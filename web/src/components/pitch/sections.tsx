import type { ReactNode } from 'react';
import { Reveal } from '../common';
import { TimeChart, LegendItem } from '../TimeChart';
import { fmtDate, fmtMonth, fmtNum, fmtProb, isNum } from '../../lib/format';
import { RISK_LABEL } from '../../lib/risk';
import { Fn } from './sources';
import { Timeline, TimelineAxis, TimelineLegend } from './Timeline';

/* ---------- loose data shapes (only the fields this page reads) ---------- */
export interface ScoreRow {
  id: string; name: string; official_warning: string | null; onset: string;
  caught_by: string; patronus_alarm: string | null; lead_months: number | null; lead_vs_official_months: number | null;
}
export interface Crisis { id: string; name: string; official_warning: { date: string; what: string } | null; onset: { date: string; what: string } }

export function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Section({ id, eyebrow, title, children, intro }: { id: string; eyebrow: string; title: ReactNode; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="pt-section" id={id} aria-labelledby={`${id}-h`}>
      <div className="pt-wrap">
        <Reveal>
          <p className="pt-eyebrow">{eyebrow}</p>
          <h2 id={`${id}-h`} className="pt-h2">{title}</h2>
          {intro && <p className="pt-intro">{intro}</p>}
        </Reveal>
        {children}
      </div>
    </section>
  );
}

const Loading = ({ what }: { what: string }) => <p className="pt-state">Loading {what}…</p>;
const Missing = ({ what }: { what: string }) => <p className="pt-state">The {what} could not be loaded. Reload the page, or see the full pages in the menu.</p>;

/* ---------- 1. Hero ---------- */
export function Hero({ kariba }: { kariba: ScoreRow | null }) {
  return (
    <section className="pt-hero" aria-labelledby="pt-hero-h">
      <div className="pt-wrap">
        <h1 id="pt-hero-h" className="pt-h1">When drought drains the dams, the lights go out.</h1>
        <p className="pt-lede">Patronus reads NASA water data to warn hydro-dependent countries of power shortfalls months before they hit.</p>
        <div className="pt-actions">
          <button type="button" className="pt-btn" onClick={() => scrollToId('pt-next')}>See the 2027 forecast</button>
          <a className="pt-link" href="#/scoreboard">How we score ourselves</a>
        </div>
        <p className="pt-proof">
          {kariba && kariba.patronus_alarm && isNum(kariba.lead_vs_official_months) ? (
            <>
              <span className="pt-proof-k">Kariba 2024</span>
              Our alarm fired {fmtMonth(kariba.patronus_alarm)}, <strong className="pt-num">{kariba.lead_vs_official_months} months</strong> before the official cut.<Fn k="scoreboard" /><Fn k="zra2023" />
            </>
          ) : (
            <span className="pt-state">Loading the Kariba 2024 result…</span>
          )}
        </p>
      </div>
    </section>
  );
}

/* ---------- 2. We called it ---------- */
const MISS_REASON: Record<string, string> = {
  'brazil-2021': 'Our El Niño layer rates Brazil as neutral, and the country model gave no alarm. It was a La Niña year.',
  'sichuan-2022': 'A record heatwave, not El Niño. Neither model raised an alarm.',
  'ecuador-2023-24': 'No alarm for any of the three waves of cuts. The late-2024 wave came under neutral ENSO conditions.',
};
const HIT_NOTE: Record<string, string> = {
  'kariba-2024': 'Caught by the El Niño reservoir model. Our short-range model fired only in Mar 2024.',
  'vietnam-2023': 'Caught by the country model. Its alarm threshold was tuned on the same data, so treat this catch as optimistic.',
};

