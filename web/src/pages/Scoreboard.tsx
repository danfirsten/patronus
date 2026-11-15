import { scaleBand, scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import { useData } from '../data/load';
import type { Crises, GenBacktest, ScoreRow, Scoreboard } from '../data/types';
import { Figure, Loading, Stat, Empty, useWidth, SourceNote } from '../components/common';
import { LegendItem } from '../components/TimeChart';
import { fmtDate, fmtMonth, fmtNum, fmtProb, isNum, monthsBetween, costText } from '../lib/format';

const CAUGHT: Record<string, string> = {
  now: '"Now" model (0–6 months)',
  next: '"Next" El Niño model (6–18 months)',
  both: 'Both models',
  missed: 'Missed',
};

/** now_alarm / next_alarm may be a month string or an object like {month, lead_months}. */
function alarmMonth(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as any;
    return o.month ?? o.alarm_month ?? o.first_alarm ?? o.date ?? null;
  }
  return null;
}
function alarmLead(v: unknown, onset?: string | null): number | null {
  if (v && typeof v === 'object' && isNum((v as any).lead_months)) return (v as any).lead_months;
  const m = alarmMonth(v);
  const n = monthsBetween(m, onset);
  return n;
}
function AlarmCell({ v, onset }: { v: unknown; onset?: string | null }) {
  const m = alarmMonth(v);
  if (!m) return <span className="miss">None</span>;
  const l = alarmLead(v, onset);
  return <>{fmtMonth(m)}{isNum(l) && <span className="muted"> · {l > 0 ? `${l} mo before` : l === 0 ? 'same month' : `${-l} mo after`}</span>}</>;
}
const nowOf = (r: any) => r.now_alarm !== undefined ? r.now_alarm : r.patronus_alarm;
const nextOf = (r: any) => r.next_alarm;

