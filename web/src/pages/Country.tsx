import { useEffect, useMemo, useState } from 'react';
import { useData, loadText, hasFixture } from '../data/load';
import type { CountryPage as CP, Countries, Enso, Trends, Watchlist, ForecastMonth } from '../data/types';
import { Figure, Loading, RiskPill, Empty, ExposureTag, MiniMarkdown, SourceNote } from '../components/common';
import { Gauge } from '../components/small';
import { TimeChart, LegendItem, type Layer } from '../components/TimeChart';
import { fmtDate, fmtMonth, fmtMusd, fmtNum, fmtPct, fmtProb, isNum, monthsBetween, periodOf } from '../lib/format';
import { riskOf, riskVar, TIER_LABEL, EXPOSURE_LABEL } from '../lib/risk';

const DRIVER_LABEL: Record<string, [string, (v: number) => string]> = {
  tws_anom_sd: ['Basin water storage (GRACE)', (v) => `${fmtNum(v, 1)} SD vs normal`],
  precip_3m_anom_pct: ['Rain, last 3 months', (v) => `${fmtPct(v, 0, true)} vs normal`],
  soil_root_anom_sd: ['Root-zone soil wetness', (v) => `${fmtNum(v, 1)} SD vs normal`],
  oni: ['Oceanic Niño Index', (v) => fmtNum(v, 2)],
  precip_1m_anom_pct: ['Rain, last month', (v) => `${fmtPct(v, 0, true)} vs normal`],
  precip_6m_anom_pct: ['Rain, last 6 months', (v) => `${fmtPct(v, 0, true)} vs normal`],
  precip_12m_anom_pct: ['Rain, last 12 months', (v) => `${fmtPct(v, 0, true)} vs normal`],
  soil_top_anom_sd: ['Surface soil wetness', (v) => `${fmtNum(v, 1)} SD vs normal`],
  t2m_3m_anom_sd: ['Temperature, last 3 months', (v) => `${fmtNum(v, 1)} SD vs normal`],
  persist_anom_pct: ['Latest hydro output', (v) => `${fmtPct(v, 0, true)} vs normal`],
};

/** Months from issue until the first forecast month with P(shortfall) >= 0.4 (warning level). */
export function monthsToDarkness(issued: string | undefined, months: ForecastMonth[] | undefined, key: 'p_shortfall' = 'p_shortfall'): number | null {
  const first = (months ?? []).find((m) => isNum(m[key]) && (m[key] as number) >= 0.4);
  if (!first) return null;
  const n = monthsBetween(issued?.slice(0, 7), first.month);
  return n === null ? null : Math.max(0, n);
}

const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

/** Country briefs that exist in public/data/briefs. */
const BRIEFS = new Set(['ECU', 'PER', 'VNM']);

