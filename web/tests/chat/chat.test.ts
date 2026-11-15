// Data chat: grounding / tool layer tests. Run: cd web && npx -y vitest@2.1.9 run tests/chat
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runTool, DATA_TOOL_NAMES, PLAN_TOOL_NAMES, type Loader } from '../../src/components/chat/tools';
import { resolveCountry, findCountriesInText, karibaSummary } from '../../src/components/chat/summaries';
import { makePlanBridge, registerPlanBridge } from '../../src/components/chat/planBridge';
import { offlineAnswer } from '../../src/components/chat/offline';
import { ask, getChatState, resetChat, trimHistory, type Transport } from '../../src/components/chat/store';
import { defaultPlan, type Constraints, type Plan, type SimInput } from '../../src/lib/plan/sim';
// server module (plain JS): same tool names and the number check the worker runs
// @ts-expect-error untyped JS module
import { TOOL_NAMES, checkNumbers, allowedNumbers } from '../../../deploy/plan-worker/chat.js';

const DATA = resolve(__dirname, '../../public/data');
const read = (f: string) => JSON.parse(readFileSync(resolve(DATA, f), 'utf8'));
const load: Loader = async (f) => { try { return { data: read(f), source: 'real' }; } catch { return { data: null, source: 'missing' }; } };

describe('tool names', () => {
  it('client implements exactly the server tool list', () => {
    expect([...DATA_TOOL_NAMES, ...PLAN_TOOL_NAMES].sort()).toEqual([...TOOL_NAMES].sort());
  });
});

describe('data tools (real pipeline output)', () => {
  it.each(DATA_TOOL_NAMES)('%s returns a small, sourced result', async (name) => {
    const args = name === 'get_country' ? { country: 'Zambia' } : name === 'get_crisis_actions' ? { crisis_id: 'kariba-2024' } : {};
    const out = await runTool(name, args, load);
    expect(out.error).toBeUndefined();
    expect(String(out.source_file)).toMatch(/\.json/);
    expect(JSON.stringify(out).length).toBeLessThan(9000);
  });

  it('kariba summary copies the headline numbers from kariba.json', () => {
    const k = read('kariba.json');
    const s = karibaSummary(k);
    expect(s.latest?.usable_pct).toBe(Math.round(k.latest.usable_pct * 10) / 10);
    expect(s.dec_2027?.usable_pct_p50).toBe(Math.round(k.zra_projection.patronus_dec_2027.usable_p50 * 10) / 10);
    expect(s.dec_2027?.chance_below_danger_pct).toBe(Math.round(k.zra_projection.patronus_dec_2027.p_below_danger * 1000) / 10);
  });

  it('get_country resolves names, codes and returns Kariba for Zambia', async () => {
    const z: any = await runTool('get_country', { country: 'zmb' }, load);
    expect(z.name).toBe('Zambia');
    expect(z.kariba.dec_2027.usable_pct_p50).toBeTypeOf('number');
    expect(z.enso.exposure).toBe('el_nino_loser');
    const e: any = await runTool('get_country', { country: 'Ecuador' }, load);
    expect(e.six_month_forecast.chance_any_shortfall_6m_pct).toBe(41);
    const x: any = await runTool('get_country', { country: 'Atlantis' }, load);
    expect(x.error).toMatch(/don't track/);
  });

  it('finds countries in free text', () => {
    const c = read('countries.json');
    expect(resolveCountry('Viet', c)?.iso3).toBe('VNM');
    expect(findCountriesInText("what's the risk for Zambia?", c).map((x) => x.iso3)).toEqual(['ZMB']);
    expect(findCountriesInText('how is everything looking?', c)).toEqual([]);
  });

  it('crisis actions without id lists the crises', async () => {
    const out: any = await runTool('get_crisis_actions', {}, load);
    expect(out.crises_available.map((c: any) => c.id)).toContain('kariba-2024');
  });

  it('plan tools say so when the simulator is not open', async () => {
    const out = await runTool('set_action', { action: 'imports', on: true }, load);
    expect(out.error).toMatch(/not open/);
  });
});

describe('number grounding', () => {
  it('accepts numbers from tool results (rounded, as percent) and flags invented ones', async () => {
    const k = await runTool('get_kariba_forecast', {}, load);
    const allowed = allowedNumbers([{ role: 'user', content: 'how low could kariba get?' }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: JSON.stringify(k) }] }]);
    const d: any = (k as any).dec_2027;
    const good = `By Dec 2027 the median is ${Math.round(d.usable_pct_p50)}% usable, with a ${d.chance_below_danger_pct}% chance below the danger line.`;
    expect(checkNumbers(good, allowed).ok).toBe(true);
    expect(checkNumbers('The lake will be at 77.7% in 2031.', allowed).bad).toEqual(['77.7', '2031']);
  });
});

