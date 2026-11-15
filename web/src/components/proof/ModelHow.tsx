/**
 * Proof: "How the model works". Scientific description with a plain-language line next to each
 * technical term. Source of every statement and number: patronus-pitch/ANSWERS.md sections 1-2,
 * DESIGN.md sections 11.3, 12 and 14 (numbers from web/public/data/*.json, Nov 14-15 2026 build).
 */
import './model.css';

const T = ({ t, plain }: { t: string; plain: string }) => (
  <span className="mh-term"><b>{t}</b><span className="mh-plain">{plain}</span></span>
);

const STEPS: { n: string; title: string; body: JSX.Element }[] = [
  {
    n: '1', title: 'Data',
    body: (
      <ul>
        <li><T t="GRACE / GRACE-FO terrestrial water storage" plain="satellites that weigh the water in a region by its pull on gravity" /> monthly, Apr 2002 – Aug 2026 (GFZ GravIS), for 466 hydropower basins (HydroBASINS level 4 that contain a WRI GPPD hydro plant).</li>
        <li><T t="G-REALM satellite altimetry" plain="radar satellites measuring the height of a lake's surface" /> about every 10 days since 1992 for Lake Kariba and 30 other reservoirs.</li>
        <li>GPCP v2.3 rainfall (1981–2025), NASA POWER (MERRA-2) rain, soil wetness and temperature, NOAA ONI for El Niño, Ember monthly generation, ZRA levels and allocations.</li>
      </ul>
    ),
  },
  {
    n: '2', title: 'Features, with publication lags',
    body: (
      <>
        <p>Every input is shifted by the delay with which it is really published, so a back-test forecast only sees what existed on its issue date.</p>
        <table className="data-table mh-table">
          <thead><tr><th>Input</th><th>Lag</th><th>Used as</th></tr></thead>
          <tbody>
            <tr><td>GRACE (GravIS)</td><td>~3 months</td><td>de-seasoned storage anomaly</td></tr>
            <tr><td>NASA POWER monthly</td><td>~2 months</td><td>trailing rain / soil anomalies</td></tr>
            <tr><td>NOAA ONI</td><td>~1 month</td><td>El Niño state; analog-year selection</td></tr>
            <tr><td>Ember generation</td><td>~2 months</td><td>recent capacity-factor anomaly</td></tr>
            <tr><td>G-REALM lake level</td><td>days</td><td>level, percentile for the calendar month</td></tr>
          </tbody>
        </table>
      </>
    ),
  },
  {
    n: '3', title: 'Models',
    body: (
      <dl className="mh-models">
        <dt>Trend test (the Trend Detective answer)</dt>
        <dd>
          <T t="Mann-Kendall with Hamed-Rao correction" plain="across all pairs of months, is the later one usually lower? corrected so a slow wet or dry spell is not mistaken for a trend" />,{' '}
          <T t="Sen's slope" plain="the rate: median of all pairwise slopes, cm per decade" />,{' '}
          <T t="Benjamini-Hochberg FDR, q < 0.05" plain="with 466 basins, ~23 would look significant by luck; FDR keeps false discoveries to 5%" />.
          Seasonal cycle removed first; each basin weighted by the hydro GW inside it.
        </dd>
        <dt>Kariba “now”, 1–12 months</dt>
        <dd><T t="LightGBM on the monthly level change, with an out-of-fold residual ensemble" plain="gradient-boosted trees; the spread of its own past errors (from data it was not trained on) gives the probability range" />. Inputs: lake level, GRACE, POWER rain and soil, ONI. Retrained each year on past data only.</dd>
        <dt>Kariba “next”, 6–18 months</dt>
        <dd>
          <T t="El Niño-conditioned water-balance ensemble" plain="replay the lake forward using inflows from past years with the same El Niño state" />:{' '}
          <code>S[m+1] = S[m] + Q<sub>net</sub>[m] − R[m]</code> (storage next month = storage + net inflow − release). Eleven El Niño seasons give eleven scenarios; a probability is the share ending below the line.
        </dd>
        <dt>Blend for the live forecast</dt>
        <dd><code>w = min(1, h / 6)</code> on “next”, <code>1 − w</code> on “now”, where h is the lead in months: the physics ensemble takes over beyond six months.</dd>
        <dt>Reservoir watch rule (31 lakes)</dt>
        <dd>The Kariba “next” method fixed before any crisis was scored. <T t="Warning < 20th, danger < 10th percentile" plain="lower than in 4 of 5 (or 9 of 10) earlier years for the same calendar month" />; El Niño/La Niña analogs only where that lake shows a significant ENSO response, re-tested each year on past data.</dd>
        <dt>Country model (experimental)</dt>
        <dd>One LightGBM pooled across 23 grids + Sichuan (2,564 country-months): will next month's hydro capacity factor be 15%+ below normal?</dd>
        <dt>Cost of waiting</dt>
        <dd>Same water balance <code>S[m+1] = S[m] + Q<sub>net</sub>[m] − R[m]</code>, run for “act in month m” vs “wait for the danger line”; cost = replacement energy × price + unserved energy × value of lost load. Illustrative only.</dd>
      </dl>
    ),
  },
  {
    n: '4', title: 'Validation design',
    body: (
      <ul>
        <li><T t="Strictly forward, rolling origin" plain="every past forecast is made with a model trained only on earlier years, then scored" /> (Kariba from 2003; reservoirs 2000–2026). Country model: blocked leave-one-year-out with a 12-month gap, plus a forward test for 2024–26.</li>
        <li><T t="Baselines" plain="the dumb forecasts a model has to beat to count" />: climatology (usual rate for that month), persistence (latest anomaly carries on), ENSO-only (ONI by itself).</li>
        <li><T t="Brier skill score" plain="how much better the probabilities are than the baseline's; 0 = no better, 1 = perfect" />, <T t="AUC-PR" plain="how well it ranks the rare bad months above the normal ones" />, reliability, and <T t="bootstrap intervals" plain="re-sample the test months many times to see how much the score could move by chance" />.</li>
        <li>Misses and false alarms are reported with the hits.</li>
      </ul>
    ),
  },
];

