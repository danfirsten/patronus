import { useMemo, useState } from 'react';
import { scaleLinear, scaleUtc } from 'd3-scale';
import { line } from 'd3-shape';
import { useWidth } from '../common';
import { LegendItem } from '../TimeChart';
import { fmtMonth, isNum, toDate } from '../../lib/format';
import type { TrendResult } from './stats';
import type { ExVariable } from './types';

export interface ChartSeries {
  v: ExVariable;
  res: TrendResult;
  deseason: boolean;
}

const fmtV = (v: number, d: number) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d);

function trendPts(r: TrendResult, slope: number) {
  // line through the pivot (median time, fitted value there) with the given slope, across the window
  const yMid = r.intercept + r.slope * r.tMid;
  const t0 = 0, t1 = r.months.length - 1;
  return [
    { t: t0, y: yMid + slope * (t0 - r.tMid) },
    { t: t1, y: yMid + slope * (t1 - r.tMid) },
  ];
}

/** Monthly series, Sen's-slope trend line and the 95% CI fan on the slope; optional second variable on a right axis. */
export function TrendChart({ main, cmp, height = 320, ariaLabel }: {
  main: ChartSeries; cmp?: ChartSeries | null; height?: number; ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(800);
  const [hover, setHover] = useState<string | null>(null);
  const narrow = width < 520;
  const m = { top: 12, right: cmp ? (narrow ? 40 : 52) : 12, bottom: 26, left: narrow ? 40 : 50 };
  const iw = Math.max(60, width - m.left - m.right);
  const ih = Math.max(80, height - m.top - m.bottom);

  const { x, yl, yr, allMonths } = useMemo(() => {
    const ms = [...main.res.months, ...(cmp?.res.months ?? [])].sort();
    const d0 = toDate(ms[0])!, d1 = toDate(ms[ms.length - 1])!;
    const x = scaleUtc().domain([d0, d1]).range([0, iw]);
    const ext = (r: TrendResult) => {
      const v = r.values.filter(isNum) as number[];
      const tl = [...trendPts(r, r.lo), ...trendPts(r, r.hi)].map((p) => p.y);
      const all = [...v, ...tl];
      return [Math.min(...all), Math.max(...all)] as [number, number];
    };
    const yl = scaleLinear().domain(ext(main.res)).range([ih, 0]).nice();
    const yr = scaleLinear().domain(cmp ? ext(cmp.res) : [0, 1]).range([ih, 0]).nice();
    const allMonths = [...new Set(ms)];
    return { x, yl, yr, allMonths };
  }, [main, cmp, iw, ih]);

  const px = (mo: string) => x(toDate(mo)!);
  const path = (r: TrendResult, s: typeof yl) =>
    line<number | null>().defined((v) => isNum(v)).x((_, i) => px(r.months[i])).y((v) => s(v as number))(r.values) ?? '';
  const tl = (r: TrendResult, s: typeof yl, slope: number) => trendPts(r, slope).map((p) => [px(r.months[p.t]), s(p.y)] as const);

  const band = (r: TrendResult, s: typeof yl) => {
    const a = tl(r, s, r.lo), b = tl(r, s, r.hi);
    return `M${a[0][0]},${a[0][1]}L${a[1][0]},${a[1][1]}L${b[1][0]},${b[1][1]}L${b[0][0]},${b[0][1]}Z`;
  };

  const yrs = +x.domain()[1] - +x.domain()[0];
  const ticks = x.ticks(Math.max(2, Math.floor(iw / (narrow ? 70 : 90))));
  const tickFmt = (d: Date) => (yrs > 3 * 365 * 864e5 ? String(d.getUTCFullYear()) : fmtMonth(d.toISOString().slice(0, 7)));
  const lblL = `${main.v.short} (${main.v.unit_short}${main.deseason ? ', vs usual for the month' : ''})`;
  const lblR = cmp ? `${cmp.v.short} (${cmp.v.unit_short}${cmp.deseason ? ', vs usual' : ''})` : '';

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const t = +x.invert(e.clientX - r.left);
    let best = allMonths[0], bd = Infinity;
    for (const mo of allMonths) { const d = Math.abs(+toDate(mo)! - t); if (d < bd) { bd = d; best = mo; } }
    setHover(best);
  }
  const valAt = (r: TrendResult, mo: string) => { const i = r.months.indexOf(mo); return i >= 0 ? r.values[i] : null; };
  const hx = hover ? px(hover) : 0;
  const hm = hover ? valAt(main.res, hover) : null;
  const hc = hover && cmp ? valAt(cmp.res, hover) : null;

  return (
    <div className="chart ex-chart" ref={ref}>
      <div className="legend">
        <LegendItem color="var(--series-1)" label={main.v.short} />
        <LegendItem color="var(--ink)" label="Trend (Sen's slope)" />
        <LegendItem kind="box" color="var(--series-band)" label="95% range of the slope" />
        {cmp && <LegendItem color="var(--series-2)" label={`${cmp.v.short} (right axis)`} />}
        {cmp && <LegendItem kind="dash" color="var(--series-3)" label={`${cmp.v.short} trend`} />}
      </div>
      <div className="axis-title"><span>{lblL}</span>{cmp && <span>Right: {lblR}</span>}</div>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        <g transform={`translate(${m.left},${m.top})`}>
          {yl.ticks(5).map((t) => (
            <g key={'l' + t} transform={`translate(0,${yl(t)})`}>
              <line x2={iw} className="grid" />
              <text x={-6} dy="0.32em" textAnchor="end" className="tick">{fmtV(t, Math.abs(t) < 10 && t % 1 ? 1 : 0)}</text>
            </g>
          ))}
          {cmp && yr.ticks(5).map((t) => (
            <text key={'r' + t} x={iw + 6} y={yr(t)} dy="0.32em" className="tick">{fmtV(t, Math.abs(t) < 10 && t % 1 ? 1 : 0)}</text>
          ))}
          {ticks.map((t) => <text key={+t} x={x(t)} y={ih + 18} textAnchor="middle" className="tick">{tickFmt(t)}</text>)}
          <line y1={ih} y2={ih} x2={iw} className="axis" />
          {yl.domain()[0] < 0 && yl.domain()[1] > 0 && <line x2={iw} y1={yl(0)} y2={yl(0)} className="ex-zero" />}

          <path d={band(main.res, yl)} fill="var(--series-band)" className="band-in" />
          <path d={path(main.res, yl)} fill="none" stroke="var(--series-1)" strokeWidth={1.4} strokeLinejoin="round" />
          {cmp && <path d={path(cmp.res, yr)} fill="none" stroke="var(--series-2)" strokeWidth={1.4} strokeLinejoin="round" opacity={0.95} />}
          {cmp && (() => { const p = tl(cmp.res, yr, cmp.res.slope); return <line x1={p[0][0]} y1={p[0][1]} x2={p[1][0]} y2={p[1][1]} stroke="var(--series-3)" strokeWidth={2.5} strokeDasharray="7 5" className="band-in" />; })()}
          {(() => { const p = tl(main.res, yl, main.res.slope); return <line x1={p[0][0]} y1={p[0][1]} x2={p[1][0]} y2={p[1][1]} stroke="var(--ink)" strokeWidth={2.75} strokeLinecap="round" className="band-in" />; })()}

          {hover && <line x1={hx} x2={hx} y1={0} y2={ih} className="crosshair" />}
          {hover && isNum(hm) && <circle cx={hx} cy={yl(hm)} r={3.5} fill="var(--series-1)" stroke="var(--bg-elev)" strokeWidth={1.5} />}
          {hover && cmp && isNum(hc) && <circle cx={hx} cy={yr(hc)} r={3.5} fill="var(--series-2)" stroke="var(--bg-elev)" strokeWidth={1.5} />}
          <rect width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </g>
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: Math.min(width - 190, Math.max(0, m.left + hx + 10)), top: m.top + 30 }}>
          <div className="chart-tip-head">{fmtMonth(hover)}</div>
          <div className="chart-tip-row"><i style={{ background: 'var(--series-1)' }} />{main.v.short}: <b>{isNum(hm) ? `${fmtV(hm, main.v.decimals)} ${main.v.unit_short}` : 'no data'}</b></div>
          {cmp && <div className="chart-tip-row"><i style={{ background: 'var(--series-2)' }} />{cmp.v.short}: <b>{isNum(hc) ? `${fmtV(hc, cmp.v.decimals)} ${cmp.v.unit_short}` : 'no data'}</b></div>}
        </div>
      )}
    </div>
  );
}
