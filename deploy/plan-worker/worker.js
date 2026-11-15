// patronus-plan: static Patronus site (branch fd/plan-simulator) + /api/plan-chat.
// Assistant order: Claude (if the secret ANTHROPIC_API_KEY is set) -> Workers AI -> the browser's
// rule-based parser (when this endpoint fails). The model only turns a sentence into simulator tool
// calls, and explains results using ONLY the numbers the browser simulator returned (checked here
// before sending). The key never leaves the worker and is never logged.
// Cost guards: per-IP and global rate limits (Workers rate-limit bindings), 600-char input,
// small max_tokens caps, low effort.
import Anthropic from '@anthropic-ai/sdk';

const CLAUDE_MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = { plan: 700, explain: 500 };

const MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-4-scout-17b-16e-instruct'];
const ACTIONS = ['hold', 'imports', 'rental', 'demand', 'solar', 'schedule'];
const MONTHS = ['2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12'];

const TOOLS = [
  {
    name: 'set_action',
    description: 'Switch one action on or off, or change its size or start month. hold = cut Kariba releases (%); imports = emergency power imports (MW); rental = rental thermal units (MW); demand = paid demand reduction or mine curtailment (% of sheddable load); solar = fast solar (MW); schedule = published load-shedding schedule.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ACTIONS, description: 'Which action' },
        on: { type: 'boolean', description: 'true to use it, false to switch it off' },
        amount: { type: 'number', description: 'Size: percent for hold and demand, MW for imports, rental, solar' },
        start_month: { type: 'string', description: 'Decision month, YYYY-MM between 2026-12 and 2027-12' },
      },
      required: ['action'],
    },
  },
  {
    name: 'disable_action',
    description: 'Mark an action as NOT POSSIBLE (the user says it cannot be done, e.g. no imports available, no money for rentals). The optimizer will not use it.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ACTIONS } }, required: ['action'] },
  },
  {
    name: 'enable_action',
    description: 'Mark an action as possible again.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ACTIONS } }, required: ['action'] },
  },
  {
    name: 'set_limit',
    description: 'Set the most the user allows for one action (e.g. "at most 200 MW of imports").',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ACTIONS }, max: { type: 'number' } }, required: ['action', 'max'] },
  },
  {
    name: 'set_budget',
    description: 'Set the maximum money for actions in USD millions (expected cost). Use null-like 0 only if the user says no money at all.',
    parameters: { type: 'object', properties: { musd: { type: 'number', description: 'Budget in USD millions' } }, required: ['musd'] },
  },
  {
    name: 'run_optimizer',
    description: 'Find the cheapest plan (expected total cost of actions plus shortage) within the user\'s limits. Call this when the user asks what to do, for the best plan, or after they rule something out.',
    parameters: { type: 'object', properties: {} },
  },
];

const SYS_PLAN = `You control a drought simulator for Lake Kariba (Zambia), Dec 2026 to Dec 2027.
Turn the user's sentence into tool calls. Do not answer with numbers. Rules:
- "can't / cannot / no / not possible / impossible" for an action -> disable_action for it.
- Argentina, South Africa, Eskom, neighbours, the grid, importing power -> action "imports". Diesel, barges, generators, rental -> "rental". Mines, smelters, industry cuts, paying big users -> "demand". Holding back water, cutting releases -> "hold". Solar panels -> "solar". Rotating outages schedule -> "schedule".
- If the user asks what to do, for the best or cheapest plan, or rules something out, also call run_optimizer.
- Budget phrases like "only $100 million" -> set_budget.
Months are YYYY-MM. Call as many tools as needed.`;

const SYS_EXPLAIN = `You explain a drought simulation for Lake Kariba to a minister's adviser in plain English.
Use ONLY numbers that appear in the JSON you are given, copied exactly (you may drop decimals only if the JSON value has none). No other numbers, no years other than 2026 and 2027, no percentages you computed yourself.
Write money as $N million (values ending in _musd are USD millions), storage as N% usable, shedding as N hours per day.
3 to 5 short sentences. Say what changed in the plan, what the lake does by Sep 2027, how much extra load-shedding is left, and the cost. Say it is a simulation based on past El Nino years, not a forecast of what will happen.
No lists, no markdown, no greetings.`;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

function normCalls(out) {
  let calls = out?.tool_calls ?? out?.response?.tool_calls ?? out?.choices?.[0]?.message?.tool_calls ?? [];
  if (!Array.isArray(calls)) calls = [];
  return calls.map((c) => {
    const f = c.function ?? c;
    let args = f.arguments ?? f.parameters ?? {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    return { name: f.name, arguments: args };
  }).filter((c) => TOOLS.some((t) => t.name === c.name));
}

function textOf(out) {
  const r = out?.response ?? out?.choices?.[0]?.message?.content ?? out?.result?.response;
  return typeof r === 'string' ? r : null;
}

const claudeTools = () => TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

async function runClaude(env, { system, user, tools, maxTokens }) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25000 });
  const res = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: user }],
    ...(tools ? { tools: claudeTools(), tool_choice: { type: 'auto' } } : {}),
  });
  if (res.stop_reason === 'refusal') return { calls: [], text: null, model: res.model };
  const calls = res.content.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, arguments: b.input ?? {} }));
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim() || null;
  return { calls, text, model: res.model };
}

