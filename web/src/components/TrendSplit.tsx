import type { Trends } from '../data/types';
import { fmtNum, isNum, periodOf } from '../lib/format';
import { LegendItem } from './TimeChart';

/**
 * The drying total split by cause, so "X GW drying" is never shown without its caveat.
 * Reads trends.json summary.split (gw_drying_with_rain_decline, gw_drying_without_rain_decline,
 * gw_wetting); falls back to summary.gw_drying_with_precip_decline and gw_drying minus that.
 */
export function trendSplit(t: Trends | null) {
  const s: any = t?.summary ?? {};
  const sp: any = s.split ?? null;
  const withRain: number | null = sp?.gw_drying_with_rain_decline ?? s.gw_drying_with_precip_decline ?? null;
  const total: number | null = isNum(sp?.gw_drying) ? sp.gw_drying : s.gw_drying ?? null;
  const without: number | null = sp?.gw_drying_without_rain_decline ?? (isNum(total) && isNum(withRain) ? total - withRain : null);
  const wetting: number | null = sp?.gw_wetting ?? s.gw_wetting ?? null;
  const drying = isNum(withRain) && isNum(without) ? withRain + without : total;
  const mapped: number | null = s.gw_total ?? null;
  const noTrend: number | null = s.gw_no_significant_trend ?? (isNum(mapped) && isNum(drying) && isNum(wetting) ? mapped - drying - wetting : null);
  // Use one decimal when rounded parts would not add up to the rounded total (e.g. 61 + 332 vs 392).
  const dp = isNum(withRain) && isNum(without) && Math.round(withRain) + Math.round(without) !== Math.round(withRain + without) ? 1 : 0;
  const composed = isNum(withRain) && isNum(without)
    ? `${fmtNum(withRain, dp)} GW of hydropower sits in basins that are drying with a significant rain decline; another ${fmtNum(without, dp)} GW is losing water storage without a rain decline (groundwater, glacier and snow loss, or reservoir drawdown).`
    : null;
  // When the pipeline provides the split, its own headline is written to lead with it.
  const headline: string | null = sp?.headline ?? (sp && s.headline ? s.headline : composed ?? s.headline ?? null);
  return { withRain, without, drying, wetting, mapped, noTrend, headline, dp, rainPeriod: rainPeriodOf(t) };
}

/** Which period the rain trend uses (it may differ from the storage period, e.g. 2002–2019 for GPCP drift). */
export function rainPeriodOf(t: Trends | null): string | null {
  const a: any = t ?? {};
  const p = a.summary?.split?.rain_period ?? a.precip_period ?? a.rain_period ?? a.period_precip;
  if (p && typeof p === 'object' && p.from && p.to) return periodOf([p.from, p.to]);
  if (typeof p === 'string') return p;
  const m = typeof a.method === 'string' ? a.method : '';
  const i = m.search(/precipitation|rain/i);
  if (i >= 0) {
    const r = /(\d{4}(?:-\d{2})?)\s*(?:\.\.|–|-|to)\s*(\d{4}(?:-\d{2})?)/.exec(m.slice(i));
    if (r) return `${r[1]} to ${r[2]}`;
  }
  return a.period ? `${periodOf([a.period.from, a.period.to])} (same as water storage)` : null;
}

export function TrendSplitBlock({ trends, compact = false }: { trends: Trends | null; compact?: boolean }) {
  const s = trendSplit(trends);
  if (!isNum(s.drying)) return null;
  const parts = [
    { v: s.withRain, c: 'var(--drying-strong)', l: 'Drying, with a rain decline' },
    { v: s.without, c: 'var(--drying-mild)', l: 'Drying, no rain decline' },
    { v: s.noTrend, c: 'var(--neutral-data)', l: 'No significant trend' },
    { v: s.wetting, c: 'var(--wetting-strong)', l: 'Wetting' },
  ].filter((p) => isNum(p.v) && (p.v as number) > 0) as { v: number; c: string; l: string }[];
  const sum = parts.reduce((a, p) => a + p.v, 0) || 1;
  return (
    <div className="trend-split">
      {s.headline && (compact ? <h2>{s.headline}</h2> : <p className="headline">{s.headline}</p>)}
      <div className="split-tiles">
        <div className="split-tile t-strong"><b>{fmtNum(s.withRain, s.dp)} GW</b><span>drying, with a significant rain decline</span></div>
        <span className="split-op" aria-hidden="true">+</span>
        <div className="split-tile t-mild"><b>{fmtNum(s.without, s.dp)} GW</b><span>losing storage without a rain decline (groundwater, glacier/snow, reservoirs)</span></div>
        <span className="split-op" aria-hidden="true">=</span>
        <div className="split-tile"><b>{fmtNum(s.drying, s.dp)} GW</b><span>in significantly drying basins</span></div>
        {isNum(s.wetting) && <div className="split-tile t-wet"><b>{fmtNum(s.wetting)} GW</b><span>in significantly wetting basins</span></div>}
      </div>
      <div className="split-bar" role="img" aria-label={`Hydropower capacity by basin trend: ${parts.map((p) => `${p.l} ${fmtNum(p.v)} GW`).join(', ')}`}>
        {parts.map((p) => (
          <span key={p.l} style={{ width: `${(p.v / sum) * 100}%`, background: p.c }} title={`${p.l}: ${fmtNum(p.v)} GW`} />
        ))}
      </div>
      <div className="legend">
        {parts.map((p) => <LegendItem key={p.l} kind="box" color={p.c} label={`${p.l} (${fmtNum(p.v)} GW)`} />)}
        {isNum(s.mapped) && <span className="legend-item">of {fmtNum(s.mapped)} GW mapped</span>}
      </div>
      <p className="small muted">
        Water storage trend: GRACE/GRACE-FO, {trends?.period ? periodOf([trends.period.from, trends.period.to]) : '2002–2026'}. Rain trend period: {s.rainPeriod ?? '—'}.
      </p>
    </div>
  );
}
