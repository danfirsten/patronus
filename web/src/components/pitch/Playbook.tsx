import { useMemo, useState, type ReactNode } from 'react';
import { useData } from '../../data/load';
import { CountUp } from '../../lib/motion';
import { InView } from './InView';
import './playbook.css';

/*
 * "What to do, and when": the remediation playbook (data/playbook.json, built in patronus-playbook/
 * from 21 coded drought crises and 124 cited sources). Every fact shown here is read from the JSON;
 * footnotes point at the case's own citations. Structure: the lead finding (early actors vs late
 * actors), the four lead-time windows with actions ranked by evidence, then "countries like you".
 */

interface Cite { id: string; title: string; publisher?: string; url: string; date?: string }
interface Case {
  id: string; country: string; period: { start: string; end: string | null };
  warning: { first_signal: string | null; lead_months_before_crisis: number | null; src?: string[] };
  outcome: { blackout_or_shedding: string; shedding_hours_per_day_max: number | null; src?: string[] };
  citation_ids: string[];
}
interface Action { id: string; bucket: string; title: string; typical_lead_time: string; evidence_summary: string; evidence_strength: string; evidence_cases: string[]; n_cases: number; n_cases_quantified_effect: number }
interface Bucket { id: string; label: string; why: string }
interface Similar { case_id: string; similarity: number; what_worked: string; what_failed: string }
interface Demo { iso3: string; name: string; warning_lead: string; takeaway: string; similar_cases: Similar[] }
interface PlaybookData { buckets: Bucket[]; actions: Action[]; cases: Case[]; matching: { demos: Demo[] }; limits: string[]; citations: Cite[] }

/* Lead finding. Early: acted months ahead with existing tools, no cuts. Late: waited, cut for hours a day. */
const EARLY = ['BRA-2021', 'COL-2016', 'NOR-2022', 'CHL-2021', 'URY-2023'];
const LATE = ['ECU-2023', 'ZMB-ZWE-2024'];
/* What each early actor did; wording from the case records in playbook.json. */
const EARLY_DID: Record<string, string> = {
  'BRA-2021': 'Dispatched thermal plants from Oct 2020 to save water, then paid consumers to save.',
  'COL-2016': 'Called on thermal backup and ran Apagar Paga, a savings bonus and penalty that cut 1,179 GWh.',
  'NOR-2022': 'Watched reservoir filling from March and set an export-limit backstop.',
  'CHL-2021': 'Decreed a water reserve in three reservoirs and imported gas from Argentina.',
  'URY-2023': 'Wind built after 2008 turned the drought into a cost problem, not a shortage.',
};
const LATE_DID: Record<string, ReactNode> = {
  'ECU-2023': <>The operator warned in Jan 2024; no action until April. Cuts reached 14 hours a day. Cost $1.9B, about 1.4% of GDP (central bank).</>,
  'ZMB-ZWE-2024': <>The water allocation was cut in Dec 2023, but load-shedding still reached up to 21 hours a day, per news reports.</>,
};
const DEMOS = ['ZMB', 'ECU', 'VNM'];
const DEMO_LABEL: Record<string, string> = { ZMB: 'Kariba 2027', ECU: 'Ecuador', VNM: 'Vietnam' };
const STRENGTH: Record<string, string> = { strong: 'Strong', moderate: 'Moderate', weak: 'Weak', unmeasured: 'Unmeasured' };
const BUCKET_SHORT: Record<string, string> = { '6_plus': '6+ months', '3_6': '3–6 months', '1_3': '1–3 months', under_1: 'Under 1 month' };

const shortTitle = (t: string) => t.split(':')[0].trim();
const firstSentence = (t: string) => { const m = t.match(/^(.+?[.!?])(\s|$)/); return m ? m[1] : t; };
/* Year from the case id (COL-2016, URY-2023), as the cases are named in the playbook; Ecuador's cuts ran Oct 2023 to Dec 2024. */
const caseName = (c: Case) => `${c.country.replace(/\s*\(.*\)/, '')} ${c.id === 'ECU-2023' ? '2023–24' : (c.id.match(/(\d{4})$/)?.[1] ?? c.period.start.slice(0, 4))}`;
const caseSrc = (c: Case) => c.outcome.src?.[0] ?? c.citation_ids[0];

