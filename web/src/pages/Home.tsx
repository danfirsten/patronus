import type { FeatureCollection } from 'geojson';
import { useData } from '../data/load';
import type { Crises, Enso, Kariba, Ledger, Scoreboard, Trends, Watchlist } from '../data/types';
import { Figure, Reveal, RiskPill, Stat, Loading, ExposureTag } from '../components/common';
import { ProbStrip } from '../components/small';
import { WorldMap } from '../components/WorldMap';
import { TimeChart, LegendItem } from '../components/TimeChart';
import { fmtDate, fmtMonth, fmtNum, fmtProb, isNum, periodOf, dateOf, costText } from '../lib/format';
import { RISK_ORDER, countryHref } from '../lib/risk';

export default function Home() {
  const crises = useData<Crises>('crises.json');
  const score = useData<Scoreboard>('scoreboard.json');
  const trends = useData<Trends>('trends.json');
  const basins = useData<FeatureCollection>('basins.geojson');
  const enso = useData<Enso>('enso.json');
  const watch = useData<Watchlist>('watchlist.json');
  const kariba = useData<Kariba>('kariba.json');
  const ledger = useData<Ledger>('ledger.json');

  const rows = score.data?.rows ?? [];
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const crisisList = crises.data?.crises ?? [];
  const cards = (crisisList.length ? crisisList.map((c) => ({ c, r: rowById.get(c.id) })) : rows.map((r) => ({ c: undefined, r })))
    .map(({ c, r }) => ({
      id: c?.id ?? r!.id,
      name: c?.name ?? r?.name ?? '',
      summary: c?.summary ?? c?.what_happened ?? r?.notes,
      warning: dateOf(c?.official_warning) ?? r?.official_warning ?? null,
      onset: dateOf(c?.onset) ?? r?.onset ?? null,
      cost: c?.costs?.[0] ?? c?.cost_text,
      alarm: r?.patronus_alarm,
      lead: r?.lead_months,
      caught: r?.caught_by,
      hasScore: !!r,
    }));
  const top = [...(watch.data?.countries ?? [])]
    .sort((a, b) => (RISK_ORDER[b.risk_level ?? ''] ?? -1) - (RISK_ORDER[a.risk_level ?? ''] ?? -1) || (b.max_p_shortfall ?? 0) - (a.max_p_shortfall ?? 0))
    .slice(0, 5);

  const kh = (kariba.data?.history ?? []).filter((h) => h.date >= '2019-01');
  const kf = kariba.data?.forecast?.months ?? [];
  const warn = kariba.data?.thresholds?.warning_usable_pct ?? 20;
  const dang = kariba.data?.thresholds?.danger_usable_pct ?? 10;
  const ts = trends.data?.summary;
  const es = enso.data?.summary;

  return (
    <div className="story">
      <section className="hero">
        <div className="wrap">
          <p className="eyebrow">Early warning for hydropower blackouts</p>
          <h1>When the reservoirs drain, the lights go out. The warning was there months before.</h1>
          <p className="lede">
            Drought drains the reservoirs behind hydropower dams. Countries that depend on them pay dearly.
            Ecuador lost an estimated 1–1.5% of GDP in 2024. Vietnam lost about $1.4 billion in 2023.
            The warning signs were in NASA's water data months earlier, but no tool turned them into a decision in time.
          </p>
          <div className="stat-row">
            <Stat value="1–1.5%" label="of GDP lost by Ecuador in 2024 (finance minister)" tone="drying" />
            <Stat value="$1.4B" label="cost of Northern Vietnam's 2023 cuts (World Bank, preliminary)" tone="drying" />
            <Stat value="2.89%" label="Lake Kariba usable storage, 11 Dec 2024 (ZRA)" tone="drying" />
            <Stat value="−36%" label="Kariba's 2027 water allocation, already cut (ZRA)" tone="accent" />
          </div>
          <blockquote className="pull">
            Ecuador's grid operator warned in December 2023 that drought would bring blackouts.
            Ten months later, Ecuadorians were living with 14 hours of darkness a day.
          </blockquote>
          <p className="lede">
            <strong>Patronus</strong> is an independent, public early warning for countries that run on hydropower.
            It reads NASA water data and El Niño / La Niña outlooks, warns when drought will drain the reservoirs,
            from months to decades ahead, and says what waiting will cost.
          </p>
          <div className="hero-steps" aria-label="Story steps">
            {['This keeps happening', "It's getting worse", "It's happening now", 'Zoom in: Kariba', 'Check us'].map((s, i) => (
              <a key={s} href={`#/`} onClick={(e) => { e.preventDefault(); document.getElementById(`step-${i + 1}`)?.scrollIntoView({ behavior: 'smooth' }); }}>
                <span>{i + 1}</span>{s}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* 1 */}
      <section className="step" id="step-1">
        <div className="wrap">
          <Reveal>
            <p className="step-num">1 · This keeps happening</p>
            <h2>Five hydropower crises in four years. Here is when Patronus would have raised the alarm.</h2>
            {score.loading || crises.loading ? <Loading /> : (
              <div className="crisis-grid">
                {cards.map((r) => (
                  <article key={r.id} className="crisis-card">
                    <h3>{r.name}</h3>
                    {r.summary && <p className="muted">{r.summary}</p>}
                    <dl>
                      <dt>First official warning</dt><dd>{r.warning ? fmtDate(r.warning) : 'None found'}</dd>
                      <dt>Crisis began</dt><dd>{fmtDate(r.onset)}</dd>
                      <dt>Patronus alarm</dt>
                      <dd>{!r.hasScore ? '—' : r.caught === 'missed' || !r.alarm ? <span className="miss">Missed</span> : <>{fmtMonth(r.alarm)}{isNum(r.lead) && <> · <b>{r.lead} months</b> ahead</>}</>}</dd>
                      {r.cost && (<><dt>Cost</dt><dd>{costText(r.cost)}</dd></>)}
                    </dl>
                  </article>
                ))}
              </div>
            )}
            <p className="source-inline">Crisis dates: official announcements and news, hand-collected. Alarm months: Patronus backtest using only data available at the time. <a href="#/scoreboard">See the full scoreboard, misses and false alarms →</a></p>
          </Reveal>
        </div>
      </section>

      {/* 2 */}
      <section className="step" id="step-2">
        <div className="wrap">
          <Reveal>
            <p className="step-num">2 · It's getting worse</p>
            <h2>{ts?.headline ?? 'Many hydropower basins are drying.'}</h2>
            <div className="stat-row">
              <Stat value={`${fmtNum(ts?.gw_drying)} GW`} label={`in basins with a significant drying trend (of ${fmtNum(ts?.gw_total)} GW mapped)`} tone="drying" />
              <Stat value={`${fmtNum(ts?.gw_wetting)} GW`} label="in significantly wetting basins" tone="wetting" />
              <Stat value={`${fmtNum(es?.gw_el_nino_losers)} GW`} label="in grids that usually lose output under El Niño" tone="drying" />
            </div>
            <Figure
              title="Hydropower basins by water-storage trend"
              sub="Orange: drying. Blue: wetting. Grey: no significant trend."
              source={<>GRACE/GRACE-FO water storage (NASA/GFZ), {trends.data?.period ? periodOf([trends.data.period.from, trends.data.period.to]) : '2002–2026'}; plants from WRI Global Power Plant Database.</>}
              files={['trends.json', 'basins.geojson']}
            >
              {trends.loading || basins.loading ? <Loading what="map" /> : <WorldMap mode="trend" trends={trends.data} basinsGeo={basins.data} enso={enso.data} compact />}
            </Figure>
            {enso.data?.projections?.text && <p className="lede">{enso.data.projections.text}</p>}
            <p><a href="#/map">Explore the trend and El Niño exposure maps →</a></p>
          </Reveal>
        </div>
      </section>

      {/* 3 */}
      <section className="step" id="step-3">
        <div className="wrap">
          <Reveal>
            <p className="step-num">3 · It's happening now</p>
            <h2>{enso.data?.outlook?.status ? `${enso.data.outlook.status}.` : 'A strong El Niño is under way.'} These grids are most at risk in the next six months.</h2>
            {enso.data?.outlook?.summary && <p className="lede">{enso.data.outlook.summary}</p>}
            {watch.loading ? <Loading /> : (
              <div className="mini-watch">
                {top.map((r) => {
                  const h = countryHref(r.iso3, r.tier);
                  return (
                    <a key={r.iso3} className="mini-watch-row" href={h ?? '#/watchlist'}>
                      <span className="mw-name">{r.name}</span>
                      <RiskPill level={r.risk_level} />
                      <span className="mw-p">{fmtProb(r.max_p_shortfall)} <span className="muted">max chance</span></span>
                      <ProbStrip months={r.months} />
                      <span className="mw-exp"><ExposureTag exposure={r.enso_exposure} /></span>
                    </a>
                  );
                })}
              </div>
            )}
            <p className="source-inline">Monthly chance of a hydro shortfall (output 15% or more below normal). Issued {fmtDate(watch.data?.issued)}. Ember generation, GRACE, NASA POWER, NOAA ONI. <a href="#/watchlist">Full watchlist →</a></p>
          </Reveal>
        </div>
      </section>

      {/* 4 */}
      <section className="step" id="step-4">
        <div className="wrap">
          <Reveal>
            <p className="step-num">4 · Zoom in: Lake Kariba</p>
            <h2>The world's largest man-made reservoir powers Zambia and Zimbabwe. El Niño drained it in 2024. A very strong El Niño is back for 2027.</h2>
            <Figure
              title="Lake Kariba usable storage, with Patronus' forecast to Dec 2027"
              sub={`Below ${warn}% is a warning; below ${dang}% the allocation cannot be met.`}
              source={<>G-REALM satellite lake levels (NASA/USDA) and ZRA gauge, {periodOf([kh[0]?.date, kariba.data?.latest?.date ?? kh[kh.length - 1]?.date])}; forecast issued {fmtDate(kariba.data?.forecast?.issued)}.</>}
              files={['kariba.json']}
            >
              {kariba.loading ? <Loading /> : (
                <TimeChart
                  ariaLabel="Lake Kariba usable storage since 2019 with forecast"
                  height={240}
                  y={{ domain: [0, 100], fmt: (v) => `${v}%`, label: 'Usable storage (%)' }}
                  legend={<><LegendItem color="var(--series-1)" label="Observed" /><LegendItem color="var(--series-2)" label="Forecast (median)" /><LegendItem color="var(--series-band-2)" kind="box" label="P10–P90" /></>}
                  layers={[
                    { kind: 'band', data: kf.map((m) => ({ x: m.month, lo: m.usable_p10, hi: m.usable_p90 })), color: 'var(--series-band-2)', label: 'Forecast P10–P90', fmt: (v) => `${Math.round(v)}%` },
                    { kind: 'hline', y: warn, color: 'var(--threshold-warning)', label: `${warn}% warning` },
                    { kind: 'hline', y: dang, color: 'var(--threshold-danger)', label: `${dang}% danger` },
                    { kind: 'line', data: kh.map((h) => ({ x: h.date, y: h.usable_pct })), color: 'var(--series-1)', label: 'Observed', fmt: (v) => `${Math.round(v)}%` },
                    { kind: 'line', data: kf.map((m) => ({ x: m.month, y: m.usable_p50 })), color: 'var(--series-2)', dash: '6 4', label: 'Forecast median', fmt: (v) => `${Math.round(v)}%` },
                  ]}
                />
              )}
            </Figure>
            <p><a className="button" href="#/kariba">Open the Kariba case →</a></p>
          </Reveal>
        </div>
      </section>

      {/* 5 */}
      <section className="step" id="step-5">
        <div className="wrap">
          <Reveal>
            <p className="step-num">5 · Check us</p>
            <h2>Every forecast is hashed and time-stamped before the outcome is known.</h2>
            <p className="lede">
              We publish the forecast files, their SHA-256 fingerprints and the time we logged them.
              Anyone can check later whether Patronus was right, and whether we changed anything after the fact.
            </p>
            {(ledger.data?.entries ?? []).slice(0, 3).map((e) => (
              <div key={e.file} className="ledger-mini">
                <code>{e.file}</code>
                <code className="hash">{e.sha256 ? `${e.sha256.slice(0, 16)}…` : '—'}</code>
                <span className="muted">{e.logged_at ? `logged ${fmtDate(e.logged_at.slice(0, 10))}` : ''}</span>
              </div>
            ))}
            <p className="pitch">The warning existed. Patronus makes ignoring it expensive and public.</p>
            <p><a className="button" href="#/proof">See the proof, methods and limits →</a></p>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
