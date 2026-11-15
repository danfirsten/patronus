// POST /api/chat: the Patronus data chat (floating bubble / dock on the data pages).
//
// Stateless tool-use loop with CLIENT-side tools. The browser holds the conversation and the data
// (web/public/data/*.json) and the plan simulator. Each request carries the whole (capped)
// conversation in Anthropic message format. When Claude asks for tools, this endpoint returns the
// assistant turn; the browser runs the tools and posts again with the tool results appended. When
// Claude answers in text, the endpoint checks that every number in the answer appears in a tool
// result (or the user's own words) before returning it.
//
// The key comes ONLY from the worker secret ANTHROPIC_API_KEY; it is never sent to the browser
// or logged. Without the key the endpoint answers 503 {error:"offline"} and the browser falls back
// to its rule-based answers (data templates + the simulator phrase parser).
//
// Guards: the same per-IP / global rate-limit bindings as /api/plan-chat (CHAT_IP_LIMIT,
// CHAT_GLOBAL_LIMIT), 600-char user messages, 48 KB body, 40 messages, 6 tool rounds per
// question, max_tokens 900, effort low.

export const CLAUDE_MODEL = 'claude-sonnet-5-5';
export const LIMITS = { bodyBytes: 48_000, messages: 40, userChars: 600, toolRounds: 6, maxTokens: 900 };

const ACTIONS = ['hold', 'imports', 'rental', 'demand', 'solar', 'schedule'];
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });

/** Data tools: available on every data page. Executed in the browser from web/public/data. */
export const DATA_TOOLS = [
  { name: 'get_overview', description: 'Headline status of everything Patronus tracks: Lake Kariba now and its forecast, the El Nino outlook, countries on alarm in the 6-month watchlist, the global drying-trend split, and the backtest track record. Use for "how is everything looking?".', input_schema: obj() },
  { name: 'get_kariba_forecast', description: 'Lake Kariba (Zambia/Zimbabwe): latest satellite level, monthly forecast to Dec 2027 (usable % p10/p50/p90, chance below 20% warning and 10% danger), ZRA projection, El Nino outlook, the 2024 crisis facts, and the cost-of-waiting summary.', input_schema: obj() },
  { name: 'get_country', description: 'Everything we have for one country: hydro share, 6-month shortfall forecast and alarm (tier 1 countries), El Nino / La Nina exposure, drying-trend basins. Zambia and Zimbabwe also include the Kariba headline.', input_schema: obj({ country: { type: 'string', description: 'ISO3 code (e.g. ZMB, ECU, CHN-SC) or English country name' } }, ['country']) },
  { name: 'get_watchlist', description: 'The 6-month shortfall watchlist: every tier-1 country with risk level, chance of any shortfall in the next 6 months, and whether it is on alarm.', input_schema: obj() },
  { name: 'get_enso_exposure', description: 'El Nino outlook and which countries lose hydropower under El Nino or La Nina (exposure, effect %, p-value).', input_schema: obj({ country: { type: 'string', description: 'Optional ISO3 to get one country only' } }) },
  { name: 'get_drying_trends', description: 'GRACE/GRACE-FO water-storage trends of hydro basins (Mann-Kendall + Sen slope, FDR): global split and the largest drying basins, optionally for one country.', input_schema: obj({ country: { type: 'string', description: 'Optional ISO3' } }) },
  { name: 'get_scoreboard', description: 'Track record: past crises and whether Patronus would have caught them (hits, misses, lead months), plus the global reservoir backtest.', input_schema: obj() },
  { name: 'get_crisis_actions', description: 'What governments actually did in past hydro crises (actions, dates, costs) from the remediation dataset. Without crisis_id, lists the crises available.', input_schema: obj({ crisis_id: { type: 'string', description: 'e.g. kariba-2024, ecuador-2024' } }) },
  { name: 'get_sources', description: 'Datasets and NASA missions the numbers come from, with licences.', input_schema: obj() },
];

/** Plan tools: only on the Plan page (#/plan) and the dashboard, where the simulator is mounted. */
export const PLAN_TOOLS = [
  { name: 'get_plan', description: 'Current Kariba 2027 plan in the simulator, its results (lake in Sep 2027, extra load-shedding, costs) and the no-action baseline.', input_schema: obj() },
  { name: 'set_action', description: 'Switch one action on or off, or change its size or start month. hold = cut Kariba releases (%); imports = emergency power imports (MW); rental = rental thermal units (MW); demand = paid demand reduction or mine curtailment (% of sheddable load); solar = fast solar (MW); schedule = published load-shedding schedule. Returns the re-simulated results.', input_schema: obj({ action: { type: 'string', enum: ACTIONS }, on: { type: 'boolean' }, amount: { type: 'number', description: 'percent for hold and demand, MW for imports, rental, solar' }, start_month: { type: 'string', description: 'Decision month YYYY-MM, 2026-12 to 2027-12' } }, ['action']) },
  { name: 'disable_action', description: 'Mark an action NOT POSSIBLE (the user says it cannot be done). The optimizer will not use it.', input_schema: obj({ action: { type: 'string', enum: ACTIONS } }, ['action']) },
  { name: 'enable_action', description: 'Mark an action as possible again.', input_schema: obj({ action: { type: 'string', enum: ACTIONS } }, ['action']) },
  { name: 'set_limit', description: 'The most the user allows for one action (e.g. "at most 200 MW of imports").', input_schema: obj({ action: { type: 'string', enum: ACTIONS }, max: { type: 'number' } }, ['action', 'max']) },
  { name: 'set_budget', description: 'Maximum money for actions, USD millions.', input_schema: obj({ musd: { type: 'number' } }, ['musd']) },
  { name: 'run_optimizer', description: 'Find the cheapest plan (actions + shortage cost) within the user\'s limits and apply it. Call after the user rules something out or asks what to do.', input_schema: obj() },
];

