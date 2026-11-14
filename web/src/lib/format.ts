export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' or 'YYYY-MM-DD' -> Date (UTC, mid-month when no day). */
export function toDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 15));
}

export function fmtMonth(s: string | null | undefined): string {
  const d = toDate(s);
  if (!d) return s ? s : '—';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = toDate(s);
  if (!d) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return fmtMonth(s);
}

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (!isNum(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
export function fmtPct(v: number | null | undefined, digits = 0, signed = false): string {
  if (!isNum(v)) return '—';
  return `${signed && v > 0 ? '+' : ''}${fmtNum(v, digits)}%`;
}
/** probability 0..1 -> '42%' */
export function fmtProb(v: number | null | undefined): string {
  if (!isNum(v)) return '—';
  return `${Math.round(v * 100)}%`;
}
export function fmtMusd(v: number | null | undefined): string {
  if (!isNum(v)) return '—';
  if (Math.abs(v) >= 1000) return `$${fmtNum(v / 1000, 1)}B`;
  return `$${fmtNum(v, 0)}M`;
}

/** Whole months from a to b (b - a). */
export function monthsBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const da = toDate(a), db = toDate(b);
  if (!da || !db) return null;
  return (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
}

export function periodOf(dates: (string | undefined | null)[]): string {
  const ds = dates.filter(Boolean) as string[];
  if (!ds.length) return '—';
  return `${fmtMonth(ds[0])} – ${fmtMonth(ds[ds.length - 1])}`;
}
