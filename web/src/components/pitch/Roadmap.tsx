import { InView } from './InView';
import './roadmap.css';

/*
 * "Where this goes": a hypothetical, sourced projection. Nothing here is built.
 * Columns 1-2 are measured back-tests (future-detector docs/LATENCY.md, regime A vs C, full v2 model,
 * 67 generation units, test 2021-2025, base rate 29%). Column 3 is a PROJECTION: the Brazil back-test
 * (docs/FLOW.md, hydro/flow/out/flow_preds_short.parquet, "hydro + water balance", 5 units with ONS
 * storage and inflow measured daily, base rate 14%) used as the analogue for "storage known everywhere".
 * Precision/catch rate use the fixed rule P >= 0.40, as in LATENCY.md.
 */

type Cell = { v: string; d?: string };
interface Row { k: string; today: Cell; live: Cell; proj: Cell }

const ROWS: Row[] = [
  {
    k: 'Data delay',
    today: { v: '2 months', d: 'Generation (Ember/EIA). GRACE 3 months, weather 1.' },
    live: { v: '~0', d: 'Each month known at its end, as ONS already does for Brazil.' },
    proj: { v: 'Days', d: 'Storage and inflow daily, as ONS publishes. Gravity storage every few days only once MAGIC flies (2030s).' },
  },
  {
    k: 'Where warnings are useful',
    today: { v: '1–3 months', d: 'Brier skill +12% at 1 month, +4% at 3.' },
    live: { v: '1–3 months, sharper', d: 'Brier skill +31% at 1 month, +9% at 3. A 3-month warning is as good as today’s 1-month one.' },
    proj: { v: '1–3 months + a 4–10 month watch', d: 'Storage beats “it stays as it is” by ×1.4–1.8 at 4–10 months, but beats chance by only +1 to +4%.' },
  },
  {
    k: '1 month ahead',
    today: { v: '56% right · 45% caught', d: '×1.55 better ranking than chance' },
    live: { v: '67% right · 65% caught', d: '×2.06' },
    proj: { v: '65% right · 62% caught', d: '×4.6 (base rate 14%)' },
  },
  {
    k: '3 months ahead',
    today: { v: '53% right · 29% caught', d: '×1.35' },
    live: { v: '53% right · 42% caught', d: '×1.48' },
    proj: { v: '31% right · 19% caught', d: '×1.76' },
  },
  {
    k: '6 months ahead',
    today: { v: '49% right · 11% caught', d: '×1.19' },
    live: { v: '48% right · 18% caught', d: '×1.25' },
    proj: { v: '18% right · 5% caught', d: '×1.01: no better than chance' },
  },
];

const HAVE: [string, string][] = [
  ['67 grids, 53 countries', 'Hydropower output for 53 countries, 4 Brazil subsystems and 10 US states, tested on 2021–2025, years the models never saw.'],
  ['×1.55 at 1 month', 'With today’s real publication delays, 56% of 1-month warnings are right against a 29% base rate, and 45% of shortfalls are caught.'],
  ['5 months on Kariba', 'Storage plus the El Niño signal gave a first alarm in Jul 2023, 5 months before the authority cut water and 8 before load-shedding. Across El Niño seasons since 1995: 3 hits, 2 misses, 2 false alarms.'],
  ['×1.21 from measured storage', 'In Brazil, adding operator storage and inflow (ONS) to the same model ranks shortfalls ×1.21 better at 3 months and ×1.20 at 6.'],
  ['9 months vs 3', 'Where operators publish storage (Colombia, Switzerland, Norway), the water-balance model beats persistence out to 9 months, against 3 with satellite inputs.'],
  ['7 open feeds, no key', 'Brazil ONS, Colombia XM, Switzerland BFE, Norway NVE, US USGS/EIA, Finland SYKE and Canada ECCC were all pulled without a login.'],
];

