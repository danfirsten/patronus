/**
 * Plan simulator for Lake Kariba, Dec 2026 - Dec 2027. Client-side, monthly, deterministic.
 *
 * Water: the same balance as pipeline/kariba_sim.py and KaribaSim.tsx (Dan):
 *     S[m+1] = min(S[m] + Q[Y, m] - R[m], capacity),  R[m] = min(target[m], max(S[m] + Q[Y, m], 0))
 * with Q[Y, m] the net inflow of El Nino analog year Y (kariba_sim.json), index 0 = rest of
 * Nov 2026 pro-rated, start = latest satellite storage.
 *
 * Energy (Zambia / ZESCO scope, as in future-detector/hydro/kariba_cf): ZESCO uses half the
 * release (Kariba North); Zimbabwe is assumed to follow the same release policy, so the whole
 * lake moves with it. Need = what the 2027 allocation plan would generate for ZESCO
 * (0.22 TWh/BCM). Whatever Kariba does not generate must come from the actions the user
 * switches on (rental, solar, paid demand reduction, imports, in that dispatch order), or is
 * shed. Load-shedding hours/day = unserved MW / 1,520 MW sheddable load x 24 (kariba_cf
 * calibration on 31 Jul 2024). These are EXTRA hours beyond what the 2027 allocation implies.
 *
 * Costs (USD M, ZESCO scope): imports 17 c/kWh (ZESCO ERB filing Jul 2024, Eskom contracted);
 * rental thermal $0.17M per MW-month from arrival to Dec 2027 (same filing: 300 MW = $51M/month);
 * paid demand reduction $93/MWh (Brazil 2021 bonus, playbook); solar: no case cost in the playbook,
 * priced at the 17 c import rate as a labelled placeholder; unserved energy at VoLL $0.5-1.5/kWh (Dan)
 * with the macro-calibrated $0.13/kWh line (KARIBA-CF.md). Water left in the lake at end-2027
 * above the no-action path is credited at the contracted price (Dan's terminal credit).
 */

export interface SimYear { year: number; season: string; oni_djf: number; phase: string; qnet_bcm: number[] }
export interface SimInput {
  issue_date: string;
  start: { date: string; level_m: number; usable_bcm: number; usable_pct: number; first_month_fraction: number };
  months: string[];
  capacity_bcm: number;
  thresholds: { warning_usable_pct: number; danger_usable_pct: number };
  releases: { allocation_2026_bcm: number; allocation_2027_bcm: number; monthly_plan_bcm: number[] };
  years: SimYear[];
  pools: Record<string, number[]>;
  energy: { twh_per_bcm: number; twh_per_bcm_range: [number, number] };
  costs: { contracted_usd_per_kwh: number; emergency_usd_per_kwh: number; voll_usd_per_kwh: number; voll_range_usd_per_kwh: [number, number] };
}

export type ActionId = 'hold' | 'imports' | 'rental' | 'demand' | 'solar' | 'schedule';

export interface ActionState {
  on: boolean;
  /** false = "not possible" (user says this cannot be done); optimizer will not use it */
  possible: boolean;
  /** MW for imports/rental/solar, % for hold/demand; unused for schedule */
  amount: number;
  /** decision month, index into months (1 = Dec 2026 .. 13 = Dec 2027) */
  start: number;
  /** max amount the user allows (optimizer bound) */
  max: number;
}
export type Plan = Record<ActionId, ActionState>;

export interface ActionMeta {
  id: ActionId;
  title: string;
  unit: '%' | 'MW' | '';
  lead: number;           // months from decision to effect
  leadText: string;       // from playbook.json
  costText: string;
  step: number;
  hardMax: number;
  playbookId: string;
}