/** Back-test of past crises. `embedded` renders it as a section inside Proof (#/proof/backtest). */
export default function ScoreboardPage({ embedded = false }: { embedded?: boolean }) {
  const H = embedded ? 'h2' : 'h1';
  const H2 = embedded ? 'h3' : 'h2';
  const s = useData<Scoreboard>('scoreboard.json');
  const cr = useData<Crises>('crises.json');
  const gb = useData<GenBacktest>('generation_backtest.json');
  const rows = s.data?.rows ?? [];
  const crisisById = new Map((cr.data?.crises ?? []).map((c) => [c.id, c]));
  const caught = rows.filter((r) => r.caught_by ? r.caught_by !== 'missed' : !!(alarmMonth(nowOf(r)) || alarmMonth(nextOf(r)))).length;
  const leads = rows.map((r) => {
    const ls = [alarmLead(nowOf(r), r.onset), alarmLead(nextOf(r), r.onset)].filter(isNum) as number[];
    return isNum(r.lead_months) ? r.lead_months : ls.length ? Math.max(...ls) : null;
  }).filter(isNum).filter((l) => l > 0);
  const hasNext = rows.some((r: any) => r.next_alarm !== undefined);
  const leadsGen: any[] = (gb.data as any)?.crisis_leads ?? [];
  const fa: any = s.data?.false_alarms;
  const faRate = fa?.per_country_5yr ?? fa?.country_model?.false_alarms_per_country_5yr;
  const faDef = fa?.definition ?? fa?.country_model?.threshold_rule;
  const sSum: any = (s.data as any)?.summary;

  return (
    <div className={embedded ? 'embed' : 'wrap page'}>
      {!embedded && <p className="eyebrow">Crisis scoreboard</p>}
      <H className={embedded ? 'embed-title' : undefined}>Would Patronus have seen them coming?</H>
      <p className="lede">
        We re-ran the pipeline on five past crises as if we were living through them, using only data that had been published by each date.
        We report misses and false alarms next to hits. The five crises are illustrations; the main test runs on thousands of country-months.
      </p>
      <p className="caveat">
        <b>Short-range monthly country forecasts from power data have little skill beyond 1 month.</b> The early warning comes from reservoir storage and the El Niño signal (Kariba).
      </p>

      {s.loading ? <Loading /> : (
        <>
          <div className="stat-row">
            <Stat value={`${caught} of ${rows.length}`} label="crises with an alarm before onset" tone="accent" />
            <Stat value={leads.length ? (Math.min(...leads) === Math.max(...leads) ? String(leads[0]) : `${Math.min(...leads)}–${Math.max(...leads)}`) : '—'} label="months of warning before onset, where caught" />
            <Stat value={fmtNum(faRate, 1)} label="false alarms per country per 5 calm years (country model)" tone="drying" />
          </div>
          {sSum?.headline && <p className="headline">{sSum.headline}</p>}
          {faDef && <details className="more"><summary>How false alarms are counted</summary><div className="muted small">{faDef}</div></details>}
          {(s.data?.notes ?? []).length > 0 && <ul className="plain small muted" style={{ marginTop: 8 }}>{(s.data?.notes ?? []).map((n, i) => <li key={i}>{n}</li>)}</ul>}

          <Figure
            title="Alarm vs official warning vs crisis onset"
            sub="Each row is aligned on the month the crisis began. Further left = earlier."
            source={<>Patronus backtests (Ember, G-REALM, GRACE/GRACE-FO, GPCP, NASA POWER, NOAA ONI); official dates from announcements and news, 2021–2024.</>}
            files={['scoreboard.json']}
          >
            <LeadChart rows={rows} />
          </Figure>

          <div className="table-wrap">
            <table className="data-table score-table">
              <thead>
                <tr><th>Crisis</th><th>ENSO</th><th>First official warning</th><th>Crisis began</th><th>"Now" model alarm</th>{hasNext && <th>"Next" El Niño model alarm</th>}<th>Caught by</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = crisisById.get(r.id);
                  return (
                    <tr key={r.id}>
                      <td data-label="Crisis" className="cell-name">{r.name}</td>
                      <td data-label="ENSO">{r.enso ?? '—'}</td>
                      <td data-label="Official warning">{r.official_warning ? fmtDate(r.official_warning) : <span className="muted">None found</span>}</td>
                      <td data-label="Began">{fmtDate(r.onset)}</td>
                      <td data-label='"Now" model alarm'><AlarmCell v={nowOf(r)} onset={r.onset} /></td>
                      {hasNext && <td data-label='"Next" model alarm'>{(r as any).next_alarm === null || (r as any).next_alarm === undefined ? <span className="muted">No reservoir model</span> : <AlarmCell v={(r as any).next_alarm} onset={r.onset} />}</td>}
                      <td data-label="Caught by"><span className={`caught caught-${r.caught_by}`}>{CAUGHT[r.caught_by ?? ''] ?? r.caught_by ?? '—'}</span></td>
                      <td data-label="Notes" className="cell-notes">
                        {r.notes ?? c?.summary}
                        {c && (c.costs?.length || c.cost_text || c.peak || c.sources?.length) ? (
                        <details className="more">
                          <summary>Costs and sources</summary>
                        {(c?.costs ?? (c?.cost_text ? [c.cost_text] : [])).map((x) => <div key={x} className="muted">Cost: {costText(x)}</div>)}
                        {c?.peak && <div className="muted">Worst point: {c.peak}</div>}
                        {(c?.sources ?? []).length > 0 && (
                          <div className="muted">Sources: {(c!.sources ?? []).map((src, i) => typeof src === 'string'
                            ? <span key={i}>{src}{i < c!.sources!.length - 1 ? '; ' : ''}</span>
                            : <span key={i}><a href={src.url} target="_blank" rel="noreferrer">{src.title ?? src.url}</a>{i < c!.sources!.length - 1 ? '; ' : ''}</span>)}
                          </div>
                        )}
                        </details>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            "Now" is the 0–6 month forecast from stored and arriving water. "Next" is the 6–18 month warning from the El Niño signal (for Kariba, the El Niño water-balance ensemble).
            Sichuan 2022 was a heatwave, not an El Niño event, so only the "now" layer could catch it.
          </p>

          {leadsGen.length > 0 && (
            <div className="panel">
              <h3>The monthly country model on the same crises</h3>
              <p className="muted">
                The pooled country model (power data plus NASA water data) caught {leadsGen.filter((c) => c.caught).length} of {leadsGen.length} crises
                at its false-alarm limit{(gb.data as any)?.alarm?.threshold ? ` (alarm when the 6-month chance is at least ${fmtProb((gb.data as any).alarm.threshold)})` : ''}.
              </p>
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead><tr><th>Crisis</th><th>Onset</th><th>Alarm</th><th>Lead</th><th>Highest 6-month chance before onset</th></tr></thead>
                  <tbody>
                    {leadsGen.map((c, i) => {
                      const ps = (c.p_series ?? []).map((p: any) => p.p_any_shortfall_6m).filter(isNum);
                      return (
                        <tr key={i}>
                          <td>{c.name}</td><td>{fmtDate(c.onset)}</td>
                          <td>{c.alarm_month ? fmtMonth(c.alarm_month) : <span className="miss">{c.status === 'missed' ? 'Missed' : c.status ?? 'None'}</span>}</td>
                          <td className="num">{isNum(c.lead_months) ? `${c.lead_months} mo` : '—'}</td>
                          <td className="num">{ps.length ? fmtProb(Math.max(...ps)) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <SourceNote files={['generation_backtest.json']}>Patronus generation backtest; Ember monthly generation, GRACE/GRACE-FO, GPCP, NASA POWER, NOAA ONI.</SourceNote>
            </div>
          )}
        </>
      )}

      <H2 className="section-title">Skill across all countries and months</H2>
      {gb.loading ? <Loading /> : !gb.data ? <Empty>Backtest summary not available yet.</Empty> : <BacktestBlock g={gb.data} />}
    </div>
  );
}

function LeadChart({ rows }: { rows: ScoreRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const rowH = 46;
  const m = { top: 24, right: 16, bottom: 28, left: Math.min(170, width * 0.32) };
  const iw = width - m.left - m.right;
  const offs = rows.flatMap((r) => [monthsBetween(r.onset, alarmMonth(nowOf(r))), monthsBetween(r.onset, alarmMonth(nextOf(r))), monthsBetween(r.onset, r.official_warning)]).filter(isNum);
  const lo = Math.min(-12, ...offs.map((o) => o - 1));
  const hi = Math.max(2, ...offs.map((o) => o + 1));
  const x = scaleLinear().domain([lo, hi]).range([0, iw]);
  const h = m.top + m.bottom + rows.length * rowH;
  return (
    <div className="chart" ref={ref}>
      <div className="legend">
        <LegendItem kind="dot" color="var(--series-4)" label='"Now" model alarm' />
        <LegendItem kind="dot" color="var(--series-2)" label='"Next" El Niño model alarm' />
        <LegendItem kind="dot" color="var(--text-muted)" label="First official warning" />
        <LegendItem kind="box" color="var(--risk-danger)" label="Crisis begins (month 0)" />
      </div>
      <svg width={width} height={h} role="img" aria-label="Months of warning for each crisis">
        <g transform={`translate(${m.left},${m.top})`}>
          {x.ticks(8).map((t) => (
            <g key={t} transform={`translate(${x(t)},0)`}>
              <line y2={rows.length * rowH} className="grid" />
              <text y={rows.length * rowH + 18} textAnchor="middle" className="tick">{t === 0 ? 'onset' : t}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const a = monthsBetween(r.onset, alarmMonth(nowOf(r)));
            const nx = monthsBetween(r.onset, alarmMonth(nextOf(r)));
            const o = monthsBetween(r.onset, r.official_warning);
            const first = [a, nx].filter(isNum) as number[];
            const earliest = first.length ? Math.min(...first) : null;
            const y = i * rowH + rowH / 2;
            return (
              <g key={r.id}>
                <text x={-10} y={y} dy="0.32em" textAnchor="end" className="row-label">{r.name}</text>
                <rect x={x(0) - 3} y={y - 12} width={6} height={24} fill="var(--risk-danger)" rx={2} />
                {isNum(earliest) && <line x1={x(earliest)} x2={x(0)} y1={y} y2={y} stroke="var(--series-2)" strokeWidth={2} strokeOpacity={0.4} />}
                {isNum(o) && <circle cx={x(o)} cy={y} r={6} fill="var(--text-muted)" />}
                {isNum(a) && <circle cx={x(a)} cy={y + 5} r={6} fill="var(--series-4)" stroke="var(--bg-elev)" strokeWidth={1.5} />}
                {isNum(nx) && <circle cx={x(nx)} cy={y - 5} r={7} fill="var(--series-2)" stroke="var(--bg-elev)" strokeWidth={1.5} />}
                {!isNum(earliest) && <text x={x(0) + 10} y={y} dy="0.32em" className="miss-label">no alarm</text>}
              </g>
            );
          })}
          <text x={x(lo)} y={-8} className="tick">months before onset</text>
        </g>
      </svg>
    </div>
  );
}

function BacktestBlock({ g }: { g: GenBacktest }) {
  const bh = g.by_horizon ?? [];
  return (
    <>
      <SkillSummary g={g} />
      <p className="small muted">
        {g.design}. {fmtNum(g.n_countries)} countries, {fmtNum(g.n_country_months)} country-months.
        Shortfalls happen in {fmtProb(g.base_rate_shortfall)} of months.
      </p>
      <div className="grid-2">
        <Figure
          title="Skill against three simple baselines"
          sub="Brier skill score by months ahead. Above 0 means Patronus beats the baseline."
          source={<>Patronus generation backtest; Ember monthly data, mostly 2019–2026.</>}
          files={['generation_backtest.json']}
        >
          <SkillBars rows={bh} />
        </Figure>
        <Figure
          title="Are the probabilities calibrated?"
          sub="When we say 30%, does it happen about 30% of the time? Points on the diagonal are well calibrated. Larger dots: more cases."
          source={<>Patronus generation backtest, held-out months.</>}
          files={['generation_backtest.json']}
        >
          <Reliability g={g} />
        </Figure>
      </div>
      <div className="grid-2">
        <Figure
          title="What each data source adds"
          sub="Change in AUC-PR when one input is removed. Bigger negative bars mean that input matters more."
          source={<>Ablation runs of the generation backtest; only datasets spanning the whole backtest.</>}
          files={['generation_backtest.json']}
        >
          <HBars items={(g.ablations ?? []).map((a) => ({ label: `Without ${labelSource(a.removed)}${a.horizon ? ` (${a.horizon} mo)` : ''}`, value: a.delta_vs_full ?? null }))} fmt={(v) => fmtNum(v, 2)} color="var(--drying-strong)" />
        </Figure>
        <Figure
          title="Precision–recall vs climatology"
          sub="AUC-PR with a 90% bootstrap interval. Climatology is the score of always forecasting the usual rate."
          source={<>Patronus generation backtest.</>}
          files={['generation_backtest.json']}
        >
          <div className="table-wrap">
            <table className="data-table compact">
              <thead><tr><th>Months ahead</th><th>AUC-PR</th><th>90% interval</th><th>Climatology</th><th>Brier</th></tr></thead>
              <tbody>
                {bh.map((r, i) => (
                  <tr key={i}><td>{r.horizon}</td><td className="num">{fmtNum(r.auc_pr, 2)}</td><td className="num">{r.auc_pr_ci90 ? `${fmtNum(r.auc_pr_ci90[0], 2)}–${fmtNum(r.auc_pr_ci90[1], 2)}` : '—'}</td><td className="num">{fmtNum(r.auc_pr_climatology, 2)}</td><td className="num">{fmtNum(r.brier, 3)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Figure>
      </div>
      {(g.feature_importance ?? []).length > 0 && (
        <Figure title="What the model leans on" sub="Top 10 inputs by share of total split gain." source={<>Patronus generation model (LightGBM).</>} files={['generation_backtest.json']}>
          <HBars items={[...(g.feature_importance ?? [])].sort((a, b) => b.gain_share - a.gain_share).slice(0, 10).map((f) => ({ label: f.feature.replace(/_/g, ' '), value: f.gain_share }))} fmt={(v) => fmtProb(v)} color="var(--series-1)" />
        </Figure>
      )}
    </>
  );
}

const SRC_LABEL: Record<string, string> = { gpcp_precip: 'GPCP rain', ember_persistence: 'recent generation', grid_history: 'grid history', gravis: 'GRACE', power: 'NASA POWER', power_precip: 'NASA POWER rain', power_soil: 'NASA POWER soil wetness', power_temp: 'NASA POWER temperature', oni: 'ENSO index', grealm: 'G-REALM', persistence: 'recent generation' };
const labelSource = (s: string) => SRC_LABEL[s] ?? s;

function SkillBars({ rows }: { rows: GenBacktest['by_horizon'] & {} }) {
  const [ref, width] = useWidth<HTMLDivElement>(480);
  const height = 240;
  const m = { top: 10, right: 10, bottom: 30, left: 40 };
  const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
  const keys = [
    ['bss_vs_climatology', 'vs climatology', 'var(--series-1)'],
    ['bss_vs_persistence', 'vs persistence', 'var(--series-2)'],
    ['bss_vs_enso_only', 'vs ENSO only', 'var(--series-3)'],
  ] as const;
  const vals = rows.flatMap((r) => keys.map(([k]) => r[k])).filter(isNum);
  const y = scaleLinear().domain([Math.min(0, ...vals), Math.max(0.1, ...vals)]).nice().range([ih, 0]);
  const x0 = scaleBand<number>().domain(rows.map((r) => r.horizon)).range([0, iw]).padding(0.2);
  const x1 = scaleBand<string>().domain(keys.map((k) => k[0])).range([0, x0.bandwidth()]).padding(0.08);
  if (!rows.length) return <Empty>No skill rows yet.</Empty>;
  return (
    <div className="chart" ref={ref}>
      <div className="legend">{keys.map(([k, l, c]) => <LegendItem key={k} kind="box" color={c} label={l} />)}</div>
      <svg width={width} height={height} role="img" aria-label="Brier skill score by horizon against three baselines">
        <g transform={`translate(${m.left},${m.top})`}>
          {y.ticks(5).map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}><line x2={iw} className="grid" /><text x={-6} dy="0.32em" textAnchor="end" className="tick">{t}</text></g>
          ))}
          <line x2={iw} y1={y(0)} y2={y(0)} className="axis" />
          {rows.map((r, ri) => (
            <g key={`${r.horizon}-${ri}`} transform={`translate(${x0(r.horizon)},0)`}>
              {keys.map(([k, l, c]) => {
                const v = r[k];
                if (!isNum(v)) return null;
                return <rect key={k} x={x1(k)} width={x1.bandwidth()} y={Math.min(y(0), y(v))} height={Math.abs(y(v) - y(0))} fill={c}><title>{`${r.horizon} months ahead, ${l}: ${fmtNum(v, 2)}`}</title></rect>;
              })}
              <text x={x0.bandwidth() / 2} y={ih + 18} textAnchor="middle" className="tick">{r.horizon} mo</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function Reliability({ g }: { g: GenBacktest }) {
  const [ref, width] = useWidth<HTMLDivElement>(480);
  const size = Math.min(width, 340);
  const m = { top: 10, right: 10, bottom: 34, left: 40 };
  const iw = size - m.left - m.right, ih = size - m.top - m.bottom;
  const x = scaleLinear().domain([0, 1]).range([0, iw]);
  const y = scaleLinear().domain([0, 1]).range([ih, 0]);
  const colors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
  const rel = g.reliability ?? [];
  const maxN = Math.max(1, ...rel.flatMap((r) => r.bins.map((b) => b.n ?? 1)));
  if (!rel.length) return <Empty>No reliability data yet.</Empty>;
  return (
    <div className="chart" ref={ref}>
      <div className="legend">{rel.map((r, i) => <LegendItem key={i} kind="dot" color={colors[i % 4]} label={`${r.horizon} months ahead${(r as any).calibrated === true ? ', calibrated' : (r as any).calibrated === false ? ', before calibration' : ''}`} />)}</div>
      <svg width={size} height={size} role="img" aria-label="Reliability diagram">
        <g transform={`translate(${m.left},${m.top})`}>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y2={ih} className="grid" />
              <line y1={y(t)} y2={y(t)} x2={iw} className="grid" />
              <text x={x(t)} y={ih + 16} textAnchor="middle" className="tick">{Math.round(t * 100)}%</text>
              <text x={-6} y={y(t)} dy="0.32em" textAnchor="end" className="tick">{Math.round(t * 100)}%</text>
            </g>
          ))}
          <line x1={0} y1={ih} x2={iw} y2={0} stroke="var(--border-strong)" strokeDasharray="4 4" />
          {rel.map((r, i) => {
            const pts = r.bins.filter((b) => isNum(b.observed_rate));
            return (
              <g key={i}>
                <path d={line<typeof pts[number]>().x((b) => x(b.p_mean)).y((b) => y(b.observed_rate as number))(pts) ?? ''} fill="none" stroke={colors[i % 4]} strokeWidth={1.5} />
                {pts.map((b, j) => (
                  <circle key={j} cx={x(b.p_mean)} cy={y(b.observed_rate as number)} r={3 + 6 * Math.sqrt((b.n ?? 1) / maxN)} fill={colors[i % 4]} fillOpacity={0.8}>
                    <title>{`Forecast ${fmtProb(b.p_mean)}, observed ${fmtProb(b.observed_rate)}, n = ${b.n ?? '—'}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
          <text x={iw / 2} y={ih + 30} textAnchor="middle" className="tick">Forecast chance</text>
        </g>
      </svg>
      <p className="muted small">Vertical: how often a shortfall actually happened.</p>
    </div>
  );
}

function HBars({ items, fmt, color }: { items: { label: string; value: number | null }[]; fmt: (v: number) => string; color: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(480);
  const rowH = 28;
  const m = { top: 4, right: 50, bottom: 4, left: Math.min(200, width * 0.42) };
  const iw = width - m.left - m.right;
  const vals = items.map((i) => i.value).filter(isNum);
  if (!vals.length) return <Empty>No values yet.</Empty>;
  const x = scaleLinear().domain([Math.min(0, ...vals), Math.max(0, ...vals)]).nice().range([0, iw]);
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={m.top + m.bottom + items.length * rowH} role="img" aria-label="Bar chart">
        <g transform={`translate(${m.left},${m.top})`}>
          <line x1={x(0)} x2={x(0)} y2={items.length * rowH} className="axis" />
          {items.map((it, i) => (
            <g key={i} transform={`translate(0,${i * rowH})`}>
              <text x={-8} y={rowH / 2} dy="0.32em" textAnchor="end" className="row-label">{it.label}</text>
              {isNum(it.value) && (
                <>
                  <rect x={Math.min(x(0), x(it.value))} y={5} height={rowH - 10} width={Math.max(1, Math.abs(x(it.value) - x(0)))} fill={color} rx={2} />
                  <text x={Math.max(x(0), x(it.value)) + 6} y={rowH / 2} dy="0.32em" className="tick">{fmt(it.value)}</text>
                </>
              )}
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function SkillSummary({ g }: { g: GenBacktest }) {
  const bh = g.by_horizon ?? [];
  const bss = bh.flatMap((r) => [r.bss_vs_climatology, r.bss_vs_persistence, r.bss_vs_enso_only]).filter(isNum);
  const beats = bh.filter((r) => {
    const ci = (r as any).auc_pr_minus_climatology_ci90;
    return Array.isArray(ci) ? ci[0] > 0 : isNum(r.auc_pr) && isNum(r.auc_pr_climatology) && r.auc_pr > r.auc_pr_climatology;
  }).map((r) => r.horizon);
  const abl = (g.ablations ?? []) as any[];
  const sig = abl.filter((a) => Array.isArray(a.delta_ci90) && a.delta_ci90[1] < 0);
  const grace = abl.find((a) => a.removed === 'gravis');
  return (
    <div className="caveat" style={{ marginBottom: 16 }}>
      <p><b>The monthly country forecast has modest skill.</b></p>
      <ul className="plain">
        {bss.length > 0 && <li>Brier skill is small{Math.min(...bss) > 0 ? ' but positive' : ''} against climatology, persistence and ENSO-only at every horizon ({fmtNum(Math.min(...bss), 2)} to {fmtNum(Math.max(...bss), 2)}; 1 would be perfect).</li>}
        <li>Its ranking of risky months (AUC-PR) clearly beats climatology {beats.length ? `only at ${beats.join(', ')} month${beats.length > 1 ? 's' : ''} ahead` : 'at no horizon'}.</li>
        {abl.length > 0 && <li>{sig.length === 0 ? 'No single NASA dataset adds significant ranking skill at the country-month level' : `Inputs that add significant skill: ${sig.map((a) => labelSource(a.removed)).join(', ')}`}{grace && isNum(grace.delta_vs_full) && grace.delta_vs_full > 0 ? '; removing GRACE slightly helps' : ''}.</li>}
      </ul>
      <p className="small muted">That is why Patronus leads with reservoir storage and the El Niño signal, where the backtest shows real lead time.</p>
    </div>
  );
}