export default function CountryPage({ iso3 }: { iso3: string }) {
  const countries = useData<Countries>('countries.json');
  const meta = countries.data?.countries.find((x) => x.iso3 === iso3);
  // Only fetch files that exist: countries without a page file would log 404s.
  const hasFile = !!iso3 && !!countries.data && meta?.has_country_page !== false;
  const file = `country/${iso3}.json`;
  const c = useData<CP>(hasFile ? file : null);
  const enso = useData<Enso>('enso.json');
  const trends = useData<Trends>('trends.json');
  const watch = useData<Watchlist>('watchlist.json');
  const [brief, setBrief] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<number | null>(null);

  useEffect(() => {
    if (BRIEFS.has(iso3)) loadText(`briefs/${iso3}.md`).then(setBrief); else setBrief(null);
  }, [iso3]);

  const d = c.data;
  const name = d?.name ?? meta?.name ?? iso3;
  const ec = enso.data?.countries.find((x) => x.iso3 === iso3);
  const wrow = watch.data?.countries.find((x) => x.iso3 === iso3);
  const myBasins = (trends.data?.basins ?? []).filter((b) => (b.countries ?? []).includes(iso3));
  const fc = d?.forecast?.months ?? wrow?.months ?? [];
  const maxP = Math.max(-1, ...fc.map((m) => m.p_shortfall ?? -1));
  const level = maxP >= 0 ? riskOf(maxP) : null;
  const issued = d?.forecast?.issued ?? watch.data?.issued;
  const mtd = monthsToDarkness(issued, fc);

  const horizons = useMemo(() => [...new Set((d?.backtest ?? []).map((b) => b.horizon))].sort((a, b) => a - b), [d]);
  const h = horizon ?? horizons[0] ?? null;
  const bt = (d?.backtest ?? []).filter((b) => b.horizon === h);
  const hits = bt.filter((b) => (b.p_shortfall ?? 0) >= 0.5);
  const hitRate = hits.length ? hits.filter((b) => b.observed_shortfall).length / hits.length : null;

  if (!iso3) return <div className="wrap page"><Empty>No country chosen. <a href="#/map/watchlist">Pick one from the watchlist.</a></Empty></div>;
  if (countries.loading || (hasFile && c.loading)) return <div className="wrap page"><Loading what={`${iso3} data`} /></div>;
  if (!d) {
    return (
      <div className="wrap page">
        <p className="eyebrow">Country</p>
        <h1>{name}</h1>
        <Empty>
          There is no country file for {iso3} yet{hasFixture(file) ? '' : ' (and no sample either)'}.
          {meta?.tier === 3 && ' This country is tier 3: we only have yearly data, so we show trend and El Niño exposure on the map, not a monthly forecast.'}
          {' '}<a href="#/map/watchlist">Back to the watchlist</a>
        </Empty>
      </div>
    );
  }

  const hist = d.history ?? [];
  const fcDomain: [string, string] | undefined = fc.length ? [`${fc[0].month}-01`, `${nextMonth(fc[fc.length - 1].month)}-01`] : undefined;
  const histPeriod = periodOf([hist[0]?.month, hist[hist.length - 1]?.month]);
  const shortSpans: Layer[] = hist.filter((x) => x.shortfall).map((x) => ({ kind: 'span', from: `${x.month}-01`, to: `${nextMonth(x.month)}-01`, color: 'var(--shortfall-shade)' }));
  const cost = d.costs?.expected_cost_next_6m_musd;
  const gwDry = myBasins.filter((b) => b.trend_class === 'drying').reduce((a, b) => a + (b.hydro_gw ?? 0), 0);
  const gwWet = myBasins.filter((b) => b.trend_class === 'wetting').reduce((a, b) => a + (b.hydro_gw ?? 0), 0);
  const gwAll = myBasins.reduce((a, b) => a + (b.hydro_gw ?? 0), 0);

  return (
    <div className="wrap page">
      <p className="eyebrow"><a href="#/map/watchlist">Watchlist</a> / {iso3}</p>
      <h1>{name}</h1>
      <p className="lede">
        {TIER_LABEL[d.tier ?? meta?.tier ?? 1]}.{' '}
        {isNum(meta?.hydro_share_pct) && <>Hydropower is about {fmtNum(meta?.hydro_share_pct)}% of its electricity. </>}
        Current risk: <RiskPill level={wrow?.risk_level ?? level} />
      </p>
      <p><span className="experimental">Experimental: modest skill, <a href="#/proof/backtest">see Scoreboard</a></span></p>

      <div className="grid-2">
        <div className="panel">
          <Gauge
            months={mtd}
            max={12}
            label="Months to darkness"
            beyond={fc.length ? `${fc.length}+` : 'n/a'}
            sub={mtd === null
              ? `No month in the ${fc.length}-month forecast reaches a 40% chance of a shortfall.`
              : `Months from ${fmtMonth(issued)} until the first month with at least a 40% chance of a shortfall (${fmtMonth(fc.find((m) => (m.p_shortfall ?? 0) >= 0.4)?.month)}).`}
          />
          <SourceNote files={[file]}>Patronus forecast issued {fmtDate(issued)}.</SourceNote>
        </div>
        <div className="panel">
          <h3>Expected cost of shortfalls, next 6 months</h3>
          <p className="big-number">{fmtMusd(cost?.p50)}</p>
          <p className="muted">Range {fmtMusd(cost?.p10)} to {fmtMusd(cost?.p90)} (P10–P90).{cost?.p50 === 0 && isNum(cost?.p90) && cost!.p90! > 0 ? ` The most likely cost is zero, but there is a 1-in-10 chance it exceeds ${fmtMusd(cost?.p90)}.` : ''}</p>
          <p className="small">
            Assumes replacement power at ${fmtNum(d.costs?.replacement_usd_per_kwh, 2)}/kWh and
            unserved energy valued at ${fmtNum(d.costs?.voll_usd_per_kwh, 2)}/kWh. These are editable assumptions, not quotes.
          </p>
          {(d.costs as any)?.method && <details className="more"><summary>How this is estimated</summary><div className="muted small">{(d.costs as any).method}</div></details>}
          <SourceNote files={[file]}>Patronus cost model: expected shortfall × replacement cost + unserved energy × value of lost load.</SourceNote>
        </div>
      </div>

      <Figure
        title="Chance of a hydro shortfall, month by month"
        sub="Top: chance that hydro output falls 15% or more below normal. Bottom: likely range of output vs normal."
        source={<>Patronus forecast issued {fmtDate(issued)}, months {periodOf([fc[0]?.month, fc[fc.length - 1]?.month])}. Inputs: Ember, GRACE/GRACE-FO, GPCP, NASA POWER, NOAA ONI.</>}
        files={[file]}
      >
        {fc.length === 0 ? <Empty>No forecast months in this file.</Empty> : (
          <>
            <TimeChart
              ariaLabel="Monthly chance of a shortfall"
              height={190}
              xDomain={fcDomain}
              y={{ domain: [0, 1], label: 'Chance of a shortfall', fmt: (v) => `${Math.round(v * 100)}%`, ticks: 4 }}
              layers={[
                { kind: 'bars', data: fc.map((m) => ({ x: m.month, y: m.p_shortfall, color: riskVar(riskOf(m.p_shortfall)) })), color: 'var(--risk-warning)', label: 'Chance of shortfall', fmt: (v) => fmtProb(v), widthDays: 16 },
                { kind: 'line', data: fc.map((m) => ({ x: m.month, y: m.p_severe })), color: 'var(--risk-danger)', label: 'Chance of severe shortfall (30%+)', fmt: (v) => fmtProb(v), curve: false },
                { kind: 'hline', y: 0.4, color: 'var(--threshold-warning)', label: '40%: warning level' },
              ]}
              legend={<><LegendItem kind="box" color="var(--risk-watch)" label="Chance of shortfall (coloured by risk level)" /><LegendItem color="var(--risk-danger)" label="Chance of severe shortfall" /></>}
            />
            <TimeChart
              ariaLabel="Forecast hydro output vs normal"
              height={200}
              xDomain={fcDomain}
              y={{ label: 'Output vs normal (%)', fmt: (v) => `${v}%` }}
              legend={<><LegendItem kind="box" color="var(--series-band)" label="Likely range, P10–P90" /><LegendItem color="var(--series-1)" label="Median" /></>}
              layers={[
                { kind: 'band', data: fc.map((m) => ({ x: m.month, lo: m.anomaly_p10_pct, hi: m.anomaly_p90_pct })), color: 'var(--series-band)', label: 'P10–P90', fmt: (v) => fmtPct(v, 0, true) },
                { kind: 'line', data: fc.map((m) => ({ x: m.month, y: m.anomaly_p50_pct })), color: 'var(--series-1)', label: 'Median', fmt: (v) => fmtPct(v, 0, true) },
                { kind: 'hline', y: -15, color: 'var(--threshold-warning)', label: 'Shortfall line (−15%)' },
                { kind: 'hline', y: 0, color: 'var(--border-strong)', dash: '1 0' },
              ]}
            />
          </>
        )}
      </Figure>

      <Figure
        title="History: hydro output vs normal, with past shortfalls and backtest alarms"
        sub="Line: hydro capacity factor vs that month's normal. Shaded months: shortfalls. Dots: what Patronus would have said beforehand, using only data available then."
        source={<>Ember monthly generation, {histPeriod}; backtest: blocked leave-one-year-out cross-validation.</>}
        files={[file]}
        id="history"
      >
        {horizons.length > 1 && (
          <div className="toggle small" role="tablist" aria-label="Backtest horizon">
            {horizons.map((x) => (
              <button key={x} role="tab" aria-selected={x === h} className={x === h ? 'on' : ''} onClick={() => setHorizon(x)}>{x} month{x > 1 ? 's' : ''} ahead</button>
            ))}
          </div>
        )}
        <TimeChart
          ariaLabel="History of hydro output anomaly with shortfalls and backtest probabilities"
          height={280}
          y={{ label: 'Output vs normal (%)', fmt: (v) => `${v}%` }}
          y2={{ domain: [0, 1], label: 'Backtest chance of shortfall', fmt: (v) => `${Math.round(v * 100)}%` }}
          legend={<><LegendItem color="var(--series-1)" label="Output vs normal" /><LegendItem kind="box" color="var(--shortfall-shade)" label="Shortfall month" /><LegendItem kind="dot" color="var(--series-2)" label={`Backtest chance, ${h ?? '–'} month(s) ahead`} /></>}
          layers={[
            ...shortSpans,
            { kind: 'hline', y: -15, color: 'var(--threshold-warning)', label: '−15%' },
            { kind: 'line', data: hist.map((x) => ({ x: x.month, y: x.cf_anom_pct })), color: 'var(--series-1)', label: 'Output vs normal', fmt: (v) => fmtPct(v, 0, true), curve: false, width: 1.6 },
            { kind: 'points', axis: 'right', data: bt.map((b) => ({ x: b.target, y: b.p_shortfall })), color: 'var(--series-2)', r: 2.5, label: 'Backtest chance', fmt: (v) => fmtProb(v) },
          ]}
        />
        {hitRate !== null && (
          <p className="small">When the backtest said 50% or more at {h} month(s) ahead, a shortfall followed {Math.round(hitRate * 100)}% of the time ({hits.length} alarms).</p>
        )}
      </Figure>

      <div className="grid-2">
        <div className="panel">
          <h3>What is driving the risk now</h3>
          <dl className="kv">
            {Object.entries(d.drivers_now ?? {}).filter(([k, v]) => isNum(v) || k in DRIVER_LABEL).map(([k, v]) => {
              const [label, f] = DRIVER_LABEL[k] ?? [k.replace(/_/g, ' '), (x: number) => fmtNum(x, 2)];
              return (<div key={k}><dt>{label}</dt><dd>{isNum(v) ? f(v) : '—'}</dd></div>);
            })}
          </dl>
          {(() => { const dr = (d as any).drivers ?? wrow?.drivers; return Array.isArray(dr) && dr.length ? <ul className="drivers">{dr.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul> : null; })()}
          <SourceNote files={[file, 'watchlist.json']}>GRACE/GRACE-FO, GPCP, NASA POWER, NOAA ONI; latest available month at issue.</SourceNote>
        </div>
        <div className="panel">
          <h3>Look-alike past situations</h3>
          <p className="muted">Past months, in this or other grids, whose water and climate conditions most resemble today's.</p>
          {(d.analogs ?? []).length === 0 ? <Empty>No analogs in this file.</Empty> : (
            <div className="table-wrap"><table className="data-table compact">
              <thead><tr><th>Month</th><th>Grid</th><th>Similarity</th><th>Shortfall in next 6 months?</th></tr></thead>
              <tbody>
                {(d.analogs ?? []).map((a, i) => (
                  <tr key={i}><td>{fmtMonth(a.month)}</td><td>{(a as any).iso3 ?? iso3}</td><td className="num">{fmtNum(a.similarity, 2)}</td><td>{a.shortfall_next_6m === true ? <b className="yes">Yes</b> : a.shortfall_next_6m === false ? 'No' : '—'}</td></tr>
                ))}
              </tbody>
            </table></div>
          )}
          <SourceNote files={[file]}>Nearest neighbours on standardized features, {histPeriod}.</SourceNote>
        </div>
      </div>

      <h2 className="section-title">Three horizons</h2>
      <div className="horizons">
        <div className="horizon">
          <p className="h-when">Now · 0–6 months</p>
          <p className="h-big">{maxP >= 0 ? fmtProb(maxP) : '—'}</p>
          <p>Highest monthly chance of a shortfall. <RiskPill level={wrow?.risk_level ?? level} /></p>
          <p className="muted small">Water already stored and arriving. Action: ration, adjust tariffs, arrange emergency imports.</p>
          <SourceNote files={[file]}>Patronus forecast, {fmtDate(issued)}.</SourceNote>
        </div>
        <div className="horizon">
          <p className="h-when">Next · 6–18 months</p>
          {ec ? (
            <>
              <p className="h-big">{fmtPct(ec.el_nino_effect_pct, 0, true)}</p>
              <p>Typical change under El Niño{isNum(ec.el_nino_p) ? ` (p = ${fmtNum(ec.el_nino_p, 2)})` : ''}. Under La Niña: {fmtPct(ec.la_nina_effect_pct, 0, true)}.</p>
              <p><ExposureTag exposure={ec.exposure} /></p>
              {(ec as any).current_implication && <p className="small">{(ec as any).current_implication}</p>}
              {enso.data?.outlook?.status && <p className="muted small">Outlook: {enso.data.outlook.status}{enso.data.outlook.oni_latest ? `, ONI ${fmtNum(enso.data.outlook.oni_latest.value, 2)} (${enso.data.outlook.oni_latest.season})` : ''}.</p>}
            </>
          ) : <Empty>No El Niño fingerprint for this country yet.</Empty>}
          <SourceNote files={['enso.json']}>ENSO fingerprint, {ec?.record ?? '—'}; outlook {enso.data?.outlook?.source ?? 'NOAA CPC'}.</SourceNote>
        </div>
        <div className="horizon">
          <p className="h-when">Later · decades</p>
          {myBasins.length ? (
            <>
              <p className="h-big">{fmtNum(gwDry, 1)} GW</p>
              <p>of {fmtNum(gwAll, 1)} GW mapped hydro sits in significantly drying basins{gwWet > 0 ? `; ${fmtNum(gwWet, 1)} GW in wetting basins` : ''}.</p>
              <ul className="small">
                {myBasins.slice(0, 4).map((b, i) => (
                  <li key={i}>{b.name || `Basin ${b.basin_id}`}: {b.trend_class === 'no_significant_trend' ? 'no significant trend' : b.trend_class}, {fmtNum(b.tws_slope_cm_per_decade, 1)} cm/decade</li>
                ))}
              </ul>
            </>
          ) : <Empty>No mapped basins for this country.</Empty>}
          <SourceNote files={['trends.json']}>GRACE/GRACE-FO trend, {trends.data?.period ? periodOf([trends.data.period.from, trends.data.period.to]) : '2002–2026'}.</SourceNote>
        </div>
      </div>
      {ec?.exposure && <p className="muted small">{EXPOSURE_LABEL[ec.exposure] ?? ''}{ec.season_note ? `. ${ec.season_note}` : ''}</p>}

      {brief && (
        <div className="panel brief">
          <p className="ai-label">AI-written brief, checked against the data</p>
          <MiniMarkdown text={brief} />
        </div>
      )}
    </div>
  );
}
