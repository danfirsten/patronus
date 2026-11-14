import { useState } from 'react';
import type { FeatureCollection } from 'geojson';
import { useData } from '../data/load';
import type { Enso, Meta, Trends } from '../data/types';
import { Figure, Loading, Stat } from '../components/common';
import { WorldMap, type MapMode } from '../components/WorldMap';
import { LegendItem } from '../components/TimeChart';
import { fmtNum, periodOf } from '../lib/format';

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
      <p className="eyebrow">Global map</p>
      <h1>Where hydropower is losing its water</h1>
      <p className="lede">
        Two slow threats. Some basins that feed hydropower dams are drying year after year.
        And some grids lose a large share of their hydropower whenever El Niño or La Niña arrives.
      </p>

      <div className="toggle" role="tablist" aria-label="Map layer">
        <button role="tab" aria-selected={mode === 'trend'} className={mode === 'trend' ? 'on' : ''} onClick={() => setMode('trend')}>Drying trend since 2002</button>
        <button role="tab" aria-selected={mode === 'enso'} className={mode === 'enso' ? 'on' : ''} onClick={() => setMode('enso')}>El Niño / La Niña exposure</button>
      </div>

      {mode === 'trend' ? (
        <>
          <div className="stat-row">
            <Stat value={`${fmtNum(ts?.gw_drying)} GW`} label={`hydropower in significantly drying basins (${fmtNum(ts?.n_drying)} basins)`} tone="drying" />
            <Stat value={`${fmtNum(ts?.gw_wetting)} GW`} label={`in significantly wetting basins (${fmtNum(ts?.n_wetting)} basins)`} tone="wetting" />
            <Stat value={`${fmtNum(ts?.gw_total)} GW`} label={`mapped across ${fmtNum(ts?.n_basins)} basins`} />
          </div>
          {ts?.headline && <p className="headline">{ts.headline}</p>}
          {(ts as any)?.headline_caveat && <p className="caveat"><b>Caveat:</b> {(ts as any).headline_caveat}</p>}
          <Figure
            title="Hydropower basins by trend in total water storage"
            sub="Basins that contain hydro plants. Colour shows a statistically significant trend after correcting for testing many basins at once."
            source={<>{trends.data?.sources?.length ? srcName(trends.data.sources) : 'GRACE/GRACE-FO terrestrial water storage (NASA/GFZ GravIS); WRI Global Power Plant Database; HydroBASINS level 4'}. Period {period}.</>}
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
            <Stat value={`${fmtNum(es?.gw_el_nino_losers)} GW`} label={`in ${fmtNum(es?.n_el_nino_losers)} grids that lose under El Niño`} tone="drying" />
            <Stat value={`${fmtNum(es?.gw_la_nina_losers)} GW`} label={`in ${fmtNum(es?.n_la_nina_losers)} grids that lose under La Niña`} tone="wetting" />
            {enso.data?.outlook?.oni_latest && (
              <Stat value={fmtNum(enso.data.outlook.oni_latest.value, 2)} label={`Oceanic Niño Index, ${enso.data.outlook.oni_latest.season ?? ''} (${enso.data.outlook.status ?? ''})`} tone="accent" />
            )}
          </div>
          {es?.headline && <p className="headline">{es.headline}</p>}
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
            </div>
            {enso.loading ? <Loading what="map" /> : <WorldMap mode="enso" trends={trends.data} basinsGeo={basins.data} enso={enso.data} />}
            {enso.data?.method && <details className="more"><summary>Method</summary><div className="muted small">{enso.data.method}</div></details>}
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
    </div>
  );
}
