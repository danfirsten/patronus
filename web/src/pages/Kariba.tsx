import { useEffect, useState } from 'react';
import { useData, loadText } from '../data/load';
import type { Kariba, KaribaForecastMonth, Nightlights, NightFrame, SkillRow } from '../data/types';
import { Figure, Loading, Stat, Empty, SourceNote, MiniMarkdown } from '../components/common';
import { Gauge } from '../components/small';
import { useWaterline } from '../lib/motion';
import { TimeChart, LegendItem } from '../components/TimeChart';
import { KaribaSim } from '../components/KaribaSim';
import { fmtDate, fmtMonth, fmtMusd, fmtNum, fmtProb, isNum, monthsBetween, periodOf } from '../lib/format';

const LOWEST_2024 = { date: '2024-12-11', usable_pct: 2.89, level_m: 475.91 }; // DESIGN.md 11.7 (ZRA)

const OUTCOME_LABEL: Record<string, string> = { hit: 'Hit', miss: 'Miss', false_alarm: 'False alarm', correct_quiet: 'Correctly quiet' };
const SENS_LABEL: Record<string, string> = {
  'voll_0.5': 'Value of lost load $0.50/kWh',
  'voll_1.5': 'Value of lost load $1.50/kWh',
  'energy_0.19_twh_per_bcm': 'Energy per BCM: 0.19 TWh',
  'energy_0.25_twh_per_bcm': 'Energy per BCM: 0.25 TWh',
  hist_release_23_bcm: 'Past releases assumed 23 BCM/yr',
  hist_release_36_bcm: 'Past releases assumed 36 BCM/yr',
  no_terminal_credit: 'No credit for water left at end-2027',
  strong_el_nino_only: 'Strong El Niño years only',
};