describe('plan bridge', () => {
  let state: { plan: Plan; limits: Constraints; opt: unknown };
  const inp = read('kariba_sim.json') as SimInput;
  beforeEach(() => { state = { plan: defaultPlan(), limits: { budgetMusd: null, maxShedH: null, voll: 'central' }, opt: null }; });
  const bridge = () => makePlanBridge(
    () => ({ inp, plan: state.plan, limits: state.limits, setPlan: () => {}, setLimits: () => {} }),
    (p) => { if (p.plan) state.plan = p.plan; if (p.limits) state.limits = p.limits; if (p.opt !== undefined) state.opt = p.opt; },
  );

  it('"can\'t import" + optimizer changes the page state and returns simulator numbers', () => {
    const out: any = bridge().apply([{ name: 'disable_action', arguments: { action: 'imports' } }, { name: 'run_optimizer', arguments: {} }]);
    expect(state.plan.imports.possible).toBe(false);
    expect(state.plan.imports.on).toBe(false);
    expect(state.opt).not.toBeNull();
    expect(out.changes[0]).toMatch(/not possible/);
    expect(out.results_after.sep_2027_storage_pct_p50).toBeTypeOf('number');
    expect(out.optimizer.why.length).toBeGreaterThan(0);
  });

  it('sequential tool calls see each other (set then budget)', () => {
    const b = bridge();
    b.apply([{ name: 'set_action', arguments: { action: 'rental', amount: 200, on: true } }]);
    const out: any = b.apply([{ name: 'set_budget', arguments: { musd: 100 } }]);
    expect(state.plan.rental.on).toBe(true);
    expect(state.plan.rental.amount).toBe(200);
    expect(state.limits.budgetMusd).toBe(100);
    expect(out.plan.rental).toMatch(/200 MW/);
  });

  it('offline: rule parser drives the registered bridge', async () => {
    const off = registerPlanBridge(bridge());
    try {
      const a = await offlineAnswer("We can't import power, what should we do?", { page: 'plan', load });
      expect(state.plan.imports.possible).toBe(false);
      expect(a.text).toMatch(/Sep 2027/);
      expect(a.changes?.join(' ')).toMatch(/not possible/);
    } finally { off(); }
  });
});

describe('offline answers', () => {
  it('country question uses the country tool', async () => {
    const a = await offlineAnswer("What's the risk for Zambia?", { page: 'map', load });
    expect(a.text).toMatch(/Zambia/);
    expect(a.text).toMatch(/Kariba/);
  });
  it('overview', async () => {
    const a = await offlineAnswer('How is everything looking?', { page: 'map', load });
    expect(a.text).toMatch(/Lake Kariba/);
    expect(a.sources).toContain('kariba.json');
  });
});

describe('conversation loop', () => {
  beforeEach(() => resetChat());

  it('runs client tools between server rounds and keeps multi-turn history', async () => {
    const seen: any[] = [];
    const t: Transport = async (body: any) => {
      seen.push(JSON.parse(JSON.stringify(body)));
      const last = body.messages[body.messages.length - 1];
      if (typeof last.content === 'string') return { status: 200, json: { type: 'tool_use', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 't1', name: 'get_country', input: { country: 'ZMB' } }] } };
      return { status: 200, json: { type: 'answer', model: 'claude-sonnet-5-5', text: 'Zambia is exposed.', content: [{ type: 'text', text: 'Zambia is exposed.' }], verified: true, unverified: [] } };
    };
    await ask("What's the risk for Zambia?", 'map', { transport: t, load });
    const s = getChatState();
    expect(s.ui.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(s.ui[1].sources?.join(',')).toMatch(/countries\.json/);
    expect(s.api.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    const tr = (s.api[2].content as any[])[0];
    expect(tr.type).toBe('tool_result');
    expect(JSON.parse(tr.content).name).toBe('Zambia');
    expect(seen[0].plan).toBe(false);
    await ask('And Zimbabwe?', 'map', { transport: t, load });
    expect(getChatState().api.length).toBe(8);
    expect(seen[2].messages.length).toBe(5); // full history sent on turn 2
  });

  it('falls back to offline answers on 503', async () => {
    await ask('How is everything looking?', 'map', { transport: async () => ({ status: 503, json: { error: 'offline' } }), load });
    const m = getChatState().ui[1];
    expect(m.via).toMatch(/Offline/);
    expect(m.text).toMatch(/Kariba/);
  });

  it('shows unverified numbers', async () => {
    await ask('x', 'map', { transport: async () => ({ status: 200, json: { type: 'answer', text: 'It is 77%.', content: null, verified: false, unverified: ['77'] } }), load });
    expect(getChatState().ui[1].warn).toMatch(/77/);
  });

  it('trimHistory drops whole turns and starts at a question', () => {
    const turn = (i: number) => [
      { role: 'user' as const, content: `q${i}` },
      { role: 'assistant' as const, content: [{ type: 'tool_use', id: `t${i}`, name: 'get_overview', input: {} }] },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'x'.repeat(100) }] },
      { role: 'assistant' as const, content: `a${i}` },
    ];
    const api = Array.from({ length: 12 }, (_, i) => turn(i)).flat();
    const out = trimHistory(api, 20, 1e9);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out[0]).toEqual({ role: 'user', content: 'q7' });
  });
});
