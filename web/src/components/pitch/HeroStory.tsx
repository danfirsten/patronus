/*
 * Pitch hero: three-beat Kariba story beside the lake's usable-storage line.
 *
 * Adapted from two 21st.dev components:
 *   - "Background Paths" by Kokonut UI (@kokonutd, MIT, kokonutui.com): a path drawn in with
 *     pathLength 0 -> 1 and a title revealed in a stagger. Here the path is real data (the
 *     Kariba line, split at the three event dates) and each segment's draw hands over to a
 *     headline beat. Motion is CSS stroke-dashoffset on pathLength="1" rather than framer-motion,
 *     so the page gains no dependency.
 *   - "Hero Modern / hero-six" by brijr (craft-ds): the split layout, copy on the left and a
 *     full-height visual on the right, stacked copy-first on phones.
 * Colours, type and timing come only from the Drawdown tokens in theme.css. No gradients or glows.
 * prefers-reduced-motion: everything renders in its final state at once (stage 4 on mount).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { scaleLinear, scaleTime } from 'd3-scale';
import { area as d3area, line as d3line, curveMonotoneX } from 'd3-shape';
import { Fn } from './sources';
import { scrollToId } from './fmt';
import './hero.css';

export interface KaribaPoint { date: string; usable_pct: number }

const START = new Date('2022-01-01');
const END = new Date('2024-12-31');
const Y_MAX = 50;

/** The three beats and the dates their markers sit on. */
const BEATS = [
  { date: '2023-07-15', when: 'Jul 2023', what: 'Alarm from NASA data', text: 'In July 2023, NASA satellites showed Lake Kariba was in trouble.', row: 0, anchor: 'end' as const },
  { date: '2023-12-28', when: '28 Dec 2023', what: 'Water for power cut', text: 'Five months later, the authorities cut its power water.', row: 1, anchor: 'start' as const },
  { date: '2024-03-11', when: '11 Mar 2024', what: 'Load-shedding begins', text: 'Eight months later, Zambia went dark.', row: 2, anchor: 'start' as const },
];

// Timing (ms). One segment draws, then its marker lights and its beat rises (~350 ms).
const FIRST = 150;
const SEG = 700;

function usePrefersReducedMotion() {
  const [r] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  return r;
}

