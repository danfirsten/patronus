import { fmtP, type TrendResult } from './stats';
import { DIRECTION, WATER_LIKE, type ExVariable } from './types';

const signed = (v: number, d: number) => {
  const r = Number(v.toFixed(d));
  if (r === 0) return (0).toFixed(d);
  return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(d);
};

/** Slope (per month) -> per-decade number in the variable's reporting unit (absolute or % of the window mean). */
export function perDecade(v: ExVariable, r: TrendResult, slopePerMonth: number): number {
  const d = slopePerMonth * 120;
  return v.rate_mode === 'pct' ? (d / r.mean) * 100 : d;
}

function digits(v: ExVariable, x: number) {
  if (v.rate_mode === 'pct') return Math.abs(x) < 10 ? 1 : 0;
  const a = Math.abs(x);
  return a >= 10 ? 1 : a >= 1 ? Math.max(1, Math.min(2, v.decimals)) : Math.max(2, v.decimals);
}

/** "−19.7 cm of water per decade" / "+6.8% of average rain per decade". */
export function rateText(v: ExVariable, r: TrendResult): string {
  const x = perDecade(v, r, r.slope);
  return `${signed(x, digits(v, x))}${v.rate_mode === 'pct' ? '%' : ''} ${v.rate_mode === 'pct' ? v.rate_unit.replace(/^% /, '') : v.rate_unit}`;
}

/** Number only, for compact use: "−19.7" (+ "%" in pct mode). */
export function rateNum(v: ExVariable, r: TrendResult, slope = r.slope): string {
  const x = perDecade(v, r, slope);
  return `${signed(x, digits(v, perDecade(v, r, r.slope)))}${v.rate_mode === 'pct' ? '%' : ''}`;
}

export function ciText(v: ExVariable, r: TrendResult): string {
  return `${rateNum(v, r, r.lo)} to ${rateNum(v, r, r.hi)}`;
}

/** Absolute rate in native units, for pct variables' small print ("+0.15 mm/day per decade"). */
export function absRateText(v: ExVariable, r: TrendResult): string {
  const x = r.slope * 120;
  return `${signed(x, Math.abs(x) >= 1 ? 2 : 3)} ${v.unit_short} per decade`;
}

export type Tone = 'drying' | 'wetting' | 'accent' | 'none';

export function verdict(v: ExVariable, r: TrendResult): { head: string; tone: Tone; odds: string } {
  const [down, up] = DIRECTION[v.id] ?? ['falling', 'rising'];
  const word = r.slope < 0 ? down : up;
  const ptxt = fmtP(r.p);
  const odds = r.p < 0.001
    ? 'If nothing were really changing, a trend this clear would turn up by chance less than 1 time in 1,000.'
    : `If nothing were really changing, a trend at least this clear would turn up by chance about ${Math.max(1, Math.round(r.p * 100))} times in 100.`;
  if (r.p < 0.05) {
    const tone: Tone = WATER_LIKE.has(v.id) ? (r.slope < 0 ? 'drying' : 'wetting') : 'accent';
    return { head: `Significant ${word} trend (${ptxt})`, tone, odds };
  }
  if (r.p < 0.1) return { head: `A hint of a ${word} trend, but not significant (${ptxt})`, tone: 'none', odds };
  return { head: `No significant trend (${ptxt}): could need a longer record`, tone: 'none', odds };
}

export function testName(r: TrendResult): string {
  return r.test === 'hamed_rao' ? 'Mann-Kendall, Hamed-Rao corrected'
    : r.test === 'yue_wang' ? 'Mann-Kendall, Yue-Wang corrected (Hamed-Rao fallback)'
      : 'Mann-Kendall (no autocorrelation correction)';
}
