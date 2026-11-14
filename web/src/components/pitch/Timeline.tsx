import { fmtDate, fmtMonth, toDate } from '../../lib/format';

/** Months from a to b, fractional (b - a). */
export function monthsDiff(a: string, b: string): number {
  const da = toDate(a)!, db = toDate(b)!;
  return (+db - +da) / (86400000 * 30.44);
}

const SPAN = 12; // axis runs from 12 months before onset to onset

export interface TimelineRow {
  alarm: string | null;
  warning: string | null;
  onset: string;
  warningLabel: string;
  onsetLabel: string;
}

/** One crisis on a shared axis: 12 months before onset to onset. */
export function Timeline({ row, name }: { row: TimelineRow; name: string }) {
  const pos = (d: string) => {
    const m = Math.max(-SPAN, Math.min(0, -monthsDiff(d, row.onset)));
    return `${((m + SPAN) / SPAN) * 100}%`;
  };
  const parts: string[] = [];
  parts.push(row.alarm ? `Patronus alarm ${fmtMonth(row.alarm)}` : 'No Patronus alarm');
  if (row.warning) parts.push(`${row.warningLabel} ${fmtDate(row.warning)}`);
  else parts.push('No official warning on record');
  parts.push(`${row.onsetLabel} ${fmtDate(row.onset)}`);
  return (
    <div className="pt-tl" role="img" aria-label={`${name}: ${parts.join('; ')}.`}>
      <div className="pt-tl-track">
        {row.alarm && row.warning && (
          <span className="pt-tl-lead" style={{ left: pos(row.alarm), right: `calc(100% - ${pos(row.warning)})` }} />
        )}
        {row.alarm && <span className="pt-tl-mark pt-tl-alarm" style={{ left: pos(row.alarm) }} title={`Patronus alarm: ${fmtMonth(row.alarm)}`} />}
        {row.warning && <span className="pt-tl-mark pt-tl-warn" style={{ left: pos(row.warning) }} title={`${row.warningLabel}: ${fmtDate(row.warning)}`} />}
        <span className="pt-tl-mark pt-tl-onset" style={{ left: pos(row.onset) }} title={`${row.onsetLabel}: ${fmtDate(row.onset)}`} />
      </div>
    </div>
  );
}

export function TimelineAxis() {
  return (
    <div className="pt-tl-axis" aria-hidden="true">
      <span style={{ left: '0%' }}>12 mo before</span>
      <span style={{ left: '50%' }}>6 mo</span>
      <span style={{ left: '100%' }}>Crisis starts</span>
    </div>
  );
}

export function TimelineLegend() {
  return (
    <ul className="pt-legend">
      <li><span className="pt-tl-mark pt-tl-alarm" aria-hidden="true" />Patronus alarm</li>
      <li><span className="pt-tl-mark pt-tl-warn" aria-hidden="true" />First official warning</li>
      <li><span className="pt-tl-mark pt-tl-onset" aria-hidden="true" />Crisis starts</li>
    </ul>
  );
}
