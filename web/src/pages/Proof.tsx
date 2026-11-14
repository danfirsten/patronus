import { useEffect, useState } from 'react';
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

export default function ProofPage() {
  const ledger = useData<Ledger>('ledger.json');
  const meta = useData<Meta>('meta.json');
  const limits = useLimitations();
  const sources: Source[] = Array.isArray(meta.data?.sources) ? meta.data!.sources : [];
  const ledgerReal = ledger.source === 'real';

  return (
    <div className="wrap page">
      <p className="eyebrow">Check us</p>
      <h1>Proof</h1>
      <p className="lede">
        A warning is only useful if people can trust it. So we publish every forecast before the outcome is known,
        fingerprint it, and list what Patronus cannot do.
      </p>

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
                  <td data-label="Proof">{e.ots ? <a href={`data/${e.ots}`}>OpenTimestamps file</a> : <span className="muted">Git commit time</span>}</td>
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
          <ul className="plain limits">
            {limits.map((l, i) => (
              <li key={i}>{l.sample && <span className="sample-tag">Sample</span>} {l.text} <span className="muted">({l.file})</span></li>
            ))}
          </ul>
        )}
      </div>

      <h2 className="section-title" id="sources">Method and sources</h2>
      <div className="method">
        <p><b>What we predict.</b> For each hydro-dependent grid, the monthly chance that hydro output (capacity factor) falls 15% or more below normal for that month ("shortfall"), or 30% or more ("severe"). For Lake Kariba, the chance that usable storage falls below 20% (warning) or 10% (danger).</p>
        <p><b>How.</b> A gradient-boosted model (LightGBM) with calibrated probabilities and quantiles, fed by NASA water storage, rain and soil wetness, the El Niño index and recent generation. Months 7–18 come from each grid's El Niño fingerprint combined with the official outlook. Long-term exposure comes from trend tests on 2002–2026 water storage.</p>
        <p><b>How we test it.</b> Blocked leave-one-year-out cross-validation with a 12-month gap, plus a strictly forward test. Baselines: climatology, persistence and ENSO only. Metrics: Brier skill, AUC-PR, reliability, and months of warning at a fixed false-alarm rate.</p>
      </div>
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
        <p className="muted small">Patronus is a NASA Space Apps 2026 project. It is not affiliated with or endorsed by NASA, and it is unrelated to any company of the same name.</p>
      </div>
    </div>
  );
}
