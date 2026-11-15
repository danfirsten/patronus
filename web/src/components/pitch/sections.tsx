import type { ReactNode } from 'react';
import { TimeChart, LegendItem } from '../TimeChart';
import { fmtMonth, fmtNum, fmtProb, isNum } from '../../lib/format';
import { CountUp } from '../../lib/motion';
import { RISK_LABEL } from '../../lib/risk';
import { Fn } from './sources';
import { Timeline, TimelineAxis, TimelineLegend } from './Timeline';
import { ElNino, GW, UsableStorage } from './units';
import { InView } from './InView';
import { fmtDate, scrollToId } from './fmt';

export { fmtDate, scrollToId };

/* ---------- loose data shapes (only the fields this page reads) ---------- */
export interface ScoreRow {
  id: string; name: string; official_warning: string | null; onset: string;
  caught_by: string; patronus_alarm: string | null; lead_months: number | null; lead_vs_official_months: number | null;
}
export interface Crisis { id: string; name: string; official_warning: { date: string; what: string } | null; onset: { date: string; what: string } }

/** Section shell: heading block on the left, content filling the rest of the width on desktop. */
function Section({ id, eyebrow, title, children, intro, wide = false }: { id: string; eyebrow: string; title: ReactNode; intro?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`pt-section${wide ? ' pt-section-wide' : ''}`} id={id} aria-labelledby={`${id}-h`}>
      <div className="wrap">
        <InView className="pt-head">
          <p className="eyebrow">{eyebrow}</p>
          <h2 id={`${id}-h`} className="pt-h2">{title}</h2>
          {intro && <p className="pt-intro">{intro}</p>}
        </InView>
        {children}
      </div>
    </section>
  );
}

const Loading = ({ what }: { what: string }) => <p className="pt-state">Loading {what}…</p>;
const Missing = ({ what }: { what: string }) => <p className="pt-state">The {what} could not be loaded. Reload the page, or open the full pages from the menu.</p>;

/* ---------- 1. Hero ----------
 * Structure from 21st.dev "Animated hero" (Tommy Jepsen): one headline, one line, one
 * primary button plus one text link. Its rotating-word animation is not used; the headline
 * rises through the design system's mask (.route-enter h1) and the proof line fades in after.
 */
