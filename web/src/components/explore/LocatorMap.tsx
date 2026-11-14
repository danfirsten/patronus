import { useMemo } from 'react';
import { geoEqualEarth, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import world from 'world-atlas/countries-110m.json';
import { useWidth } from '../common';
import type { ExRegion } from './types';

const land = (feature(world as any, (world as any).objects.countries) as unknown as FeatureCollection<Geometry>).features
  .filter((f) => f.id !== '010');

/** Small locator: every region in the current filter as a dot, the chosen one ringed. Dots are clickable;
 *  the list next to it is the keyboard route. */
export function LocatorMap({ regions, selected, onPick }: {
  regions: ExRegion[]; selected: ExRegion | null; onPick: (id: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(420);
  const height = Math.round(width * 0.5);
  const projection = useMemo(
    () => geoEqualEarth().fitExtent([[2, 2], [width - 2, height - 2]], { type: 'FeatureCollection', features: land } as any),
    [width, height],
  );
  const path = useMemo(() => geoPath(projection), [projection]);
  const pt = (r: ExRegion) => (r.lon != null && r.lat != null ? projection([r.lon, r.lat]) : null);
  const sel = selected ? pt(selected) : null;
  return (
    <div className="ex-locator" ref={ref}>
      <svg width={width} height={height} role="img"
        aria-label={selected ? `Locator map: ${selected.name}${selected.lat != null ? ` at ${selected.lat.toFixed(1)}°, ${selected.lon?.toFixed(1)}°` : ''}` : 'Locator map'}>
        <rect width={width} height={height} rx={10} fill="var(--map-ocean)" />
        {land.map((f, i) => <path key={i} d={path(f) ?? ''} fill="var(--map-land)" stroke="var(--map-land-stroke)" strokeWidth={0.5} />)}
        {regions.map((r) => {
          const p = pt(r);
          if (!p || r.id === selected?.id) return null;
          return (
            <circle key={r.id} cx={p[0]} cy={p[1]} r={width < 360 ? 3 : 3.5} className="ex-dot" onClick={() => onPick(r.id)}>
              <title>{r.name}</title>
            </circle>
          );
        })}
        {sel && (
          <g transform={`translate(${sel[0]},${sel[1]})`} pointerEvents="none">
            <circle r={11} fill="none" stroke="var(--map-highlight)" strokeWidth={2} />
            <circle r={4.5} fill="var(--map-highlight)" />
          </g>
        )}
      </svg>
    </div>
  );
}
