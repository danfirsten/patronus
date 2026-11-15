import { useMemo, useRef, useState, type FormEvent } from 'react';
import { scaleBand, scaleLinear } from 'd3-scale';
import { area, line, curveMonotoneX } from 'd3-shape';
import { useData } from '../data/load';
import { Loading, SourceNote, useWidth } from '../components/common';
import {
  ACTIONS, ACTION, K, defaultPlan, simulatePlan, optimize, monthName, monthLabel,
  type ActionId, type Constraints, type OptResult, type Plan, type Result, type SimInput,
} from '../lib/plan/sim';
import '../components/plan/plan.css';
import { usePlanBridge } from '../components/chat/planBridge';

const FILE = 'kariba_sim.json';
const START_OPTS = Array.from({ length: 13 }, (_, i) => i + 1);
const m0 = (v: number) => Math.round(v).toLocaleString('en-US');
const m1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const usd = (v: number) => `${v < 0 ? '−' : ''}$${m0(Math.abs(v))}M`;

/** Plain-language summary built only from simulator output. */
export function summaryText(r: Result) {
  const shed = r.peakShedMean < 0.05
    ? 'there is almost no extra load-shedding in the average El Niño year'
    : `extra load-shedding peaks at ${m1(r.peakShedMean)} h/day in ${monthName(r.months.indexOf(r.peakShedMeanMonth) + 1)} on average`;
  return `By Sep 2027 the lake is most likely at ${m1(r.sepP50)}% usable (${m1(r.sepP10)}% in the driest 1 in 10 years); ${shed}, and up to ${m1(r.peakShedP90)} h/day in the driest years. ${r.nHitFloor} of ${r.years.length} El Niño years hit the minimum operating level.`;
}

export function planLine(p: Plan) {
  const on = ACTIONS.filter((a) => p[a.id].on && p[a.id].possible).map((a) => {
    const s = p[a.id];
    return a.unit ? `${a.title.split(':')[0].split(' (')[0].toLowerCase()} ${s.amount}${a.unit === '%' ? '%' : ' MW'} from ${monthName(s.start)}` : `${a.title.toLowerCase()} from ${monthName(s.start)}`;
  });
  return on.length ? on.join('; ') : 'no action';
}

