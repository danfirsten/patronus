import { useMemo, useState, type ReactNode } from 'react';
import { scaleLinear, scaleUtc } from 'd3-scale';
import { area, line, curveMonotoneX } from 'd3-shape';
import { useWidth } from './common';
import { toDate, isNum, fmtMonth } from '../lib/format';

type Axis = 'left' | 'right';
export type Layer =
  | { kind: 'line'; data: { x: string; y: number | null | undefined }[]; color: string; width?: number; dash?: string; axis?: Axis; label?: string; fmt?: (v: number) => string; curve?: boolean }
  | { kind: 'band'; data: { x: string; lo: number | null | undefined; hi: number | null | undefined }[]; color: string; axis?: Axis; label?: string; fmt?: (v: number) => string }
  | { kind: 'bars'; data: { x: string; y: number | null | undefined; color?: string }[]; color: string; axis?: Axis; label?: string; fmt?: (v: number) => string; widthDays?: number }
  | { kind: 'hline'; y: number; color: string; label?: string; dash?: string; axis?: Axis }
  | { kind: 'vline'; x: string; color: string; label?: string; row?: number; dash?: string }
  | { kind: 'span'; from: string; to: string; color: string }
  | { kind: 'points'; data: { x: string; y: number | null | undefined; label?: string }[]; color: string; r?: number; axis?: Axis; label?: string; fmt?: (v: number) => string };

export interface AxisSpec {
  domain?: [number, number];
  label?: string;
  fmt?: (v: number) => string;
  ticks?: number;
}

const DAY = 86400000;