/** Lead times and costs: patronus-playbook/playbook.json (observed in the cases) unless noted. */
export const ACTIONS: ActionMeta[] = [
  { id: 'hold', title: 'Hold water: cut Kariba releases', unit: '%', lead: 0, step: 5, hardMax: 50, playbookId: 'hold_water_early',
    leadText: 'Decision in days to weeks; observed 0-1 month (3 cases). Starts the month you decide.',
    costText: 'No cash cost; the energy not generated must be covered by other actions or it is shed.' },
  { id: 'imports', title: 'Emergency imports', unit: 'MW', lead: 1, step: 50, hardMax: 650, playbookId: 'emergency_imports',
    leadText: 'Days to about 1 month over existing lines (5 cases). Zambia had about 410 MW by Jul 2024, +218 MW from Aug 2024.',
    costText: '17 c/kWh used (Eskom contracted, ZESCO ERB filing Jul 2024). The region may be in the same drought.' },
  { id: 'rental', title: 'Rental thermal (diesel units, barges)', unit: 'MW', lead: 3, step: 50, hardMax: 600, playbookId: 'rent_capacity_barges',
    leadText: '3 weeks to 18 months (6 cases); 3 months assumed here. Ecuador 2024: barge awarded 1 Aug, running 17 Sep.',
    costText: '$0.17M per MW per month from arrival to Dec 2027, used or not (ZESCO filing: 300 MW = $51M/month).' },
  { id: 'demand', title: 'Paid demand reduction / mine curtailment', unit: '%', lead: 1, step: 5, hardMax: 30, playbookId: 'paid_demand_reduction',
    leadText: 'About 1-4 weeks to launch (3 cases). % of the 1,520 MW sheddable load.',
    costText: '$93/MWh reduced (Brazil 2021 bonus), paid only when used.' },
  { id: 'solar', title: 'Fast solar', unit: 'MW', lead: 9, step: 50, hardMax: 400, playbookId: 'fast_solar',
    leadText: 'Not measured in the cases; 9 months assumed. Daytime only (22% capacity factor assumed).',
    costText: 'No solar cost in the case evidence: priced at the 17 c/kWh import rate as a placeholder. Lead time and 22% capacity factor are assumptions.' },
  { id: 'schedule', title: 'Published load-shedding schedule', unit: '', lead: 0, step: 1, hardMax: 1, playbookId: 'scheduled_load_shedding',
    leadText: 'Days (12 cases). Spreads the unavoidable shortage evenly so the lake does not hit its floor.',
    costText: 'No direct cost. Best case: the model re-plans the schedule knowing each year\'s rain.' },
];
export const ACTION = Object.fromEntries(ACTIONS.map((a) => [a.id, a])) as Record<ActionId, ActionMeta>;

export const K = {
  HOURS: 730,
  ZESCO_SHARE: 0.5,
  L_SHED_MW: 1520,
  IMPORT_USD_KWH: 0.17,
  RENTAL_MUSD_PER_MW_MONTH: 51 / 300,
  DEMAND_USD_KWH: 0.093,
  SOLAR_USD_KWH: 0.17, // placeholder: no solar cost in the case evidence, priced at the import rate
  SOLAR_CF: 0.22,
  DAYLIGHT_SHARE: 10 / 24,
  VOLL: 1.0,
  VOLL_RANGE: [0.5, 1.5] as [number, number],
  VOLL_MACRO: 0.13,
};

export function defaultPlan(): Plan {
  return {
    hold: { on: false, possible: true, amount: 20, start: 2, max: 50 },
    imports: { on: false, possible: true, amount: 300, start: 1, max: 650 },
    rental: { on: false, possible: true, amount: 200, start: 1, max: 600 },
    demand: { on: false, possible: true, amount: 10, start: 1, max: 30 },
    solar: { on: false, possible: true, amount: 100, start: 1, max: 400 },
    schedule: { on: false, possible: true, amount: 1, start: 1, max: 1 },
  };
}

export interface YearRun {
  year: number;
  pct: number[];       // month-end usable %, months 1..13
  shedH: number[];     // extra load-shedding h/day, months 1..13
  unservedGwh: number;
  importGwh: number; demandGwh: number; solarGwh: number; rentalGwh: number;
  costImports: number; costRental: number; costDemand: number; costSolar: number;
  credit: number;      // terminal water credit vs no action, $M
  sEnd: number;
}

