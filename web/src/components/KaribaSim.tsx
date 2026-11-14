import { useId, useMemo, useState } from 'react';
import { scaleLinear, scaleUtc } from 'd3-scale';
import { line, curveMonotoneX } from 'd3-shape';
import { useData } from '../data/load';
import { useWidth, SourceNote, Loading } from './common';
import { LegendItem } from './TimeChart';
import { fmtDate, fmtMonth, fmtMusd, fmtNum, toDate } from '../lib/format';

/**
 * "What if we act now?" A client-side replay of the 'next' (El Niño) model's monthly water balance
 * for Lake Kariba (pipeline/kariba_ensemble.py), with a release cut the user chooses.
 * Inputs come from kariba_sim.json (pipeline/kariba_sim.py), which also checks that this
 * arithmetic reproduces kariba.json with default settings (4 in 11 below 10% at end-2027).
 */

type Pool = 'el_nino' | 'all' | 'la_nina';
interface SimYear { year: number; season: string; oni_djf: number; phase: string; qnet_bcm: number[] }
interface SimData {
  issue_date: string;
  start: { date: string; level_m: number; usable_bcm: number; usable_pct: number; first_month_fraction: number; note: string };
  months: string[];
  capacity_bcm: number;
  thresholds: { warning_usable_pct: number; danger_usable_pct: number };
  releases: { allocation_2026_bcm: number; allocation_2027_bcm: number; remaining_2026_bcm: number; monthly_plan_bcm: number[]; source_url?: string };
  cut: { min_pct: number; max_pct: number; step_pct: number; start_months: string[]; default_start: string };
  years: SimYear[];
  pools: Record<Pool, number[]>;
  pool_labels: Record<Pool, string>;
  energy: { twh_per_bcm: number; twh_per_bcm_range: [number, number] };
  costs: { contracted_usd_per_kwh: number; emergency_usd_per_kwh: number; voll_usd_per_kwh: number; emergency_cap_gwh_per_month: number; source: string };
  honesty: string[];
  validation: { passed: boolean; sim_n_below_10_dec_2027: number; n_years: number; sim_median_dec_2027_pct: number };
}

interface YearRun {
  year: number;
  pct: number[];          // month-end usable % for months[1..] (Dec 2026 .. Dec 2027)
  generatedTwh: number;   // Dec 2026 .. Dec 2027
  cutTwh: number;         // deliberately not generated
  forcedTwh: number;      // not generated because the lake hit the minimum operating level
  costMusd: number;       // illustrative replacement cost
}

/** One analog year. Mirrors browser_sim() in pipeline/kariba_sim.py and kariba_cost.simulate(). */
function simulateYear(d: SimData, y: SimYear, cut: number, startIdx: number, contracted: boolean): YearRun {
  const cap = d.capacity_bcm;
  const f0 = d.start.first_month_fraction;
  const gwhPerBcm = d.energy.twh_per_bcm * 1000;
  const capGwh = d.costs.emergency_cap_gwh_per_month;
  const cCon = d.costs.contracted_usd_per_kwh, cEm = d.costs.emergency_usd_per_kwh, voll = d.costs.voll_usd_per_kwh;
  let S = d.start.usable_bcm;
  const pct: number[] = [];
  let gen = 0, cutB = 0, forcedB = 0, cost = 0;
  for (let i = 0; i < y.qnet_bcm.length; i++) {
    let q = y.qnet_bcm[i], plan = d.releases.monthly_plan_bcm[i];
    if (i === 0) { q *= f0; plan *= f0; }
    const target = i >= startIdx ? plan * (1 - cut) : plan;
    const release = Math.min(target, Math.max(S + q, 0));
    S = Math.min(S + q - release, cap);   // spill above full supply level
    if (i === 0) continue;
    const plannedCut = plan - target, forced = target - release;
    gen += release; cutB += plannedCut; forcedB += forced;
    // GWh x $/kWh = $M
    const ePlan = plannedCut * gwhPerBcm, eForced = forced * gwhPerBcm;
    let room = capGwh;
    if (ePlan > 0) {
      if (contracted) cost += ePlan * cCon;
      else {
        cost += Math.min(ePlan, capGwh) * cEm + Math.max(ePlan - capGwh, 0) * voll;
        room = Math.max(capGwh - ePlan, 0);
      }
    }
    const em = Math.min(eForced, room);
    cost += em * cEm + (eForced - em) * voll;
    pct.push((S / cap) * 100);
  }
  const k = d.energy.twh_per_bcm;
  return { year: y.year, pct, generatedTwh: gen * k, cutTwh: cutB * k, forcedTwh: forcedB * k, costMusd: cost };
}