const MISSING: { n: string; k: string; v: string }[] = [
  { n: '1', k: 'Live operator generation', v: 'The biggest single gain. Making only generation live ranks ×1.30 better at 1 month and ×1.10 at 3. Brazil already publishes daily; most grids reach us 2 months late.' },
  { n: '2', k: 'Reservoir storage and inflow per dam', v: '×1.29–1.41 better than satellite inputs at 3–9 months where operators publish it. Today 8 of 67 grids have it. ENTSO-E’s weekly filling data would add about 15 European zones with one free token.' },
  { n: '3', k: 'Faster gravity data (MAGIC)', v: 'Live GRACE alone adds only ×1.02–1.03 when pooled. Its value is a storage map for grids whose operators publish nothing (Ecuador, Sichuan, Vietnam). That is untested: in Brazil, satellite lake levels matched measured storage (×1.10–1.23 at 2–5 months).' },
  { n: '4', k: 'Longer generation records', v: 'Each doubling of record length adds 0.08–0.14 to the ranking ratio, but older monthly records mostly do not exist.' },
  { n: '5', k: 'Seasonal skill per basin', v: 'Global seasonal forecasts add ×1.00: at basin scale their rain forecasts correlate 0.03–0.12 with what fell. Only a few El Niño-tied basins (Ecuador, southern Africa, southeast Brazil) are worth a basin rule.' },
];

const WHY: [string, string][] = [
  ['Speed', 'Live data more than doubles 1-month skill (Brier +12% → +31%). Today’s 1-month warning equals a live 3-month one.'],
  ['What is measured', 'Measured storage in Brazil bought ×1.21 at 3 months, about what 8× longer records would buy.'],
  ['Not more countries', '10× more grids moves 3-month skill only from ×1.52 to ×1.58: the limit is the signal, not the sample.'],
  ['Operators', 'Where storage is published, useful lead over persistence goes from 3 to 9 months. Scaling needs operator data agreements, not more satellites.'],
];

const REFS: { t: string; u: string }[] = [
  { t: 'Patronus Future Detector back-tests, Nov 14, 2026: LATENCY.md (columns 1–2), FLOW.md + hydro/flow/out (column 3), GROUND.md, SCALE.md, LEAD.md, S2S.md. Team repository.', u: '#/proof' },
  { t: 'NASA, GRACE-C mission page (launch planned December 2028)', u: 'https://science.nasa.gov/mission/grace-c/' },
  { t: 'NASA OIG, May 2026: GRACE-C audit, commitment date July 2029, cost and schedule risks', u: 'https://oig.nasa.gov/news/audit-of-nasas-upcoming-twin-satellite-mission-identifies-cost-and-schedule-risks/' },
  { t: 'ESA Living Planet Symposium 2025: NGGM status, launch 2032', u: 'https://lps25.esa.int/lps25-presentations/presentations/2516/_2516.pdf' },
  { t: 'EGU23-14482: MAGIC design goals, down to 3 days and about 100 km', u: 'https://meetingorganizer.copernicus.org/EGU23/EGU23-14482.html' },
  { t: 'NASA JPL GRACE-FO: monthly products 40–60 days after the month', u: 'https://grace.jpl.nasa.gov/' },
  { t: 'NASA GRACE-DA-DM: weekly groundwater and soil moisture, 2–9 day latency', u: 'https://registry.opendata.aws/nasa-grace-da-dm/' },
  { t: 'ONS Brazil open data: daily reservoir storage (EAR) and hydrology, CC-BY 4.0', u: 'https://registry.opendata.aws/ons-opendata-portal/' },
  { t: 'ENTSO-E Transparency Platform: weekly reservoir filling by area (16.1.D)', u: 'https://transparency.entsoe.eu/generation/r2/waterReservoirsAndHydroStoragePlants/show' },
];