export interface Result {
  months: string[];                    // 13 labels, Dec 2026 .. Dec 2027
  years: number[];
  runs: YearRun[];
  fan: { p10: number[]; p50: number[]; p90: number[] };
  shedMean: number[]; shedP90: number[];
  peakShedMean: number; peakShedMeanMonth: string; peakShedP90: number;
  unservedGwhMean: number; unservedGwhP90: number;
  actionCost: { imports: number; rental: number; demand: number; solar: number; total: number };
  credit: number;
  shortageCost: { voll: number; low: number; high: number; macro: number };
  total: { voll: number; low: number; high: number; macro: number };
  nBelow10Sep: number; nBelow20Sep: number; nHitFloor: number;
  sepP50: number; sepP10: number;
}

const mwPerBcmYr = (inp: SimInput) => (inp.energy.twh_per_bcm * 1e6) / 8760;

function quant(v: number[], p: number) {
  const s = [...v].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

function active(a: ActionState, meta: ActionMeta, i: number) {
  return a.on && a.possible && i >= a.start + meta.lead;
}

interface MonthOut { S: number; Kz: number; U: number; imp: number; dem: number; sol: number; ren: number; forced: boolean }

/** One month's dispatch. targetTotal = whole-lake release target (BCM in the month). */
function step(inp: SimInput, S: number, q: number, targetTotal: number, needZ: number,
  sup: { ren: number; sol: number; dem: number; imp: number }): MonthOut {
  const mw = mwPerBcmYr(inp);
  // rental is paid for anyway: when it is on the grid, it displaces Kariba water first
  const KzTarget0 = (targetTotal / 2) * 12 * mw;
  const renUse0 = Math.min(sup.ren, needZ);
  const KzTarget = Math.min(KzTarget0, Math.max(needZ - renUse0, 0));
  const tgt = (KzTarget / (12 * mw)) * 2;
  const rel = Math.min(tgt, Math.max(S + q, 0));
  const forced = rel < tgt - 1e-9;
  const S2 = Math.min(S + q - rel, inp.capacity_bcm);
  const Kz = (rel / 2) * 12 * mw;
  let d = Math.max(needZ - Kz, 0);
  const ren = Math.min(sup.ren, d); d -= ren;
  const sol = Math.min(sup.sol, d * K.DAYLIGHT_SHARE); d -= sol;
  const dem = Math.min(sup.dem, d); d -= dem;
  const imp = Math.min(sup.imp, d); d -= imp;
  return { S: S2, Kz, U: d, imp, dem, sol, ren, forced };
}

function runYear(inp: SimInput, plan: Plan, y: SimYear, sEndNoAction: number | null): YearRun {
  const mw = mwPerBcmYr(inp);
  const frac0 = inp.start.first_month_fraction;
  const n = inp.months.length; // 14
  const plan_bcm = inp.releases.monthly_plan_bcm;
  const A = ACTION;
  // per-month supplies and targets (independent of the water path)
  const needZ: number[] = [], tgtHold: number[] = [], sups: { ren: number; sol: number; dem: number; imp: number }[] = [];
  for (let i = 0; i < n; i++) {
    const pm = plan_bcm[i];
    needZ.push((pm / 2) * 12 * mw);
    const cut = active(plan.hold, A.hold, i) ? plan.hold.amount / 100 : 0;
    tgtHold.push(pm * (1 - cut) * (i === 0 ? frac0 : 1));
    sups.push({
      ren: active(plan.rental, A.rental, i) ? plan.rental.amount : 0,
      sol: active(plan.solar, A.solar, i) ? plan.solar.amount * K.SOLAR_CF : 0,
      dem: active(plan.demand, A.demand, i) ? (plan.demand.amount / 100) * K.L_SHED_MW : 0,
      imp: active(plan.imports, A.imports, i) ? plan.imports.amount : 0,
    });
  }
  const q = y.qnet_bcm.map((v, i) => (i === 0 ? v * frac0 : v));

  const simulate = (u: number | null) => {
    let S = inp.start.usable_bcm;
    const outs: MonthOut[] = [];
    let anyForced = false;
    for (let i = 0; i < n; i++) {
      let tgt = tgtHold[i];
      if (u !== null && i >= plan.schedule.start && plan.schedule.on && plan.schedule.possible) {
        // published flat schedule: Kariba covers what other supply cannot, beyond a constant depth u
        const s = sups[i];
        const other = Math.min(s.ren + s.dem + s.imp + Math.min(s.sol, needZ[i] * K.DAYLIGHT_SHARE), needZ[i]);
        const resid = Math.max(needZ[i] - other, 0);
        const kz = Math.max(resid - u, 0);
        tgt = Math.min(tgt, (kz / (12 * mw)) * 2);
      }
      const o = step(inp, S, q[i], tgt, needZ[i], sups[i]);
      if (o.forced && i >= 1) anyForced = true;
      S = o.S;
      outs.push(o);
    }
    return { outs, anyForced, S };
  };

  let res = simulate(null);
  if (plan.schedule.on && plan.schedule.possible && res.anyForced) {
    // shallowest constant depth that keeps the lake off its floor (kariba_cf method)
    let lo = 0, hi = Math.max(...needZ);
    if (!simulate(hi).anyForced) {
      for (let k = 0; k < 28; k++) {
        const mid = (lo + hi) / 2;
        if (simulate(mid).anyForced) lo = mid; else hi = mid;
      }
      res = simulate(hi);
    }
  }
  const outs = res.outs;
  const g = (mwv: number) => (mwv * K.HOURS) / 1000; // GWh in a month
  let unserved = 0, impG = 0, demG = 0, solG = 0, renG = 0, renMonths = 0;
  const pct: number[] = [], shedH: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = outs[i];
    const w = i === 0 ? frac0 : 1;
    unserved += g(o.U) * w; impG += g(o.imp) * w; demG += g(o.dem) * w; solG += g(o.sol) * w; renG += g(o.ren) * w;
    if (sups[i].ren > 0) renMonths += w;
    if (i >= 1) {
      pct.push((100 * o.S) / inp.capacity_bcm);
      shedH.push(Math.min(24, (o.U / K.L_SHED_MW) * 24));
    }
  }
  const sEnd = res.S;
  const credit = sEndNoAction === null ? 0
    : ((sEnd - sEndNoAction) / 2) * inp.energy.twh_per_bcm * 1000 * K.IMPORT_USD_KWH;
  return {
    year: y.year, pct, shedH, unservedGwh: unserved, importGwh: impG, demandGwh: demG, solarGwh: solG, rentalGwh: renG,
    costImports: impG * K.IMPORT_USD_KWH, costRental: plan.rental.amount * K.RENTAL_MUSD_PER_MW_MONTH * renMonths,
    costDemand: demG * K.DEMAND_USD_KWH, costSolar: solG * K.SOLAR_USD_KWH, credit, sEnd,
  };
}