export function TimeChart({
  layers, height = 280, y, y2, xDomain, ariaLabel, legend,
}: {
  layers: Layer[]; height?: number; y: AxisSpec; y2?: AxisSpec; xDomain?: [string, string]; ariaLabel: string; legend?: ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const vRows = Math.max(0, ...layers.filter((l) => l.kind === 'vline').map((l: any) => (l.row ?? 0) + 1));
  const m = { top: 12 + vRows * 16, right: y2 ? 48 : 14, bottom: 26, left: 46 };
  const iw = Math.max(50, width - m.left - m.right);
  const ih = Math.max(50, height - m.top - m.bottom);

  const { x, yl, yr, xs } = useMemo(() => {
    const allX: number[] = [];
    const valsL: number[] = [];
    const valsR: number[] = [];
    for (const l of layers) {
      const push = (axis: Axis | undefined, v: number | null | undefined) => {
        if (isNum(v)) (axis === 'right' ? valsR : valsL).push(v);
      };
      if (l.kind === 'line' || l.kind === 'bars' || l.kind === 'points') {
        l.data.forEach((d) => { const t = toDate(d.x); if (t) allX.push(+t); push(l.axis, d.y); });
      } else if (l.kind === 'band') {
        l.data.forEach((d) => { const t = toDate(d.x); if (t) allX.push(+t); push(l.axis, d.lo); push(l.axis, d.hi); });
      } else if (l.kind === 'hline') push(l.axis, l.y);
    }
    const xd: [Date, Date] = xDomain
      ? [toDate(xDomain[0])!, toDate(xDomain[1])!]
      : allX.length ? [new Date(Math.min(...allX)), new Date(Math.max(...allX))] : [new Date(), new Date()];
    const bars = layers.find((l) => l.kind === 'bars') as any;
    if (bars && !xDomain) {
      const pad = ((bars.widthDays ?? 24) / 2 + 4) * DAY;
      xd[0] = new Date(+xd[0] - pad); xd[1] = new Date(+xd[1] + pad);
    }
    const x = scaleUtc().domain(xd).range([0, iw]);
    const ext = (v: number[]): [number, number] => (v.length ? [Math.min(0, ...v), Math.max(...v)] : [0, 1]);
    const yl = scaleLinear().domain(y.domain ?? ext(valsL)).range([ih, 0]);
    if (!y.domain) yl.nice();
    const yr = scaleLinear().domain(y2?.domain ?? ext(valsR)).range([ih, 0]);
    if (y2 && !y2.domain) yr.nice();
    const xs = [...new Set(allX)].sort((a, b) => a - b);
    return { x, yl, yr, xs };
  }, [layers, iw, ih, xDomain, y.domain, y2?.domain]);

  const ys = (a?: Axis) => (a === 'right' ? yr : yl);
  const px = (s: string) => { const d = toDate(s); return d ? x(d) : NaN; };
  const span0 = +x.domain()[1] - +x.domain()[0];
  const short = span0 <= 3 * 365 * DAY;
  let xTicks: Date[];
  if (short) {
    // Short spans: one tick per month (at mid-month, where monthly values sit), thinned to fit.
    const [d0, d1] = x.domain();
    const months: Date[] = [];
    let y0 = d0.getUTCFullYear(), m0 = d0.getUTCMonth();
    for (;;) {
      const t = new Date(Date.UTC(y0, m0, 15));
      if (t > d1) break;
      if (t >= d0) months.push(t);
      m0++; if (m0 > 11) { m0 = 0; y0++; }
    }
    const maxN = Math.max(2, Math.floor(iw / 80));
    const step = Math.max(1, Math.ceil(months.length / maxN));
    xTicks = months.filter((_, i) => i % step === 0);
  } else {
    xTicks = x.ticks(Math.max(2, Math.floor(iw / 90)));
  }
  const span = +x.domain()[1] - +x.domain()[0];
  const tickFmt = (d: Date) => (span > 3 * 365 * DAY ? String(d.getUTCFullYear()) : fmtMonth(d.toISOString().slice(0, 7)));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    if (!xs.length) return;
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const t = +x.invert(e.clientX - r.left);
    let best = xs[0];
    for (const v of xs) if (Math.abs(v - t) < Math.abs(best - t)) best = v;
    setHover(best);
  }

  const hoverRows: { label: string; value: string; color: string }[] = [];
  if (hover !== null) {
    for (const l of layers) {
      if (!('label' in l) || !l.label) continue;
      const fmt = ('fmt' in l && l.fmt) || ((('axis' in l && l.axis === 'right') ? y2?.fmt : y.fmt) ?? ((v: number) => String(Math.round(v * 10) / 10)));
      if (l.kind === 'line' || l.kind === 'bars' || l.kind === 'points') {
        const d = l.data.find((d) => +(toDate(d.x) ?? 0) === hover);
        if (d && isNum(d.y)) hoverRows.push({ label: l.label, value: fmt(d.y), color: l.color });
      } else if (l.kind === 'band') {
        const d = l.data.find((d) => +(toDate(d.x) ?? 0) === hover);
        if (d && isNum(d.lo) && isNum(d.hi)) hoverRows.push({ label: l.label, value: `${fmt(d.lo)} to ${fmt(d.hi)}`, color: l.color });
      }
    }
  }
  const hx = hover !== null ? x(new Date(hover)) : 0;

  return (
    <div className="chart" ref={ref}>
      {legend && <div className="legend">{legend}</div>}
      {(y.label || y2?.label) && (
        <div className="axis-title">
          <span>{y.label}</span>
          {y2?.label && <span>Right axis: {y2.label}</span>}
        </div>
      )}
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        <g transform={`translate(${m.left},${m.top})`}>
          {/* grid + left axis */}
          {yl.ticks(y.ticks ?? 5).map((t) => (
            <g key={'yl' + t} transform={`translate(0,${yl(t)})`}>
              <line x2={iw} className="grid" />
              <text x={-6} dy="0.32em" textAnchor="end" className="tick">{y.fmt ? y.fmt(t) : t}</text>
            </g>
          ))}
          {y2 && yr.ticks(y2.ticks ?? 5).map((t) => (
            <text key={'yr' + t} x={iw + 6} y={yr(t)} dy="0.32em" className="tick">{y2.fmt ? y2.fmt(t) : t}</text>
          ))}
          {xTicks.map((t) => (
            <text key={+t} x={x(t)} y={ih + 18} textAnchor="middle" className="tick">{tickFmt(t)}</text>
          ))}
          <line y1={ih} y2={ih} x2={iw} className="axis" />

          {layers.map((l, i) => {
            const k = `l${i}`;
            switch (l.kind) {
              case 'span': {
                const a = px(l.from), b = px(l.to);
                if (!isFinite(a) || !isFinite(b)) return null;
                return <rect key={k} x={Math.max(0, a)} width={Math.max(1, Math.min(iw, b) - Math.max(0, a))} y={0} height={ih} fill={l.color} />;
              }
              case 'band': {
                const pts = l.data.filter((d) => isNum(d.lo) && isNum(d.hi) && toDate(d.x));
                const s = ys(l.axis);
                const p = area<typeof pts[number]>().x((d) => px(d.x)).y0((d) => s(d.lo as number)).y1((d) => s(d.hi as number)).curve(curveMonotoneX)(pts);
                return p ? <path key={k} d={p} fill={l.color} stroke="none" /> : null;
              }
              case 'bars': {
                const s = ys(l.axis);
                const bw = Math.max(1, (iw / Math.max(1, span / DAY)) * (l.widthDays ?? 24));
                return (
                  <g key={k}>
                    {l.data.filter((d) => isNum(d.y)).map((d, j) => {
                      const y0 = s(Math.max(s.domain()[0], 0));
                      const yv = s(d.y as number);
                      return <rect key={j} x={px(d.x) - bw / 2} width={bw} y={Math.min(y0, yv)} height={Math.abs(y0 - yv)} fill={d.color ?? l.color} />;
                    })}
                  </g>
                );
              }
              case 'line': {
                const s = ys(l.axis);
                const gen = line<typeof l.data[number]>()
                  .defined((d) => isNum(d.y) && !!toDate(d.x))
                  .x((d) => px(d.x)).y((d) => s(d.y as number));
                if (l.curve !== false) gen.curve(curveMonotoneX);
                return <path key={k} d={gen(l.data) ?? ''} fill="none" stroke={l.color} strokeWidth={l.width ?? 2} strokeDasharray={l.dash} />;
              }
              case 'points': {
                const s = ys(l.axis);
                return (
                  <g key={k}>
                    {l.data.filter((d) => isNum(d.y)).map((d, j) => (
                      <g key={j} transform={`translate(${px(d.x)},${s(d.y as number)})`}>
                        <circle r={l.r ?? 4} fill={l.color} stroke="var(--bg)" strokeWidth={1.5} />
                        {d.label && (px(d.x) > iw * 0.7
                          ? <text x={-8} dy="-0.6em" textAnchor="end" className="point-label">{d.label}</text>
                          : <text x={7} dy="0.32em" className="point-label">{d.label}</text>)}
                      </g>
                    ))}
                  </g>
                );
              }
              case 'hline': {
                const s = ys(l.axis);
                const yy = s(l.y);
                if (!isFinite(yy) || yy < -1 || yy > ih + 1) return null;
                return (
                  <g key={k}>
                    <line x2={iw} y1={yy} y2={yy} stroke={l.color} strokeDasharray={l.dash ?? '5 4'} strokeWidth={1.5} />
                    {l.label && <text x={iw - 4} y={yy - 4} textAnchor="end" className="hline-label" fill={l.color}>{l.label}</text>}
                  </g>
                );
              }
              case 'vline': {
                const xx = px(l.x);
                if (!isFinite(xx) || xx < 0 || xx > iw) return null;
                const row = l.row ?? 0;
                const anchor = xx > iw * 0.7 ? 'end' : 'start';
                return (
                  <g key={k}>
                    <line x1={xx} x2={xx} y1={-(vRows - row) * 16 + 4} y2={ih} stroke={l.color} strokeDasharray={l.dash ?? '2 3'} strokeWidth={1.5} />
                    {l.label && (
                      <text x={xx + (anchor === 'start' ? 4 : -4)} y={-(vRows - row) * 16 + 12} textAnchor={anchor} className="vline-label" fill={l.color}>{l.label}</text>
                    )}
                  </g>
                );
              }
            }
          })}

          {hover !== null && <line x1={hx} x2={hx} y1={0} y2={ih} className="crosshair" />}
          <rect width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </g>
      </svg>
      {hover !== null && hoverRows.length > 0 && (
        <div className="chart-tip" style={{ left: Math.min(width - 190, Math.max(0, m.left + hx + 10)), top: m.top }}>
          <div className="chart-tip-head">{fmtMonth(new Date(hover).toISOString().slice(0, 7))}</div>
          {hoverRows.map((r) => (
            <div key={r.label} className="chart-tip-row"><i style={{ background: r.color }} />{r.label}: <b>{r.value}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LegendItem({ color, label, kind = 'line' }: { color: string; label: ReactNode; kind?: 'line' | 'box' | 'dash' | 'dot' }) {
  return (
    <span className="legend-item">
      <i className={`lg-${kind}`} style={kind === 'dash' ? { borderColor: color } : { background: color }} />
      {label}
    </span>
  );
}