/* The app uses hash routing, so in-page jumps scroll instead of changing location.hash. */
const Ref = ({ i }: { i: number }) => (
  <sup className="rm-ref">
    <button type="button" aria-label={`Source ${i}: ${REFS[i - 1]?.t ?? ''}`} title={REFS[i - 1]?.t}
      onClick={() => document.getElementById(`rm-ref-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{i}</button>
  </sup>
);

/** Pitch section 6: what Patronus could do with live data and mapped storage. A projection, clearly marked. */
export function Roadmap() {
  return (
    <section className="pt-section" id="pt-roadmap" aria-labelledby="pt-roadmap-h">
      <div className="wrap">
        <InView className="pt-head">
          <p className="eyebrow">Where this goes</p>
          <h2 id="pt-roadmap-h" className="pt-h2">How far ahead could it warn, with better data?</h2>
          <p className="pt-intro">
            A hypothetical, not something we have built. The first two columns are measured on held-out years. The third is projected from Brazil, where storage and inflow are measured every day, and has not been tested globally.
          </p>
        </InView>

        <InView className="rm-answer">
          <p className="rm-answer-k">Short answer</p>
          <p className="rm-answer-t">
            Not a reliable 6-month warning. Live data makes the 1–3 month warning much sharper. Mapped storage adds a 4–10 month watch, but at 6 months even Brazil’s measured storage ranks no better than chance.<Ref i={1} />
          </p>
        </InView>

        <InView className="rm-table-wrap">
          <table className="pt-table rm-table">
            <caption className="rm-cap">
              “Right” = share of warnings followed by a shortfall (rule: probability 0.40 or more). “Caught” = share of shortfalls warned of. “×” = ranking skill against chance (AUC-PR ratio vs climatology).<Ref i={1} />
            </caption>
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Measure</span></th>
                <th scope="col">Today <span className="rm-tag">measured</span></th>
                <th scope="col">With live data <span className="rm-tag">measured</span></th>
                <th scope="col" className="rm-proj-h">+ storage mapped everywhere <span className="rm-tag rm-tag-proj">projected from Brazil, not tested globally</span></th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.k}>
                  <th scope="row">{r.k}</th>
                  {(['today', 'live', 'proj'] as const).map((c) => (
                    <td key={c} className={c === 'proj' ? 'rm-proj' : undefined} data-col={c === 'today' ? 'Today' : c === 'live' ? 'With live data' : 'Projected'}>
                      <span className="rm-v">{r[c].v}</span>
                      {r[c].d && <span className="rm-d">{r[c].d}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pt-honest">
            Base rates differ: shortfalls happen in 29% of months across all 67 grids and in 14% in Brazil, so compare the “×” figures across columns, not the percentages. The Brazil projection rests on 5 systems and 300 test months. Patronus’s own pre-set test on Brazil’s country score did not adopt ONS storage, so this is a lead worth pursuing, not a result.<Ref i={1} />
          </p>
        </InView>

        <div className="rm-grid">
          <InView className="rm-block">
            <h3 className="pt-h3">What we have now</h3>
            <ul className="rm-list">
              {HAVE.map(([k, v]) => <li key={k}><span className="rm-k">{k}</span><span className="rm-t">{v}</span></li>)}
            </ul>
          </InView>
          <InView className="rm-block" i={1}>
            <h3 className="pt-h3">Missing pieces, by measured impact</h3>
            <ol className="rm-list rm-ranked">
              {MISSING.map((m) => <li key={m.n}><span className="rm-k"><span className="rm-n">{m.n}</span>{m.k}</span><span className="rm-t">{m.v}</span></li>)}
            </ol>
            <p className="pt-small pt-muted rm-magic">
              MAGIC pairs NASA/DLR’s GRACE-C (launch planned Dec 2028, committed by Jul 2029<Ref i={2} /><Ref i={3} />) with ESA’s NGGM (about 2032<Ref i={4} />). Together they aim at storage maps every few days down to 3 days at about 100 km, a design goal, not a product yet.<Ref i={5} /> Today GRACE-FO arrives 40–60 days after each month<Ref i={6} />; NASA’s GRACE-assimilated product is weekly, 2–9 days behind.<Ref i={7} />
            </p>
          </InView>
        </div>

        <InView className="rm-why">
          <h3 className="pt-h3">Why more data moves it</h3>
          <dl className="rm-why-list">
            {WHY.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </InView>

        <ol className="rm-refs" aria-label="Sources for this section">
          {REFS.map((r, i) => (
            <li key={i} id={`rm-ref-${i + 1}`}>
              <a href={r.u} target={r.u.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{r.t}</a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