const NO_ACTION = (() => {
  const p = defaultPlan();
  (Object.keys(p) as ActionId[]).forEach((k) => (p[k].on = false));
  return p;
})();

const baseCache = new WeakMap<SimInput, Map<number, number>>();
function noActionEnd(inp: SimInput, y: SimYear) {
  let m = baseCache.get(inp);
  if (!m) { m = new Map(); baseCache.set(inp, m); }
  if (!m.has(y.year)) m.set(y.year, runYear(inp, NO_ACTION, y, null).sEnd);
  return m.get(y.year)!;
}

export function scenarioYears(inp: SimInput, pool = 'el_nino') {
  const ids = new Set(inp.pools[pool] ?? []);
  return inp.years.filter((y) => ids.has(y.year));
}

export function simulatePlan(inp: SimInput, plan: Plan, pool = 'el_nino'): Result {
  const ys = scenarioYears(inp, pool);
  const runs = ys.map((y) => runYear(inp, plan, y, noActionEnd(inp, y)));
  const labels = inp.months.slice(1);
  const nM = labels.length;
  const col = (f: (r: YearRun) => number[], j: number) => runs.map((r) => f(r)[j]);
  const fan = { p10: [] as number[], p50: [] as number[], p90: [] as number[] };
  const shedMean: number[] = [], shedP90: number[] = [];
  for (let j = 0; j < nM; j++) {
    const v = col((r) => r.pct, j);
    fan.p10.push(quant(v, 0.1)); fan.p50.push(quant(v, 0.5)); fan.p90.push(quant(v, 0.9));
    const h = col((r) => r.shedH, j);
    shedMean.push(mean(h)); shedP90.push(quant(h, 0.9));
  }
  const peakJ = shedMean.indexOf(Math.max(...shedMean));
  const un = runs.map((r) => r.unservedGwh);
  const ac = {
    imports: mean(runs.map((r) => r.costImports)), rental: mean(runs.map((r) => r.costRental)),
    demand: mean(runs.map((r) => r.costDemand)), solar: mean(runs.map((r) => r.costSolar)), total: 0,
  };
  ac.total = ac.imports + ac.rental + ac.demand + ac.solar;
  const credit = mean(runs.map((r) => r.credit));
  const unM = mean(un);
  const shortage = { voll: unM * K.VOLL, low: unM * K.VOLL_RANGE[0], high: unM * K.VOLL_RANGE[1], macro: unM * K.VOLL_MACRO };
  const tot = (s: number) => ac.total + s - credit;
  const sepJ = labels.indexOf('2027-09');
  const sep = col((r) => r.pct, sepJ);
  return {
    months: labels, years: ys.map((y) => y.year), runs, fan, shedMean, shedP90,
    peakShedMean: shedMean[peakJ], peakShedMeanMonth: labels[peakJ], peakShedP90: Math.max(...shedP90),
    unservedGwhMean: unM, unservedGwhP90: quant(un, 0.9),
    actionCost: ac, credit, shortageCost: shortage,
    total: { voll: tot(shortage.voll), low: tot(shortage.low), high: tot(shortage.high), macro: tot(shortage.macro) },
    nBelow10Sep: sep.filter((v) => v < 10).length, nBelow20Sep: sep.filter((v) => v < 20).length,
    nHitFloor: runs.filter((r) => r.pct.some((v) => v <= 0.05)).length,
    sepP50: quant(sep, 0.5), sepP10: quant(sep, 0.1),
  };
}

