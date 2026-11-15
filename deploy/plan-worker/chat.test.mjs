// Server tests for /api/chat (no network, no SDK): node --test deploy/plan-worker/chat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleChat, validateBody, toolRounds, checkNumbers, allowedNumbers, LIMITS } from './chat.js';

const req = (body, method = 'POST') => new Request('http://x/api/chat', { method, body: method === 'POST' ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json' } });
const read = async (r) => ({ status: r.status, json: await r.json() });

test('no key -> 503 offline (browser falls back)', async () => {
  const r = await read(await handleChat(req({ messages: [{ role: 'user', content: 'hi' }] }), {}));
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'offline');
});

test('GET -> 405', async () => {
  assert.equal((await handleChat(req(null, 'GET'), {})).status, 405);
});

test('validation: caps and shapes', () => {
  assert.equal(validateBody({ messages: [] }, 10).error, 'no_messages');
  assert.equal(validateBody({ messages: [{ role: 'assistant', content: 'x' }] }, 10).error, 'first_must_be_user');
  assert.equal(validateBody({ messages: [{ role: 'user', content: 'x'.repeat(LIMITS.userChars + 1) }] }, 10).error, 'message_too_long');
  assert.equal(validateBody({ messages: [{ role: 'user', content: 'x' }] }, LIMITS.bodyBytes + 1).error, 'too_large');
  assert.equal(validateBody({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: [{ type: 'tool_use', name: 'bash', id: '1', input: {} }] }, { role: 'user', content: 'y' }] }, 10).error, 'unknown_tool');
  assert.equal(validateBody({ messages: [{ role: 'user', content: 'x' }, { role: 'system', content: 'y' }] }, 10).error, 'bad_role');
  assert.ok(validateBody({ messages: [{ role: 'user', content: 'x' }] }, 10).messages);
});

test('rate limit binding is honoured', async () => {
  const env = { ANTHROPIC_API_KEY: 'k', CHAT_IP_LIMIT: { limit: async () => ({ success: false }) } };
  assert.equal((await handleChat(req({ messages: [{ role: 'user', content: 'x' }] }), env)).status, 429);
});

test('tool_use passes through; plan tools only in plan mode', async () => {
  let seen;
  const claude = async (a) => { seen = a; return { stop_reason: 'tool_use', model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id: 't', name: 'get_overview', input: {} }] }; };
  const r = await read(await handleChat(req({ messages: [{ role: 'user', content: 'how is it?' }], page: 'map' }), {}, { claude }));
  assert.equal(r.json.type, 'tool_use');
  assert.ok(!seen.tools.some((t) => t.name === 'set_action'));
  await handleChat(req({ messages: [{ role: 'user', content: 'x' }], page: 'plan', plan: true }), {}, { claude });
  assert.ok(seen.tools.some((t) => t.name === 'set_action'));
  assert.match(seen.system, /plan simulator is open/);
});

test('answer with unsupported number gets one corrective retry', async () => {
  const msgs = [
    { role: 'user', content: 'kariba?' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'get_kariba_forecast', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: JSON.stringify({ dec_2027: { usable_pct_p50: 31.2, chance_below_danger_pct: 36.4 } }) }] },
  ];
  let calls = 0;
  const claude = async (a) => {
    calls++;
    if (calls === 1) return { stop_reason: 'end_turn', model: 'm', content: [{ type: 'text', text: 'Median 31% but maybe 55%.' }] };
    assert.equal(a.noTools, true);
    assert.match(a.messages.at(-1).content, /55/);
    return { stop_reason: 'end_turn', model: 'm', content: [{ type: 'text', text: 'Median 31.2%, 36% chance below danger.' }] };
  };
  const r = await read(await handleChat(req({ messages: msgs }), {}, { claude }));
  assert.equal(calls, 2);
  assert.equal(r.json.verified, true);
  assert.equal(r.json.text, 'Median 31.2%, 36% chance below danger.');
});

test('still-unsupported numbers are returned flagged', async () => {
  const claude = async () => ({ stop_reason: 'end_turn', model: 'm', content: [{ type: 'text', text: 'It is 77%.' }] });
  const r = await read(await handleChat(req({ messages: [{ role: 'user', content: 'x' }] }), {}, { claude }));
  assert.equal(r.json.verified, false);
  assert.deepEqual(r.json.unverified, ['77']);
});

test('tool rounds cap forces a text answer', async () => {
  const msgs = [{ role: 'user', content: 'x' }];
  for (let i = 0; i < LIMITS.toolRounds; i++) {
    msgs.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'get_overview', input: {} }] });
    msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: '{}' }] });
  }
  assert.equal(toolRounds(msgs), LIMITS.toolRounds);
  let seen;
  await handleChat(req({ messages: msgs }), {}, { claude: async (a) => { seen = a; return { stop_reason: 'end_turn', model: 'm', content: [{ type: 'text', text: 'ok' }] }; } });
  assert.equal(seen.noTools, true);
});

test('number check: rounding, percent of probabilities, thousands separators', () => {
  const allowed = allowedNumbers([{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: JSON.stringify({ p: 0.3636, gw: 1053.2, d: '2027-09' }) }] }]);
  assert.ok(checkNumbers('36% chance, 1,053 GW by Sep 2027', allowed).ok);
  assert.deepEqual(checkNumbers('40% chance', allowed).bad, ['40']);
});