export default function KaribaPage() {
  const k = useData<Kariba>('kariba.json');
  const nl = useData<Nightlights>('nightlights.json');
  const trends = useData<any>('trends.json');
  const [brief, setBrief] = useState<string | null>(null);
  useEffect(() => { loadText('briefs/kariba.md').then(setBrief); }, []);
  // The logo's waterline drops to Kariba's live usable storage while this page is open.
  useWaterline((k.data as any)?.latest?.usable_pct);

  if (k.loading) return <div className="wrap page"><Loading what="Kariba data" /></div>;
  const d = k.data as any as Kariba & Record<string, any>;
  if (!d) return <div className="wrap page"><Empty>Kariba data is not available.</Empty></div>;

  const warn = d.thresholds?.warning_usable_pct ?? 20;
  const dang = d.thresholds?.danger_usable_pct ?? 10;
  const hist = d.history ?? [];
  const F: any = d.forecast ?? {};
  const fc: KaribaForecastMonth[] = F.months ?? [];
  const nowM: KaribaForecastMonth[] = F.now_model?.months ?? [];
  const nextM: KaribaForecastMonth[] = F.next_model?.months ?? [];
  const c24: any = d.backtest?.crisis_2024 ?? {};
  const c24Now: any = c24.now_model ?? null;
  const c24Series: any[] = c24.next_model?.series ?? c24.series ?? [];
  const zra: any = d.zra_projection ?? {};
  const issued = F.issued;
  // Months to darkness (Kariba): first month with at least a 1-in-3 chance of falling below the danger line.
  const DARK_P = 1 / 3;
  const firstDanger = fc.find((m) => isNum(m.p_below_danger) && (m.p_below_danger as number) >= DARK_P);
  const mtd = firstDanger ? Math.max(0, monthsBetween(issued?.slice(0, 7), firstDanger.month) ?? 0) : null;
  const last = fc[fc.length - 1];
  const histPeriod = periodOf([hist[0]?.date, hist[hist.length - 1]?.date]);
  const recent = hist.filter((h) => h.date >= '2025-06');
  const crisisWin = hist.filter((h) => h.date >= '2023-01' && h.date <= '2025-03');
  const lead = (n: number | null | undefined) => !isNum(n) ? '—' : n > 0 ? `${n} month${n === 1 ? '' : 's'} before` : n === 0 ? 'the same month as' : `${-n} month${n === -1 ? '' : 's'} after`;
  const pct = (v: number) => `${Math.round(v)}%`;
  const nm: any = (d.backtest as any)?.next_model ?? null;
  const elnScore = nm?.score?.warning?.el_nino_seasons?.ensemble;
  const interp: string | undefined = trends.data?.kariba_basin?.interpretation;

  // cost of waiting
  const cw: any = d.cost_of_waiting ?? {};
  const curve: any[] = cw.curve ?? [];
  const hasMean = curve.some((c) => isNum(c.expected_cost_musd_mean));
  const val = (c: any) => (hasMean ? c?.expected_cost_musd_mean : c?.expected_cost_musd_p50);
  const policies: any[] = Array.isArray(cw.policies) ? cw.policies : [];
  const POLICY: Record<string, string> = { wait_warning: 'Wait until the lake drops below 20%', no_action: 'Take no action' };
  const sens: Record<string, any> = cw.sensitivity_mean_musd ?? {};
  const pol = (name: string) => policies.find((p) => p.policy === name)?.expected_cost_musd_mean;
  const central = { act_2026_12: val(curve.find((c) => c.action_month === '2026-12')), act_2027_04: val(curve.find((c) => c.action_month === '2027-04')), wait_warning: pol('wait_warning'), no_action: pol('no_action') };
  const actDec = [central.act_2026_12, ...Object.values(sens).map((v: any) => v?.act_2026_12)].filter(isNum);
  const relDec = Object.entries(sens).filter(([k]) => k.startsWith('hist_release')).map(([, v]: any) => v?.act_2026_12).filter(isNum);
  const relRange = relDec.length ? [Math.min(...relDec, ...(isNum(central.act_2026_12) ? [central.act_2026_12] : [])), Math.max(...relDec)] : null;

  return (
    <>
    <header className="k-hero">
      <div className="wrap k-hero-grid">
      <div>
      <p className="eyebrow">Kariba 2027 · Zambia and Zimbabwe</p>
      <h1>Lake Kariba: 2024 replay and 2027 forecast</h1>
      <p className="lede">
        Kariba is the largest man-made reservoir in the world. Its two power stations supply much of the electricity in Zambia and Zimbabwe.
        In 2024 an El Niño drought drained it to 2.89% usable storage. Zambia cut power for 8, then 12 hours a day.
        A very strong El Niño is back for 2027, and the Zambezi River Authority (ZRA) has already cut the 2027 power allocation by {zra?.cut_pct ?? 36}%.
      </p>

      </div>
      <figure className="k-level" aria-label={`Usable storage ${fmtNum(d.latest?.usable_pct, 1)} percent on ${fmtDate(d.latest?.date)}`}>
        <p className="eyebrow">Usable storage now</p>
        <p className="k-level-n">{fmtNum(d.latest?.usable_pct, 1)}<span>%</span></p>
        <div className="k-tank" aria-hidden="true">
          <i className="k-fill" style={{ height: `${Math.max(0, Math.min(100, d.latest?.usable_pct ?? 0))}%` }} />
          <i className="k-line" style={{ bottom: `${warn}%` }}><b>{warn}% warning</b></i>
          <i className="k-line k-line-d" style={{ bottom: `${dang}%` }}><b>{dang}% danger</b></i>
        </div>
        <figcaption className="small">Satellite altimetry, {fmtDate(d.latest?.date)}. 2024 low: 2.89%.</figcaption>
      </figure>
      </div>
      <div className="wrap">
      <div className="stat-row">
        <Stat value={`−${zra?.cut_pct ?? 36}%`} label={`2027 allocation cut to ${fmtNum(zra?.allocation_2027_bcm)} BCM (ZRA)`} tone="drying" />
        <Stat value={fmtProb(last?.p_below_danger)} label={`chance of falling below ${dang}% (danger) by ${fmtMonth(last?.month)}`} tone="drying" />
        <Stat value={`${fmtNum(last?.usable_p50, 0)}%`} label={`Patronus median for ${fmtMonth(last?.month)}, vs ZRA's own ${fmtNum(zra?.end_2027_usable_pct)}%`} />
      </div>
      </div>
    </header>
    <div className="wrap page k-body">

      <div className="grid-2">
        <div className="panel">
          <Gauge months={mtd} max={12} label="Months to darkness" beyond={fc.length ? `${fc.length}+` : 'n/a'}
            sub={mtd === null
              ? `No forecast month reaches a 1-in-3 chance of falling below ${dang}% usable.`
              : `Months from ${fmtMonth(issued)} until the first month with at least a 1-in-3 chance of falling below ${dang}% usable storage (${fmtMonth(firstDanger?.month)}: ${fmtProb(firstDanger?.p_below_danger)}). Below ${dang}%, the allocation can no longer be met.`} />
          <SourceNote files={['kariba.json']}>Patronus blended Kariba forecast issued {fmtDate(issued)}.</SourceNote>
        </div>
        <div className="panel">
          <h3>Two models, one forecast</h3>
          <dl className="kv stack">
            <div><dt>Now · 0–6 months</dt><dd>{F.now_model?.name ?? 'Machine-learning model'}. Skilful for the next few months from stored water, rain and soil, but it learned from few strong El Niños and cannot see one coming.</dd></div>
            <div><dt>Next · 6–18 months</dt><dd>{F.next_model?.name ?? 'El Niño-conditioned water-balance ensemble'}. It replays inflows from past years in the same El Niño phase ({(F.next_model?.analog_years ?? []).length || '—'} years) against the announced releases.</dd></div>
          </dl>
          {F.blend_rule && <p className="small"><b>How they are blended:</b> {F.blend_rule}</p>}
          {F.skill_caveat && <p className="small muted">{F.skill_caveat}</p>}
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
      {interp && (
        <div className="callout">
          <h3>Is the Kariba basin drying?</h3>
          <p className="small">{interp}</p>
          <SourceNote files={['trends.json']}>GRACE/GRACE-FO (GFZ GravIS), G-REALM, GPCP and MERRA-2 rainfall, 2002–2026.</SourceNote>
        </div>
      )}

      <h2 className="section-title">The 2024 crisis, and when Patronus would have warned</h2>
      <p className="headline">
        In a fair backtest, Patronus' El Niño model first gave a better-than-even chance of the lake falling below {warn}% in <b>{fmtMonth(c24.first_warning_p_gt_0_5)}</b>:{' '}
        <b>{lead(c24.lead_months_vs_zra)}</b> ZRA's water cut and <b>{lead(c24.lead_months_vs_load_shedding)}</b> load-shedding began.
      </p>
      <Figure
        title="2023–2025: the lake falls, the officials act, the alarms fire"
        sub="Solid line: usable storage. Dashed line: what the El Niño model said at the time (chance of falling below 20% during Apr–Dec 2024). Vertical lines: first alarms of each model and the official decisions."
        source={<>G-REALM lake levels (NASA/USDA), Jan 2023 – Mar 2025; ZRA and news for official dates. Backtest issued monthly with only the data then available.</>}
        files={['kariba.json']}
      >
        <TimeChart
          ariaLabel="Lake Kariba 2023 to 2025 with alarm and decision dates"
          height={320}
          xDomain={['2023-01-01', '2025-03-01']}
          y={{ domain: [0, 40], fmt: pct, label: 'Usable storage (%)' }}
          y2={c24Series.length ? { domain: [0, 1], fmt: (v) => fmtProb(v), label: 'Alarm probability (dashed)' } : undefined}
          legend={<><LegendItem color="var(--series-1)" label="Usable storage" />{c24Series.length > 0 && <><LegendItem kind="dash" color="var(--series-2)" label={`El Niño model: chance of < ${warn}%`} /><LegendItem kind="dash" color="var(--series-3)" label={`El Niño model: chance of < ${dang}%`} /></>}</>}
          layers={[
            { kind: 'hline', y: warn, color: 'var(--threshold-warning)', label: `${warn}%` },
            { kind: 'hline', y: dang, color: 'var(--threshold-danger)', label: `${dang}%` },
            { kind: 'line', data: crisisWin.map((h) => ({ x: h.date, y: h.usable_pct })), color: 'var(--series-1)', label: 'Usable storage', fmt: (v) => `${fmtNum(v, 1)}%`, curve: false },
            ...(c24.first_warning_p_gt_0_5 ? [{ kind: 'vline' as const, x: c24.first_warning_p_gt_0_5, color: 'var(--series-2)', label: 'El Niño model: warning', row: 0 }] : []),
            ...(c24.zra_allocation_cut ? [{ kind: 'vline' as const, x: c24.zra_allocation_cut, color: 'var(--text-muted)', label: 'ZRA cuts allocation', row: 1 }] : []),
            ...(c24Now?.first_warning_p_gt_0_5 ? [{ kind: 'vline' as const, x: c24Now.first_warning_p_gt_0_5, color: 'var(--series-4)', label: 'ML model: warning', row: 2 }] : []),
            { kind: 'vline', x: c24.load_shedding_start ?? '2024-03-11', color: 'var(--threshold-danger)', label: 'Load-shedding starts', row: 3 },
            { kind: 'points', data: [{ x: LOWEST_2024.date, y: LOWEST_2024.usable_pct, label: '2.89% (11 Dec 2024)' }], color: 'var(--threshold-danger)', r: 5 },
            ...(c24Series.length ? [
              { kind: 'line' as const, axis: 'right' as const, data: c24Series.map((p) => ({ x: p.issue, y: p.p_warning })), color: 'var(--series-2)', dash: '4 3', width: 1.8, label: `El Niño model: chance of < ${warn}%`, fmt: fmtProb, curve: false },
              { kind: 'line' as const, axis: 'right' as const, data: c24Series.map((p) => ({ x: p.issue, y: p.p_danger })), color: 'var(--series-3)', dash: '4 3', width: 1.5, label: `El Niño model: chance of < ${dang}%`, fmt: fmtProb, curve: false },
            ] : []),
          ]}
        />
      </Figure>
      <ol className="timeline">
        {c24.first_warning_p_gt_0_5 && <li className="tl-p"><span className="tl-date">{fmtMonth(c24.first_warning_p_gt_0_5)}</span><span>El Niño model: chance of falling below {warn}% passes 50%. This first alarm came from low storage while the El Niño index was still neutral.</span></li>}
        {c24.first_danger_p_gt_0_5 && <li className="tl-p"><span className="tl-date">{fmtMonth(c24.first_danger_p_gt_0_5)}</span><span>El Niño model: chance of falling below {dang}% passes 50%. From now on it uses El Niño analog years.</span></li>}
        <li><span className="tl-date">{fmtDate(c24.zra_allocation_cut ?? '2023-12-28')}</span><span>ZRA cuts the 2024 allocation to 16 BCM.</span></li>
        {c24Now?.first_warning_p_gt_0_5 && <li className="tl-ml"><span className="tl-date">{fmtMonth(c24Now.first_warning_p_gt_0_5)}</span><span>ML ("now") model: chance of falling below {warn}% passes 50%, only {lead(c24Now.lead_months_vs_load_shedding)} load-shedding.</span></li>}
        <li><span className="tl-date">{fmtDate(c24.load_shedding_start ?? '2024-03-11')}</span><span>Zambia starts 8 hours a day of load-shedding; 12 hours from 20 May.</span></li>
        <li><span className="tl-date">~14 Sep 2024</span><span>Kariba North power station stops.</span></li>
        <li><span className="tl-date">11 Dec 2024</span><span>Lake at 475.91 m: 2.89% usable, the lowest point.</span></li>
      </ol>
      {c24Now && (
        <p className="small"><b>The honest part:</b> the machine-learning model missed the early signal. Issued in Oct–Dec 2023, its median expected the lake to recover; it fired only in {fmtMonth(c24Now.first_warning_p_gt_0_5)}. The early warning came from the El Niño water-balance model.</p>
      )}
      {c24.definition && <p className="muted small">How the alarm is defined: {c24.definition}</p>}

      {nm?.score && (
        <div className="panel">
          <h3>Not cherry-picked: every season since 1995</h3>
          <p className="muted">
            The El Niño model was re-run each Oct, Nov and Dec from 1995 to 2025, using only what was known then. An alarm is any of the three with a chance above 50%.
            The event is the lake falling below {warn}% at any time in Apr–Dec of the next year.
          </p>
          {elnScore && (
            <p className="headline">In El Niño seasons: {elnScore.hit} hits, {elnScore.miss} misses and {elnScore.false_alarm} false alarms ({elnScore.correct_quiet} correctly quiet).</p>
          )}
          <ScoreTable score={nm.score} warn={warn} dang={dang} />
          <SeasonStrip seasons={nm.seasons ?? []} />
          <SourceNote files={['kariba.json']}>Patronus Kariba backtest, seasons 1996–2026; G-REALM levels, NOAA ONI.</SourceNote>
        </div>
      )}

      <h2 className="section-title" id="forecast">2027: the forecast</h2>
      <Figure
        title={`Forecast usable storage, ${fmtMonth(fc[0]?.month)} – ${fmtMonth(last?.month)}, against ZRA's projection`}
        sub="Shaded fan: 80% of outcomes (P10–P90) of the blended forecast. Thick line: blended median. Thin lines: each model's median. Dot: ZRA's projection for end-2027 if the full allocation is used."
        source={<>Patronus forecast issued {fmtDate(issued)} (G-REALM, GRACE/GRACE-FO, GPCP, NASA POWER, NOAA ONI, GEOS-S2S outlook); ZRA projection{zra?.source_url ? <> (<a href={zra.source_url} target="_blank" rel="noreferrer">source</a>)</> : ''}.</>}
        files={['kariba.json']}
      >
        <TimeChart
          ariaLabel="Kariba forecast fan chart with ZRA projection"
          height={300}
          y={{ domain: [0, 80], fmt: pct, label: 'Usable storage (%)' }}
          legend={<>
            <LegendItem color="var(--series-1)" label="Observed" />
            <LegendItem color="var(--series-2)" label="Blended median" />
            <LegendItem kind="box" color="var(--series-band-2)" label="P10–P90" />
            {nowM.length > 0 && <LegendItem kind="dash" color="var(--series-4)" label="ML (now) model median" />}
            {nextM.length > 0 && <LegendItem kind="dash" color="var(--drying-mild)" label="El Niño (next) model median" />}
            <LegendItem kind="dot" color="var(--series-3)" label="ZRA projection" />
          </>}
          layers={[
            { kind: 'band', data: fc.map((m) => ({ x: m.month, lo: m.usable_p10, hi: m.usable_p90 })), color: 'var(--series-band-2)', label: 'P10–P90', fmt: pct },
            { kind: 'hline', y: warn, color: 'var(--threshold-warning)', label: `${warn}% warning` },
            { kind: 'hline', y: dang, color: 'var(--threshold-danger)', label: `${dang}% danger` },
            { kind: 'line', data: recent.map((h) => ({ x: h.date, y: h.usable_pct })), color: 'var(--series-1)', label: 'Observed', fmt: (v) => `${fmtNum(v, 1)}%` },
            ...(nowM.length ? [{ kind: 'line' as const, data: nowM.map((m) => ({ x: m.month, y: m.usable_p50 })), color: 'var(--series-4)', dash: '3 3', width: 1.3, label: 'ML model median', fmt: pct }] : []),
            ...(nextM.length ? [{ kind: 'line' as const, data: nextM.map((m) => ({ x: m.month, y: m.usable_p50 })), color: 'var(--drying-mild)', dash: '3 3', width: 1.3, label: 'El Niño model median', fmt: pct }] : []),
            { kind: 'line', data: fc.map((m) => ({ x: m.month, y: m.usable_p50 })), color: 'var(--series-2)', width: 2.5, label: 'Blended median', fmt: pct },
            ...(isNum(zra?.end_2027_usable_pct) ? [{ kind: 'points' as const, data: [{ x: '2027-12', y: zra.end_2027_usable_pct, label: `ZRA ${zra.end_2027_usable_pct}%` }], color: 'var(--series-3)', r: 6, label: 'ZRA projection', fmt: pct }] : []),
          ]}
        />
        <div className="prob-table-wrap">
          <table className="data-table compact prob-table">
            <thead><tr><th>Month</th>{fc.map((m) => <th key={m.month}>{fmtMonth(m.month).replace(' 20', " '")}</th>)}</tr></thead>
            <tbody>
              <tr><th>Below {warn}%</th>{fc.map((m) => <td key={m.month} className="num">{fmtProb(m.p_below_warning)}</td>)}</tr>
              <tr><th>Below {dang}%</th>{fc.map((m) => <td key={m.month} className="num">{fmtProb(m.p_below_danger)}</td>)}</tr>
              {fc.some((m: any) => isNum(m.weight_next_model)) && <tr><th>El Niño model weight</th>{fc.map((m: any) => <td key={m.month} className="num muted">{fmtProb(m.weight_next_model)}</td>)}</tr>}
            </tbody>
          </table>
        </div>
        {zra?.comparison && <p className="small" style={{ marginTop: 12 }}>{zra.comparison}</p>}
      </Figure>

      <KaribaSim />

      <p className="callout"><b>Plan it yourself.</b> Pick the actions Zambia can actually take (hold water, imports, rentals, mine curtailment, solar, a published schedule), see the month-by-month result over the El Niño years, and ask the assistant to re-plan. <a href="#/plan">Open the Plan simulator</a>.</p>

      <Figure
        title="The cost of waiting (illustrative)"
        sub="Expected cost of the shortfall depending on the month conservation and import contracts start, under central assumptions. Treat it as a range, not a figure: it moves a lot with the assumptions below."
        source={<>Patronus water balance and cost model; {String(cw?.assumptions?.source ?? 'ZESCO ERB filing Jul 2024; VoLL literature')}. Action months {periodOf([curve[0]?.action_month, curve[curve.length - 1]?.action_month])}.{cw?.headline_note ? ` ${cw.headline_note}` : ''}</>}
        files={['kariba.json']}
      >
        {relRange ? (
          <p className="headline">Acting in December would cost an expected {fmtMusd(relRange[0])} to {fmtMusd(relRange[1])}, depending mostly on how much water past years are assumed to have released. Waiting costs more in every run we tried{Object.values(sens).some((v: any) => isNum(v?.act_2026_12) && isNum(v?.wait_warning) && v.act_2026_12 > v.wait_warning) ? ' except one (see table)' : ''}.</p>
        ) : cw?.headline && <p className="headline">{cw.headline}</p>}
        {relRange && cw?.headline && <p className="small muted">Central case: {cw.headline}</p>}
        <TimeChart
          ariaLabel="Expected cost by month action starts"
          height={240}
          y={{ fmt: (v) => fmtMusd(v), label: 'Expected cost, central assumptions (US$)' }}
          legend={<>
            <LegendItem color="var(--drying-strong)" label={hasMean ? 'Act in this month (mean across El Niño scenarios)' : 'Median expected cost'} />
            {!hasMean && <LegendItem kind="box" color="var(--shortfall-shade)" label="P10–P90" />}
            {policies.map((p, i) => <LegendItem key={i} kind="dash" color={i === 0 ? 'var(--risk-warning)' : 'var(--text-muted)'} label={`${POLICY[p.policy] ?? p.policy}: ${fmtMusd(p.expected_cost_musd_mean ?? p.expected_cost_musd_p50)}`} />)}
          </>}
          layers={[
            ...(!hasMean ? [{ kind: 'band' as const, data: curve.map((c) => ({ x: c.action_month, lo: c.expected_cost_musd_p10, hi: c.expected_cost_musd_p90 })), color: 'var(--shortfall-shade)', label: 'P10–P90', fmt: fmtMusd }] : []),
            ...policies.map((p, i) => ({ kind: 'hline' as const, y: p.expected_cost_musd_mean ?? p.expected_cost_musd_p50 ?? 0, color: i === 0 ? 'var(--risk-warning)' : 'var(--text-muted)', label: POLICY[p.policy] ?? p.policy })),
            { kind: 'line', data: curve.map((c) => ({ x: c.action_month, y: val(c) })), color: 'var(--drying-strong)', label: 'Act in this month', fmt: fmtMusd },
            { kind: 'points', data: curve.map((c) => ({ x: c.action_month, y: val(c) })), color: 'var(--drying-strong)', r: 3 },
          ]}
        />
        {Object.keys(sens).length > 0 && (
          <div className="table-wrap">
            <table className="data-table compact">
              <thead><tr><th>Assumption changed</th><th>Act in Dec 2026</th><th>Act in Apr 2027</th><th>Wait until below {warn}%</th><th>No action</th></tr></thead>
              <tbody>
                <tr className="row-strong"><td>Central assumptions</td><td className="num">{fmtMusd(central.act_2026_12)}</td><td className="num">{fmtMusd(central.act_2027_04)}</td><td className="num">{fmtMusd(central.wait_warning)}</td><td className="num">{fmtMusd(central.no_action)}</td></tr>
                {Object.entries(sens).map(([key, v]: any) => (
                  <tr key={key}>
                    <td>{SENS_LABEL[key] ?? key.replace(/_/g, ' ')}{Array.isArray(v?.years) ? ` (${v.years.join(', ')})` : ''}</td>
                    <td className="num">{fmtMusd(v?.act_2026_12)}</td><td className="num">{fmtMusd(v?.act_2027_04)}</td><td className="num">{fmtMusd(v?.wait_warning)}</td><td className="num">{fmtMusd(v?.no_action)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {actDec.length > 1 && <p className="small muted">Across all runs, acting in December ranges from {fmtMusd(Math.min(...actDec))} to {fmtMusd(Math.max(...actDec))}. Costs are expected values over historical El Niño inflow years, relative to the no-action storage path.</p>}
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
              {(d.analogs ?? []).map((a, i) => (
                <li key={i}><b>{fmtMonth(a.date)}</b> <span className="muted">similarity {fmtNum(a.similarity, 2)}</span><br />{a.what_happened}</li>
              ))}
            </ul>
          )}
          <SourceNote files={['kariba.json']}>Nearest neighbours on lake level, water storage and ENSO state, {histPeriod}.</SourceNote>
        </div>
      </div>

      <SkillTable rows={d.backtest?.by_horizon ?? []} noGrace={d.backtest?.ablation_no_grace ?? []} />

      <h2 className="section-title">What the 2024 blackout looked like from space</h2>
      <NightStrip frames={(nl.data?.frames ?? []).filter((f) => !f.region || f.region === 'zambia')} />

      {(d.other_reservoirs ?? []).length > 0 && (
        <div className="panel">
          <h3>Other reservoirs we track</h3>
          <div className="table-wrap"><table className="data-table compact">
            <thead><tr><th>Reservoir</th><th>Country</th><th>Latest level</th><th>vs normal</th></tr></thead>
            <tbody>
              {(d.other_reservoirs ?? []).map((r, i) => (
                <tr key={i}><td>{r.name}</td><td>{r.country}</td><td className="num">{fmtNum(r.latest_level_m, 2)} m</td><td className="num">{isNum(r.anomaly_m) ? `${r.anomaly_m > 0 ? '+' : ''}${fmtNum(r.anomaly_m, 2)} m` : '—'}</td></tr>
              ))}
            </tbody>
          </table></div>
          <SourceNote files={['kariba.json']}>G-REALM satellite lake levels (NASA/USDA).</SourceNote>
        </div>
      )}

      {brief && <BriefPanel text={brief} />}
    </div>
    </>
  );
}

function ScoreTable({ score, warn, dang }: { score: any; warn: number; dang: number }) {
  const rows: [string, string][] = [['el_nino_seasons', 'El Niño seasons'], ['other_seasons', 'Other seasons'], ['all', 'All seasons']];
  const cell = (o: any) => (o ? `${o.hit} / ${o.miss} / ${o.false_alarm} / ${o.correct_quiet}` : '—');
  return (
    <div className="table-wrap">
      <table className="data-table compact">
        <thead><tr><th>Seasons</th><th>El Niño model, below {warn}%</th><th>ML model (2006 on), below {warn}%</th><th>El Niño model, below {dang}%</th></tr></thead>
        <tbody>
          {rows.map(([k, label]) => (
            <tr key={k}><td>{label}</td><td className="num">{cell(score?.warning?.[k]?.ensemble)}</td><td className="num">{cell(score?.warning?.[k]?.ml_2006_onward)}</td><td className="num">{cell(score?.danger?.[k]?.ensemble)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Each cell: hits / misses / false alarms / correctly quiet.</p>
    </div>
  );
}

function SeasonStrip({ seasons }: { seasons: any[] }) {
  const s = seasons.filter((x) => x && x.season);
  if (!s.length) return null;
  return (
    <>
      <div className="season-strip" role="list" aria-label="El Niño model outcome by season, 20% warning line">
        {s.map((x) => {
          const o = x.warning_ensemble_outcome ?? 'none';
          return (
            <span key={x.season} role="listitem" className={`season season-${o}`} title={`${x.season}: ${OUTCOME_LABEL[o] ?? o}${x.el_nino ? ' (El Niño season)' : ''}${isNum(x.obs_min_apr_dec_pct) ? `; lowest Apr–Dec ${fmtNum(x.obs_min_apr_dec_pct, 0)}%` : ''}`}>
              <span className="season-y">{String(x.season).slice(2)}</span>
              {x.el_nino && <span className="season-e" aria-label="El Niño">EN</span>}
            </span>
          );
        })}
      </div>
      <div className="legend">
        <LegendItem kind="box" color="var(--outcome-hit)" label="Hit" />
        <LegendItem kind="box" color="var(--outcome-miss)" label="Miss" />
        <LegendItem kind="box" color="var(--outcome-false)" label="False alarm" />
        <LegendItem kind="box" color="var(--outcome-quiet)" label="Correctly quiet" />
        <span className="legend-item">EN = El Niño season</span>
      </div>
    </>
  );
}

function BriefPanel({ text }: { text: string }) {
  return (
    <div className="panel brief">
      <p className="ai-label">AI-written brief, checked against the data</p>
      <MiniMarkdown text={text} />
    </div>
  );
}

function SkillTable({ rows, noGrace }: { rows: SkillRow[]; noGrace: any[] }) {
  if (!rows.length) return null;
  const ng = new Map(noGrace.filter((x) => x && typeof x === 'object').map((x: any) => [x.horizon, x]));
  // kariba.json nests metrics per threshold ({warning: {...}, danger: {...}}); flat rows also work.
  const m = (r: any): SkillRow => ({ ...(r.warning ?? r), horizon: r.horizon });
  const ngAuc = (x: any) => x?.auc_pr_warning_no_grace ?? x?.auc_pr;
  return (
    <div className="panel">
      <h3>How good is the ML ("now") model? Backtest by lead time</h3>
      <p className="muted">Target: usable storage below the 20% warning line. Brier skill above 0 means better than the baseline. Without GRACE: the same model with NASA's water-storage data removed.</p>
      <div className="table-wrap">
        <table className="data-table compact">
          <thead><tr><th>Months ahead</th><th>Skill vs climatology</th><th>vs persistence</th><th>vs ENSO only</th><th>AUC-PR</th><th>AUC-PR without GRACE</th></tr></thead>
          <tbody>
            {rows.map(m).map((r, i) => (
              <tr key={i}>
                <td>{r.horizon}</td>
                <td className="num">{fmtNum(r.bss_vs_climatology, 2)}</td>
                <td className="num">{fmtNum(r.bss_vs_persistence, 2)}</td>
                <td className="num">{fmtNum(r.bss_vs_enso_only, 2)}</td>
                <td className="num">{fmtNum(r.auc_pr, 2)}{r.auc_pr_ci90 ? <span className="muted"> [{fmtNum(r.auc_pr_ci90[0], 2)}–{fmtNum(r.auc_pr_ci90[1], 2)}]</span> : null}</td>
                <td className="num">{fmtNum(ngAuc(ng.get(r.horizon)), 2)}</td>
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
  // src is relative to the site root (public/); fall back to data/ for older layouts
  const candidates = f.src ? [f.src, `data/${f.src}`] : [];
  const failed = srcIdx >= candidates.length;
  return (
    <figure className="night-frame">
      {failed ? (
        <div className="night-placeholder" role="img" aria-label="Image not available">Image not loaded<br /><span className="muted">{f.src ?? 'no file'}</span></div>
      ) : (
        <img src={candidates[srcIdx]} alt={`Night lights over ${f.place ?? 'the region'}, ${fmtDate(f.date)}`} onError={() => setSrcIdx((i) => i + 1)} />
      )}
      <figcaption>
        <b>{fmtDate(f.date)}</b> · {f.place}<br /><span className="muted">{f.caption}</span>
        {!f.is_baseline && f.cities && (
          <ul className="city-change">
            {Object.entries(f.cities).slice(0, 2).map(([name, c]) => isNum(c?.vs_baseline_pct) ? (
              <li key={name}>{name.split(' (')[0]}: <b>{c.vs_baseline_pct > 0 ? '+' : ''}{fmtNum(c.vs_baseline_pct, 0)}%</b> brightness vs baseline</li>
            ) : null)}
          </ul>
        )}
      </figcaption>
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
        NASA Black Marble night lights (VNP46A2) via NASA GIBS, {periodOf([frames[0]?.date, frames[frames.length - 1]?.date])}. Multi-night composites of display imagery; brightness changes are approximate.
      </SourceNote>
    </>
  );
}