function median(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN;
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

function summarize(runs: YearRun[], danger: number) {
  const n = runs.length;
  const nEnd = runs.filter((r) => r.pct[r.pct.length - 1] < danger).length;
  const nEver = runs.filter((r) => r.pct.some((p) => p < danger)).length;
  const monthsBelow = runs.map((r) => r.pct.filter((p) => p < danger).length);
  const med = runs[0]?.pct.map((_, j) => median(runs.map((r) => r.pct[j]))) ?? [];
  return {
    n, nEnd, nEver,
    monthsBelowMean: mean(monthsBelow),
    monthsBelowTotal: monthsBelow.reduce((a, b) => a + b, 0),
    median: med,
    endMedian: med[med.length - 1],
    gen: mean(runs.map((r) => r.generatedTwh)),
    cutTwh: mean(runs.map((r) => r.cutTwh)),
    forced: mean(runs.map((r) => r.forcedTwh)),
    cost: mean(runs.map((r) => r.costMusd)),
  };
}

const POOLS: Pool[] = ['el_nino', 'all', 'la_nina'];
const POOL_SHORT: Record<Pool, string> = { el_nino: 'El Niño', all: 'past', la_nina: 'La Niña' };
const fmtCents = (usd: number) => `${Math.round(usd * 100)}¢`;
const inN = (k: number, n: number) => `${k} in ${n}`;

export function KaribaSim() {
  const sim = useData<SimData>('kariba_sim.json');
  if (sim.loading) return <Loading what="simulator" />;
  const d = sim.data;
  if (!d || !Array.isArray(d.years)) return null;
  return <Sim d={d} />;
}

function Sim({ d }: { d: SimData }) {
  const uid = useId();
  const [pool, setPool] = useState<Pool>('el_nino');
  const [cutPct, setCutPct] = useState(0);
  const [start, setStart] = useState(d.cut.default_start);
  const [contracted, setContracted] = useState(true);

  const danger = d.thresholds.danger_usable_pct;
  const startIdx = Math.max(1, d.months.indexOf(start));
  const years = useMemo(() => d.years.filter((y) => d.pools[pool].includes(y.year)), [d, pool]);
  const runs = useMemo(() => years.map((y) => simulateYear(d, y, cutPct / 100, startIdx, contracted)), [d, years, cutPct, startIdx, contracted]);
  const base = useMemo(() => years.map((y) => simulateYear(d, y, 0, startIdx, contracted)), [d, years, startIdx, contracted]);
  const S = summarize(runs, danger), B = summarize(base, danger);
  // y-axis fixed per pool (the wettest path at the deepest cut) so the chart doesn't jump while dragging
  const yMax = useMemo(() => {
    const deep = years.map((y) => simulateYear(d, y, d.cut.max_pct / 100, 1, true));
    const m = Math.max(...deep.flatMap((r) => r.pct), d.start.usable_pct);
    return Math.min(100, Math.ceil((m + 4) / 20) * 20);
  }, [d, years]);

  const n = S.n;
  const startLabel = fmtMonth(start);
  const poolWord = POOL_SHORT[pool];
  const keptBcm = median(runs.map((r) => r.pct[r.pct.length - 1])) / 100 * d.capacity_bcm - median(base.map((r) => r.pct[r.pct.length - 1])) / 100 * d.capacity_bcm;
  const endMed = (r: YearRun[]) => median(r.map((x) => x.pct[x.pct.length - 1]));
  const sentence = cutPct === 0
    ? `With the announced ${fmtNum(d.releases.allocation_2027_bcm)} BCM release and no cut, the lake ends 2027 below ${danger}% in ${S.nEnd} of ${n} ${poolWord} years. Move the slider to see what cutting releases does.`
    : S.nEnd < B.nEnd
      ? `Cutting releases ${cutPct}% from ${startLabel} keeps the lake above ${danger}% at the end of 2027 in ${n - S.nEnd} of ${n} ${poolWord} years (${n - B.nEnd} of ${n} with no cut), at the cost of ${fmtNum(S.cutTwh, 1)} TWh less hydropower by Dec 2027.`
      : `Cutting releases ${cutPct}% from ${startLabel} lifts the median end-2027 level from ${fmtNum(endMed(base), 0)}% to ${fmtNum(endMed(runs), 0)}%, but the lake still ends below ${danger}% in ${S.nEnd} of ${n} ${poolWord} years, the same as with no cut. It costs ${fmtNum(S.cutTwh, 1)} TWh less hydropower by Dec 2027.`;

  return (
    <section className="figure ksim" aria-labelledby={`${uid}-h`}>
      <p className="eyebrow">Try it: what if we act now?</p>
      <h3 id={`${uid}-h`}>Cut releases, and watch the lake replay real El Niño years</h3>
      <p className="small muted ksim-intro">
        Start: {fmtNum(d.start.usable_pct, 0)}% usable ({fmtNum(d.start.usable_bcm, 1)} BCM) on {fmtDate(d.start.date)}.
        Each thin line replays one past year's river inflow, minus evaporation, against the announced release plan
        ({fmtNum(d.releases.remaining_2026_bcm, 1)} BCM for the rest of 2026, {fmtNum(d.releases.allocation_2027_bcm)} BCM in 2027).
      </p>

      <div className="ksim-controls">
        <div className="ksim-control">
          <span className="ksim-label" id={`${uid}-pool`}>Which years to replay</span>
          <div className="toggle small" role="radiogroup" aria-labelledby={`${uid}-pool`}>
            {POOLS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={pool === p} className={pool === p ? 'on' : ''} onClick={() => setPool(p)}>
                {d.pool_labels[p]} ({d.pools[p].length})
              </button>
            ))}
          </div>
        </div>

        <div className="ksim-control">
          <span className="ksim-label" id={`${uid}-imp`}>Replace the lost power with</span>
          <div className="toggle small" role="radiogroup" aria-labelledby={`${uid}-imp`}>
            <button type="button" role="radio" aria-checked={contracted} className={contracted ? 'on' : ''} onClick={() => setContracted(true)}>
              Imports contracted now ({fmtCents(d.costs.contracted_usd_per_kwh)}/kWh)
            </button>
            <button type="button" role="radio" aria-checked={!contracted} className={!contracted ? 'on' : ''} onClick={() => setContracted(false)}>
              Emergency power later ({fmtCents(d.costs.emergency_usd_per_kwh)}/kWh)
            </button>
          </div>
        </div>
        <div className="ksim-control">
          <label className="ksim-label" htmlFor={`${uid}-cut`}>
            Cut releases by <b className="ksim-val">{cutPct}%</b>
          </label>
          <input
            id={`${uid}-cut`} className="ksim-range" type="range"
            min={d.cut.min_pct} max={d.cut.max_pct} step={d.cut.step_pct} value={cutPct}
            aria-valuetext={`${cutPct}% cut from ${startLabel}`}
            onChange={(e) => setCutPct(Number(e.target.value))}
          />
          <div className="ksim-scale" aria-hidden="true"><span>{d.cut.min_pct}%</span><span>{d.cut.max_pct}%</span></div>
        </div>

        <div className="ksim-control">
          <label className="ksim-label" htmlFor={`${uid}-start`}>Starting in <b className="ksim-val">{startLabel}</b></label>
          <input
            id={`${uid}-start`} className="ksim-range" type="range"
            min={0} max={d.cut.start_months.length - 1} step={1} value={Math.max(0, d.cut.start_months.indexOf(start))}
            aria-valuetext={startLabel}
            onChange={(e) => setStart(d.cut.start_months[Number(e.target.value)])}
          />
          <div className="ksim-scale" aria-hidden="true"><span>{fmtMonth(d.cut.start_months[0])}</span><span>{fmtMonth(d.cut.start_months[d.cut.start_months.length - 1])}</span></div>
        </div>

      </div>

      <p className="headline ksim-sentence" aria-live="polite">{sentence}</p>

      <SimChart d={d} runs={runs} median={S.median} baseMedian={cutPct > 0 ? B.median : null} yMax={yMax} startMonth={cutPct > 0 ? start : null} />

      <div className="ksim-stats">
        <div className="stat ksim-stat">
          <div className="stat-label">Chance below {danger}% in Dec 2027</div>
          <div className="stat-value">
            {cutPct > 0 && <><span className="ksim-was">{inN(B.nEnd, n)}</span><span className="ksim-arrow" aria-label="becomes"> → </span></>}
            <span className={S.nEnd > 0 ? 'ksim-bad' : 'ksim-good'}>{inN(S.nEnd, n)}</span>
          </div>
          <div className="ksim-note">{poolWord} years; {inN(S.nEver, n)} dip below {danger}% at some point</div>
        </div>
        <div className="stat ksim-stat">
          <div className="stat-label">Months below {danger}%</div>
          <div className="stat-value">
            {cutPct > 0 && <><span className="ksim-was">{fmtNum(B.monthsBelowMean, 1)}</span><span className="ksim-arrow" aria-label="becomes"> → </span></>}
            <span>{fmtNum(S.monthsBelowMean, 1)}</span>
          </div>
          <div className="ksim-note">average per replayed year, Dec 2026 – Dec 2027 ({S.monthsBelowTotal} of {n * S.median.length} month-ends)</div>
        </div>
        <div className="stat ksim-stat">
          <div className="stat-label">Hydropower, Dec 2026 – Dec 2027</div>
          <div className="stat-value"><span>{fmtNum(S.gen, 1)} TWh</span></div>
          <div className="ksim-note">
            generated (average). Not generated: {fmtNum(S.cutTwh, 1)} TWh by choice + {fmtNum(S.forced, 1)} TWh because the lake ran low
            {cutPct > 0 && <> (no cut: 0 + {fmtNum(B.forced, 1)} TWh)</>}
          </div>
        </div>
        <div className="stat ksim-stat">
          <div className="stat-label">Illustrative cost of the shortfall</div>
          <div className="stat-value">
            {cutPct > 0 && <><span className="ksim-was">{fmtMusd(B.cost)}</span><span className="ksim-arrow" aria-label="becomes"> → </span></>}
            <span>{fmtMusd(S.cost)}</span>
          </div>
          <div className="ksim-note">
            average; {contracted ? 'cut power bought as contracted imports' : 'cut power bought as emergency power'}, shortfalls beyond {fmtNum(d.costs.emergency_cap_gwh_per_month)} GWh/month priced as lost load (${fmtNum(d.costs.voll_usd_per_kwh, 2)}/kWh).
            {cutPct > 0 && isFinite(keptBcm) && keptBcm > 0.05 && <> Median water kept for 2028: {fmtNum(keptBcm, 1)} BCM (≈{fmtNum(keptBcm * d.energy.twh_per_bcm, 1)} TWh), not credited here.</>}
          </div>
        </div>
      </div>

      <ul className="ksim-honesty">
        {d.honesty.map((h, i) => <li key={i}>{h}</li>)}
      </ul>

      <SourceNote files={['kariba_sim.json']}>
        Patronus water balance replayed in your browser: G-REALM satellite levels (NASA/USDA), NOAA ONI, ZRA allocations
        {d.releases.source_url ? <> (<a href={d.releases.source_url} target="_blank" rel="noreferrer">2027</a>)</> : null},
        energy {fmtNum(d.energy.twh_per_bcm, 2)} TWh/BCM (range {d.energy.twh_per_bcm_range.join('–')}), prices from the ZESCO ERB filing (Jul 2024).
        {d.validation?.passed ? ` Check: with no cut and El Niño years it reproduces the forecast (${inN(d.validation.sim_n_below_10_dec_2027, d.validation.n_years)} below ${danger}%, median ${fmtNum(d.validation.sim_median_dec_2027_pct, 0)}%).` : ''}
      </SourceNote>
    </section>
  );
}