export function CalledIt({ rows, crises, summary, loading }: { rows: ScoreRow[] | null; crises: Crisis[] | null; summary?: { n_crises: number; n_caught: number }; loading: boolean }) {
  const byId = new Map((crises ?? []).map((c) => [c.id, c]));
  const caught = summary?.n_caught, total = summary?.n_crises;
  return (
    <Section
      id="pt-called"
      eyebrow="Track record"
      title={isNum(caught) && isNum(total) ? <>We called {caught} of {total}. We missed {total - caught}.</> : 'We called it, and where we did not'}
      intro={<>The same pipeline, run forward on five past crises with only the data that existed at the time.<Fn k="scoreboard" /></>}
    >
      {loading ? <Loading what="the crisis back-test" /> : !rows ? <Missing what="crisis back-test" /> : (
        <Reveal>
          <TimelineLegend />
          <ol className="pt-crises">
            {[...rows].sort((a, b) => order(a) - order(b) || a.onset.localeCompare(b.onset)).map((r) => {
              const c = byId.get(r.id);
              const hit = r.caught_by !== 'missed' && r.patronus_alarm;
              return (
                <li key={r.id} className="pt-crisis">
                  <div className="pt-crisis-head">
                    <h3 className="pt-h3">{r.name}</h3>
                    <p className={hit ? 'pt-verdict pt-hit' : 'pt-verdict pt-miss'}>
                      {hit && isNum(r.lead_vs_official_months)
                        ? <>Caught: <span className="pt-num">{r.lead_vs_official_months} months</span> before the first official warning</>
                        : 'Missed'}
                    </p>
                  </div>
                  <div className="pt-crisis-body">
                    <Timeline
                      name={r.name}
                      row={{ alarm: r.patronus_alarm, warning: r.official_warning, onset: r.onset, warningLabel: 'Official warning', onsetLabel: 'Crisis starts' }}
                    />
                    <TimelineAxis />
                    <p className="pt-crisis-note">
                      {hit ? HIT_NOTE[r.id] : MISS_REASON[r.id]}{' '}
                      <span className="pt-muted">
                        {c?.official_warning ? <>Official warning {fmtDate(c.official_warning.date)}: {lowerFirst(c.official_warning.what)}.</> : 'No official warning on record.'}
                        {' '}Crisis began {fmtDate(r.onset)}.
                      </span>
                      <Fn k="crises" />
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Reveal>
      )}
    </Section>
  );
}
// Kariba (the showpiece) first, then the other catch, then misses by date.
const order = (r: ScoreRow) => (r.id === 'kariba-2024' ? 0 : r.caught_by !== 'missed' ? 1 : 2);
const lowerFirst = (s: string) => s.replace(/\.$/, '');

/* ---------- 3. What it cost ---------- */
const COSTS: { name: string; value: string; detail: ReactNode }[] = [
  { name: 'Ecuador 2024', value: '$1.9B', detail: <>About 1.4% of GDP.<Fn k="bce" /> Blackouts of up to 14 hours a day.<Fn k="rnz" /></> },
  { name: 'Northern Vietnam 2023', value: '$1.4B', detail: <>About 0.3% of GDP in May and June, preliminary estimate.<Fn k="wb" /></> },
  { name: 'Brazil 2021', value: 'R$13.8B', detail: <>Estimated crisis cost.<Fn k="agbr" /> Average power bill up about 6.8%.<Fn k="mme" /></> },
  { name: 'Zambia 2024', value: '4.7% → 1.2%', detail: <>IMF cut to 2024 growth, citing power shortfalls.<Fn k="imf" /> Cuts of up to 21 hours a day, per news reports.<Fn k="crisis24" /></> },
  { name: 'Sichuan 2022', value: 'No estimate', detail: <>Hydro output more than halved and factories in 19 of 21 cities stopped. No official cost estimate found.<Fn k="yicai" /></> },
];

export function Cost() {
  return (
    <Section id="pt-cost" eyebrow="The cost" title="What waiting cost" intro="Each crisis, in the words of the agency that measured it.">
      <Reveal>
        <dl className="pt-costs">
          {COSTS.map((c) => (
            <div key={c.name} className="pt-cost">
              <dt>{c.name}</dt>
              <dd className="pt-cost-v pt-num">{c.value}</dd>
              <dd className="pt-cost-d">{c.detail}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </Section>
  );
}

/* ---------- 4. What is next ---------- */
export interface KaribaLite {
  history_monthly?: { month: string; usable_pct: number | null; gap?: boolean }[];
  forecast?: { issued: string; months: { month: string; usable_p10: number; usable_p50: number; usable_p90: number; p_below_danger: number; p_below_warning: number }[] };
  zra_projection?: { end_2027_usable_pct: number; cut_pct: number; allocation_2026_bcm: number; allocation_2027_bcm: number };
  thresholds?: { warning_usable_pct: number; danger_usable_pct: number };
}
export interface EnsoCpc { issued_date: string; status: string; synopsis: string }
export interface WatchRow { iso3: string; name: string; risk_level: string | null; p_any_shortfall_6m: number | null; max_p_shortfall: number | null; alarm: boolean }

export function Next({ kariba, cpc, watch, loading }: { kariba: KaribaLite | null; cpc: EnsoCpc | null; watch: WatchRow[] | null; loading: boolean }) {
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
        <>
          <Reveal>
            <div className="pt-big">
              <p className="pt-big-v pt-num">{fmtProb(dec.p_below_danger)}<Fn k="kariba" /></p>
              <p className="pt-big-l">chance the lake falls below {danger}% usable storage, our danger line, by December 2027.</p>
            </div>
            <p className="pt-intro">
              Our median is {pct(dec.usable_p50)} usable. The Zambezi River Authority has already cut 2027 generation water by {zra?.cut_pct ?? 36}% and projects {zra?.end_2027_usable_pct ?? 9}% if the full allocation is used.<Fn k="zra2027" />
            </p>
          </Reveal>
          <Reveal>
            <figure className="pt-figure">
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
            </figure>
          </Reveal>
        </>
      )}

      <div className="pt-two">
        <Reveal>
          <h3 className="pt-h3">El Niño</h3>
          {cpc ? (
            <>
              <p className="pt-quote-src">NOAA, {fmtDate(cpc.issued_date)}: <strong>{cpc.status}</strong><Fn k="cpc" /></p>
              <blockquote className="pt-quote">“{cpc.synopsis}”</blockquote>
              <p className="pt-muted pt-small">Zambia and Zimbabwe are among the 11 grids that lose hydropower under El Niño in our analysis.<Fn k="design" /></p>
            </>
          ) : loading ? <Loading what="the El Niño status" /> : <Missing what="El Niño status" />}
        </Reveal>
        <Reveal>
          <h3 className="pt-h3">Top of the watchlist</h3>
          <p className="pt-muted pt-small">Highest monthly chance of a hydro shortfall in the next 6 months. Experimental country model with weak skill.<Fn k="watchlist" /></p>
          {watch ? (
            <table className="pt-table">
              <thead><tr><th scope="col">Grid</th><th scope="col">Level</th><th scope="col" className="pt-r">Peak month</th></tr></thead>
              <tbody>
                {watch.slice(0, 5).map((w) => (
                  <tr key={w.iso3}>
                    <td><a href={`#/country/${w.iso3}`}>{w.name}</a></td>
                    <td>{RISK_LABEL[w.risk_level ?? ''] ?? '—'}</td>
                    <td className="pt-r pt-num">{fmtProb(w.max_p_shortfall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : loading ? <Loading what="the watchlist" /> : <Missing what="watchlist" />}
          <p className="pt-small"><a href="#/watchlist">Full watchlist</a></p>
        </Reveal>
      </div>
    </Section>
  );
}

/* ---------- 5. Proof ---------- */
export interface Skill { h1: { clim: number; pers: number }; h6: { clim: number; pers: number }; h12: { clim: number; pers: number } }
export interface EnsembleScore { hit: number; miss: number; false_alarm: number }
export interface LedgerLite { n: number; loggedAt: string | null; ots: string | null }

export function Proof({ skill, ens, ledger }: { skill: Skill | null; ens: EnsembleScore | null; ledger: LedgerLite | null }) {
  const f = (v: number) => fmtNum(v, 2);
  return (
    <Section id="pt-proof" eyebrow="Proof" title="Check us" intro="Every model has to beat the simple guesses on years it never saw, and every forecast is logged before the outcome.">
      <Reveal>
        <ul className="pt-proofs">
          <li>
            <p className="pt-proofs-k">Beats climatology</p>
            <p>{skill ? <>Kariba lake model, Brier skill <span className="pt-num">{f(skill.h1.clim)}</span> at 1 month, <span className="pt-num">{f(skill.h6.clim)}</span> at 6, <span className="pt-num">{f(skill.h12.clim)}</span> at 12.<Fn k="kariba" /></> : '—'}</p>
          </li>
          <li>
            <p className="pt-proofs-k">Beats persistence</p>
            <p>{skill ? <>Same test against “the lake stays where it is”: <span className="pt-num">{f(skill.h1.pers)}</span>, <span className="pt-num">{f(skill.h6.pers)}</span> and <span className="pt-num">{f(skill.h12.pers)}</span>.<Fn k="kariba" /></> : '—'}</p>
          </li>
          <li>
            <p className="pt-proofs-k">Misses shown</p>
            <p>{ens ? <>El Niño reservoir model since 1995: <span className="pt-num">{ens.hit}</span> hits, <span className="pt-num">{ens.miss}</span> misses, <span className="pt-num">{ens.false_alarm}</span> false alarms in El Niño seasons.<Fn k="scoreboard" /></> : '—'}</p>
          </li>
          <li>
            <p className="pt-proofs-k">Logged before the outcome</p>
            <p>{ledger ? <>{ledger.n} data files hashed with SHA-256{ledger.loggedAt ? <> on {fmtDate(ledger.loggedAt.slice(0, 10))}</> : null} and stamped with OpenTimestamps in the Bitcoin chain.<Fn k="ledger" /></> : '—'}</p>
          </li>
        </ul>
        <p className="pt-small">Brier skill: 1 is perfect, 0 is no better than the baseline. <a href="#/proof">Methods, ledger and limits</a></p>
      </Reveal>
    </Section>
  );
}

/* ---------- 6. Audience + CTA ---------- */
export function Audience() {
  return (
    <Section id="pt-who" eyebrow="Who it is for" title="For the people who pay when the dams run dry">
      <Reveal>
        <ul className="pt-who">
          <li><h3 className="pt-h3">Finance ministries</h3><p>Budget for imports and backup power before the price spikes.</p></li>
          <li><h3 className="pt-h3">Regulators</h3><p>An independent, public warning to set against the utility’s own.</p></li>
          <li><h3 className="pt-h3">Development lenders</h3><p>See which grids are exposed before committing emergency money.</p></li>
        </ul>
        <div className="pt-close">
          <p className="pt-close-t">The warning existed. Patronus makes it public.</p>
          <a className="pt-btn" href="#/kariba">Open the Kariba forecast</a>
        </div>
      </Reveal>
    </Section>
  );
}
