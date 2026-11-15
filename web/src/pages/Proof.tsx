import { Roadmap } from '../components/pitch/Roadmap';
import ScoreboardPage from './Scoreboard';
import ModelHow from '../components/proof/ModelHow';
import { useEffect, useState } from 'react';
import { useRoute } from '../lib/router';
import { useData, loadData } from '../data/load';
import type { Ledger, Meta, Source } from '../data/types';
import { Loading, Empty, SourceNote } from '../components/common';
import { fmtDate } from '../lib/format';

const LIMIT_FILES = ['trends.json', 'enso.json', 'watchlist.json', 'generation_backtest.json', 'kariba.json', 'scoreboard.json', 'crises.json', 'nightlights.json', 'meta.json'];

const FIXED_LIMITS = [
  'Patronus does not forecast El Niño. We use the official outlooks from NOAA CPC / IRI and NASA GEOS-S2S.',
  'GRACE sees water storage at roughly 300 km resolution. Small basins, such as Ecuador\'s Andean basins, are low-confidence.',
  'The GRACE era (2002 onward) holds only about five El Niños and five La Niñas. Fingerprints also use rainfall back to 1981 and lake levels back to 1992.',
  'Monthly generation data mostly starts in 2019, so the record for most countries is short.',
  'The five crises are illustrations. The main test runs on many country-months, including calm years.',
  'The power plant database dates from 2021. Newer dams, such as Coca Codo Sinclair in Ecuador, are missing.',
  'Costs are ranges built on stated assumptions (replacement power price, value of lost load). They are not quotes or official estimates.',
  'Night-light images are for display. Clouds, moonlight and fires affect single nights.',
  'SWOT (2023) and NISAR (2025) are too new to backtest, so they are not part of the claim.',
  'We do not model grid operations, imports, demand or political decisions. A forecast of low water is not a forecast of blackouts by itself.',
];

const RULES = [
  'Every model must beat persistence and climatology on held-out data, or it is not part of the claim.',
  'Each backtest forecast uses only data that existed on that date, including publication delays (GRACE-FO is about 2–3 months behind).',
  'The main test runs on many country-months. The five crises are illustrations, not the whole test.',
  'Misses and false alarms are reported alongside hits.',
  'Ablations only use datasets that span the whole backtest.',
  'El Niño fingerprints use records longer than GRACE where possible.',
];

function useLimitations() {
  const [items, setItems] = useState<{ file: string; text: string; sample: boolean }[] | null>(null);
  useEffect(() => {
    Promise.all(LIMIT_FILES.map((f) => loadData<any>(f).then((r) => ({ f, r })))).then((all) => {
      const out: { file: string; text: string; sample: boolean }[] = [];
      for (const { f, r } of all) {
        const d = r.data;
        if (!d) continue;
        for (const key of ['limitations', 'notes']) {
          const arr = d[key];
          if (!Array.isArray(arr)) continue;
          for (const t of arr) {
            if (typeof t !== 'string' || t.startsWith('ILLUSTRATIVE SAMPLE')) continue;
            out.push({ file: f, text: t, sample: r.source === 'fixture' });
          }
        }
      }
      setItems(out);
    });
  }, []);
  return items;
}