// ---------------------------------------------------------------- optimizer

export interface Constraints {
  budgetMusd: number | null;      // max expected action cost (before water credit)
  maxShedH: number | null;        // optional: worst average month must stay below this
  voll: 'central' | 'macro';
}

export interface OptResult {
  plan: Plan;
  result: Result;
  baseline: Result;
  tried: number;
  feasible: number;
  why: string[];
  objective: number;
}

const grid = (max: number, step: number, n: number) => {
  const out = [0];
  for (let k = 1; k <= n; k++) {
    const v = Math.round((max * k) / n / step) * step;
    if (v > 0 && !out.includes(v)) out.push(v);
  }
  return out;
};

export function objective(r: Result, c: Constraints) {
  return c.voll === 'macro' ? r.total.macro : r.total.voll;
}

/** Grid search over amounts and start months, honouring disabled actions, max amounts and the budget. */
export function optimize(inp: SimInput, user: Plan, c: Constraints, pool = 'el_nino'): OptResult {
  const allowed = (id: ActionId) => user[id].possible;
  const opts = (id: ActionId, n: number) => (allowed(id) ? grid(Math.min(user[id].max, ACTION[id].hardMax), ACTION[id].step, n) : [0]);
  const holdA = opts('hold', 4), impA = opts('imports', 4), renA = opts('rental', 3), demA = opts('demand', 3), solA = opts('solar', 2);
  const holdStarts = allowed('hold') ? [1, 2, 4] : [1];
  const schedA = allowed('schedule') ? [false, true] : [false];
  const baseline = simulatePlan(inp, NO_ACTION, pool);
  let best: { plan: Plan; r: Result; obj: number } | null = null;
  let tried = 0, feasible = 0;
  const mk = (h: number, hs: number, im: number, re: number, de: number, so: number, sc: boolean): Plan => ({
    hold: { ...user.hold, on: h > 0, amount: h || user.hold.amount, start: hs },
    imports: { ...user.imports, on: im > 0, amount: im || user.imports.amount, start: 1 },
    rental: { ...user.rental, on: re > 0, amount: re || user.rental.amount, start: 1 },
    demand: { ...user.demand, on: de > 0, amount: de || user.demand.amount, start: 1 },
    solar: { ...user.solar, on: so > 0, amount: so || user.solar.amount, start: 1 },
    schedule: { ...user.schedule, on: sc, start: 1 },
  });
  for (const h of holdA) for (const hs of (h > 0 ? holdStarts : [1])) for (const im of impA) for (const re of renA)
    for (const de of demA) for (const so of solA) for (const sc of schedA) {
      tried++;
      const p = mk(h, hs, im, re, de, so, sc);
      const r = simulatePlan(inp, p, pool);
      if (c.budgetMusd !== null && r.actionCost.total > c.budgetMusd + 1e-6) continue;
      if (c.maxShedH !== null && Math.max(...r.shedMean) > c.maxShedH + 1e-6) continue;
      feasible++;
      const obj = objective(r, c);
      // tie-break: fewer/smaller actions
      if (!best || obj < best.obj - 0.05) best = { plan: p, r, obj };
    }
  if (!best) {
    return { plan: NO_ACTION, result: baseline, baseline, tried, feasible, objective: objective(baseline, c),
      why: ['No combination meets your limits. Loosen the budget or the shedding cap.'] };
  }
  // why: what each chosen action is worth (remove it, keep the rest)
  const why: string[] = [];
  const b = best;
  (['hold', 'imports', 'rental', 'demand', 'solar', 'schedule'] as ActionId[]).forEach((id) => {
    if (!b.plan[id].on) return;
    const p2: Plan = { ...b.plan, [id]: { ...b.plan[id], on: false } };
    const r2 = simulatePlan(inp, p2, pool);
    const d = objective(r2, c) - b.obj;
    const dh = Math.max(...r2.shedMean) - Math.max(...b.r.shedMean);
    why.push(`${ACTION[id].title}: dropping it raises expected total cost by $${Math.round(d)}M` +
      (Math.abs(dh) >= 0.1 ? ` and peak shedding by ${dh.toFixed(1)} h/day.` : '.'));
  });
  const off = (Object.keys(user) as ActionId[]).filter((k) => !user[k].possible).map((k) => ACTION[k].title.toLowerCase());
  if (off.length) why.push(`Not used because you marked them not possible: ${off.join(', ')}.`);
  if (!ACTIONS.some((a) => b.plan[a.id].on)) why.push('Doing nothing is cheapest under these limits: in most El Nino years the lake stays above its floor.');
  return { plan: b.plan, result: b.r, baseline, tried, feasible, why, objective: b.obj };
}

