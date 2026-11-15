import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import type { PlantRow, GlobePick, ResMarker } from '../../app/globe/plants';
import type { LL } from '../../app/globe/engine';
import { shouldUse2D } from '../../app/globe/detect';
import './globe.css';

const GlobeCanvas = lazy(() => import('./GlobeCanvas'));

const TREND_NAME: Record<string, string> = { d: 'Drying', w: 'Wetting', n: 'No significant trend' };
const TREND_VAR: Record<string, string> = { d: 'var(--drying-mild)', w: 'var(--wetting-mild)', n: 'var(--neutral-data)' };
const TIER_VAR: Record<string, string> = { danger: 'var(--risk-danger)', warning: 'var(--risk-warning)', watch: 'var(--risk-watch)', low: '#E8F1F4' };
const TIER_LEGEND: Record<string, string> = { ...TIER_VAR, low: '#9AA7AD' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const SA: LL = [28.6, -16.2];
const WORLD: LL = [26, -10];

interface Res { id: string; name: string; countries?: string[]; mw?: number; lat: number; lon: number; latest?: { usable_pct?: number | null; percentile_same_month?: number | null; month?: string }; forecast?: { risk_level?: string; p_warning_any_month?: number | null; p_danger_any_month?: number | null } }

type Sel = { kind: 'plant'; p: PlantRow } | { kind: 'reservoir'; r: Res };

/** 2-D fallback: reduced motion, no WebGPU/WebGL 2, low-memory phones, or renderer failure. */
function Plants2D({ plants, res, zoom, onPick }: { plants: PlantRow[]; res: Res[]; zoom: boolean; onPick: (s: Sel) => void }) {
  const W = 960, H = 500;
  const proj = useMemo(() => {
    const p = geoNaturalEarth1();
    return zoom ? p.fitExtent([[10, 10], [W - 10, H - 10]], { type: 'MultiPoint', coordinates: [[20, -8], [36, -24]] } as any) : p.fitExtent([[6, 6], [W - 6, H - 6]], { type: 'Sphere' } as any);
  }, [zoom]);
  const path = geoPath(proj);
  const k = zoom ? 3 : 1;
  return (
    <svg className="plants2d" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Hydropower plants and reservoirs, flat map">
      <path d={path({ type: 'Sphere' } as any) ?? ''} fill="#0B2A3C" />
      <path d={path(geoGraticule10()) ?? ''} fill="none" stroke="rgba(232,241,244,.12)" />
      {plants.map((p, i) => {
        const xy = proj([p[0], p[1]]); if (!xy || xy[0] < 0 || xy[0] > W || xy[1] < 0 || xy[1] > H) return null;
        return <circle key={i} cx={xy[0]} cy={xy[1]} r={Math.max(0.8, Math.sqrt(p[2]) * 0.08 * k)} fill={TREND_VAR[p[6] ?? 'n']} fillOpacity={0.85} onClick={() => onPick({ kind: 'plant', p })} />;
      })}
      {res.map((r) => {
        const xy = proj([r.lon, r.lat]); if (!xy) return null;
        return <circle key={r.id} cx={xy[0]} cy={xy[1]} r={4 * Math.sqrt(k)} fill="none" stroke={TIER_VAR[r.forecast?.risk_level ?? 'low']} strokeWidth={2} onClick={() => onPick({ kind: 'reservoir', r })} style={{ cursor: 'pointer' }} />;
      })}
    </svg>
  );
}

function pct(x?: number | null) { return x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`; }

function Card({ sel, resById, onClose }: { sel: Sel; resById: Map<string, Res>; onClose: () => void }) {
  if (sel.kind === 'plant') {
    const p = sel.p; const r = p[8] ? resById.get(p[8]) : undefined;
    return (
      <div className="g-card" role="dialog" aria-label={p[3]}>
        <button className="g-x" onClick={onClose} aria-label="Close">×</button>
        <p className="g-k">Hydropower plant · {p[4]}</p>
        <h3>{p[3]}</h3>
        <dl>
          <dt>Capacity</dt><dd>{p[2].toLocaleString('en')} MW</dd>
          <dt>Basin water trend</dt><dd><i style={{ background: TREND_VAR[p[6] ?? 'n'] }} />{p[6] ? TREND_NAME[p[6]] : 'Basin not analysed'}{p[7] ? <span className="g-sub">{p[7]}</span> : null}</dd>
          {r && <><dt>Reservoir watch</dt><dd><i style={{ background: TIER_VAR[r.forecast?.risk_level ?? 'low'] }} />{r.name}: {cap(r.forecast?.risk_level ?? '—')}</dd></>}
        </dl>
        <p className="g-src">WRI Global Power Plant Database (2021) · GRACE/GRACE-FO basin trend, Mann-Kendall + FDR</p>
      </div>
    );
  }
  const r = sel.r; const tier = r.forecast?.risk_level ?? 'low';
  return (
    <div className="g-card" role="dialog" aria-label={r.name}>
      <button className="g-x" onClick={onClose} aria-label="Close">×</button>
      <p className="g-k">Reservoir · {(r.countries ?? []).join(' / ')}</p>
      <h3>{r.name}</h3>
      <dl>
        <dt>Watch tier (6-month outlook)</dt><dd><i style={{ background: TIER_LEGEND[tier] }} />{cap(tier)}</dd>
        {r.mw ? <><dt>Hydro behind it</dt><dd>{r.mw.toLocaleString('en')} MW</dd></> : null}
        <dt>Level now</dt><dd>{r.latest?.percentile_same_month != null ? `${ord(r.latest.percentile_same_month)} percentile vs past ${r.latest.month ? new Date(`${r.latest.month}-15`).toLocaleString('en', { month: 'long' }) : 'same-month'} levels` : '—'}{r.latest?.usable_pct != null ? <span className="g-sub">{r.latest.usable_pct}% usable</span> : null}</dd>
        <dt>Chance of warning level, next 6 months</dt><dd>{pct(r.forecast?.p_warning_any_month)}</dd>
      </dl>
      <p className="g-src">G-REALM satellite altimetry (NASA/USDA) · <a href="#/map/watchlist">Reservoir watch</a></p>
    </div>
  );
}

export default function MapGlobe() {
  const [plants, setPlants] = useState<PlantRow[] | null>(null);
  const [res, setRes] = useState<Res[]>([]);
  const [why2d, setWhy2d] = useState<string | null>(() => shouldUse2D());
  const [zoom, setZoom] = useState(false);
  const [fly, setFly] = useState<{ at: LL; dist: number; key: number } | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  useEffect(() => {
    fetch('data/hydro_plants.json').then((r) => r.json()).then((d) => setPlants(d.plants)).catch(() => setPlants([]));
    fetch('data/reservoirs.json').then((r) => r.json()).then((d) => setRes(d.reservoirs ?? [])).catch(() => setRes([]));
  }, []);
  const markers: ResMarker[] = useMemo(() => res.map((r) => ({ id: r.id, name: r.name, at: [r.lon, r.lat] as LL, tier: r.forecast?.risk_level ?? 'low', mw: r.mw ?? 0 })), [res]);
  const resById = useMemo(() => new Map(res.map((r) => [r.id, r])), [res]);
  const totalGw = plants ? plants.reduce((s, p) => s + p[2], 0) / 1000 : 0;
  const go = (z: boolean) => { setZoom(z); setFly({ at: z ? SA : WORLD, dist: z ? 0.32 : 3.6, key: Date.now() }); };
  const pick = (p: GlobePick) => {
    if (!plants) return;
    if (p.kind === 'plant') setSel({ kind: 'plant', p: plants[p.index] });
    else { const r = resById.get(p.id); if (r) setSel({ kind: 'reservoir', r }); }
  };
  const selAt = useMemo(() => !sel ? null : sel.kind === 'plant' ? { at: [sel.p[0], sel.p[1]] as LL, h: 0.0015 + Math.sqrt(sel.p[2]) * 0.0005 } : { at: [sel.r.lon, sel.r.lat] as LL, h: 0 }, [sel]);
  return (
    <section className="g-stage" aria-label="Hydropower globe">
      <div className="g-view">
        {!plants || res.length === 0 ? <div className="globe-wait">Loading plants…</div>
          : why2d ? <Plants2D plants={plants} res={res} zoom={zoom} onPick={setSel} />
          : (
            <Suspense fallback={<div className="globe-wait">Loading globe…</div>}>
              <GlobeCanvas plants={plants} res={markers} fly={fly} sel={selAt} onPick={pick} onFail={setWhy2d} />
            </Suspense>
          )}
        <div className="g-tools">
          <button type="button" className={zoom ? 'on' : ''} onClick={() => go(true)}>Southern Africa</button>
          <button type="button" className={!zoom ? 'on' : ''} onClick={() => go(false)}>World</button>
        </div>
        {sel && <Card sel={sel} resById={resById} onClose={() => setSel(null)} />}
      </div>
      <div className="g-legend">
        <span><b>{plants ? plants.length.toLocaleString('en') : '—'}</b> hydro plants ({totalGw ? `${Math.round(totalGw).toLocaleString('en')} GW` : '—'}), column height by MW, colour by basin water trend since 2002:</span>
        <span className="g-li"><i style={{ background: TREND_VAR.d }} />Drying</span>
        <span className="g-li"><i style={{ background: TREND_VAR.n }} />No significant trend</span>
        <span className="g-li"><i style={{ background: TREND_VAR.w }} />Wetting</span>
        <span className="g-sep">{res.length || 31} reservoirs, ring by watch tier:</span>
        {(['danger', 'warning', 'watch', 'low'] as const).map((t) => <span key={t} className="g-li"><i className="ring" style={{ borderColor: TIER_LEGEND[t] }} />{cap(t)}</span>)}
        {why2d && <span className="g-note">Flat map shown: {why2d}.</span>}
      </div>
      <p className="g-credit">Drag to turn, scroll or pinch to zoom, click a column or ring. Earth imagery: NASA Visible Earth Blue Marble and Black Marble (public domain), via the three.js examples (MIT). Plants: WRI Global Power Plant Database v1.3 (CC BY 4.0, 2021, so newer dams such as Kafue Gorge Lower are missing).</p>
    </section>
  );
}
