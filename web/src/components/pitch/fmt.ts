import { fmtMonth, MONTHS, toDate } from '../../lib/format';

/** US date: 'Nov 12, 2026'; month-only values read 'Jul 2023'. */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = toDate(s);
  if (!d) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  return fmtMonth(s);
}

export function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
