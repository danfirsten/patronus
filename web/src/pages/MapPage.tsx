import { useState } from 'react';
import type { FeatureCollection } from 'geojson';
import { useData } from '../data/load';
import type { Enso, Meta, Trends } from '../data/types';
import WatchlistPage from './Watchlist';
import { Figure, Loading, Stat } from '../components/common';
import { WorldMap, type MapMode } from '../components/WorldMap';
import { TrendSplitBlock, trendSplit } from '../components/TrendSplit';
import { LegendItem } from '../components/TimeChart';
import { fmtNum, isNum, periodOf } from '../lib/format';

export default function MapPage() {
  const [mode, setMode] = useState<MapMode>('trend');
  const trends = useData<Trends>('trends.json');
  const basins = useData<FeatureCollection>('basins.geojson');
  const enso = useData<Enso>('enso.json');
  const meta = useData<Meta>('meta.json');
  const srcName = (ids?: string[]) => {
    const list: any[] = Array.isArray(meta.data?.sources) ? meta.data!.sources : [];
    return (ids ?? []).map((id) => list.find((x) => x.id === id)?.name ?? id).join('; ');
  };
  const ts = trends.data?.summary;
  const es = enso.data?.summary;
  const period = trends.data?.period ? periodOf([trends.data.period.from, trends.data.period.to]) : '2002–2026';

  return (
    <div className="wrap page">
      <header className="map-hero">
        <p className="eyebrow">Map · {period}</p>
        <h1>Where hydropower is losing its water</h1>
        <p className="lede">
          Two slow threats and one near one. Some basins that feed hydropower dams are drying year after year.
          Some grids lose a large share of their hydropower whenever El Niño arrives. And some are at risk in the next six months.
        </p>
        <ul className="map-figs" aria-label="On this page">
          <li>
            <button type="button" onClick={() => { setMode('trend'); document.getElementById('map-layers')?.scrollIntoView({ behavior: 'smooth' }); }}>
              <span className="mf-v">{isNum(ts?.gw_drying) ? `${fmtNum(ts!.gw_drying, 0)} GW` : '—'}</span>
              <span className="mf-l">of hydropower in {isNum(ts?.n_drying) ? fmtNum(ts!.n_drying) : '—'} drying basins</span>
              <span className="mf-k">Drying trend</span>
            </button>
          </li>
          <li>
            <button type="button" onClick={() => { setMode('enso'); document.getElementById('map-layers')?.scrollIntoView({ behavior: 'smooth' }); }}>
              <span className="mf-v">{isNum((es as any)?.gw_robust_el_nino_losers) ? `${fmtNum((es as any).gw_robust_el_nino_losers, 0)} GW` : isNum(es?.gw_el_nino_losers) ? `${fmtNum(es!.gw_el_nino_losers, 0)} GW` : '—'}</span>
              <span className="mf-l">in {fmtNum((es as any)?.n_robust_el_nino_losers ?? es?.n_el_nino_losers)} grids that lose under El Niño</span>
              <span className="mf-k">El Niño exposure</span>
            </button>
          </li>
          <li>
            <a href="#/map/watchlist">
              <span className="mf-v">6 months</span>
              <span className="mf-l">country-by-country shortfall watchlist</span>
              <span className="mf-k">Watchlist</span>
            </a>
          </li>
        </ul>
      </header>

      <div id="map-layers" className="toggle" role="tablist" aria-label="Map layer">
        <button role="tab" aria-selected={mode === 'trend'} className={mode === 'trend' ? 'on' : ''} onClick={() => setMode('trend')}>Drying trend since 2002</button>
        <button role="tab" aria-selected={mode === 'enso'} className={mode === 'enso' ? 'on' : ''} onClick={() => setMode('enso')}>El Niño / La Niña exposure</button>
      </div>

      {mode === 'trend' ? (
        <>
          <TrendSplitBlock trends={trends.data} />
          {(ts as any)?.headline_caveat && <p className="caveat"><b>Why the split matters:</b> {(ts as any).headline_caveat}</p>}
          {trendSplit(trends.data).headline !== ts?.headline && ts?.headline && <p className="small muted">{ts.headline}</p>}
          <Figure
            title="Hydropower basins by trend in total water storage"
            sub="Basins that contain hydro plants. Colour shows a statistically significant trend after correcting for testing many basins at once."
            source={<>{trends.data?.sources?.length ? srcName(trends.data.sources) : 'GRACE/GRACE-FO terrestrial water storage (NASA/GFZ GravIS); WRI Global Power Plant Database; HydroBASINS level 4'}. Water storage {period}; rain trend {trendSplit(trends.data).rainPeriod ?? "period as stated in the method"}.</>}
            files={['trends.json', 'basins.geojson']}
          >
            <div className="legend">
              <LegendItem kind="box" color="var(--drying-strong)" label="Drying (stronger)" />
              <LegendItem kind="box" color="var(--drying-mild)" label="Drying" />
              <LegendItem kind="box" color="var(--neutral-data)" label="No significant trend" />
              <LegendItem kind="box" color="var(--wetting-mild)" label="Wetting" />
              <LegendItem kind="box" color="var(--wetting-strong)" label="Wetting (stronger)" />
            </div>
            {trends.loading || basins.loading ? <Loading what="map" /> : <WorldMap mode="trend" trends={trends.data} basinsGeo={basins.data} enso={enso.data} />}
            {trends.data?.method && <details className="more"><summary>Method</summary><div className="muted small">{trends.data.method}</div></details>}
          </Figure>
        </>
      ) : (
        <>
          <div className="stat-row">
            {isNum((es as any)?.gw_robust_el_nino_losers) && <Stat value={`${fmtNum((es as any).gw_robust_el_nino_losers)} GW`} label={`in ${fmtNum((es as any).n_robust_el_nino_losers ?? (es as any).robust_el_nino_losers?.length)} grids that lose under El Niño in both the full record and the 1981–2019 check`} tone="drying" />}
            <Stat value={`${fmtNum(es?.gw_el_nino_losers)} GW`} label={`in ${fmtNum(es?.n_el_nino_losers)} grids that lose under El Niño (full record)`} tone={isNum((es as any)?.gw_robust_el_nino_losers) ? undefined : 'drying'} />
            <Stat value={`${fmtNum(es?.gw_la_nina_losers)} GW`} label={`in ${fmtNum(es?.n_la_nina_losers)} grids that lose under La Niña`} tone="wetting" />
            {enso.data?.outlook?.oni_latest && (
              <Stat value={fmtNum(enso.data.outlook.oni_latest.value, 2)} label={`Oceanic Niño Index, ${enso.data.outlook.oni_latest.season ?? ''} (${enso.data.outlook.status ?? ''})`} tone="accent" />
            )}
          </div>
          {((es as any)?.headline_robust ?? es?.headline) && <p className="headline">{(es as any)?.headline_robust ?? es?.headline}</p>}
          {(es as any)?.headline_robust && es?.headline && <p className="small muted">Full record: {es.headline}</p>}
          <Figure
            title="How each hydro-dependent grid responds to El Niño and La Niña"
            sub="A grid counts as a loser in a phase when output or storage is 5% or more below normal with permutation p < 0.1."
            source={<>{enso.data?.sources?.length ? srcName(enso.data.sources) : 'Ember generation, G-REALM lake levels, basin rainfall, NOAA ONI'}. Records vary by country (shown in the tooltip).</>}
            files={['enso.json']}
          >
            <div className="legend">
              <LegendItem kind="box" color="var(--enso-el-nino)" label="Loses under El Niño" />
              <LegendItem kind="box" color="var(--enso-la-nina)" label="Loses under La Niña" />
              <LegendItem kind="box" color="var(--enso-both)" label="Loses under both" />
              <LegendItem kind="box" color="var(--enso-neutral)" label="No clear effect" />
              <LegendItem kind="box" color="var(--enso-nodata)" label="Not hydro-dependent" />
              {(enso.data?.countries ?? []).some((c: any) => c.robust === false) && <span className="legend-item"><i className="lg-outline" />Dashed outline: class changes when 2020+ data are excluded (possible GPCP rainfall break)</span>}
            </div>
            {enso.loading ? <Loading what="map" /> : <WorldMap mode="enso" trends={trends.data} basinsGeo={basins.data} enso={enso.data} />}
            {enso.data?.method && (
              <details className="more"><summary>Method</summary>
                <div className="muted small">{enso.data.method}</div>
                {(enso.data as any).robustness_1981_2019 && (() => {
                  const r: any = (enso.data as any).robustness_1981_2019;
                  return (
                    <div className="muted small">
                      <p><b>Robustness check, 1981–2019:</b> {r.description}</p>
                      {r.summary_full && r.summary_1981_2019 && <p>El Niño losers: {fmtNum(r.summary_full.gw_el_nino_losers)} GW in {r.summary_full.n_el_nino_losers} grids (full record) vs {fmtNum(r.summary_1981_2019.gw_el_nino_losers)} GW in {r.summary_1981_2019.n_el_nino_losers} grids (1981–2019).</p>}
                      {Array.isArray(r.class_changed) && r.class_changed.length > 0 && <p>Class changes: {r.class_changed.join('; ')}.</p>}
                    </div>
                  );
                })()}
              </details>
            )}
          </Figure>
          {enso.data?.projections?.text && (
            <div className="callout">
              <h3>Why this matters more over time</h3>
              <p>{enso.data.projections.text}</p>
              <ul>
                {(enso.data.projections.refs ?? []).map((r) => (
                  <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <section id="watchlist" className="map-watch">
        <WatchlistPage embedded />
      </section>
    </div>
  );
}