export function templateExplain(r: Result, p: Plan, changes: string[], opt: OptResult | null) {
  const parts: string[] = [];
  if (changes.length) parts.push(`Changed: ${changes.join('; ')}.`);
  if (opt) parts.push(`Best plan found: ${planLine(p)}.`);
  parts.push(summaryText(r));
  parts.push(`Actions cost about ${usd(r.actionCost.total)}; the remaining shortage costs ${usd(r.shortageCost.voll)} at $1/kWh (${usd(r.shortageCost.low)} to ${usd(r.shortageCost.high)} across $0.5–1.5/kWh, ${usd(r.shortageCost.macro)} at $0.13/kWh). Simulation over past El Niño years, not a forecast.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------- charts

export function FanChart({ r, base, inp, h = 280, mark }: { r: Result; base: Result; inp: SimInput; h?: number; mark?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = useState<number | null>(null);
  const m = { t: 16, r: 16, b: 30, l: 40 };
  const months = r.months;
  const x = scaleBand<string>().domain(months).range([m.l, width - m.r]).padding(0);
  const cx = (k: number) => (x(months[k]) ?? 0) + x.bandwidth() / 2;
  const ymax = Math.max(60, Math.ceil(Math.max(...r.fan.p90, ...base.fan.p90) / 10) * 10);
  const y = scaleLinear().domain([0, ymax]).range([h - m.b, m.t]);
  const band = area<number>().x((_, k) => cx(k)).y0((_, k) => y(r.fan.p10[k])).y1((v) => y(v)).curve(curveMonotoneX)(r.fan.p90) ?? '';
  const ln = (v: number[]) => line<number>().x((_, k) => cx(k)).y((d) => y(d)).curve(curveMonotoneX)(v) ?? '';
  const warn = inp.thresholds.warning_usable_pct, danger = inp.thresholds.danger_usable_pct;
  const small = width < 520;
  return (
    <div className="chart plan-chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={h} role="img" aria-label={`Lake Kariba usable storage, Dec 2026 to Dec 2027. Median ${m1(r.sepP50)}% in Sep 2027.`}>
        {[0, 20, 40, 60, 80, 100].filter((v) => v <= ymax).map((v) => (
          <g key={v}>
            <line x1={m.l} x2={width - m.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={m.l - 6} y={y(v) + 3} textAnchor="end" className="tick">{v}%</text>
          </g>
        ))}
        {months.map((mo, k) => (small ? k % 3 === 0 : k % 2 === 0) && (
          <text key={mo} x={cx(k)} y={h - 10} textAnchor="middle" className="tick">{monthLabel(mo)}</text>
        ))}
        <path d={band} className="plan-band" />
        <path d={ln(base.fan.p50)} className="plan-base" />
        <path d={ln(r.fan.p50)} className="plan-p50" />
        <line x1={m.l} x2={width - m.r} y1={y(warn)} y2={y(warn)} className="plan-th plan-th-warn" />
        <line x1={m.l} x2={width - m.r} y1={y(danger)} y2={y(danger)} className="plan-th plan-th-danger" />
        <text x={width - m.r - 4} y={y(warn) - 5} textAnchor="end" className="hline-label">{warn}% warning</text>
        <text x={width - m.r - 4} y={y(danger) - 5} textAnchor="end" className="hline-label">{danger}% danger</text>
        {mark !== undefined && <line x1={cx(mark)} x2={cx(mark)} y1={m.t} y2={h - m.b} className="plan-mark" />}
        {hover !== null && <line x1={cx(hover)} x2={cx(hover)} y1={m.t} y2={h - m.b} className="crosshair" />}
        {months.map((mo, k) => (
          <rect key={mo} x={x(mo)} y={m.t} width={x.bandwidth()} height={h - m.t - m.b} fill="transparent"
            onMouseEnter={() => setHover(k)} onTouchStart={() => setHover(k)} />
        ))}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(width - 200, Math.max(0, cx(hover) + 10)), top: 20 }}>
          <div className="chart-tip-head">End of {monthName(hover + 1)}</div>
          <div className="chart-tip-row"><i style={{ background: 'var(--water)' }} />Median: <b>{m1(r.fan.p50[hover])}%</b></div>
          <div className="chart-tip-row"><i style={{ background: 'var(--wetting-mild)' }} />P10–P90: <b>{m1(r.fan.p10[hover])}–{m1(r.fan.p90[hover])}%</b></div>
          <div className="chart-tip-row"><i style={{ background: 'var(--neutral-data)' }} />No action median: <b>{m1(base.fan.p50[hover])}%</b></div>
        </div>
      )}
      <div className="legend">
        <span className="legend-item"><i className="lg-line" style={{ background: 'var(--water)' }} />This plan, median</span>
        <span className="legend-item"><i className="lg-box" style={{ background: 'var(--wetting-mild)', opacity: 0.5 }} />P10–P90 of {r.years.length} El Niño years</span>
        <span className="legend-item"><i className="lg-dash" style={{ borderColor: 'var(--text-faint)' }} />No action, median</span>
      </div>
    </div>
  );
}

export function ShedChart({ r, h = 200, mark }: { r: Result; h?: number; mark?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = useState<number | null>(null);
  const m = { t: 14, r: 16, b: 30, l: 40 };
  const months = r.months;
  const x = scaleBand<string>().domain(months).range([m.l, width - m.r]).padding(0.25);
  const ymax = Math.max(2, Math.ceil(Math.max(...r.shedP90) * 1.15));
  const y = scaleLinear().domain([0, ymax]).range([h - m.b, m.t]);
  const ticks = y.ticks(4);
  const small = width < 520;
  return (
    <div className="chart plan-chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={h} role="img" aria-label={`Extra load-shedding hours per day by month. Peak average ${m1(r.peakShedMean)} h/day.`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={width - m.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={m.l - 6} y={y(v) + 3} textAnchor="end" className="tick">{v}h</text>
          </g>
        ))}
        {mark !== undefined && <rect x={(x(months[mark]) ?? 0) - 3} y={m.t} width={x.bandwidth() + 6} height={h - m.t - m.b} className="plan-mark-bg" />}
        {months.map((mo, k) => {
          const bh = y(0) - y(r.shedMean[k]);
          return (
            <g key={mo}>
              {bh > 0.5 && <rect x={x(mo)} y={y(r.shedMean[k])} width={x.bandwidth()} height={bh} rx={Math.min(4, bh / 2)} className="plan-bar" />}
              {r.shedP90[k] > 0.05 && <line x1={(x(mo) ?? 0) - 2} x2={(x(mo) ?? 0) + x.bandwidth() + 2} y1={y(r.shedP90[k])} y2={y(r.shedP90[k])} className="plan-p90" />}
              {(small ? k % 3 === 0 : k % 2 === 0) && <text x={(x(mo) ?? 0) + x.bandwidth() / 2} y={h - 10} textAnchor="middle" className="tick">{monthLabel(mo)}</text>}
              <rect x={(x(mo) ?? 0) - 2} y={m.t} width={x.bandwidth() + 4} height={h - m.t - m.b} fill="transparent"
                onMouseEnter={() => setHover(k)} onTouchStart={() => setHover(k)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(width - 200, Math.max(0, (x(months[hover]) ?? 0) + 14)), top: 10 }}>
          <div className="chart-tip-head">{monthName(hover + 1)}</div>
          <div className="chart-tip-row"><i style={{ background: 'var(--rock)' }} />Average: <b>{m1(r.shedMean[hover])} h/day</b></div>
          <div className="chart-tip-row"><i style={{ background: 'var(--ink)' }} />Driest 1 in 10: <b>{m1(r.shedP90[hover])} h/day</b></div>
        </div>
      )}
      <div className="legend">
        <span className="legend-item"><i className="lg-box" style={{ background: 'var(--rock)' }} />Average over El Niño years</span>
        <span className="legend-item"><i className="lg-line" style={{ background: 'var(--ink)' }} />Driest 1 in 10 (P90)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- controls

function ActionCard({ id, plan, setPlan }: { id: ActionId; plan: Plan; setPlan: (p: Plan) => void }) {
  const a = ACTION[id];
  const s = plan[id];
  const set = (patch: Partial<Plan[ActionId]>) => setPlan({ ...plan, [id]: { ...s, ...patch } });
  const effect = Math.min(13, s.start + a.lead);
  const uid = `act-${id}`;
  return (
    <div className={`plan-action ${s.on && s.possible ? 'is-on' : ''} ${!s.possible ? 'is-off' : ''}`}>
      <div className="plan-action-head">
        <label className="plan-switch" htmlFor={`${uid}-on`}>
          <input id={`${uid}-on`} type="checkbox" checked={s.on && s.possible} disabled={!s.possible} onChange={(e) => set({ on: e.target.checked })} />
          <span>{a.title}</span>
        </label>
        <label className="plan-np" htmlFor={`${uid}-np`}>
          <input id={`${uid}-np`} type="checkbox" checked={!s.possible} onChange={(e) => set({ possible: !e.target.checked, on: e.target.checked ? false : s.on })} />
          Not possible
        </label>
      </div>
      {s.possible && (
        <div className="plan-action-body">
          {a.unit && (
            <div className="plan-row">
              <label htmlFor={`${uid}-amt`} className="plan-lab">{id === 'hold' ? 'Cut releases by' : id === 'demand' ? 'Reduce demand by' : 'Size'}</label>
              <input id={`${uid}-amt`} type="range" min={0} max={a.hardMax} step={a.step} value={s.amount} onChange={(e) => set({ amount: +e.target.value, on: true })} />
              <output htmlFor={`${uid}-amt`} className="plan-val">{s.amount}{a.unit === '%' ? '%' : ' MW'}</output>
            </div>
          )}
          <div className="plan-row">
            <label htmlFor={`${uid}-start`} className="plan-lab">Decide in</label>
            <select id={`${uid}-start`} value={s.start} onChange={(e) => set({ start: +e.target.value })}>
              {START_OPTS.map((k) => <option key={k} value={k}>{monthName(k)}</option>)}
            </select>
            <span className="plan-effect">{a.lead ? `effect from ${monthName(effect)} (${a.lead} mo lead)` : 'effect the same month'}{s.start + a.lead > 13 ? ' — too late' : ''}</span>
          </div>
          {a.unit && (
            <div className="plan-row">
              <label htmlFor={`${uid}-max`} className="plan-lab">Best plan may use up to</label>
              <input id={`${uid}-max`} type="number" min={0} max={a.hardMax} step={a.step} value={s.max} onChange={(e) => set({ max: Math.max(0, Math.min(a.hardMax, +e.target.value || 0)) })} />
              <span className="plan-effect">{a.unit === '%' ? '%' : 'MW'}</span>
            </div>
          )}
          <p className="plan-note"><b>Lead time.</b> {a.leadText} <b>Cost.</b> {a.costText}</p>
        </div>
      )}
    </div>
  );
}

function CostTable({ r, base }: { r: Result; base: Result }) {
  const rows: [string, (x: Result) => number, string?][] = [
    ['Emergency imports', (x) => x.actionCost.imports],
    ['Rental thermal', (x) => x.actionCost.rental],
    ['Paid demand reduction', (x) => x.actionCost.demand],
    ['Solar', (x) => x.actionCost.solar],
    ['Cost of actions', (x) => x.actionCost.total, 'row-strong'],
    ['Water left in the lake (credit)', (x) => -x.credit],
    ['Shortage at VoLL $0.5/kWh', (x) => x.shortageCost.low],
    ['Shortage at VoLL $1.0/kWh (central)', (x) => x.shortageCost.voll],
    ['Shortage at VoLL $1.5/kWh', (x) => x.shortageCost.high],
    ['Shortage at $0.13/kWh (macro-calibrated)', (x) => x.shortageCost.macro],
    ['Total, central VoLL', (x) => x.total.voll, 'row-strong'],
    ['Total, VoLL $0.5–1.5', (x) => x.total.low, 'range'],
    ['Total, $0.13/kWh', (x) => x.total.macro, 'row-strong'],
  ];
  return (
    <div className="table-wrap">
      <table className="data-table plan-table">
        <thead><tr><th>Expected cost, USD (mean of El Niño years)</th><th>This plan</th><th>No action</th></tr></thead>
        <tbody>
          {rows.map(([label, f, cls]) => (
            <tr key={label} className={cls === 'row-strong' ? 'row-strong' : ''}>
              <td>{label}</td>
              <td>{cls === 'range' ? `${usd(r.total.low)} to ${usd(r.total.high)}` : usd(f(r))}</td>
              <td>{cls === 'range' ? `${usd(base.total.low)} to ${usd(base.total.high)}` : usd(f(base))}</td>
            </tr>
          ))}
          <tr><td>Unserved energy (mean / driest 1 in 10)</td><td>{m0(r.unservedGwhMean)} / {m0(r.unservedGwhP90)} GWh</td><td>{m0(base.unservedGwhMean)} / {m0(base.unservedGwhP90)} GWh</td></tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- chat

export interface Msg { role: 'user' | 'assistant'; text: string; changes?: string[]; via?: string; note?: string }

export const EXAMPLES = [
  "I can't import power, what should I do?",
  'We can rent 200 MW of diesel from February, budget $150 million',
  'Mines refuse to curtail. Best plan?',
];

export function Chat({ onAsk, msgs, busy }: { onAsk: (t: string) => void; msgs: Msg[]; busy: boolean }) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    onAsk(t);
  };
  return (
    <section className="panel plan-chat-panel" aria-labelledby="chat-h">
      <h2 id="chat-h" className="plan-h">Ask the planning assistant</h2>
      <p className="muted small">Say what you can and cannot do. The assistant changes the simulator, re-runs it, and explains the result using only the simulator's numbers. Runs server-side: Claude when the team's key is set, otherwise Cloudflare Workers AI (Llama 3.3 70B), otherwise a simple phrase parser. No key is exposed in the page.</p>
      <div className="plan-log" aria-live="polite">
        {msgs.length === 0 && (
          <div className="plan-examples">
            {EXAMPLES.map((ex) => <button key={ex} type="button" className="plan-chip" onClick={() => onAsk(ex)} disabled={busy}>{ex}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`plan-msg plan-msg-${m.role}`}>
            {m.role === 'assistant' && m.changes && m.changes.length > 0 && (
              <ul className="plan-changes">{m.changes.map((c) => <li key={c}>{c}</li>)}</ul>
            )}
            <p>{m.text}</p>
            {m.via && <p className="plan-via">{m.via}{m.note ? ` · ${m.note}` : ''}</p>}
          </div>
        ))}
        {busy && <div className="plan-msg plan-msg-assistant"><p className="muted">Re-running the simulator…</p></div>}
      </div>
      <form className="plan-form" onSubmit={submit}>
        <label htmlFor="plan-q" className="sr-only">Your question</label>
        <input id="plan-q" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. I can't import from South Africa, what now?" maxLength={300} autoComplete="off" />
        <button className="button" type="submit" disabled={busy || !text.trim()}>Ask</button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- page

export default function PlanPage() {
  const { data: inp, loading } = useData<SimInput>(FILE);
  const [plan, setPlan] = useState<Plan>(defaultPlan);
  const [limits, setLimits] = useState<Constraints>({ budgetMusd: null, maxShedH: null, voll: 'central' });
  const [opt, setOpt] = useState<OptResult | null>(null);
  const [optBusy, setOptBusy] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  usePlanBridge({ inp, plan, setPlan, limits, setLimits, setOpt });

  const base = useMemo(() => (inp ? simulatePlan(inp, { ...defaultPlan() }) : null), [inp]);
  const r = useMemo(() => (inp ? simulatePlan(inp, plan) : null), [inp, plan]);

  if (loading) return <div className="wrap page"><Loading what="the Kariba inputs" /></div>;
  if (!inp || !r || !base) return <div className="wrap page"><p>The simulator inputs (kariba_sim.json) could not be loaded.</p></div>;

  const runOpt = (p: Plan = plan, l: Constraints = limits) => {
    const o = optimize(inp, p, l);
    setOpt(o);
    return o;
  };
  const clickOpt = () => {
    setOptBusy(true);
    setTimeout(() => { runOpt(); setOptBusy(false); }, 20);
  };

  const applyOpt = () => { if (opt) { setPlan(opt.plan); resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };

  return (
    <div className="wrap page plan">
      <p className="eyebrow">Plan · Lake Kariba 2027 · Zambia</p>
      <h1>What can Zambia still do before 2027?</h1>
      <p className="lede">Pick the actions you can actually take. The simulator replays the lake month by month from the latest satellite level ({inp.start.usable_pct.toFixed(1)}% usable on {inp.start.date}) through {r.years.length} past El Niño rainy seasons, and shows what each plan does to the lake, to load-shedding and to the bill.</p>
      <p className="plan-honest"><b>Simulation, not a forecast of policy outcomes.</b> Based on past cases and a simple water balance. Load-shedding here is the <i>extra</i> shedding beyond what the 23 BCM allocation for 2027 already implies, for Zambia (ZESCO) only.</p>

      <div className="plan-grid">
        <div className="plan-controls">
          <h2 className="plan-h">Actions</h2>
          {ACTIONS.map((a) => <ActionCard key={a.id} id={a.id} plan={plan} setPlan={(p) => { setPlan(p); }} />)}
          <button type="button" className="plan-reset" onClick={() => { setPlan(defaultPlan()); setOpt(null); }}>Reset to no action</button>
        </div>

        <div className="plan-results" ref={resultsRef}>
          <section className="panel plan-summary" aria-live="polite">
            <p className="eyebrow">This plan: {planLine(plan)}</p>
            <p className="plan-sentence">{summaryText(r)}</p>
            <div className="plan-stats">
              <div><span className="plan-stat-v">{m1(r.sepP50)}%</span><span className="plan-stat-l">Lake, Sep 2027 (median)</span></div>
              <div><span className="plan-stat-v">{m1(r.peakShedMean)} h</span><span className="plan-stat-l">Peak extra shedding per day</span></div>
              <div><span className="plan-stat-v">{m0(r.unservedGwhMean)} GWh</span><span className="plan-stat-l">Unserved energy (mean)</span></div>
              <div><span className="plan-stat-v">{usd(r.total.voll)}</span><span className="plan-stat-l">Expected total cost (VoLL $1)</span></div>
            </div>
          </section>

          <figure className="figure">
            <figcaption><h3>Lake Kariba usable storage</h3><p className="muted">Month-end, Dec 2026 to Dec 2027. Band: P10–P90 of the El Niño years.</p></figcaption>
            <FanChart r={r} base={base} inp={inp} />
            <SourceNote files={[FILE]}>G-REALM satellite level and Dan's water balance (pipeline/kariba_sim.py); El Niño years {r.years.join(', ')}.</SourceNote>
          </figure>

          <figure className="figure">
            <figcaption><h3>Extra load-shedding, hours per day</h3><p className="muted">Unserved MW ÷ 1,520 MW sheddable load × 24 (calibrated on Zambia, 31 Jul 2024).</p></figcaption>
            <ShedChart r={r} />
            <SourceNote>Calibration and method: Patronus 2024 counterfactual (kariba_cf), ZESCO/ministry statements 2024.</SourceNote>
          </figure>


          <section className="panel plan-opt" aria-labelledby="opt-h">
            <h2 id="opt-h" className="plan-h">Best plan</h2>
            <p className="muted small">Grid search over the actions you have not ruled out (sizes up to your limits, start months), minimising expected total cost: actions + shortage − water credit.</p>
            <div className="plan-opt-row">
              <label htmlFor="opt-budget">Budget for actions, $M</label>
              <input id="opt-budget" type="number" min={0} step={10} placeholder="no limit" value={limits.budgetMusd ?? ''}
                onChange={(e) => setLimits({ ...limits, budgetMusd: e.target.value === '' ? null : Math.max(0, +e.target.value) })} />
              <label htmlFor="opt-shed">Max extra shedding, h/day</label>
              <input id="opt-shed" type="number" min={0} step={0.5} placeholder="no limit" value={limits.maxShedH ?? ''}
                onChange={(e) => setLimits({ ...limits, maxShedH: e.target.value === '' ? null : Math.max(0, +e.target.value) })} />
            </div>
            <div className="toggle small" role="group" aria-label="Value of lost load used by the optimizer">
              <button type="button" className={limits.voll === 'central' ? 'on' : ''} aria-pressed={limits.voll === 'central'} onClick={() => setLimits({ ...limits, voll: 'central' })}>Shortage at $1/kWh</button>
              <button type="button" className={limits.voll === 'macro' ? 'on' : ''} aria-pressed={limits.voll === 'macro'} onClick={() => setLimits({ ...limits, voll: 'macro' })}>At $0.13/kWh (macro)</button>
            </div>
            <div><button type="button" className="button" onClick={clickOpt} disabled={optBusy}>{optBusy ? 'Searching…' : 'Find the best plan'}</button></div>
            {opt && (
              <div className="plan-opt-out">
                <p><b>Best plan:</b> {planLine(opt.plan)}.</p>
                <p className="small">Expected total {usd(opt.objective)} vs {usd(limits.voll === 'macro' ? opt.baseline.total.macro : opt.baseline.total.voll)} with no action; peak extra shedding {m1(opt.result.peakShedMean)} vs {m1(opt.baseline.peakShedMean)} h/day; lake in Sep 2027 {m1(opt.result.sepP50)}% vs {m1(opt.baseline.sepP50)}% (median). {opt.feasible} of {opt.tried} plans met your limits.</p>
                <p className="small"><b>Why:</b></p>
                <ul className="plain small">{opt.why.map((w) => <li key={w}>{w}</li>)}</ul>
                {opt.result.credit > 1 && <p className="small muted">Part of the saving is the water credit: water still in the lake at end-2027 ({usd(opt.result.credit)} at 17 c/kWh) displaces 2028 imports.</p>}
                <button type="button" className="plan-apply" onClick={applyOpt}>Use this plan</button>
              </div>
            )}
          </section>

          <section className="panel">
            <h2 className="plan-h">What it costs</h2>
            <CostTable r={r} base={base} />
            <p className="small muted">Value of lost load (VoLL) is shown as a range, $0.5–1.5/kWh, because it dominates the totals. The $0.13/kWh line is calibrated on the IMF growth cut for 2024; at that value early action roughly breaks even.</p>
          </section>
        </div>
      </div>

      <section className="panel plan-assume">
        <h2 className="plan-h">Assumptions</h2>
        <ul className="plain small">
          <li>Water: S[m+1] = S[m] + net inflow of a past El Niño year − release; floor at 475.5 m (0% usable); start {inp.start.level_m} m on {inp.start.date}; first step pro-rated ({inp.start.first_month_fraction} of November).</li>
          <li>Releases follow the ZRA plan ({inp.releases.allocation_2026_bcm} BCM/yr for 2026, {inp.releases.allocation_2027_bcm} BCM for 2027, spread evenly). Zambia uses half; Zimbabwe is assumed to follow the same policy.</li>
          <li>Energy: {inp.energy.twh_per_bcm} TWh per BCM (range {inp.energy.twh_per_bcm_range.join('–')}). The need is what the 2027 plan would generate for ZESCO; other plants and demand are held fixed.</li>
          <li>Dispatch order for the gap: rental (already paid for; it also replaces Kariba water when it is spare), solar (daytime only, at most {Math.round(K.DAYLIGHT_SHARE * 24)} of 24 hours of the gap), paid demand reduction, imports. What is left is shed.</li>
          <li>Prices: imports {K.IMPORT_USD_KWH * 100} c/kWh and rental $51M per 300 MW-month (ZESCO ERB filing, Jul 2024); demand reduction $93/MWh (Brazil 2021); solar has no case cost and is priced at the import rate as a placeholder.</li>
          <li>Water still in the lake at the end of 2027 above the no-action path is credited at 17 c/kWh, as in Dan's cost-of-waiting model.</li>
          <li>Published schedule: best case, it is re-planned knowing each year's rain (as in the 2024 counterfactual), so the lake never hits its floor if water allows.</li>
          <li>Lead times come from 20 past drought crises (Patronus playbook). Solar lead time (9 months) and capacity factor (22%) are assumptions.</li>
          <li>Not modelled: head loss as the lake falls, extra evaporation from a fuller lake, regional import shortages (SAPP was in the same drought in 2024).</li>
        </ul>
        <p className="small"><a href="#/kariba">Back to the Kariba 2027 forecast</a></p>
      </section>
    </div>
  );
}