async function sha256Hex(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function VerifyButton({ file, expected }: { file: string; expected?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'match' | 'diff' | 'missing' | 'nocrypto'>('idle');
  async function run() {
    if (!crypto?.subtle) return setState('nocrypto');
    setState('busy');
    try {
      const res = await fetch(`data/${file}`, { cache: 'no-cache' });
      const ct = res.headers.get('content-type') ?? '';
      if (!res.ok || ct.includes('text/html')) return setState('missing');
      const hex = await sha256Hex(await res.arrayBuffer());
      setState(expected && hex === expected.toLowerCase() ? 'match' : 'diff');
    } catch {
      setState('missing');
    }
  }
  const label = { idle: 'Check in browser', busy: 'Checking…', match: 'Matches', diff: 'Does not match the published file', missing: 'File not published here', nocrypto: 'Needs https or localhost' }[state];
  return <button className={`verify verify-${state}`} onClick={run} disabled={state === 'busy'}>{label}</button>;
}

const PROOF_INDEX: [string, string, string][] = [
  ['backtest', 'Back-test', 'Five past crises, replayed with only the data available at the time. Hits, misses and false alarms.'],
  ['ledger', 'Forecast ledger', 'Every forecast hashed and time-stamped before the outcome.'],
  ['limits', 'Limits', 'What Patronus cannot do.'],
  ['sources', 'Method and sources', 'Every dataset, with links.'],
  ['ai', 'Use of AI', 'Our statement on how AI was used.'],
  ['model', 'Advanced: how the model works', 'Data, lags, models, validation design, results and limits.'],
];

export default function ProofPage() {
  const ledger = useData<Ledger>('ledger.json');
  const meta = useData<Meta>('meta.json');
  const limits = useLimitations();
  const sources: Source[] = Array.isArray(meta.data?.sources) ? meta.data!.sources : [];
  const ledgerReal = ledger.source === 'real';
  const openModel = useRoute()[1] === 'model';

  return (
    <>
    <div className="wrap page">
      <header className="proof-hero">
        <div>
          <p className="eyebrow">Proof</p>
          <h1>Check every number.</h1>
          <p className="lede">
            A warning is only useful if people can trust it. We re-ran past crises blind, publish every forecast before the
            outcome is known, fingerprint it, and list what Patronus cannot do.
          </p>
          <p style={{ margin: '20px 0 0' }}><a className="button" href="#/kariba">See the Kariba 2027 forecast</a></p>
        </div>
        <ol className="proof-index" aria-label="On this page">
          {PROOF_INDEX.map(([id, t, d], i) => (
            <li key={id}>
              <a href={`#/proof/${id}`}>
                <span className="pi-n">{String(i + 1).padStart(2, '0')}</span>
                <span className="pi-t">{t}</span>
                <span className="pi-d">{d}</span>
              </a>
            </li>
          ))}
        </ol>
      </header>

      <section id="backtest" className="proof-backtest">
        <p className="eyebrow">02 · Back-test</p>
        <ScoreboardPage embedded />
      </section>

      <h2 className="section-title" id="ledger">The forecast ledger</h2>
      <p>
        Each forecast file is hashed with SHA-256 when it is logged. The hash is committed to the public repository and,
        where possible, stamped with OpenTimestamps. If anyone changes a forecast later, its hash will no longer match.
      </p>
      {ledger.loading ? <Loading /> : (ledger.data?.entries ?? []).length === 0 ? <Empty>No ledger entries yet.</Empty> : (
        <div className="table-wrap">
          <table className="data-table ledger-table">
            <thead><tr><th>File</th><th>SHA-256</th><th>Logged at (UTC)</th><th>Timestamp proof</th><th>Verify</th></tr></thead>
            <tbody>
              {(ledger.data?.entries ?? []).map((e) => (
                <tr key={e.file + e.logged_at}>
                  <td data-label="File"><code>{e.file}</code></td>
                  <td data-label="SHA-256"><code className="hash">{e.sha256 ?? '—'}</code></td>
                  <td data-label="Logged">{e.logged_at ? e.logged_at.replace('T', ' ').replace(/\.\d+/, '').replace('Z', '') : '—'}</td>
                  <td data-label="Proof">{e.ots ? <a href={e.ots}>OpenTimestamps file</a> : <span className="muted">Git commit time</span>}</td>
                  <td data-label="Verify">
                    {e.verify && <code className="cmd">{e.verify}</code>}
                    {ledgerReal && <VerifyButton file={e.file} expected={e.sha256} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="callout">
        <h3>How to verify a forecast yourself</h3>
        <ol>
          <li>Download the forecast file from the public repository or this site (<code>data/&lt;file&gt;</code>).</li>
          <li>Run <code>sha256sum &lt;file&gt;</code> (macOS: <code>shasum -a 256 &lt;file&gt;</code>) and compare with the hash above.</li>
          <li>Check the git history: the commit that added the hash shows when it was logged.</li>
          <li>If there is an <code>.ots</code> file, run <code>ots verify &lt;file&gt;.ots</code> to check its Bitcoin timestamp.</li>
        </ol>
      </div>
      <SourceNote files={['ledger.json']}>Patronus ledger, issued {fmtDate(meta.data?.issue_date)}.</SourceNote>

      <h2 className="section-title" id="limits">What it can't do</h2>
      <div className="grid-2">
        <div className="panel">
          <h3>Known limits</h3>
          <ul className="plain">{FIXED_LIMITS.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div className="panel">
          <h3>Rules we test ourselves against</h3>
          <ul className="plain">{RULES.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>
      <div className="panel">
        <h3>Notes and limits reported by the pipeline</h3>
        {limits === null ? <Loading /> : limits.length === 0 ? <Empty>No notes reported in the data files.</Empty> : (
          <>
            {[...new Set(limits.map((l) => l.file))].map((f) => {
              const items = limits.filter((l) => l.file === f);
              return (
                <details key={f} className="more limits-group">
                  <summary>{f}: {items.length} note{items.length === 1 ? '' : 's'}{items[0]?.sample ? ' (sample)' : ''}</summary>
                  <ul className="plain limits">
                    {items.map((l, i) => <li key={i}>{l.sample && <span className="sample-tag">Sample</span>} {l.text}</li>)}
                  </ul>
                </details>
              );
            })}
          </>
        )}
      </div>

      <h2 className="section-title" id="sources">Method and sources</h2>
      <div className="method">
        <p><b>What we predict.</b> For each hydro-dependent grid, the monthly chance that hydro output (capacity factor) falls 15% or more below normal for that month ("shortfall"), or 30% or more ("severe"). For Lake Kariba, the chance that usable storage falls below 20% (warning) or 10% (danger).</p>
        <p><b>How.</b> A gradient-boosted model (LightGBM) with calibrated probabilities and quantiles, fed by NASA water storage, rain and soil wetness, the El Niño index and recent generation. Months 7–18 come from each grid's El Niño fingerprint combined with the official outlook. Long-term exposure comes from trend tests on 2002–2026 water storage.</p>
        <p><b>How we test it.</b> Blocked leave-one-year-out cross-validation with a 12-month gap, plus a strictly forward test. Baselines: climatology, persistence and ENSO only. Metrics: Brier skill, AUC-PR, reliability, and months of warning at a fixed false-alarm rate.</p>
      </div>
      {(meta.data?.nasa_data_summary ?? []).length > 0 && (
        <div className="callout">
          <h3>NASA data at the core</h3>
          <ul className="plain">
            {(meta.data?.nasa_data_summary ?? []).map((n) => <li key={n.mission}><b>{n.mission}:</b> {n.what}</li>)}
          </ul>
        </div>
      )}
      {meta.loading ? <Loading /> : sources.length === 0 ? <Empty>Source list not available yet.</Empty> : (
        <div className="table-wrap">
          <table className="data-table sources-table">
            <thead><tr><th>Dataset</th><th>Provider</th><th>Coverage</th><th>Licence</th></tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td data-label="Dataset">
                    {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}
                    {s.nasa && <span className="nasa-tag">NASA data</span>}
                    {s.use && <div className="muted small">{s.use}</div>}
                  </td>
                  <td data-label="Provider">{s.provider ?? '—'}</td>
                  <td data-label="Coverage">{s.coverage ?? '—'}</td>
                  <td data-label="Licence">{s.license ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SourceNote files={['meta.json']}>meta.json, generated {fmtDate(meta.data?.generated_at?.slice(0, 10))}.</SourceNote>

      <h2 className="section-title" id="ai">Use of AI</h2>
      <div className="panel">
        <p>
          AI tools were used for research, critique, coding and drafting the briefs; all numbers come from the data pipeline.
          The concept is the team's own. Briefs written by AI are labelled as AI-written and checked against the data files.
          No AI-generated images or video are used on this site.
        </p>
        {meta.data?.ai_disclosure && <p className="muted">{meta.data.ai_disclosure}</p>}
        <p className="muted small">Patronus is a NASA Space Apps 2026 project. It is not affiliated with or endorsed by NASA, and it is unrelated to any company of the same name.</p>
      </div>
      <details className="k-advanced" open={openModel}>
        <summary>Advanced: how the model works (data, lags, models, validation)</summary>
        <ModelHow />
      </details>
    </div>
    <Roadmap />
    </>
  );
}
