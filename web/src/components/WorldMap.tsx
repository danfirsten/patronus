import { useMemo, useState } from 'react';
import { geoArea, geoEqualEarth, geoGraticule10, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon } from 'geojson';
import world from 'world-atlas/countries-110m.json';
import type { Basin, Enso, EnsoCountry, Trends } from '../data/types';
import { NUM_TO_ISO3 } from '../lib/iso';
import { exposureVar, EXPOSURE_LABEL, countryHref } from '../lib/risk';
import { fmtNum, fmtPct, isNum, periodOf } from '../lib/format';
import { useWidth } from './common';
import { Sparkline } from './small';

const countries = (feature(world as any, (world as any).objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>).features
  .filter((f) => f.id !== '010')
  .map((f) => ({ ...f, iso3: NUM_TO_ISO3[String(f.id)] ?? null }));

/**
 * d3-geo uses spherical winding: a ring that is counter-clockwise (as RFC 7946 GeoJSON
 * usually is) means "everything except this". Reverse rings when a polygon covers more
 * than a hemisphere.
 */
function rewind<G extends Geometry>(g: G): G {
  const fix = (poly: number[][][]) => {
    const area = geoArea({ type: 'Polygon', coordinates: poly } as Polygon);
    return area > 2 * Math.PI ? poly.map((ring) => [...ring].reverse()) : poly;
  };
  if (g.type === 'Polygon') return { ...g, coordinates: fix((g as Polygon).coordinates) };
  if (g.type === 'MultiPolygon') return { ...g, coordinates: (g as MultiPolygon).coordinates.map(fix) };
  return g;
}

export type MapMode = 'trend' | 'enso';

type Tip =
  | { kind: 'basin'; basin: Basin; x: number; y: number }
  | { kind: 'country'; iso3: string | null; name: string; enso?: EnsoCountry; x: number; y: number };

export function basinColor(b: Basin | undefined, strongCut: number): string {
  if (!b) return 'var(--neutral-data)';
  const s = Math.abs(b.tws_slope_cm_per_decade ?? 0);
  if (b.trend_class === 'drying') return s >= strongCut ? 'var(--drying-strong)' : 'var(--drying-mild)';
  if (b.trend_class === 'wetting') return s >= strongCut ? 'var(--wetting-strong)' : 'var(--wetting-mild)';
  return 'var(--neutral-data)';
}

export function strongCutOf(trends: Trends | null): number {
  const s = (trends?.basins ?? [])
    .filter((b) => b.trend_class === 'drying' || b.trend_class === 'wetting')
    .map((b) => Math.abs(b.tws_slope_cm_per_decade ?? 0))
    .sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : Infinity;
}

export function WorldMap({ mode, trends, basinsGeo, enso, compact = false }: {
  mode: MapMode; trends: Trends | null; basinsGeo: FeatureCollection | null; enso: Enso | null; compact?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const height = Math.round(width * (compact ? 0.46 : 0.5));
  const [hover, setHover] = useState<Tip | null>(null);
  const [pinned, setPinned] = useState<Tip | null>(null);

  const projection = useMemo(
    () => geoEqualEarth().fitExtent([[4, 4], [width - 4, height - 4]], { type: 'FeatureCollection', features: countries } as any),
    [width, height],
  );
  const path = useMemo(() => geoPath(projection), [projection]);

  const basinById = useMemo(() => new Map((trends?.basins ?? []).map((b) => [String(b.basin_id), b])), [trends]);
  const strongCut = useMemo(() => strongCutOf(trends), [trends]);
  const basinFeatures = useMemo(
    () => (basinsGeo?.features ?? [])
      .filter((f) => f && f.geometry)
      .map((f) => ({ ...f, geometry: rewind(f.geometry) }) as Feature),
    [basinsGeo],
  );
  const ensoByIso = useMemo(() => new Map((enso?.countries ?? []).map((c) => [c.iso3, c])), [enso]);

  function pos(e: React.PointerEvent | React.MouseEvent) {
    const r = (ref.current as HTMLDivElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const tip = pinned ?? hover;

  return (
    <div className="map" ref={ref} onPointerLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img"
        aria-label={mode === 'trend' ? 'World map of hydropower basins coloured by water-storage trend' : 'World map of countries coloured by how their hydropower responds to El Niño and La Niña'}>
        <rect width={width} height={height} fill="var(--map-ocean)" rx={8} />
        <path d={path(geoGraticule10()) ?? ''} fill="none" stroke="var(--map-graticule)" strokeWidth={0.6} />
        <g>
          {countries.map((c) => {
            const ec = c.iso3 ? ensoByIso.get(c.iso3) : undefined;
            const fill = mode === 'enso' ? (ec ? exposureVar(ec.exposure) : 'var(--map-land)') : 'var(--map-land)';
            const interactive = mode === 'enso';
            return (
              <path
                key={String(c.id ?? c.properties.name)}
                d={path(c as any) ?? ''}
                fill={fill}
                stroke={interactive && (ec as any)?.robust === false ? 'var(--map-highlight)' : 'var(--map-land-stroke)'}
                strokeWidth={interactive && (ec as any)?.robust === false ? 1.4 : 0.5}
                strokeDasharray={interactive && (ec as any)?.robust === false ? '3 2' : undefined}
                className={interactive ? 'map-shape' : undefined}
                onPointerMove={interactive ? (e) => setHover({ kind: 'country', iso3: c.iso3, name: ec?.name ?? c.properties.name, enso: ec, ...pos(e) }) : undefined}
                onClick={interactive ? (e) => setPinned({ kind: 'country', iso3: c.iso3, name: ec?.name ?? c.properties.name, enso: ec, ...pos(e) }) : undefined}
              />
            );
          })}
        </g>
        {mode === 'trend' && (
          <g>
            {basinFeatures.map((f, i) => {
              const id = String((f.properties as any)?.basin_id ?? '');
              const b = basinById.get(id);
              return (
                <path
                  key={id || i}
                  d={path(f as any) ?? ''}
                  fill={basinColor(b, strongCut)}
                  fillOpacity={b ? 0.92 : 0.4}
                  stroke="var(--bg)"
                  strokeWidth={0.4}
                  className="map-shape"
                  onPointerMove={b ? (e) => setHover({ kind: 'basin', basin: b, ...pos(e) }) : undefined}
                  onClick={b ? (e) => setPinned({ kind: 'basin', basin: b, ...pos(e) }) : undefined}
                />
              );
            })}
            {/* When no polygons are available, fall back to centroid dots */}
            {basinFeatures.length === 0 && (trends?.basins ?? []).filter((b) => b.centroid).map((b) => {
              const p = projection(b.centroid as [number, number]);
              if (!p) return null;
              return (
                <circle key={b.basin_id} cx={p[0]} cy={p[1]} r={Math.max(3, Math.sqrt(b.hydro_gw ?? 1) * 2)}
                  fill={basinColor(b, strongCut)} className="map-shape"
                  onPointerMove={(e) => setHover({ kind: 'basin', basin: b, ...pos(e) })}
                  onClick={(e) => setPinned({ kind: 'basin', basin: b, ...pos(e) })} />
              );
            })}
          </g>
        )}
      </svg>
      {tip && <MapTip tip={tip} width={width} height={height} pinned={!!pinned} onClose={() => setPinned(null)} period={trends?.period} />}
      <p className="muted map-hint">{compact ? '' : 'Hover or tap a shape for details. Tap again elsewhere to change it.'}</p>
    </div>
  );
}

function MapTip({ tip, width, height, pinned, onClose, period }: {
  tip: Tip; width: number; height: number; pinned: boolean; onClose: () => void; period?: { from: string; to: string };
}) {
  const left = Math.max(4, Math.min(width - 264, tip.x + 14));
  const top = Math.max(4, Math.min(height - 40, tip.y + 14));
  return (
    <div className={`map-tip ${pinned ? 'pinned' : ''}`} style={{ left, top }}>
      {pinned && <button className="tip-close" onClick={onClose} aria-label="Close details">×</button>}
      {tip.kind === 'basin' ? <BasinTip b={tip.basin} period={period} /> : <CountryTip t={tip} />}
    </div>
  );
}

function BasinTip({ b, period }: { b: Basin; period?: { from: string; to: string } }) {
  const cls = b.trend_class === 'drying' ? 'Drying' : b.trend_class === 'wetting' ? 'Wetting' : 'No significant trend';
  return (
    <>
      <div className="tip-title">{b.name || `Basin ${b.basin_id}`}</div>
      <div className="tip-sub">{(b.countries ?? []).join(', ')} · {fmtNum(b.hydro_gw, 1)} GW hydro · {fmtNum(b.n_plants)} plants</div>
      <dl className="tip-dl">
        <dt>Trend</dt><dd>{cls}</dd>
        <dt>Water storage</dt><dd>{isNum(b.tws_slope_cm_per_decade) ? `${fmtNum(b.tws_slope_cm_per_decade, 1)} cm per decade` : '—'} {isNum(b.tws_q) && <span className="muted">(q {b.tws_q < 0.001 ? '< 0.001' : `= ${fmtNum(b.tws_q, 3)}`})</span>}</dd>
        <dt>Rainfall</dt><dd>{fmtPct(b.precip_slope_pct_per_decade, 1, true)} per decade {isNum(b.precip_q) && <span className="muted">(q {b.precip_q < 0.001 ? '< 0.001' : `= ${fmtNum(b.precip_q, 3)}`})</span>}</dd>
      </dl>
      {b.series?.tws_anom_cm?.length ? (
        <>
          <Sparkline values={b.series.tws_anom_cm} color={b.trend_class === 'drying' ? 'var(--drying-mild)' : 'var(--wetting-mild)'} />
          <div className="tip-foot">Water storage anomaly (cm), {periodOf([b.series.months[0], b.series.months[b.series.months.length - 1]])}. GRACE/GRACE-FO.</div>
        </>
      ) : (
        <div className="tip-foot">Water storage trend {period ? periodOf([period.from, period.to]) : ''}. GRACE/GRACE-FO.</div>
      )}
    </>
  );
}

function CountryTip({ t }: { t: Extract<Tip, { kind: 'country' }> }) {
  const e = t.enso;
  const link = t.iso3 ? countryHref(t.iso3, undefined) : null;
  return (
    <>
      <div className="tip-title">{t.name}</div>
      {!e ? (
        <div className="tip-sub">Not in the hydro-dependent set.</div>
      ) : (
        <>
          <div className="tip-sub">{EXPOSURE_LABEL[e.exposure ?? ''] ?? e.exposure}</div>
          {(e as any).robust === false && <div className="tip-flag">Not robust: class changes when 2020+ data are excluded (possible GPCP rainfall break).</div>}
          <dl className="tip-dl">
            <dt>El Niño</dt><dd>{fmtPct(e.el_nino_effect_pct, 0, true)} {isNum(e.el_nino_p) && <span className="muted">(p = {fmtNum(e.el_nino_p, 2)}, n = {e.n_el_nino ?? '—'})</span>}</dd>
            <dt>La Niña</dt><dd>{fmtPct(e.la_nina_effect_pct, 0, true)} {isNum(e.la_nina_p) && <span className="muted">(p = {fmtNum(e.la_nina_p, 2)}, n = {e.n_la_nina ?? '—'})</span>}</dd>
            <dt>Measured on</dt><dd>{(e.variable ?? '').replace(/_/g, ' ')}, {e.record}</dd>
          </dl>
          {(e as any).current_implication && (e.exposure === 'el_nino_loser' || e.exposure === 'both') && <div className="tip-now">{(e as any).current_implication}</div>}
          {e.season_note && <div className="tip-foot">{e.season_note}</div>}
          {link && <a className="tip-link" href={link}>Open country page →</a>}
        </>
      )}
    </>
  );
}
