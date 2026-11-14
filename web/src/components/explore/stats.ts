/**
 * Trend statistics computed live in the browser (no dependencies).
 *
 * Mirrors pipeline/trends.py and pymannkendall exactly, so a basin's result here matches trends.json:
 *   - seasonal cycle: subtract each calendar month's mean over the chosen window;
 *   - Sen's slope: median of all pairwise slopes on the REAL time axis (gaps don't compress time);
 *   - Mann-Kendall S with tie correction; Hamed-Rao (1998) variance correction from the significant
 *     autocorrelation lags of the ranks of the Sen-detrended series (pymannkendall's version), with the
 *     Yue-Wang fallback when the corrected variance is not positive (as trends.py does);
 *   - 95% CI on Sen's slope by Gilbert's (1987) rank method using the (corrected) variance of S.
 * A Python copy (pipeline/explorer.py `browser_stats`) cross-checks this against trends.json.
 */

export const Z975 = 1.959963984540054;

export interface TrendResult {
  n: number;            // months with data used in the test
  nWindow: number;      // months in the window
  gaps: number;         // months in the window between first and last value that have no data
  first: string | null;
  last: string | null;
  s: number;
  varS: number;
  z: number;
  p: number;
  test: 'mann_kendall' | 'hamed_rao' | 'yue_wang';
  correction: number | null;  // variance inflation factor (n/n*), null without a correction
  slope: number;        // per month
  lo: number;           // 95% CI on slope, per month
  hi: number;
  intercept: number;    // y = intercept + slope * t, t in months since window start
  tMid: number;         // median t of the data
  mean: number;         // mean of the RAW values in the window (for % rates)
  values: (number | null)[]; // what is plotted (deseasonalized or raw), aligned with `months`
  months: string[];
}

/** Numerical Recipes erfcc: fractional error < 1.2e-7 everywhere. */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (
    0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

function median(sorted: Float64Array | number[]): number {
  const n = sorted.length;
  if (!n) return NaN;
  const h = n >> 1;
  return n % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
}

function rank(v: number[]): number[] {
  const order = v.map((_, i) => i).sort((a, b) => v[a] - v[b] || a - b);
  const r = new Array<number>(v.length);
  let i = 0;
  while (i < v.length) {
    let j = i;
    while (j + 1 < v.length && v[order[j + 1]] === v[order[i]]) j++;
    for (let k = i; k <= j; k++) r[order[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

function acf(x: number[]): number[] {
  const n = x.length;
  let m = 0;
  for (const v of x) m += v;
  m /= n;
  const y = x.map((v) => v - m);
  let c0 = 0;
  for (const v of y) c0 += v * v;
  const out = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    let c = 0;
    for (let i = 0; i + k < n; i++) c += y[i] * y[i + k];
    out[k] = c / c0;
  }
  return out;
}

export function deseasonalize(values: (number | null)[], months: string[]): (number | null)[] {
  const sum = new Array(13).fill(0), cnt = new Array(13).fill(0);
  values.forEach((v, i) => { if (v != null) { const m = +months[i].slice(5, 7); sum[m] += v; cnt[m]++; } });
  return values.map((v, i) => {
    if (v == null) return null;
    const m = +months[i].slice(5, 7);
    return v - sum[m] / cnt[m];
  });
}

export function sliceWindow<T>(months: string[], values: T[], from: string, to: string): { months: string[]; values: T[] } {
  const a = months.findIndex((m) => m >= from);
  if (a < 0) return { months: [], values: [] };
  let b = months.length - 1;
  while (b >= 0 && months[b] > to) b--;
  if (b < a) return { months: [], values: [] };
  return { months: months.slice(a, b + 1), values: values.slice(a, b + 1) };
}

export const MIN_POINTS = 24;

export function trendStats(
  allMonths: string[], allValues: (number | null)[], from: string, to: string,
  opts: { deseason: boolean; hamedRao: boolean },
): TrendResult | null {
  const w = sliceWindow(allMonths, allValues, from, to);
  const raw = w.values;
  const plotted = opts.deseason ? deseasonalize(raw, w.months) : raw.slice();
  const x: number[] = [], t: number[] = [];
  let rawSum = 0;
  plotted.forEach((v, i) => { if (v != null) { x.push(v); t.push(i); rawSum += raw[i] as number; } });
  const n = x.length;
  if (n < MIN_POINTS) return null;

  // Mann-Kendall S and tie-corrected variance
  let s = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(x[j] - x[i]);
  const ties = new Map<number, number>();
  for (const v of x) ties.set(v, (ties.get(v) ?? 0) + 1);
  let tieTerm = 0;
  ties.forEach((c) => { tieTerm += c * (c - 1) * (2 * c + 5); });
  let varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;

  // pairwise slopes: index axis (for Hamed-Rao detrending, as pymannkendall) and real time axis (Sen's slope)
  const np = (n * (n - 1)) / 2;
  const sl = new Float64Array(np);
  const slIdx = opts.hamedRao ? new Float64Array(np) : null;
  let k = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      sl[k] = (x[j] - x[i]) / (t[j] - t[i]);
      if (slIdx) slIdx[k] = (x[j] - x[i]) / (j - i);
      k++;
    }
  }
  sl.sort();

  let test: TrendResult['test'] = 'mann_kendall';
  let correction: number | null = null;
  if (slIdx) {
    slIdx.sort();
    const bIdx = median(slIdx);
    const det = x.map((v, i) => v - (i + 1) * bIdx);
    const r = acf(rank(det));
    const bound = Z975 / Math.sqrt(n);
    let sni = 0;
    for (let i = 1; i < n; i++) if (Math.abs(r[i]) > bound) sni += (n - i) * (n - i - 1) * (n - i - 2) * r[i];
    let corr = 1 + (2 / (n * (n - 1) * (n - 2))) * sni;
    test = 'hamed_rao';
    if (!(corr > 0)) {
      const r2 = acf(det);
      let s2 = 0;
      for (let i = 1; i < n; i++) s2 += (1 - i / n) * r2[i];
      corr = 1 + 2 * s2;
      test = 'yue_wang';
    }
    correction = corr;
    varS *= corr;
  }
  const z = s === 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(varS);
  const p = Math.min(1, erfc(Math.abs(z) / Math.SQRT2));

  const slope = median(sl);
  const c = Z975 * Math.sqrt(varS);
  const clamp = (i: number) => Math.max(0, Math.min(np - 1, i));
  const lo = sl[clamp(Math.round((np - c) / 2) - 1)];
  const hi = sl[clamp(Math.round((np + c) / 2))];
  const resid = x.map((v, i) => v - slope * t[i]).sort((a, b) => a - b);
  const intercept = median(resid);
  const tMid = median(t.slice().sort((a, b) => a - b));

  const idxFirst = t[0], idxLast = t[n - 1];
  return {
    n, nWindow: w.months.length, gaps: idxLast - idxFirst + 1 - n,
    first: w.months[idxFirst] ?? null, last: w.months[idxLast] ?? null,
    s, varS, z, p, test, correction, slope, lo, hi, intercept, tMid, mean: rawSum / n,
    values: plotted, months: w.months,
  };
}

/** p-value text: 'p < 0.001' or 'p = 0.034'. */
export function fmtP(p: number): string {
  if (p < 0.001) return 'p < 0.001';
  if (p < 0.01) return `p = ${p.toFixed(3)}`;
  return `p = ${p.toFixed(2)}`;
}