export default function ModelHow() {
  return (
    <section id="model" className="model-how" aria-labelledby="mh-h">
      <p className="eyebrow">01 · How the model works</p>
      <h2 id="mh-h" className="mh-title">How the model works</h2>
      <p className="mh-flow">Data → features (with publication lags) → models → validation design → results → limits</p>
      <ol className="mh-steps">
        {STEPS.map((s) => (
          <li key={s.n}><h3><span className="mh-n">{s.n}</span>{s.title}</h3>{s.body}</li>
        ))}
        <li>
          <h3><span className="mh-n">5</span>Results</h3>
          <div className="table-wrap">
            <table className="data-table mh-table">
              <thead><tr><th>Model</th><th>Test</th><th>Result</th></tr></thead>
              <tbody>
                <tr><td>Trend map</td><td>466 basins, MK + FDR</td><td>392 GW in 221 significantly drying basins; 343 GW in 108 wetting. Only 19 GW of the drying total also had significantly less rain.</td></tr>
                <tr><td>El Niño fingerprint</td><td>48 grids, permutation test, 1981–2019 re-check</td><td>54 GW in 9 grids lose under El Niño (chance alone: ~2.4 grids)</td></tr>
                <tr><td>Kariba “now”</td><td>forward vs climatology, persistence, ENSO-only</td><td>Brier skill 0.84 (1 mo), 0.46 (6 mo), 0.03 (12 mo). Missed 2024: first alarm Mar 2024</td></tr>
                <tr><td>Kariba “next”</td><td>El Niño seasons since 1995</td><td>First alarm Jul 2023, 5 months before ZRA's cut. 3 hits, 2 misses, 2 false alarms</td></tr>
                <tr><td>Reservoir watch</td><td>31 lakes, ~6,500 forecasts per horizon</td><td>Brier skill 0.38 / AUC-PR 0.73 at 3 mo (climatology 0.27); 0.15 / 0.58 at 6 mo; −0.02 at 12 mo. 14 of 17 crises flagged before onset (8 while still above warning)</td></tr>
                <tr><td>Country model</td><td>blocked LOYO + forward 2024–26</td><td>Weak: Brier skill 0.03–0.07; caught 1 of 6 crises. Labelled experimental</td></tr>
              </tbody>
            </table>
          </div>
          <p className="small muted">Sources: trends.json, enso.json, kariba.json, reservoirs.json, generation_backtest.json (DESIGN.md §12, §14).</p>
        </li>
        <li>
          <h3><span className="mh-n">6</span>Limits</h3>
          <p>GRACE resolution is ~300 km, so small basins are low-confidence. The GRACE era holds only about five El Niños. GPCP rainfall drifts after 2019 over the Zambezi, so Kariba uses POWER. Skill fades by 12 months. We do not model grid operations, imports or politics: a low-water forecast is not a blackout forecast by itself. <a href="#/proof/limits">Full list below</a>.</p>
        </li>
      </ol>
    </section>
  );
}