export const TOOL_NAMES = [...DATA_TOOLS, ...PLAN_TOOLS].map((t) => t.name);

export function systemPrompt(page, planMode) {
  return `You are the Patronus data assistant. Patronus uses NASA water data (GRACE/GRACE-FO storage, G-REALM lake levels, GPCP and NASA POWER rain, ENSO) to warn hydropower-dependent countries of power shortfalls. Showpiece: Lake Kariba (Zambia/Zimbabwe), forecast to Dec 2027.

Rules:
- Every number you write must come from a tool result in this conversation, copied as given (you may round, and write probabilities like 0.36 as 36%). If no tool has the number, say "we don't have that" instead of estimating. Never use outside knowledge for numbers.
- Call tools first, then answer. Name the dataset or file you used in a short "Source:" line at the end (e.g. "Source: kariba.json (G-REALM, NASA POWER)").
- Plain English for a science-literate reader. 2 to 5 short sentences, no markdown headings, no tables. Bullets only if the user asks for a list.
- Forecasts are probabilities, not certainties; say so when it matters. Mention misses and limits when asked about skill.
- Talk the user through their situation; ask one short question back only if you truly need it.
${planMode ? `- The Kariba 2027 plan simulator is open. When the user says what they can or cannot do, change it with the plan tools (disable_action for "can't", set_action, set_limit, set_budget), then run_optimizer if they ask what to do or rule something out, then explain what changed using the numbers the tools returned. The simulator is a simulation over past El Nino years, not a forecast of what will happen.` : '- The plan simulator is not open on this page. For "what should we do" questions about Kariba, say the Plan page (#/plan) can simulate options, and use get_crisis_actions for what others did.'}
The user is on page: ${String(page || 'unknown').slice(0, 40)}.`;
}

// ---------------------------------------------------------------- number check

/** Collect every number appearing in a value (numbers, and digits inside strings). */
export function collectNums(o, set = new Set()) {
  if (typeof o === 'number' && Number.isFinite(o)) { set.add(o); return set; }
  if (typeof o === 'string') {
    (o.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(?:\.\d+)?/g) || []).forEach((x) => set.add(+x));
    return set;
  }
  if (Array.isArray(o)) { o.forEach((v) => collectNums(v, set)); return set; }
  // keys count too: field names like chance_any_shortfall_6m_pct carry the units the answer may repeat
  if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => { collectNums(k, set); collectNums(v, set); });
  return set;
}

/**
 * Numbers the answer may use: only numbers from SUCCESSFUL tool results (not marked is_error, no
 * top-level "error"). No seeded constants and nothing from the user's own text: a number the user
 * typed is not evidence, so repeating it back must not earn the "checked against the data" label.
 */
export function allowedNumbers(messages) {
  const set = new Set();
  const take = (raw) => {
    let v = raw;
    if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { v = raw; } }
    if (v && typeof v === 'object' && !Array.isArray(v) && 'error' in v) return; // failed tool
    collectNums(v, set);
  };
  for (const m of messages) {
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    for (const b of m.content || []) {
      if (b.type !== 'tool_result' || b.is_error) continue;
      if (typeof b.content === 'string') take(b.content);
      else if (Array.isArray(b.content)) b.content.forEach((x) => x.type === 'text' && take(x.text));
    }
  }
  return set;
}

/** Remove structural list numbering ("1. ", "2) " at the start of a line); it is not a claim. */
export function stripListNumbering(text) {
  return String(text).replace(/^(\s*)\d{1,2}[.)](?=\s)/gm, '$1');
}

function decimals(s) { const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }

/** Every number in text must match an allowed number, allowing rounding and 0.36 -> 36%. */
export function checkNumbers(text, allowed) {
  const tokens = (stripListNumbering(text).replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(?:\.\d+)?/g) || []);
  const vals = [...allowed];
  const bad = [];
  for (const tok of tokens) {
    const n = +tok;
    const tol = 0.5 * 10 ** -decimals(tok) + 1e-9;
    const ok = vals.some((a) => Math.abs(Math.abs(a) - n) <= tol || Math.abs(Math.abs(a) * 100 - n) <= tol);
    if (!ok) bad.push(tok);
  }
  return { ok: bad.length === 0, bad: [...new Set(bad)] };
}

