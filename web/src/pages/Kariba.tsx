import { useEffect, useState } from 'react';
import { useData, loadText } from '../data/load';
import type { Kariba, Nightlights, NightFrame, SkillRow } from '../data/types';
import { Figure, Loading, Stat, Empty, SourceNote, MiniMarkdown } from '../components/common';
import { Gauge } from '../components/small';
import { TimeChart, LegendItem } from '../components/TimeChart';
import { fmtDate, fmtMonth, fmtMusd, fmtNum, fmtProb, isNum, monthsBetween, periodOf } from '../lib/format';

const LOWEST_2024 = { date: '2024-12-11', usable_pct: 2.89, level_m: 475.91 }; // DESIGN.md 11.7 (ZRA)

export default function KaribaPage() {
  const k = useData<Kariba>('kariba.json');
  const nl = useData<Nightlights>('nightlights.json');
  const [brief, setBrief] = useState<string | null>(null);
  useEffect(() => { loadText('briefs/kariba.md').then(setBrief); }, []);

  if (k.loading) return <div className="wrap page"><Loading what="Kariba data" /></div>;
  const d = k.data;
  if (!d) return <div className="wrap page"><Empty>Kariba data is not available.</Empty></div>;

  const warn = d.thresholds?.warning_usable_pct ?? 20;
  const dang = d.thresholds?.danger_usable_pct ?? 10;
  const hist = d.history ?? [];
  const fc = d.forecast?.months ?? [];
  const c24 = d.backtest?.crisis_2024;
  const zra = d.zra_projection;
  const issued = d.forecast?.issued;
  const firstDanger = fc.find((m) => isNum(m.p_below_danger) && (m.p_below_danger as number) >= 0.4);
  const mtd = firstDanger ? Math.max(0, monthsBetween(issued?.slice(0, 7), firstDanger.month) ?? 0) : null;
  const histPeriod = periodOf([hist[0]?.date, hist[hist.length - 1]?.date]);
  const recent = hist.filter((h) => h.date >= '2025-06');
  const crisisWin = hist.filter((h) => h.date >= '2023-01' && h.date <= '2025-03');
  const cw = d.cost_of_waiting;
  const pct = (v: number) => `${Math.round(v)}%`;

  return (
    <div className="wrap page">
      <p className="eyebrow">Zoom in · Zambia and Zimbabwe</p>
      <h1>Lake Kariba: 2024 replay and 2027 forecast</h1>
      <p className="lede">
        Kariba is the largest man-made reservoir in the world. Its two power stations supply much of the electricity in Zambia and Zimbabwe.
        In 2024 an El Niño drought drained it to 2.89% usable storage. Zambia cut power for 8, then 12 hours a day.
        A very strong El Niño is back for 2027, and the Zambezi River Authority (ZRA) has already cut the 2027 power allocation by {zra?.cut_pct ?? 36}%.
      </p>

      <div className="stat-row">
        <Stat value={`${fmtNum(d.latest?.usable_pct, 1)}%`} label={`usable storage, ${fmtDate(d.latest?.date)} (satellite)`} tone="accent" />
        {d.latest?.zra_gauge && <Stat value={`${fmtNum(d.latest.zra_gauge.usable_pct, 1)}%`} label={`ZRA gauge, ${fmtDate(d.latest.zra_gauge.date)}`} />}
        <Stat value={`−${zra?.cut_pct ?? 36}%`} label={`2027 allocation cut to ${fmtNum(zra?.allocation_2027_bcm)} BCM (ZRA)`} tone="drying" />
        <Stat value={`${fmtNum(zra?.end_2027_usable_pct)}%`} label="ZRA's own projection for end-2027 if the full allocation is used" tone="drying" />
      </div>

      <div className="grid-2">
        <div className="panel">
          <Gauge months={mtd} max={12} label="Months to darkness" beyond={fc.length ? `${fc.length}+` : 'n/a'}
            sub={mtd === null
              ? `No forecast month reaches a 40% chance of falling below ${dang}% usable.`
              : `Months from ${fmtMonth(issued)} until the first month with at least a 40% chance of falling below ${dang}% usable storage (${fmtMonth(firstDanger?.month)}), when the allocation can no longer be met.`} />
          <SourceNote files={['kariba.json']}>Patronus Kariba forecast issued {fmtDate(issued)}.</SourceNote>
        </div>
        <div className="panel">
          <h3>Why Kariba</h3>
          <ul className="plain">
            <li>NASA measures it: G-REALM satellite altimetry since 1992, about every 10 days.</li>
            <li>It spans about 34 years and roughly 10 El Niño events.</li>
            <li>Operating range {fmtNum(d.thresholds?.min_operating_m, 2)} m to {fmtNum(d.thresholds?.max_operating_m, 2)} m. Below {warn}% usable is a warning. Below {dang}%, generation is curtailed.</li>
          </ul>
        </div>
      </div>

      <Figure
        title="Usable storage since 1992"
        sub={`Lake level converted to % of usable storage. Dashed lines: ${warn}% warning and ${dang}% danger.`}
        source={<>G-REALM satellite lake levels (NASA/USDA), {histPeriod}; storage curve: {d.storage_curve?.method ?? '—'}</>}
        files={['kariba.json']}
      >
        <TimeChart
          ariaLabel="Lake Kariba usable storage history"
          height={280}
          y={{ domain: [0, 100], fmt: pct, label: 'Usable storage (%)' }}
          layers={[
            { kind: 'hline', y: warn, color: 'var(--threshold-warning)', label: `${warn}% warning` },
            { kind: 'hline', y: dang, color: 'var(--threshold-danger)', label: `${dang}% danger` },
            { kind: 'line', data: hist.map((h) => ({ x: h.date, y: h.usable_pct })), color: 'var(--series-1)', width: 1.5, label: 'Usable storage', fmt: (v) => `${fmtNum(v, 1)}%`, curve: false },
          ]}
        />
      </Figure>

      <h2 className="section-title">The 2024 crisis, and when Patronus would have warned</h2>
      <Figure
        title="2023–2025: the lake falls, the officials act, the alarm fires"
        sub="Vertical lines mark the Patronus alarms (strictly forward backtest) and the official decisions."
        source={<>G-REALM lake levels (NASA/USDA), Jan 2023 – Mar 2025; ZRA and news for official dates. Backtest: {d.backtest?.design ?? '—'}</>}
        files={['kariba.json']}
      >
        <TimeChart
          ariaLabel="Lake Kariba 2023 to 2025 with alarm and decision dates"
          height={300}
          xDomain={['2023-01-01', '2025-03-01']}
          y={{ domain: [0, 40], fmt: pct, label: 'Usable storage (%)' }}
          layers={[
            { kind: 'hline', y: warn, color: 'var(--threshold-warning)', label: `${warn}%` },
            { kind: 'hline', y: dang, color: 'var(--threshold-danger)', label: `${dang}%` },
            { kind: 'line', data: crisisWin.map((h) => ({ x: h.date, y: h.usable_pct })), color: 'var(--series-1)', label: 'Usable storage', fmt: (v) => `${fmtNum(v, 1)}%`, curve: false },
            ...(c24?.first_warning_p_gt_0_5 ? [{ kind: 'vline' as const, x: c24.first_warning_p_gt_0_5, color: 'var(--series-2)', label: 'Patronus: warning', row: 0 }] : []),
            ...(c24?.first_danger_p_gt_0_5 ? [{ kind: 'vline' as const, x: c24.first_danger_p_gt_0_5, color: 'var(--series-3)', label: 'Patronus: danger', row: 1 }] : []),
            { kind: 'vline', x: c24?.zra_allocation_cut ?? '2023-12-28', color: 'var(--text-muted)', label: 'ZRA cuts allocation', row: 2 },
            { kind: 'vline', x: c24?.load_shedding_start ?? '2024-03-11', color: 'var(--threshold-danger)', label: 'Load-shedding starts', row: 3 },
            { kind: 'points', data: [{ x: LOWEST_2024.date, y: LOWEST_2024.usable_pct, label: '2.89% (11 Dec 2024)' }], color: 'var(--threshold-danger)', r: 5 },
          ]}
        />
      </Figure>
      <ol className="timeline">
        <li className="tl-p"><span className="tl-date">{fmtMonth(c24?.first_warning_p_gt_0_5)}</span><span>Patronus: chance of falling below {warn}% passes 50%.</span></li>
        <li className="tl-p"><span className="tl-date">{fmtMonth(c24?.first_danger_p_gt_0_5)}</span><span>Patronus: chance of falling below {dang}% passes 50%.</span></li>
        <li><span className="tl-date">{fmtDate(c24?.zra_allocation_cut ?? '2023-12-28')}</span><span>ZRA cuts the 2024 allocation to 16 BCM.</span></li>
        <li><span className="tl-date">{fmtDate(c24?.load_shedding_start ?? '2024-03-11')}</span><span>Zambia starts 8 hours a day of load-shedding; 12 hours from 20 May.</span></li>
        <li><span className="tl-date">~14 Sep 2024</span><span>Kariba North power station stops.</span></li>
        <li><span className="tl-date">11 Dec 2024</span><span>Lake at 475.91 m: 2.89% usable, the lowest point.</span></li>
      </ol>
      <p className="headline">
        Patronus lead time: <b>{isNum(c24?.lead_months_vs_load_shedding) ? `${c24!.lead_months_vs_load_shedding} months` : '—'}</b> before load-shedding,
        and <b>{isNum(c24?.lead_months_vs_zra) ? `${c24!.lead_months_vs_zra} months` : '—'}</b> before the ZRA allocation cut.
      </p>

      <h2 className="section-title">2027: the forecast</h2>
      <Figure
        title={`Forecast usable storage, ${fmtMonth(fc[0]?.month)} – ${fmtMonth(fc[fc.length - 1]?.month)}, against ZRA's projection`}
        sub="Shaded fan: 80% of outcomes (P10–P90). Line: median. Diamond: ZRA's projection for end-2027 if the full allocation is used."
        source={<>Patronus forecast issued {fmtDate(issued)} (G-REALM, GRACE/GRACE-FO, NASA POWER, NOAA ONI); ZRA projection{zra?.source_url ? <> (<a href={zra.source_url} target="_blank" rel="noreferrer">source</a>)</> : ''}.</>}
        files={['kariba.json']}
      >
        <TimeChart
          ariaLabel="Kariba forecast fan chart with ZRA projection"
          height={300}
          y={{ domain: [0, 60], fmt: pct, label: 'Usable storage (%)' }}
          legend={<><LegendItem color="var(--series-1)" label="Observed" /><LegendItem color="var(--series-2)" label="Median forecast" /><LegendItem kind="box" color="var(--series-band-2)" label="P10–P90" /><LegendItem kind="dot" color="var(--series-3)" label="ZRA projection" /></>}
          layers={[
            { kind: 'band', data: fc.map((m) => ({ x: m.month, lo: m.usable_p10, hi: m.usable_p90 })), color: 'var(--series-band-2)', label: 'P10–P90', fmt: pct },
            { kind: 'hline', y: warn, color: 'var(--threshold-warning)', label: `${warn}% warning` },
            { kind: 'hline', y: dang, color: 'var(--threshold-danger)', label: `${dang}% danger` },
            { kind: 'line', data: recent.map((h) => ({ x: h.date, y: h.usable_pct })), color: 'var(--series-1)', label: 'Observed', fmt: (v) => `${fmtNum(v, 1)}%` },
            { kind: 'line', data: fc.map((m) => ({ x: m.month, y: m.usable_p50 })), color: 'var(--series-2)', label: 'Median', fmt: pct },
            ...(isNum(zra?.end_2027_usable_pct) ? [{ kind: 'points' as const, data: [{ x: '2027-12', y: zra!.end_2027_usable_pct, label: `ZRA ${zra!.end_2027_usable_pct}%` }], color: 'var(--series-3)', r: 6, label: 'ZRA projection', fmt: pct }] : []),
          ]}
        />
        <div className="prob-table-wrap">
          <table className="data-table compact prob-table">
            <thead><tr><th>Month</th>{fc.map((m) => <th key={m.month}>{fmtMonth(m.month).replace(' 20', " '")}</th>)}</tr></thead>
            <tbody>
              <tr><th>Below {warn}%</th>{fc.map((m) => <td key={m.month} className="num">{fmtProb(m.p_below_warning)}</td>)}</tr>
              <tr><th>Below {dang}%</th>{fc.map((m) => <td key={m.month} className="num">{fmtProb(m.p_below_danger)}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </Figure>

      <Figure
        title="The cost of waiting"
        sub="Expected cost of the shortfall depending on the month conservation and import contracts start. Later action means emergency power at higher prices and more unserved energy."
        source={<>Patronus water balance and cost model; {String(cw?.assumptions?.source ?? 'ZESCO ERB filing Jul 2024; VoLL literature')}. Action months {periodOf([cw?.curve?.[0]?.action_month, cw?.curve?.[(cw?.curve?.length ?? 1) - 1]?.action_month])}.</>}
        files={['kariba.json']}
      >
        {cw?.headline && <p className="headline">{cw.headline}</p>}
        <TimeChart
          ariaLabel="Expected cost by month action starts"
          height={240}
          y={{ fmt: (v) => fmtMusd(v), label: 'Expected cost (US$ millions)' }}
          legend={<><LegendItem color="var(--drying-strong)" label="Median expected cost" /><LegendItem kind="box" color="var(--shortfall-shade)" label="P10–P90" /></>}
          layers={[
            { kind: 'band', data: (cw?.curve ?? []).map((c) => ({ x: c.action_month, lo: c.expected_cost_musd_p10, hi: c.expected_cost_musd_p90 })), color: 'var(--shortfall-shade)', label: 'P10–P90', fmt: fmtMusd },
            { kind: 'line', data: (cw?.curve ?? []).map((c) => ({ x: c.action_month, y: c.expected_cost_musd_p50 })), color: 'var(--drying-strong)', label: 'Median', fmt: fmtMusd },
            { kind: 'points', data: (cw?.curve ?? []).map((c) => ({ x: c.action_month, y: c.expected_cost_musd_p50 })), color: 'var(--drying-strong)', r: 3 },
          ]}
        />
        <dl className="kv inline">
          <div><dt>Contracted imports</dt><dd>${fmtNum(Number(cw?.assumptions?.replacement_contracted_usd_per_kwh), 2)}/kWh</dd></div>
          <div><dt>Emergency power</dt><dd>${fmtNum(Number(cw?.assumptions?.replacement_emergency_usd_per_kwh), 2)}/kWh</dd></div>
          <div><dt>Value of lost load</dt><dd>${fmtNum(Number(cw?.assumptions?.voll_usd_per_kwh), 2)}/kWh</dd></div>
        </dl>
      </Figure>

      <div className="grid-2">
        <div className="panel">
          <h3>El Niño and the lake</h3>
          <dl className="kv">
            <div><dt>Mean level change in El Niño years</dt><dd>{fmtNum(d.enso?.mean_level_change_el_nino_m, 2)} m</dd></div>
            <div><dt>Mean level change in other years</dt><dd>{fmtNum(d.enso?.mean_level_change_other_m, 2)} m</dd></div>
            <div><dt>Significance (permutation p)</dt><dd>{fmtNum(d.enso?.p, 3)}</dd></div>
          </dl>
          <p className="small muted">El Niño years in the record: {(d.enso?.el_nino_years ?? []).join(', ') || '—'}.</p>
          <SourceNote files={['kariba.json']}>G-REALM levels and NOAA ONI, {histPeriod}.</SourceNote>
        </div>
        <div className="panel">
          <h3>Look-alike past situations</h3>
          {(d.analogs ?? []).length === 0 ? <Empty>No analogs yet.</Empty> : (
            <ul className="analogs">
              {(d.analogs ?? []).map((a) => (
                <li key={a.date}><b>{fmtMonth(a.date)}</b> <span className="muted">similarity {fmtNum(a.similarity, 2)}</span><br />{a.what_happened}</li>
              ))}
            </ul>
          )}
          <SourceNote files={['kariba.json']}>Nearest neighbours on lake level, water storage and ENSO state, {histPeriod}.</SourceNote>
        </div>
      </div>

      <SkillTable rows={d.backtest?.by_horizon ?? []} noGrace={d.backtest?.ablation_no_grace ?? []} />

      <h2 className="section-title">What the 2024 blackout looked like from space</h2>
      <NightStrip frames={nl.data?.frames ?? []} />

      {(d.other_reservoirs ?? []).length > 0 && (
        <div className="panel">
          <h3>Other reservoirs we track</h3>
          <table className="data-table compact">
            <thead><tr><th>Reservoir</th><th>Country</th><th>Latest level</th><th>vs normal</th></tr></thead>
            <tbody>
              {(d.other_reservoirs ?? []).map((r) => (
                <tr key={r.name}><td>{r.name}</td><td>{r.country}</td><td className="num">{fmtNum(r.latest_level_m, 2)} m</td><td className="num">{isNum(r.anomaly_m) ? `${r.anomaly_m > 0 ? '+' : ''}${fmtNum(r.anomaly_m, 2)} m` : '—'}</td></tr>
              ))}
            </tbody>
          </table>
          <SourceNote files={['kariba.json']}>G-REALM satellite lake levels (NASA/USDA).</SourceNote>
        </div>
      )}

      {brief && (
        <div className="panel brief">
          <p className="ai-label">AI-written brief, checked against the data files</p>
          <MiniMarkdown text={brief} />
        </div>
      )}
    </div>
  );
}

function SkillTable({ rows, noGrace }: { rows: SkillRow[]; noGrace: any[] }) {
  if (!rows.length) return null;
  const ng = new Map(noGrace.filter((x) => x && typeof x === 'object').map((x: any) => [x.horizon, x]));
  return (
    <div className="panel">
      <h3>How good is the Kariba model? Backtest by lead time</h3>
      <p className="muted">Brier skill above 0 means better than the baseline. Without GRACE: the same model with NASA's water-storage data removed.</p>
      <div className="table-wrap">
        <table className="data-table compact">
          <thead><tr><th>Months ahead</th><th>Skill vs climatology</th><th>vs persistence</th><th>vs ENSO only</th><th>AUC-PR</th><th>AUC-PR without GRACE</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.horizon}>
                <td>{r.horizon}</td>
                <td className="num">{fmtNum(r.bss_vs_climatology, 2)}</td>
                <td className="num">{fmtNum(r.bss_vs_persistence, 2)}</td>
                <td className="num">{fmtNum(r.bss_vs_enso_only, 2)}</td>
                <td className="num">{fmtNum(r.auc_pr, 2)}{r.auc_pr_ci90 ? <span className="muted"> [{fmtNum(r.auc_pr_ci90[0], 2)}–{fmtNum(r.auc_pr_ci90[1], 2)}]</span> : null}</td>
                <td className="num">{fmtNum(ng.get(r.horizon)?.auc_pr, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SourceNote files={['kariba.json']}>Strictly forward rolling backtest from 2003 (GRACE era); no-GRACE version from 1993.</SourceNote>
    </div>
  );
}

function NightFrameImg({ f }: { f: NightFrame }) {
  const [srcIdx, setSrcIdx] = useState(0);
  const candidates = f.src ? [`data/${f.src}`, f.src] : [];
  const failed = srcIdx >= candidates.length;
  return (
    <figure className="night-frame">
      {failed ? (
        <div className="night-placeholder" role="img" aria-label="Image not available">Image not loaded<br /><span className="muted">{f.src ?? 'no file'}</span></div>
      ) : (
        <img src={candidates[srcIdx]} alt={`Night lights over ${f.place ?? 'the region'}, ${fmtDate(f.date)}`} loading="lazy" onError={() => setSrcIdx((i) => i + 1)} />
      )}
      <figcaption><b>{fmtDate(f.date)}</b> · {f.place}<br /><span className="muted">{f.caption}</span></figcaption>
    </figure>
  );
}

function NightStrip({ frames }: { frames: NightFrame[] }) {
  if (!frames.length) return <Empty>Night-light images are not available yet.</Empty>;
  return (
    <>
      <div className="night-strip">
        {frames.map((f) => <NightFrameImg key={f.id} f={f} />)}
      </div>
      <SourceNote files={['nightlights.json']}>
        NASA Black Marble night lights (VNP46) via NASA GIBS, {periodOf([frames[0]?.date, frames[frames.length - 1]?.date])}. Display images only; clouds and moonlight affect single nights.
      </SourceNote>
    </>
  );
}