export function HeroStory({ history }: { history: KaribaPoint[] | null }) {
  const reduced = usePrefersReducedMotion();
  // stage n: segments 0..n-1 drawn and beats 0..n-1 shown; 4 = tail drawn, all done.
  const [stage, setStage] = useState(reduced ? 4 : 0);
  const ready = !!history?.length;

  useEffect(() => {
    if (reduced || !ready) return;
    const ts = [1, 2, 3, 4].map((s) => window.setTimeout(() => setStage(s), FIRST + (s - 1) * SEG));
    return () => ts.forEach(clearTimeout);
  }, [reduced, ready]);

  // Size the SVG to its box so labels stay true-size; phones drop in-chart labels for a key below.
  const figRef = useRef<HTMLElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = figRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = W < 560;
  const H = narrow ? 260 : Math.min(440, Math.round(W * 0.66));
  const M = narrow ? { t: 24, r: 10, b: 30, l: 34 } : { t: 132, r: 16, b: 34, l: 40 };

  const chart = useMemo(() => {
    if (!history?.length) return null;
    const pts = history
      .map((p) => ({ d: new Date(p.date), v: p.usable_pct }))
      .filter((p) => p.d >= START && p.d <= END && Number.isFinite(p.v));
    const x = scaleTime().domain([START, END]).range([M.l, W - M.r]);
    const y = scaleLinear().domain([0, Y_MAX]).range([H - M.b, M.t]);
    const valAt = (d: Date) => {
      const i = pts.findIndex((p) => p.d >= d);
      if (i === -1) return pts[pts.length - 1].v;
      if (i === 0) return pts[0].v;
      const a = pts[i - 1], b = pts[i];
      const f = (+d - +a.d) / (+b.d - +a.d);
      return a.v + (b.v - a.v) * f;
    };
    const cuts = BEATS.map((b) => new Date(b.date));
    // Four segments: start..beat1, beat1..beat2, beat2..beat3, beat3..end; each shares its join point.
    const bounds = [START, ...cuts, END];
    const ln = d3line<{ d: Date; v: number }>().x((p) => x(p.d)).y((p) => y(p.v)).curve(curveMonotoneX);
    const segs = bounds.slice(0, -1).map((a, i) => {
      const b = bounds[i + 1];
      const inner = pts.filter((p) => p.d > a && p.d < b);
      return ln([{ d: a, v: valAt(a) }, ...inner, { d: b, v: valAt(b) }]) ?? '';
    });
    const fill = d3area<{ d: Date; v: number }>().x((p) => x(p.d)).y0(y(0)).y1((p) => y(p.v)).curve(curveMonotoneX)(pts) ?? '';
    const markers = BEATS.map((b, i) => ({ ...b, cx: x(cuts[i]), cy: y(valAt(cuts[i])), ly: 18 + b.row * 40 }));
    const years = [2022, 2023, 2024, 2025].map((yr) => ({ yr, x: x(new Date(`${yr}-01-01`)) }));
    const grid = [0, 20, 40].map((v) => ({ v, y: y(v) }));
    return { segs, fill, markers, years, grid, x0: M.l, x1: W - M.r };
  }, [history, W, H, narrow]);

  return (
    <section className="ph" aria-labelledby="ph-h" data-stage={stage}>
      <div className="ph-wrap">
        <div className="ph-copy">
          <p className="eyebrow">Hydropower early warning</p>
          <h1 id="ph-h" className="ph-h1">
            {BEATS.map((b, i) => (
              <span key={b.date} className={`ph-beat${stage > i ? ' is-on' : ''}`}>
                <span className="ph-beat-n" aria-hidden="true">{i + 1}</span>
                <span className="ph-beat-t">{b.text}</span>
              </span>
            ))}
          </h1>
          <div className={`ph-after${stage > 0 ? ' is-on' : ''}`}>
            <p className="ph-lede"><strong>Patronus</strong> reads <strong>NASA water data</strong> to warn countries that run on hydropower of power shortfalls months before they hit.</p>
            <div className="pt-actions">
              <button type="button" className="button" onClick={() => scrollToId('pt-next')}>See the 2027 forecast</button>
              <a className="pt-link" href="#/proof/backtest">See every past call</a>
            </div>
          </div>
        </div>

        <figure className="ph-fig" ref={figRef}>
          {chart ? (
            <svg className="ph-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="ph-cap">
              {chart.grid.map((g) => (
                <g key={g.v}>
                  <line className="ph-grid" x1={chart.x0} x2={chart.x1} y1={g.y} y2={g.y} />
                  <text className="ph-axis" x={chart.x0 - 8} y={g.y + 4} textAnchor="end">{g.v}%</text>
                </g>
              ))}
              {chart.years.map((t) => (
                <text key={t.yr} className="ph-axis" x={t.x} y={H - 10} textAnchor="middle">{t.yr}</text>
              ))}
              <path className={`ph-area${stage >= 4 ? ' is-on' : ''}`} d={chart.fill} />
              {chart.segs.map((d, i) => (
                <path key={i} className={`ph-line${stage > i ? ' is-on' : ''}${i === 3 ? ' ph-tail' : ''}`} d={d} pathLength={1} />
              ))}
              {chart.markers.map((m, i) => (
                <g key={m.date} className={`ph-mk${stage > i ? ' is-on' : ''}`}>
                  <line className="ph-mk-rule" x1={m.cx} x2={m.cx} y1={narrow ? M.t : m.ly + 22} y2={m.cy - 8} />
                  <circle className="ph-mk-dot" cx={m.cx} cy={m.cy} r={6} />
                  <text className="ph-mk-n" x={m.cx} y={m.cy + 3.5} textAnchor="middle">{i + 1}</text>
                  {!narrow && <text className="ph-mk-when" x={m.cx + (m.anchor === 'end' ? -6 : 6)} y={m.ly} textAnchor={m.anchor}>{m.when}</text>}
                  {!narrow && <text className="ph-mk-what" x={m.cx + (m.anchor === 'end' ? -6 : 6)} y={m.ly + 17} textAnchor={m.anchor}>{m.what}</text>}
                </g>
              ))}
            </svg>
          ) : (
            <div className="ph-svg ph-svg-empty" aria-hidden="true" />
          )}
          {narrow && (
            <ol className="ph-key">
              {BEATS.map((b, i) => (
                <li key={b.date} className={stage > i ? 'is-on' : ''}><span className="ph-key-n">{i + 1}</span><span className="ph-key-when">{b.when}</span> {b.what}</li>
              ))}
            </ol>
          )}
          <figcaption id="ph-cap" className="ph-cap">
            Lake Kariba usable storage, % of the operating band, from satellite altimetry, 2022 to 2024.<Fn k="kariba" /><Fn k="zra2023" /><Fn k="lusakatimes" />
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
