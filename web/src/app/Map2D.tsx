import { useMemo } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { useWidth } from '../components/common';
import type { GeoData, Pick, SceneState } from './globe/engine';

/** 2-D fallback of the globe scene (reduced motion, weak phones, no WebGPU/WebGL2). Same picks. */
export default function Map2D({ geo, scene, onPick, why }: { geo: GeoData; scene: SceneState; onPick: (p: Pick) => void; why: string | null }) {
  const [ref, width] = useWidth<HTMLDivElement>(600);
  const h = Math.max(280, Math.min(520, width * 0.78));
  const proj = useMemo(() => geoMercator().fitExtent([[8, 8], [width - 8, h - 8]], {
    type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[20, -8], [36, -8], [20, -26], [36, -26]] },
  } as any), [width, h]);
  const path = geoPath(proj);
  const P = (ll: [number, number]) => proj(ll) ?? [0, 0];
  const kariba = geo.lakes.find((f) => /Kariba/.test(f.properties.name));
  return (
    <div className="map2d" ref={ref}>
      <svg width={width} height={h} role="img" aria-label="Map of Zambia, Lake Kariba and Southern African Power Pool neighbours">
        <rect width={width} height={h} className="m-ocean" />
        {geo.countries.map((f) => <path key={f.properties.iso3} d={path(f as any) ?? ''} className="m-country" />)}
        {geo.provinces.map((f) => {
          const c = scene.cuts[f.properties.name] ?? 0;
          return (
            <path key={f.properties.name} d={path(f as any) ?? ''} className={`m-prov ${scene.selected === f.properties.name ? 'is-sel' : ''}`}
              style={{ fillOpacity: c > 0 ? 0.15 + (c / 30) * 0.55 : 0 }} onClick={() => onPick({ kind: 'province', id: f.properties.name })}>
              <title>{f.properties.name}: demand cut {c}%</title>
            </path>
          );
        })}
        {geo.rivers.map((f, i) => <path key={i} d={path(f as any) ?? ''} className="m-river" style={{ strokeWidth: 1 + scene.releaseFactor * 1.5 }} />)}
        {kariba && <path d={path(kariba as any) ?? ''} className="m-lake" style={{ fillOpacity: 0.35 + Math.min(1, scene.level / 60) * 0.65 }} onClick={() => onPick({ kind: 'lake', id: 'kariba' })} />}
        {scene.arcs.map((a) => {
          const [x0, y0] = P(a.from), [x1, y1] = P(a.to);
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - Math.hypot(x1 - x0, y1 - y0) * 0.25;
          return (
            <g key={a.id} className={`m-arc ${a.available ? '' : 'is-off'} ${scene.selected === a.id ? 'is-sel' : ''}`} onClick={() => onPick({ kind: 'source', id: a.id })}>
              {a.available && a.mw > 0 && <path d={`M${x0},${y0} Q${mx},${my} ${x1},${y1}`} style={{ strokeWidth: 1.5 + (a.mw / 650) * 9 }} />}
              <circle cx={x0} cy={y0} r={6} />
              <text x={x0} y={y0 - 9} textAnchor="middle">{a.label}</text>
            </g>
          );
        })}
        {scene.pins.map((p) => {
          const [x, y] = P(p.at);
          return (
            <g key={p.id} className={`m-pin is-${p.kind} ${scene.selected === p.id ? 'is-sel' : ''}`} onClick={() => onPick({ kind: p.kind, id: p.id })}>
              <rect x={x - 3.5} y={y - 3.5} width={7} height={7} />
              <title>{p.label}</title>
            </g>
          );
        })}
        {scene.gauges.map((g) => {
          const [x, y] = P(g.at);
          if (x < 0 || x > width || y < 0 || y > h) return null;
          return <g key={g.id} className="m-gauge" onClick={() => onPick({ kind: 'reservoir', id: g.id })}><rect x={x - 4} y={y - 24} width={8} height={24} /><rect x={x - 4} y={y - (24 * g.value) / 100} width={8} height={(24 * g.value) / 100} className="fill" /></g>;
        })}
      </svg>
      <span className="globe-backend" data-renderer="2d"><b className="r-badge">2D</b> map{why ? ` (${why})` : ''}</span>
    </div>
  );
}
