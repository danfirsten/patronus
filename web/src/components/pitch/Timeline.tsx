import { fmtMonth, toDate } from '../../lib/format';
import { fmtDate } from './fmt';
import { useInViewOnce } from './InView';

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

/**
 * One crisis on a shared axis: 12 months before onset to onset.
 * Draw-in inspired by 21st.dev "Scroll animated timeline" (Waqar H. Syed, ibrandify UI):
 * the lead bar grows from the alarm to the official warning, then the marks settle in order.
 * Here it is CSS only: transform: scaleX() and opacity on the design system's
 * --dur-5 / --ease-inout (the chart draw), so it stays on the compositor and holds still
 * under prefers-reduced-motion (the duration tokens are 0 there).
 */
export function Timeline({ row, name, compact = false }: { row: TimelineRow; name: string; compact?: boolean }) {
  const [ref, on] = useInViewOnce<HTMLDivElement>();
  const pos = (d: string) => {
    const m = Math.max(-SPAN, Math.min(0, -monthsDiff(d, row.onset)));
    return `${((m + SPAN) / SPAN) * 100}%`;
  };
  const parts: string[] = [];
  parts.push(row.alarm ? `Patronus alarm ${fmtMonth(row.alarm)}` : 'No Patronus alarm');
  parts.push(row.warning ? `${row.warningLabel} ${fmtDate(row.warning)}` : 'No official warning on record');
  parts.push(`${row.onsetLabel} ${fmtDate(row.onset)}`);
  const leadEnd = row.warning ?? row.onset;
  return (
    <div ref={ref} className={`pt-tl${compact ? ' pt-tl-compact' : ''}${on ? ' is-on' : ''}`} role="img" aria-label={`${name}: ${parts.join('; ')}.`}>
      <div className="pt-tl-track">
        {row.alarm && (
          <span className="pt-tl-lead" style={{ left: pos(row.alarm), right: `calc(100% - ${pos(leadEnd)})` }} />
        )}
        {row.alarm && <span className="pt-tl-mark pt-tl-alarm" style={{ left: pos(row.alarm), ['--d' as string]: '0ms' }} />}
        {row.warning && <span className="pt-tl-mark pt-tl-warn" style={{ left: pos(row.warning), ['--d' as string]: '900ms' }} />}
        <span className="pt-tl-mark pt-tl-onset" style={{ left: pos(row.onset), ['--d' as string]: '1100ms' }} />
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
