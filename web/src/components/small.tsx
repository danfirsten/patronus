import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import type { ForecastMonth } from '../data/types';
import { fmtMonth, fmtProb, isNum } from '../lib/format';
import { riskOf, riskVar, riskTextVar } from '../lib/risk';

/** Small TWS anomaly sparkline for map tooltips. */
export function Sparkline({ values, width = 220, height = 48, color = 'var(--series-1)' }: {
  values: (number | null)[]; width?: number; height?: number; color?: string;
}) {
  const vals = values.filter(isNum);
  if (vals.length < 2) return null;
  const x = scaleLinear().domain([0, values.length - 1]).range([2, width - 2]);
  const ext = Math.max(Math.abs(Math.min(...vals)), Math.abs(Math.max(...vals)), 1);
  const y = scaleLinear().domain([-ext, ext]).range([height - 2, 2]);
  const d = line<number | null>().defined(isNum).x((_, i) => x(i)).y((v) => y(v as number))(values);
  return (
    <svg width={width} height={height} className="sparkline" aria-hidden="true">
      <line x1={0} x2={width} y1={y(0)} y2={y(0)} className="grid" />
      <path d={d ?? ''} fill="none" stroke={color} strokeWidth={1.4} />
    </svg>
  );
}

/** Six coloured cells, one per forecast month, coloured by risk level. */
export function ProbStrip({ months }: { months?: ForecastMonth[] }) {
  if (!months?.length) return <span className="muted">—</span>;
  return (
    <span className="prob-strip" role="list">
      {months.slice(0, 6).map((m) => {
        const r = riskOf(m.p_shortfall);
        return (
          <span
            key={m.month}
            role="listitem"
            className="prob-cell"
            title={`${fmtMonth(m.month)}: ${fmtProb(m.p_shortfall)} chance of a shortfall`}
            style={{ background: riskVar(r), color: riskTextVar(r) }}
          >
            <span className="prob-cell-m">{fmtMonth(m.month).slice(0, 3)}</span>
            <span className="prob-cell-v">{isNum(m.p_shortfall) ? Math.round(m.p_shortfall * 100) : '–'}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * "Months to darkness" gauge. `months` = months until the first forecast month
 * that crosses the alarm line; null = not within the forecast window.
 */
export function Gauge({ months, max = 12, label, sub, beyond }: { months: number | null; max?: number; label: string; sub?: string; beyond?: string }) {
  const W = 220, H = 130, cx = W / 2, cy = 112, r = 92;
  const v = months === null ? max : Math.max(0, Math.min(max, months));
  const angle = Math.PI * (1 - v / max); // 0 months = left (danger), max = right (calm)
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`;
  };
  const seg = [
    { from: 0, to: 2, c: 'var(--risk-danger)' },
    { from: 2, to: 4, c: 'var(--risk-warning)' },
    { from: 4, to: 6, c: 'var(--risk-watch)' },
    { from: 6, to: max, c: 'var(--risk-low)' },
  ];
  const nx = cx + (r - 18) * Math.cos(angle), ny = cy - (r - 18) * Math.sin(angle);
  return (
    <div className="gauge">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 280 }} role="img"
        aria-label={`${label}: ${months === null ? beyond ?? `more than ${max}` : months} months`}>
        {seg.map((s) => (
          <path key={s.from} d={arc(Math.PI * (1 - s.from / max), Math.PI * (1 - s.to / max))} stroke={s.c} strokeWidth={14} fill="none" />
        ))}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--text)" strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={6} fill="var(--text)" />
        <text x={cx - r} y={cy + 16} textAnchor="middle" className="tick">0</text>
        <text x={cx + r} y={cy + 16} textAnchor="middle" className="tick">{max}+</text>
      </svg>
      <div className="gauge-value">{months === null ? beyond ?? `${max}+` : months}<span> months</span></div>
      <div className="gauge-label">{label}</div>
      {sub && <div className="gauge-sub muted">{sub}</div>}
    </div>
  );
}