function SimChart({ d, runs, median: med, baseMedian, yMax, startMonth }: {
  d: SimData; runs: YearRun[]; median: number[]; baseMedian: number[] | null; yMax: number; startMonth: string | null;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = width < 520 ? 260 : 320;
  const m = { top: 14, right: 14, bottom: 26, left: 40 };
  const iw = Math.max(50, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const danger = d.thresholds.danger_usable_pct, warning = d.thresholds.warning_usable_pct;

  // x positions: the start observation, then month-ends Dec 2026 .. Dec 2027 (plotted at month-end)
  const monthEnd = (s: string) => { const t = toDate(s)!; return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)); };
  const xsDates = [toDate(d.start.date)!, ...d.months.slice(1).map(monthEnd)];
  const x = scaleUtc().domain([xsDates[0], xsDates[xsDates.length - 1]]).range([0, iw]);
  const y = scaleLinear().domain([0, yMax]).range([ih, 0]);
  const gen = line<number>().x((_, i) => x(xsDates[i])).y((v) => y(Math.max(0, v))).curve(curveMonotoneX);
  const withStart = (p: number[]) => [d.start.usable_pct, ...p];

  const step = Math.max(1, Math.ceil(13 / Math.max(2, Math.floor(iw / 70))));
  const ticks = d.months.slice(1).map((s, i) => ({ s, i: i + 1 })).filter((_, j) => j % step === 0);
  const yTicks = y.ticks(5);
  const sx = startMonth ? (() => { const t = toDate(startMonth)!; return x(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))); })() : null;

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 1;
    for (let i = 1; i < xsDates.length; i++) if (Math.abs(x(xsDates[i]) - px) < Math.abs(x(xsDates[best]) - px)) best = i;
    setHover(best);
  }
  const hv = hover !== null ? runs.map((r) => r.pct[hover - 1]) : [];
  const legend = (
    <>
      <LegendItem color="var(--series-4)" label="One past year (thin)" />
      <LegendItem color="var(--drying-strong)" label={`Ends below ${danger}%`} />
      <LegendItem color="var(--series-2)" label="Median" />
      {baseMedian && <LegendItem kind="dash" color="var(--text-muted)" label="Median, no cut" />}
    </>
  );
  const nBelowEnd = runs.filter((r) => r.pct[r.pct.length - 1] < danger).length;

  return (
    <div className="chart ksim-chart" ref={ref}>
      <div className="legend">{legend}</div>
      <div className="axis-title"><span>Usable storage (%), month-end</span></div>
      <svg width={width} height={height} role="img"
        aria-label={`Lake Kariba usable storage from ${fmtDate(d.start.date)} to Dec 2027 for ${runs.length} replayed years; median ends at ${fmtNum(med[med.length - 1], 0)}%, ${nBelowEnd} of ${runs.length} end below ${danger}%.`}>
        <g transform={`translate(${m.left},${m.top})`}>
          {yTicks.map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x2={iw} className="grid" />
              <text x={-6} dy="0.32em" textAnchor="end" className="tick">{t}%</text>
            </g>
          ))}
          {ticks.map(({ s, i }) => (
            <text key={s} x={x(xsDates[i])} y={ih + 18} textAnchor="middle" className="tick">{fmtMonth(s).replace(' 20', " '")}</text>
          ))}
          <rect x={0} y={y(danger)} width={iw} height={ih - y(danger)} fill="var(--shortfall-shade)" />
          {sx !== null && isFinite(sx) && (
            <g>
              <line x1={sx} x2={sx} y1={0} y2={ih} stroke="var(--event-mark)" strokeDasharray="2 3" strokeWidth={1.5} />
              <text x={sx + 4} y={10} className="vline-label" fill="var(--event-mark)">Cut starts</text>
            </g>
          )}
          {runs.map((r) => {
            const bad = r.pct[r.pct.length - 1] < danger;
            return (
              <path key={r.year} className="ksim-line" d={gen(withStart(r.pct)) ?? ''} fill="none"
                stroke={bad ? 'var(--drying-strong)' : 'var(--series-4)'} strokeWidth={bad ? 1.4 : 1.1} strokeOpacity={bad ? 0.85 : 0.55} />
            );
          })}
          {[{ v: warning, c: 'var(--threshold-warning)', l: `${warning}% warning` }, { v: danger, c: 'var(--threshold-danger)', l: `${danger}% danger` }].map((h) => (
            <g key={h.v}>
              <line x2={iw} y1={y(h.v)} y2={y(h.v)} stroke={h.c} strokeDasharray="5 4" strokeWidth={1.5} />
              <text x={iw - 4} y={y(h.v) - 4} textAnchor="end" className="hline-label" fill={h.c}>{h.l}</text>
            </g>
          ))}
          {baseMedian && <path d={gen(withStart(baseMedian)) ?? ''} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="4 3" />}
          <path d={gen(withStart(med)) ?? ''} fill="none" stroke="var(--series-2)" strokeWidth={3} strokeLinecap="round" />
          <circle cx={0} cy={y(d.start.usable_pct)} r={4} fill="var(--series-1)" stroke="var(--bg-elev)" strokeWidth={1.5} />
          <line y1={ih} y2={ih} x2={iw} className="axis" />
          {hover !== null && <line x1={x(xsDates[hover])} x2={x(xsDates[hover])} y1={0} y2={ih} className="crosshair" />}
          <rect width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </g>
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(width - 190, Math.max(0, m.left + x(xsDates[hover]) + 10)), top: m.top + 40 }}>
          <div className="chart-tip-head">End of {fmtMonth(d.months[hover])}</div>
          <div className="chart-tip-row"><i style={{ background: 'var(--series-2)' }} />Median: <b>{fmtNum(med[hover - 1], 0)}%</b></div>
          <div className="chart-tip-row"><i style={{ background: 'var(--series-4)' }} />Range: <b>{fmtNum(Math.min(...hv), 0)}–{fmtNum(Math.max(...hv), 0)}%</b></div>
          <div className="chart-tip-row"><i style={{ background: 'var(--drying-strong)' }} />Below {danger}%: <b>{inN(hv.filter((v) => v < danger).length, hv.length)}</b></div>
        </div>
      )}
    </div>
  );
}