export function Hero({ kariba }: { kariba: ScoreRow | null }) {
  return (
    <section className="pt-hero" aria-labelledby="pt-hero-h">
      <div className="wrap pt-hero-grid">
        <div>
          <p className="eyebrow">Hydropower early warning</p>
          <h1 id="pt-hero-h" className="pt-h1 pt-h1-story">
            <span>In July 2023, NASA satellites showed Lake Kariba was in trouble.</span>{' '}
            <span>Five months later, the authorities cut its power water.</span>{' '}
            <span>Eight months later, Zambia went dark.</span>
          </h1>
          <p className="lede pt-lede"><span className="pt-key">Patronus</span> reads <span className="pt-key">NASA water data</span> to warn countries that run on hydropower of power shortfalls months before they hit.</p>
          <div className="pt-actions">
            <button type="button" className="button" onClick={() => scrollToId('pt-next')}>See the 2027 forecast</button>
            <a className="pt-link" href="#/proof/backtest">See every past call</a>
          </div>
        </div>
        <div className="pt-proof">
          {kariba && kariba.patronus_alarm && isNum(kariba.lead_vs_official_months) ? (
            <>
              <p className="eyebrow">Kariba 2024</p>
              <p className="pt-proof-n"><CountUp value={`${kariba.lead_vs_official_months} months`} /></p>
              <p className="pt-proof-t">
                Our alarm fired in <strong>{fmtMonth(kariba.patronus_alarm)}</strong>, {kariba.lead_vs_official_months} months before the Zambezi River Authority cut the water for power.<Fn k="scoreboard" /><Fn k="zra2023" />
              </p>
            </>
          ) : (
            <p className="pt-state">Loading the Kariba 2024 result…</p>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- 2. Track record: the hits first ---------- */
const HIT_COPY: Record<string, { title: string; vs: string; second?: (r: ScoreRow) => ReactNode; note: ReactNode }> = {
  'kariba-2024': {
    title: 'Lake Kariba 2024',
    vs: 'before the official water cut',
    second: (r) => (isNum(r.lead_months) ? <><span className="pt-num">{r.lead_months} months</span> before load-shedding began in Zambia</> : null),
    note: <>Raised by our <ElNino /> reservoir model.</>,
  },
  'vietnam-2023': {
    title: 'Northern Vietnam 2023',
    vs: 'before the first official warning',
    note: <>Caught by the country model, ahead of the May–June power cuts in the north.</>,
  },
};

export interface ReservoirSummary { n: number; scored: number; caught: number; forecast: number }

export function CalledIt({ rows, crises, loading, res }: { rows: ScoreRow[] | null; crises: Crisis[] | null; loading: boolean; res?: ReservoirSummary | null }) {
  const byId = new Map((crises ?? []).map((c) => [c.id, c]));
  const hits = (rows ?? []).filter((r) => r.caught_by !== 'missed' && r.patronus_alarm)
    .sort((a, b) => (a.id === 'kariba-2024' ? -1 : b.id === 'kariba-2024' ? 1 : 0));
  const misses = (rows ?? []).filter((r) => !(r.caught_by !== 'missed' && r.patronus_alarm));
  const sichuan = misses.find((r) => r.id === 'sichuan-2022');
  return (
    <Section
      id="pt-called"
      eyebrow="Track record"
      title="Patronus saw it coming"
      intro={<>Run forward on past crises with only the data that existed at the time.<Fn k="scoreboard" /></>}
    >
      {loading ? <Loading what="the crisis back-test" /> : !rows ? <Missing what="crisis back-test" /> : (
        <>
          <ol className="pt-hits">
            {hits.map((r, i) => {
              const copy = HIT_COPY[r.id];
              const c = byId.get(r.id);
              const lead = r.lead_vs_official_months ?? r.lead_months;
              return (
                <InView as="li" key={r.id} i={i} className="pt-hit-card">
                  <h3 className="pt-h3">{copy?.title ?? r.name}</h3>
                  <p className="pt-hit-n"><CountUp value={`${lead} months`} /></p>
                  <p className="pt-hit-vs">{copy?.vs ?? 'before the first official warning'}{copy?.second ? <><br />{copy.second(r)}</> : null}</p>
                  <Timeline
                    name={r.name}
                    row={{ alarm: r.patronus_alarm, warning: r.official_warning, onset: r.onset, warningLabel: 'Official warning', onsetLabel: 'Crisis starts' }}
                  />
                  <TimelineAxis />
                  <p className="pt-hit-note">
                    {copy?.note}{' '}
                    <span className="pt-muted">Alarm {fmtMonth(r.patronus_alarm)}. {c?.official_warning ? <>Official warning {fmtDate(c.official_warning.date)}. </> : null}Crisis began {fmtDate(r.onset)}.</span>
                    <Fn k="crises" />
                  </p>
                </InView>
              );
            })}
          </ol>
          <InView className="pt-legend-row"><TimelineLegend /></InView>
          {res && (
            <InView className="pt-res14">
              <p className="pt-res14-n"><CountUp value={`${res.caught} of ${res.scored}`} /></p>
              <p className="pt-res14-t">
                <b>The same method, applied unchanged to {res.n} reservoirs</b>, flagged {res.caught} of {res.scored} past hydro crises on 4 continents before they began. In {res.forecast} of them the alarm came before the lake had dropped below its warning level; in the other {res.caught - res.forecast} it was already low.<Fn k="reservoirs" />
              </p>
            </InView>
          )}
          {misses.length > 0 && (
            <p className="pt-honest">
              Not every crisis: {sichuan ? 'Sichuan 2022 was a sudden heatwave, and ' : ''}
              {misses.filter((m) => m.id !== 'sichuan-2022').map((m) => m.name).join(' and ')} came without an alarm.{' '}
              <a href="#pt-record" onClick={(e) => { e.preventDefault(); scrollToId('pt-record'); }}>Full record</a>
            </p>
          )}
        </>
      )}
    </Section>
  );
}

/* ---------- 3. What it cost ---------- */
const COSTS: { name: string; value: string; detail: ReactNode }[] = [
  { name: 'Ecuador 2024', value: '$1.9B', detail: <>About 1.4% of GDP.<Fn k="bce" /> Blackouts of up to 14 hours a day.<Fn k="rnz" /></> },
  { name: 'Northern Vietnam 2023', value: '$1.4B', detail: <>About 0.3% of GDP in May and June, preliminary estimate.<Fn k="wb" /></> },
  { name: 'Brazil 2021', value: 'R$13.8B', detail: <>Estimated crisis cost.<Fn k="agbr" /> Average power bill up about 6.8%.<Fn k="mme" /></> },
  { name: 'Zambia 2024', value: 'Growth forecast cut', detail: <>The IMF cut its 2024 growth forecast for Zambia from 4.7% to 1.2%, citing power shortfalls.<Fn k="imf" /> Cuts of up to 21 hours a day, per news reports.<Fn k="crisis24" /></> },
  { name: 'Sichuan 2022', value: 'Hydro halved', detail: <>Hydro output more than halved and factories in 19 of 21 cities stopped. No official cost estimate found.<Fn k="yicai" /></> },
];

export function Cost() {
  return (
    <Section id="pt-cost" eyebrow="The cost" title="What the crises cost" intro="Each crisis, in the words of the agency that measured it.">
      <dl className="pt-costs">
        {COSTS.map((c, i) => (
          <InView key={c.name} i={i} className="pt-cost">
            <dt>{c.name}</dt>
            <dd className="pt-cost-v pt-num"><CountUp value={c.value} /></dd>
            <dd className="pt-cost-d">{c.detail}</dd>
          </InView>
        ))}
      </dl>
    </Section>
  );
}

/* ---------- 4. What is next ---------- */
export interface KaribaLite {
  history_monthly?: { month: string; usable_pct: number | null; gap?: boolean }[];
  forecast?: { issued: string; months: { month: string; usable_p10: number; usable_p50: number; usable_p90: number; p_below_danger: number; p_below_warning: number }[] };
  zra_projection?: { end_2027_usable_pct: number; cut_pct: number; allocation_2026_bcm: number; allocation_2027_bcm: number };
  thresholds?: { warning_usable_pct: number; danger_usable_pct: number; min_operating_m?: number; max_operating_m?: number };
}
export interface EnsoCpc { issued_date: string; status: string; synopsis: string }
export interface WatchRow { iso3: string; name: string; risk_level: string | null; p_any_shortfall_6m: number | null; max_p_shortfall: number | null; alarm: boolean }
export interface Exposure { n: number; gw: number; zmbEffect: number | null }

export function Next({ kariba, cpc, watch, exposure, loading }: { kariba: KaribaLite | null; cpc: EnsoCpc | null; watch: WatchRow[] | null; exposure: Exposure | null; loading: boolean }) {
  const months = kariba?.forecast?.months ?? [];
  const dec = months.find((m) => m.month === '2027-12');
  const danger = kariba?.thresholds?.danger_usable_pct ?? 10;
  const warn = kariba?.thresholds?.warning_usable_pct ?? 20;
  const zra = kariba?.zra_projection;
  const hist = (kariba?.history_monthly ?? []).filter((h) => h.month >= '2024-12' && isNum(h.usable_pct));
  const pct = (v: number) => `${fmtNum(v, 0)}%`;
  return (
    <Section id="pt-next" eyebrow="What is next" title="Lake Kariba, December 2027">
      {loading ? <Loading what="the Kariba forecast" /> : !dec ? <Missing what="Kariba forecast" /> : (
        <div className="pt-next-grid">
          <InView className="pt-big">
            <p className="big-number pt-big-v"><CountUp value={fmtProb(dec.p_below_danger)} /><Fn k="kariba" /></p>
            <p className="pt-big-l">chance the lake falls below {danger}% <UsableStorage min={kariba?.thresholds?.min_operating_m} max={kariba?.thresholds?.max_operating_m} danger={danger} />, our danger line, by December 2027.</p>
            <p className="pt-muted pt-small">
              Our median forecast is {pct(dec.usable_p50)}. The Zambezi River Authority has already cut 2027 generation water by {zra?.cut_pct ?? 36}% and projects {zra?.end_2027_usable_pct ?? 9}% if the full allocation is used.<Fn k="zra2027" />
            </p>
          </InView>
          <InView as="figure" i={1} className="figure pt-figure">
            <TimeChart
              ariaLabel={`Lake Kariba usable storage since December 2024 and forecast to December 2027. Median ${pct(dec.usable_p50)}, 10 to 90 percent range ${pct(dec.usable_p10)} to ${pct(dec.usable_p90)}.`}
              height={300}
              y={{ domain: [0, 80], fmt: pct, label: 'Usable storage (%)' }}
              legend={<>
                <LegendItem color="var(--series-1)" label="Observed (satellite)" />
                <LegendItem color="var(--series-2)" label="Forecast median" />
                <LegendItem kind="box" color="var(--series-band-2)" label="80% range" />
                <LegendItem kind="dot" color="var(--series-3)" label="ZRA projection" />
              </>}
              layers={[
                { kind: 'band', data: months.map((m) => ({ x: m.month, lo: m.usable_p10, hi: m.usable_p90 })), color: 'var(--series-band-2)', label: '80% range', fmt: pct },
                { kind: 'hline', y: warn, color: 'var(--threshold-warning)', label: `${warn}%`, dash: '4 4' },
                { kind: 'hline', y: danger, color: 'var(--threshold-danger)', label: `${danger}%`, dash: '4 4' },
                { kind: 'line', data: hist.map((h) => ({ x: h.month, y: h.usable_pct })), color: 'var(--series-1)', label: 'Observed', fmt: (v) => `${fmtNum(v, 1)}%`, curve: false },
                { kind: 'line', data: months.map((m) => ({ x: m.month, y: m.usable_p50 })), color: 'var(--series-2)', label: 'Median', fmt: (v) => `${fmtNum(v, 1)}%` },
                ...(zra ? [{ kind: 'points' as const, data: [{ x: '2027-12', y: zra.end_2027_usable_pct, label: 'ZRA' }], color: 'var(--series-3)', r: 5, label: 'ZRA projection', fmt: pct }] : []),
              ]}
            />
            <figcaption className="pt-cap">Satellite lake levels (NASA G-REALM) converted to usable storage. Forecast issued {fmtDate(kariba?.forecast?.issued)}.<Fn k="kariba" /></figcaption>
          </InView>
        </div>
      )}

      <div className="pt-two">
        <InView>
          <h3 className="pt-h3"><ElNino zmbEffect={exposure?.zmbEffect} /> is here</h3>
          {cpc ? (
            <>
              <p className="pt-quote-src">NOAA, {fmtDate(cpc.issued_date)}: <strong>{cpc.status}</strong><Fn k="cpc" /></p>
              <blockquote className="pt-quote">“{cpc.synopsis}”</blockquote>
              {exposure && exposure.n > 0 && (
                <p className="pt-muted pt-small">{fmtNum(exposure.n)} grids, holding <GW value={exposure.gw} /> of hydropower, lose output in El Niño years in both our full record and a 1981–2019 check. Zambia and Zimbabwe are two of them.<Fn k="enso" /></p>
              )}
            </>
          ) : loading ? <Loading what="the El Niño status" /> : <Missing what="El Niño status" />}
        </InView>
        <InView i={1}>
          <h3 className="pt-h3">Top of the watchlist</h3>
          <p className="pt-muted pt-small">Highest monthly chance of a hydro shortfall in the next 6 months.<Fn k="watchlist" /></p>
          {watch ? (
            <table className="pt-table">
              <thead><tr><th scope="col">Grid</th><th scope="col">Level</th><th scope="col" className="pt-r">Peak month</th></tr></thead>
              <tbody>
                {watch.slice(0, 5).map((w) => (
                  <tr key={w.iso3}>
                    <td><a href={`#/country/${w.iso3}`}>{w.name}</a></td>
                    <td><span className={`pt-level pt-level-${w.risk_level ?? 'none'}`}>{RISK_LABEL[w.risk_level ?? ''] ?? '—'}</span></td>
                    <td className="pt-r pt-num">{fmtProb(w.max_p_shortfall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : loading ? <Loading what="the watchlist" /> : <Missing what="watchlist" />}
          <p className="pt-small"><a href="#/map/watchlist">Full watchlist</a></p>
        </InView>
      </div>
    </Section>
  );
}

/* ---------- 5. Proof ---------- */
export interface Skill { h1: { clim: number; pers: number }; h6: { clim: number; pers: number }; h12: { clim: number; pers: number } }
export interface EnsembleScore { hit: number; miss: number; false_alarm: number }
export interface LedgerLite { n: number; loggedAt: string | null; ots: string | null }

const MISS_REASON: Record<string, string> = {
  'brazil-2021': 'A La Niña year; neither model raised an alarm.',
  'sichuan-2022': 'A sudden record heatwave, not El Niño. No alarm.',
  'ecuador-2023-24': 'No alarm for any of the three waves of cuts.',
};
const HIT_LIMIT: Record<string, string> = {
  'kariba-2024': 'Caught by the El Niño reservoir model. The short-range model fired only in Mar 2024.',
  'vietnam-2023': 'Caught by the country model; its alarm threshold was set on the same years, so this catch is optimistic.',
};

export function Proof({ skill, ens, ledger, rows }: { skill: Skill | null; ens: EnsembleScore | null; ledger: LedgerLite | null; rows: ScoreRow[] | null }) {
  const f = (v: number) => fmtNum(v, 2);
  const sorted = [...(rows ?? [])].sort((a, b) => a.onset.localeCompare(b.onset));
  return (
    <Section id="pt-proof" eyebrow="Proof" title="Tested on years it never saw" intro="Every model has to beat the simple guesses on held-out years, and every forecast is logged before the outcome.">
      <ul className="pt-proofs">
        <InView as="li">
          <p className="pt-proofs-k">Beats climatology</p>
          <p>{skill ? <>Kariba lake model, Brier skill <span className="pt-num pt-strong">{f(skill.h1.clim)}</span> at 1 month, <span className="pt-num">{f(skill.h6.clim)}</span> at 6, <span className="pt-num">{f(skill.h12.clim)}</span> at 12.<Fn k="kariba" /></> : '—'}</p>
        </InView>
        <InView as="li" i={1}>
          <p className="pt-proofs-k">Beats persistence</p>
          <p>{skill ? <>Same test against “the lake stays where it is”: <span className="pt-num pt-strong">{f(skill.h1.pers)}</span>, <span className="pt-num">{f(skill.h6.pers)}</span> and <span className="pt-num">{f(skill.h12.pers)}</span>.<Fn k="kariba" /></> : '—'}</p>
        </InView>
        <InView as="li" i={2}>
          <p className="pt-proofs-k">Logged before the outcome</p>
          <p>{ledger ? <>{ledger.n} data files hashed with SHA-256{ledger.loggedAt ? <> on {fmtDate(ledger.loggedAt.slice(0, 10))}</> : null} and stamped with OpenTimestamps in the Bitcoin chain.<Fn k="ledger" /></> : '—'}</p>
        </InView>
      </ul>
      <p className="pt-small pt-muted">Brier skill: 1 is perfect, 0 is no better than the baseline. <a href="#/proof">Methods, ledger and limits</a></p>

      <InView className="pt-record" id="pt-record">
        <h3 className="pt-h4">Full record</h3>
        {ens && (
          <p className="pt-small pt-muted">El Niño reservoir model across El Niño seasons since 1995: {ens.hit} hits, {ens.miss} misses, {ens.false_alarm} false alarms.<Fn k="scoreboard" /></p>
        )}
        {rows ? (
          <table className="pt-table pt-record-table">
            <thead><tr><th scope="col">Crisis</th><th scope="col">Result</th><th scope="col">Note</th></tr></thead>
            <tbody>
              {sorted.map((r) => {
                const hit = r.caught_by !== 'missed' && !!r.patronus_alarm;
                const lead = r.lead_vs_official_months ?? r.lead_months;
                return (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className={hit ? 'pt-res-hit' : 'pt-res-miss'}>{hit ? `Caught, ${lead} months early` : 'Missed'}</td>
                    <td className="pt-muted">{hit ? HIT_LIMIT[r.id] : MISS_REASON[r.id]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </InView>
    </Section>
  );
}

/* ---------- 6. Audience + CTA ---------- */
export function Audience() {
  return (
    <Section id="pt-who" eyebrow="Who it is for" title="For the people who pay when the dams run dry">
      <ul className="pt-who">
        <InView as="li"><h3 className="pt-h3">Finance ministries</h3><p>Budget for imports and backup power before the price spikes.</p></InView>
        <InView as="li" i={1}><h3 className="pt-h3">Regulators</h3><p>An independent, public warning to set against the utility’s own.</p></InView>
        <InView as="li" i={2}><h3 className="pt-h3">Development lenders</h3><p>See which grids are exposed before committing emergency money.</p></InView>
      </ul>
      <InView className="pt-close">
        <p className="pt-close-t">The warning existed. <span className="pt-key">Patronus</span> makes it public.</p>
        <a className="button" href="#/kariba">Open the Kariba forecast</a>
      </InView>
    </Section>
  );
}