export function Playbook() {
  const pb = useData<PlaybookData>('playbook.json');
  const d = pb.data;
  const [demo, setDemo] = useState('ZMB');

  const cases = useMemo(() => new Map((d?.cases ?? []).map((c) => [c.id, c])), [d]);
  const cites = useMemo(() => new Map((d?.citations ?? []).map((c) => [c.id, c])), [d]);

  /* Local footnotes, numbered by first use; a fixed pre-pass keeps numbers stable when the selector changes. */
  const refs = useMemo(() => {
    const order: string[] = [];
    const add = (id?: string) => { if (id && cites.has(id) && !order.includes(id)) order.push(id); };
    [...EARLY, ...LATE].forEach((id) => { const c = cases.get(id); if (c) { add(c.warning.src?.[0]); add(caseSrc(c)); } });
    (d?.actions ?? []).forEach((a) => a.evidence_cases.slice(0, 3).forEach((id) => { const c = cases.get(id); if (c) add(caseSrc(c)); }));
    (d?.matching.demos ?? []).filter((m) => DEMOS.includes(m.iso3)).forEach((m) => m.similar_cases.forEach((s) => { const c = cases.get(s.case_id); if (c) add(caseSrc(c)); }));
    return order;
  }, [d, cases, cites]);
  const R = ({ id }: { id?: string }) => {
    const i = id ? refs.indexOf(id) : -1;
    if (i < 0) return null;
    const c = cites.get(id!)!;
    return (
      <sup className="rm-ref">
        <button type="button" aria-label={`Source ${i + 1}: ${c.title}`} title={c.title}
          onClick={() => document.getElementById(`pb-ref-${i + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{i + 1}</button>
      </sup>
    );
  };

  const head = (
    <InView className="pt-head">
      <p className="eyebrow">What to do, and when</p>
      <h2 id="pt-playbook-h" className="pt-h2">Grids that acted 5–7 months early avoided cuts</h2>
      <p className="pt-intro">What 21 drought crises from 1992 to 2024 show, coded from 124 cited sources. The earlier the warning, the more of the options are still open.</p>
    </InView>
  );

  if (!d) {
    return (
      <section className="pt-section" id="pt-playbook" aria-labelledby="pt-playbook-h">
        <div className="wrap">{head}<p className="pt-state">{pb.loading ? 'Loading the playbook…' : 'The playbook could not be loaded.'}</p></div>
      </section>
    );
  }

  const m = d.matching.demos.find((x) => x.iso3 === demo);

  return (
    <section className="pt-section" id="pt-playbook" aria-labelledby="pt-playbook-h">
      <div className="wrap">
        {head}

        {/* 1. Early vs late */}
        <div className="pb-lead">
          <InView className="pb-lead-col">
            <p className="pb-lead-k">Acted early: no power cuts</p>
            <ul className="pb-cases">
              {EARLY.map((id) => {
                const c = cases.get(id);
                if (!c) return null;
                const lead = c.warning.lead_months_before_crisis;
                return (
                  <li key={id}>
                    <span className="pb-case-n">{caseName(c)}</span>
                    <span className="pb-case-lead pt-num">{lead != null ? `${lead} months ahead` : 'built years before'}<R id={c.warning.src?.[0]} /></span>
                    <span className="pb-case-t">{EARLY_DID[id]}<R id={caseSrc(c)} /></span>
                  </li>
                );
              })}
            </ul>
          </InView>
          <InView className="pb-lead-col pb-late" i={1}>
            <p className="pb-lead-k">Waited: hours of cuts a day</p>
            <ul className="pb-cases">
              {LATE.map((id) => {
                const c = cases.get(id);
                if (!c) return null;
                return (
                  <li key={id}>
                    <span className="pb-case-n">{caseName(c)}</span>
                    <span className="pb-case-lead pb-cut pt-num">up to <CountUp value={c.outcome.shedding_hours_per_day_max ?? 0} /> h a day<R id={caseSrc(c)} /></span>
                    <span className="pb-case-t">{LATE_DID[id]}<R id={c.warning.src?.[0]} /></span>
                  </li>
                );
              })}
            </ul>
          </InView>
        </div>
        <details className="k-advanced"><summary>Notes</summary><p className="pt-honest pb-lead-note">Lead times are estimated from news and agency dates (first public warning sign to the worst month). Uruguay had no dated warning; its protection was the wind it built years earlier.</p></details>

        {/* 2. Four windows */}
        <InView className="pb-sub"><h3 className="pt-h3">What you can still do, by months of warning</h3>
          <p className="pt-muted pt-small">Ranked by evidence within each window. Strong = the effect was measured in at least 3 cases; unmeasured = used, but no case measured an effect. Open a row for the lead time and an example.</p>
        </InView>
        <ol className="pb-windows">
          {d.buckets.map((b, bi) => (
            <InView as="li" key={b.id} i={bi} className="pb-window">
              <p className="pb-w-k">{BUCKET_SHORT[b.id] ?? b.label}</p>
              <p className="pb-w-why">{b.why}</p>
              <ul className="pb-actions">
                {d.actions.filter((a) => a.bucket === b.id).map((a) => {
                  const ex = a.evidence_cases.slice(0, 3).map((id) => cases.get(id)).filter(Boolean) as Case[];
                  return (
                    <li key={a.id}>
                      <details>
                        <summary>
                          <span className="pb-a-t">{shortTitle(a.title)}</span>
                          <span className={`pb-ev pb-ev-${a.evidence_strength}`}>{STRENGTH[a.evidence_strength] ?? a.evidence_strength} <span className="pt-num">({a.n_cases_quantified_effect} of {a.n_cases})</span></span>
                        </summary>
                        <div className="pb-a-body">
                          <p><b>Time to effect.</b> {a.typical_lead_time}</p>
                          <p><b>Example.</b> {firstSentence(a.evidence_summary)}</p>
                          <p className="pt-muted">Cases: {ex.map((c, i) => <span key={c.id}>{i ? ', ' : ''}{caseName(c)}<R id={caseSrc(c)} /></span>)}{a.evidence_cases.length > 3 ? ` and ${a.evidence_cases.length - 3} more` : ''}.</p>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </InView>
          ))}
        </ol>

        {/* 3. Countries like you */}
        <InView className="pb-like">
          <div className="pb-like-head">
            <h3 className="pt-h3">Countries like you</h3>
            <div className="pb-tabs" role="tablist" aria-label="Choose a country">
              {DEMOS.map((iso) => (
                <button key={iso} type="button" role="tab" aria-selected={demo === iso} className={`pb-tab${demo === iso ? ' is-on' : ''}`} onClick={() => setDemo(iso)}>{DEMO_LABEL[iso]}</button>
              ))}
            </div>
          </div>
          {m && (
            <div className="pb-like-body" role="tabpanel" key={m.iso3}>
              <p className="pb-like-meta pt-muted pt-small">{m.name}. Warning window: <b>{BUCKET_SHORT[m.warning_lead]}</b>. Closest past cases by hydro share, storage, El Niño link, imports and warning time.</p>
              <p className="pb-take">{m.takeaway}</p>
              <ol className="pb-sim">
                {m.similar_cases.map((s) => {
                  const c = cases.get(s.case_id);
                  return (
                    <li key={s.case_id}>
                      <p className="pb-sim-n">{c ? caseName(c) : s.case_id} <span className="pb-sim-s pt-num">similarity {Math.round(s.similarity * 100)}%</span></p>
                      <p><b>Worked.</b> {firstSentence(s.what_worked)}{c ? <R id={caseSrc(c)} /> : null}</p>
                      <p className="pt-muted"><b>Failed.</b> {firstSentence(s.what_failed)}</p>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </InView>

        <p className="pb-limit">Case evidence, not proof: rain, prices and other measures changed at the same time, so no single action's effect is isolated. <span className="pt-key">Patronus</span> shows the options and their trade-offs; it does not prescribe. Decisions belong to ministries, regulators and utilities.</p>

        <ol className="rm-refs pb-refs" aria-label="Sources for this section">
          {refs.map((id, i) => {
            const c = cites.get(id)!;
            return <li key={id} id={`pb-ref-${i + 1}`}><a href={c.url} target="_blank" rel="noreferrer">{c.title}{c.publisher ? `, ${c.publisher}` : ''}{c.date ? ` (${c.date})` : ''}</a></li>;
          })}
          <li><a href="data/playbook.json">Patronus remediation playbook: 21 cases, 17 actions, 124 sources (data/playbook.json)</a></li>
        </ol>
      </div>
    </section>
  );
}