async function runModel(env, input) {
  let lastErr;
  for (const m of MODELS) {
    try { return { out: await env.AI.run(m, input), model: m }; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// every number in the text must appear in the allowed set (simulator output)
function collectNums(o, set) {
  if (typeof o === 'number') { set.add(o); return set; }
  if (typeof o === 'string') { (o.match(/-?\d+(?:\.\d+)?/g) || []).forEach((x) => set.add(+x)); return set; }
  if (o && typeof o === 'object') Object.values(o).forEach((v) => collectNums(v, set));
  return set;
}
function checkNumbers(text, allowedObj) {
  const allowed = collectNums(allowedObj, new Set([2026, 2027, 10, 20, 1, 0]));
  const found = (text.replace(/,(\d{3})/g, '$1').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const bad = found.filter((n) => ![...allowed].some((a) => Math.abs(a - n) < 1e-9 || Math.abs(Math.abs(a) - Math.abs(n)) < 1e-9 || (Math.round(a) === n && Math.abs(a - n) < 0.5)));
  return { ok: bad.length === 0, bad };
}

async function planChat(request, env) {
  if (!env.AI && !env.ANTHROPIC_API_KEY) return json({ error: 'no_model' }, 503);
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (env.CHAT_IP_LIMIT && !(await env.CHAT_IP_LIMIT.limit({ key: ip })).success) return json({ error: 'rate_limited' }, 429);
  if (env.CHAT_GLOBAL_LIMIT && !(await env.CHAT_GLOBAL_LIMIT.limit({ key: 'all' })).success) return json({ error: 'rate_limited' }, 429);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const msg = String(body.message ?? '').slice(0, 600);
  if (body.phase === 'explain') {
    const facts = { user_said: msg, plan: body.plan, limits: body.limits, results: body.results, before: body.before ?? null, optimizer: body.optimizer ?? null };
    if (JSON.stringify(facts).length > 8000) return json({ error: 'too_large' }, 413);
    let text = '', model = null;
    if (env.ANTHROPIC_API_KEY) {
      try {
        const c = await runClaude(env, { system: SYS_EXPLAIN, user: JSON.stringify(facts), maxTokens: MAX_TOKENS.explain });
        text = c.text ?? ''; model = c.model;
      } catch { /* fall through to Workers AI */ }
    }
    if (!text && env.AI) {
      const r = await runModel(env, {
        messages: [{ role: 'system', content: SYS_EXPLAIN }, { role: 'user', content: JSON.stringify(facts) }],
        max_tokens: 320, temperature: 0.2,
      });
      text = (textOf(r.out) ?? '').trim(); model = r.model;
    }
    const chk = checkNumbers(text, facts);
    return json({ text: chk.ok && text ? text : null, rejected: chk.ok ? null : chk.bad, model });
  }
  if (JSON.stringify(body.plan ?? {}).length + JSON.stringify(body.limits ?? {}).length > 3000) return json({ error: 'too_large' }, 413);
  const userText = `Current plan: ${JSON.stringify(body.plan ?? {})}. Limits: ${JSON.stringify(body.limits ?? {})}.\nUser: ${msg}`;
  let raw = null, model = null;
  if (env.ANTHROPIC_API_KEY) {
    try {
      const c = await runClaude(env, { system: SYS_PLAN + '\nAlways answer by calling tools; do not reply in prose.', user: userText, tools: true, maxTokens: MAX_TOKENS.plan });
      raw = c.calls; model = c.model;
    } catch { raw = null; }
  }
  if ((!raw || !raw.length) && env.AI) {
    const r = await runModel(env, {
      messages: [{ role: 'system', content: SYS_PLAN }, { role: 'user', content: userText }],
      tools: TOOLS, max_tokens: 400, temperature: 0,
    });
    raw = normCalls(r.out); model = r.model;
  }
  const calls = (raw ?? []).map((c) => {
    const a = c.arguments ?? {};
    if (a.start_month && !MONTHS.includes(a.start_month)) delete a.start_month;
    return { name: c.name, arguments: a };
  });
  return json({ tool_calls: calls, model });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/plan-chat') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      try { return await planChat(request, env); } catch { return json({ error: 'ai_failed' }, 502); }
    }
    if (url.pathname === '/api/health') return json({ ok: true, workers_ai: !!env.AI, claude: !!env.ANTHROPIC_API_KEY });
    return env.ASSETS.fetch(request);
  },
};