// ---------------------------------------------------------------- validation

/** Validate and normalise the client conversation. Returns {messages} or {error,status}. */
export function validateBody(body, rawLength) {
  if (rawLength > LIMITS.bodyBytes) return { error: 'too_large', status: 413 };
  const msgs = body?.messages;
  if (!Array.isArray(msgs) || !msgs.length) return { error: 'no_messages', status: 400 };
  if (msgs.length > LIMITS.messages) return { error: 'too_many_messages', status: 413 };
  if (msgs[0].role !== 'user') return { error: 'first_must_be_user', status: 400 };
  const out = [];
  for (const m of msgs) {
    if (m.role !== 'user' && m.role !== 'assistant') return { error: 'bad_role', status: 400 };
    if (typeof m.content === 'string') {
      if (m.role === 'user' && m.content.length > LIMITS.userChars) return { error: 'message_too_long', status: 413 };
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) return { error: 'bad_content', status: 400 };
    for (const b of m.content) {
      if (b.type === 'tool_use' && !TOOL_NAMES.includes(b.name)) return { error: 'unknown_tool', status: 400 };
      if (m.role === 'user' && b.type === 'text' && String(b.text).length > LIMITS.userChars) return { error: 'message_too_long', status: 413 };
    }
    out.push({ role: m.role, content: m.content });
  }
  if (out[out.length - 1].role !== 'user') return { error: 'last_must_be_user', status: 400 };
  return { messages: out };
}

/** Tool rounds since the last plain user question. */
export function toolRounds(messages) {
  let n = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const isQuestion = m.role === 'user' && (typeof m.content === 'string' || m.content.some((b) => b.type === 'text'));
    if (isQuestion) break;
    if (m.role === 'assistant') n++;
  }
  return n;
}

// ---------------------------------------------------------------- handler

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function callClaude(env, { system, messages, tools, noTools }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25000 });
  return client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: LIMITS.maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system,
    messages,
    tools,
    tool_choice: { type: noTools ? 'none' : 'auto' },
  });
}

/**
 * Handle POST /api/chat. `deps.claude` can replace the Claude call in tests.
 * Response: {type:"tool_use", content, model} | {type:"answer", text, content, model, verified, unverified}
 *         | {error} with 4xx/5xx (503 {error:"offline"} when no key is set).
 */
export async function handleChat(request, env, deps = {}) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!env.ANTHROPIC_API_KEY && !deps.claude) return json({ error: 'offline', reason: 'no_key' }, 503);
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (env.CHAT_IP_LIMIT && !(await env.CHAT_IP_LIMIT.limit({ key: ip })).success) return json({ error: 'rate_limited' }, 429);
  if (env.CHAT_GLOBAL_LIMIT && !(await env.CHAT_GLOBAL_LIMIT.limit({ key: 'all' })).success) return json({ error: 'rate_limited' }, 429);
  const raw = await request.text();
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'bad_json' }, 400); }
  const v = validateBody(body, raw.length);
  if (v.error) return json({ error: v.error }, v.status);
  const planMode = body.plan === true;
  const tools = planMode ? [...DATA_TOOLS, ...PLAN_TOOLS] : DATA_TOOLS;
  const system = systemPrompt(body.page, planMode);
  const call = deps.claude ?? ((args) => callClaude(env, args));
  const noTools = toolRounds(v.messages) >= LIMITS.toolRounds;

  let res;
  try { res = await call({ system, messages: v.messages, tools, noTools }); } catch { return json({ error: 'ai_failed' }, 502); }
  if (res.stop_reason === 'refusal') return json({ type: 'answer', text: "I can't help with that one. Ask me about the hydropower data, Kariba, or the plan.", content: null, model: res.model, verified: true, unverified: [] });
  if (res.stop_reason === 'tool_use') {
    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (uses.every((b) => TOOL_NAMES.includes(b.name))) return json({ type: 'tool_use', content: res.content, model: res.model });
  }
  let text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  let content = res.content;
  const allowed = allowedNumbers(v.messages);
  let chk = checkNumbers(text, allowed);
  if (!chk.ok) {
    // one corrective retry: same conversation, the draft, and a note naming the unsupported numbers
    try {
      const retry = await call({
        system, tools, noTools: true,
        messages: [...v.messages, { role: 'assistant', content: res.content.filter((b) => b.type !== 'tool_use') },
          { role: 'user', content: `(Automatic check, not from the user: these numbers are not in any tool result: ${chk.bad.join(', ')}. Rewrite the answer using only numbers from the tool results, or say we don't have that.)` }],
      });
      const t2 = retry.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const c2 = checkNumbers(t2, allowed);
      if (t2 && c2.ok) { text = t2; chk = c2; content = null; }
    } catch { /* keep the first draft, flagged */ }
  }
  return json({ type: 'answer', text, content, model: res.model, verified: chk.ok, unverified: chk.bad });
}