/** Compact numbers for the assistant: the ONLY numbers it may quote. */
export function digest(r: Result) {
  const r0 = (v: number) => Math.round(v);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    sep_2027_storage_pct_p50: r1(r.sepP50),
    sep_2027_storage_pct_p10: r1(r.sepP10),
    years_below_10pct_in_sep: r.nBelow10Sep,
    years_total: r.years.length,
    years_lake_hits_floor: r.nHitFloor,
    peak_shedding_h_per_day_avg: r1(r.peakShedMean),
    peak_shedding_month: r.peakShedMeanMonth,
    peak_shedding_h_per_day_dry_years_p90: r1(r.peakShedP90),
    unserved_gwh_avg: r0(r.unservedGwhMean),
    action_cost_musd: r0(r.actionCost.total),
    shortage_cost_musd_voll_1: r0(r.shortageCost.voll),
    shortage_cost_musd_range: [r0(r.shortageCost.low), r0(r.shortageCost.high)],
    shortage_cost_musd_macro_013: r0(r.shortageCost.macro),
    water_credit_musd: r0(r.credit),
    total_cost_musd_voll_1: r0(r.total.voll),
  };
}

export function planDigest(p: Plan) {
  const o: Record<string, unknown> = {};
  ACTIONS.forEach((a) => {
    const s = p[a.id];
    o[a.id] = s.possible ? (s.on ? (a.unit ? `${s.amount}${a.unit === '%' ? '%' : ' MW'} from ${monthName(s.start)}` : `on from ${monthName(s.start)}`) : 'off') : 'not possible';
  });
  return o;
}

export const MONTH_LABELS = ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12'];
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthName(idx: number) {
  const m = MONTH_LABELS[idx] ?? MONTH_LABELS[1];
  return `${MN[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
}
export function monthLabel(m: string) { return `${MN[+m.slice(5) - 1]} ${m.slice(2, 4)}`; }
