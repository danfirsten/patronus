import { useEffect, useMemo, useState } from 'react';
import { scaleLinear, scalePoint } from 'd3-scale';
import { line } from 'd3-shape';
import { useData } from '../data/load';
import { useWidth } from '../components/common';
import { Stage, useGeo } from './PlanDash';
import { Info } from './Shell';
import { PLANTS, KARIBA_CENTER } from './geo';
import type { Pick, SceneState } from './globe/engine';

interface HistM { month: string; usable_pct: number | null; level_m?: number }
interface Kariba { history_monthly: HistM[]; crisis_2024_facts: any }
interface CF { label: string; storage_act_jul_2023: Record<string, { actual_pct: number; cf_pct: number }>; hours_actual: Record<string, number>; hours_act_jul_2023: Record<string, number>; hours_actual_sources: Record<string, string>; max_h: Record<string, number> }
interface Frame { id: string; region: string; date: string; src: string; caption: string; cities?: Record<string, { vs_baseline_pct: number }> }
interface Res { id: string; name: string; lat: number; lon: number; iso3: string; history: { month: string; level_m: number | null; percentile: number | null }[] }
interface Crisis { id: string; name: string; reservoir_id: string; alarm: string | null; official_warning: string | null; official_warning_what?: string; onset: string | null; onset_what?: string; lead_months: number | null; outcome: string }

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ml = (m: string) => `${MN[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;
const addM = (m: string, k: number) => { const y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + k; return `${y + Math.floor(mo / 12)}-${String(((mo % 12) + 12) % 12 + 1).padStart(2, '0')}`; };
const range = (a: string, b: string) => { const o: string[] = []; for (let m = a; m <= b; m = addM(m, 1)) o.push(m); return o; };

interface Ev { month: string; text: string; kind: 'alarm' | 'official' | 'impact' }
const KARIBA_EVENTS: Ev[] = [
  { month: '2023-07', text: 'Patronus alarm (back-test, issued from data up to Jul 2023)', kind: 'alarm' },
  { month: '2023-12', text: 'ZRA cuts the 2024 allocation to 16 BCM (28 Dec 2023)', kind: 'official' },
  { month: '2024-03', text: 'Load-shedding starts, 8 h/day (11 Mar 2024)', kind: 'impact' },
  { month: '2024-05', text: 'Load-shedding 12 h/day (20 May 2024)', kind: 'impact' },
  { month: '2024-09', text: '20+ h/day; Kariba North halted (~14 Sep 2024)', kind: 'impact' },
  { month: '2024-12', text: 'Low point: 475.91 m, 2.89% usable (11 Dec 2024, ZRA)', kind: 'impact' },
];

function Lines({ months, series, mark, h = 160, unit, events }: {
  months: string[]; series: { name: string; v: (number | null)[]; cls: string }[]; mark: number; h?: number; unit: string; events?: Ev[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>(400);
  const m = { t: 10, r: 10, b: 22, l: 34 };
  const x = scalePoint<string>().domain(months).range([m.l, width - m.r]);
  const all = series.flatMap((s) => s.v.filter((v): v is number => v !== null));
  const y = scaleLinear().domain([0, Math.max(10, ...all) * 1.08]).nice().range([h - m.b, m.t]);
  const step = Math.ceil(months.length / (width < 360 ? 4 : 7));
  return (
    <div ref={ref} className="chart plan-chart">
      <svg width={width} height={h} role="img" aria-label={series.map((s) => s.name).join(' vs ')}>
        {y.ticks(4).map((v) => <g key={v}><line x1={m.l} x2={width - m.r} y1={y(v)} y2={y(v)} className="grid" /><text x={m.l - 5} y={y(v) + 3} textAnchor="end" className="tick">{v}{unit}</text></g>)}
        {months.map((mo, k) => k % step === 0 && <text key={mo} x={x(mo)} y={h - 6} textAnchor="middle" className="tick">{ml(mo)}</text>)}
        {events?.map((e) => x(e.month) !== undefined && <line key={e.month + e.kind} x1={x(e.month)} x2={x(e.month)} y1={m.t} y2={h - m.b} className={`ev-line ev-${e.kind}`} />)}
        {series.map((s) => {
          const d = line<number | null>().defined((v) => v !== null).x((_, k) => x(months[k]) ?? 0).y((v) => y(v ?? 0))(s.v) ?? '';
          return <path key={s.name} d={d} className={s.cls} />;
        })}
        <line x1={x(months[mark])} x2={x(months[mark])} y1={m.t} y2={h - m.b} className="plan-mark" />
      </svg>
      <div className="legend">{series.map((s) => <span key={s.name} className="legend-item"><i className={`lg-line ${s.cls}`} />{s.name}</span>)}</div>
    </div>
  );
}

export default function Replay() {
  const geo = useGeo();
  const { data: kar } = useData<Kariba>('kariba.json');
  const { data: cf } = useData<CF>('replay/kariba_cf.json');
  const { data: nl } = useData<{ frames: Frame[] }>('nightlights.json');
  const { data: res } = useData<{ reservoirs: Res[]; crises: Crisis[] }>('reservoirs.json');
  const [caseId, setCaseId] = useState('kariba');
  const [k, setK] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ghost, setGhost] = useState(true);
  const [fly, setFly] = useState<{ at: [number, number]; dist?: number; key: string } | null>({ at: KARIBA_CENTER, dist: 0.45, key: 'intro' });

  const crisis = res?.crises.find((c) => c.id === caseId) ?? null;
  const rsv = crisis ? res?.reservoirs.find((r) => r.id === crisis.reservoir_id) ?? null : null;

  const months = useMemo(() => {
    if (crisis) {
      const a = crisis.alarm ?? crisis.onset?.slice(0, 7) ?? '2000-01';
      const on = crisis.onset?.slice(0, 7) ?? a;
      return range(addM(a < on ? a : on, -6), addM(on, 9));
    }
    return range('2023-01', '2025-03');
  }, [crisis]);
  useEffect(() => { setK(0); setPlaying(false); }, [caseId]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setK((v) => { if (v >= months.length - 1) { setPlaying(false); return v; } return v + 1; }), 600);
    return () => clearInterval(t);
  }, [playing, months.length]);

  const hist = useMemo(() => new Map((kar?.history_monthly ?? []).map((h) => [h.month, h.usable_pct])), [kar]);
  const mo = months[Math.min(k, months.length - 1)];
  const actual = months.map((m) => hist.get(m) ?? null);
  const cfS = months.map((m) => cf?.storage_act_jul_2023[m]?.cf_pct ?? null);
  const hA = months.map((m) => cf?.hours_actual[m] ?? null);
  const hC = months.map((m) => cf?.hours_act_jul_2023[m] ?? null);

  const events: Ev[] = crisis ? [
    ...(crisis.alarm ? [{ month: crisis.alarm, text: `Patronus alarm (back-test; lead ${crisis.lead_months ?? '–'} months)`, kind: 'alarm' as const }] : []),
    ...(crisis.official_warning ? [{ month: crisis.official_warning.slice(0, 7), text: `Official: ${crisis.official_warning_what ?? 'warning'} (${crisis.official_warning})`, kind: 'official' as const }] : []),
    ...(crisis.onset ? [{ month: crisis.onset.slice(0, 7), text: `Onset: ${crisis.onset_what ?? 'crisis'} (${crisis.onset})`, kind: 'impact' as const }] : []),
  ] : KARIBA_EVENTS;
  const shown = events.filter((e) => e.month <= mo);

  const rHist = useMemo(() => new Map((rsv?.history ?? []).map((h) => [h.month, h])), [rsv]);
  const pct = months.map((m) => rHist.get(m)?.percentile ?? null);
  const lvl = months.map((m) => rHist.get(m)?.level_m ?? null);

  const level = crisis ? null : (hist.get(mo) ?? null);
  const scene: SceneState = {
    level: level ?? 0, band: null, ghost: !crisis && ghost && cf?.storage_act_jul_2023[mo] ? cf.storage_act_jul_2023[mo].cf_pct : null,
    holdPct: 0, releaseFactor: crisis ? 0.5 : Math.max(0.15, Math.min(1, (level ?? 10) / 30)),
    arcs: [], cuts: {}, rentalMw: 0, solarMw: 0,
    pins: crisis ? [] : PLANTS.filter((p) => p.onKariba).map((p) => ({ id: p.id, at: p.at, label: '', kind: 'plant' as const, mw: p.mw })),
    selected: crisis ? crisis.reservoir_id : null,
    gauges: (res?.crises ?? []).map((c) => {
      const rv = res!.reservoirs.find((r) => r.id === c.reservoir_id);
      if (!rv || rv.id === 'kariba') return null;
      const v = rv.id === rsv?.id ? (rHist.get(mo)?.percentile ?? 50) : 50;
      return { id: c.id, at: [rv.lon, rv.lat] as [number, number], value: v, label: rv.id === rsv?.id ? `${rv.name} · ${rHist.get(mo)?.percentile ?? '–'}th pct` : rv.name };
    }).filter((g): g is NonNullable<typeof g> => g !== null).filter((g, i, a) => a.findIndex((x) => x.at[0] === g.at[0]) === i),
  };

  const pick = (p: Pick) => {
    if (p.kind === 'reservoir') { setCaseId(p.id); const rv = res?.reservoirs.find((r) => r.id === res.crises.find((c) => c.id === p.id)?.reservoir_id); if (rv) setFly({ at: [rv.lon, rv.lat], dist: 0.9, key: p.id }); }
    if (p.kind === 'lake' || p.kind === 'plant') setCaseId('kariba');
  };
  const choose = (id: string) => {
    setCaseId(id);
    if (id === 'kariba') setFly({ at: KARIBA_CENTER, dist: 0.45, key: `k${Date.now()}` });
    else { const c = res?.crises.find((x) => x.id === id); const rv = res?.reservoirs.find((r) => r.id === c?.reservoir_id); if (rv) setFly({ at: [rv.lon, rv.lat], dist: 0.9, key: `${id}${Date.now()}` }); }
  };

  const frame = !crisis ? (nl?.frames ?? []).filter((f) => f.region === 'zambia' && f.date.slice(0, 7) <= mo).pop() ?? null : null;
  const sorted = (res?.crises ?? []).slice().sort((a, b) => (a.onset ?? '').localeCompare(b.onset ?? ''));

  return (
    <div className="dash replay">
      <section className="dash-left" aria-label="Replay data">
        <div className="card">
          <label className="card-h" htmlFor="rp-case">Event</label>
          <select id="rp-case" value={caseId} onChange={(e) => choose(e.target.value)} className="rp-select">
            <option value="kariba">Kariba 2023–24 (Zambia / Zimbabwe)</option>
            {sorted.filter((c) => c.reservoir_id !== 'kariba').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {!crisis ? (
          <>
            <div className="kpis">
              <div className="kpi"><span className="kpi-v">{level !== null ? `${level.toFixed(1)}%` : '–'}</span><span className="kpi-l">Usable, {ml(mo)} (satellite)</span></div>
              <div className="kpi"><span className="kpi-v">{cf?.hours_actual[mo] ?? '–'}{cf?.hours_actual[mo] !== undefined ? ' h' : ''}</span><span className="kpi-l">Shedding h/day (modelled)</span></div>
              <div className="kpi is-ghost"><span className="kpi-v">{cf?.storage_act_jul_2023[mo] ? `${cf.storage_act_jul_2023[mo].cf_pct}%` : '–'}</span><span className="kpi-l">If acted Jul 2023 (model estimate)</span></div>
              <div className="kpi is-ghost"><span className="kpi-v">{cf?.hours_act_jul_2023[mo] ?? '–'}{cf?.hours_act_jul_2023[mo] !== undefined ? ' h' : ''}</span><span className="kpi-l">Shedding if acted (model estimate)</span></div>
            </div>
            <div className="card">
              <div className="card-h">Usable storage, % <Info label="Storage replay">Solid: NASA/USDA G-REALM satellite level converted with the ZRA storage curve (kariba.json). Dashed: model estimate if Zambia had acted on the Jul 2023 alarm (hold water + imports from Nov 2023), from the kariba_cf counterfactual (docs/KARIBA-CF.md). The ghost surface on the globe is the same model estimate.</Info>
                <label className="sw rp-ghost"><input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} />what if</label></div>
              <Lines months={months} mark={k} unit="%" events={events} series={[{ name: 'Measured', v: actual, cls: 'ln-a' }, ...(ghost ? [{ name: 'If acted on alarm (model estimate)', v: cfS, cls: 'ln-cf' }] : [])]} />
            </div>
            <div className="card">
              <div className="card-h">Load-shedding, h/day <Info label="Shedding replay">Actual hours as reported (ZESCO, ministry, World Bank) and interpolated where marked; "if acted" is the model estimate. Peak {cf?.max_h.actual} vs {cf?.max_h.act_jul_2023} h/day.{cf?.hours_actual_sources[mo] ? ` ${ml(mo)}: ${cf.hours_actual_sources[mo]}.` : ''}</Info></div>
              <Lines months={months} mark={k} unit="h" h={130} series={[{ name: 'Reported / modelled', v: hA, cls: 'ln-a' }, ...(ghost ? [{ name: 'If acted (model estimate)', v: hC, cls: 'ln-cf' }] : [])]} />
            </div>
          </>
        ) : (
          <div className="card">
            <div className="card-h">{rsv?.name} level, m <Info label="Reservoir replay">G-REALM satellite level (reservoirs.json, global reservoir watch). Lines: alarm (back-test), official warning, onset. The globe column is the month's level percentile for that calendar month.</Info></div>
            <Lines months={months} mark={k} unit="" events={events} series={[{ name: 'Level (m, offset)', v: lvl.map((v) => (v === null ? null : v - Math.min(...lvl.filter((x): x is number => x !== null)))), cls: 'ln-a' }]} />
            <p className="insp-n">Percentile, {ml(mo)}: {pct[k] ?? '–'} · outcome: {crisis.outcome}</p>
          </div>
        )}
      </section>

      <section className="dash-stage" aria-label="Globe">
        <Stage geo={geo} scene={scene} onPick={pick} fly={fly} />
        <div className="stage-bar">
          <button type="button" className="tb" onClick={() => { if (k >= months.length - 1) setK(0); setPlaying(!playing); }} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
          <input type="range" min={0} max={months.length - 1} value={k} onChange={(e) => { setPlaying(false); setK(+e.target.value); }} aria-label="Month" />
          <span className="stage-month">{ml(mo)}</span>
          <a className="tb" href="#/app/plan">Plan 2027</a>
        </div>
        <ol className="ev-feed" aria-live="polite">
          {shown.slice(-4).map((e) => <li key={e.month + e.text} className={`ev ev-${e.kind}`}><b>{ml(e.month)}</b> {e.text}</li>)}
        </ol>
      </section>

      <aside className="dash-chat rp-side" aria-label="Night lights">
        {!crisis ? (
          <div className="card">
            <div className="card-h">Night lights, Lusaka & Copperbelt <Info label="Night lights">NASA Black Marble VNP46A2 (VIIRS Day/Night Band), per-pixel median of up to 9 nights per frame, via NASA GIBS (nightlights.json). Change is the Lusaka box vs the Feb 2023 baseline.</Info></div>
            {frame ? (
              <figure className="nl">
                <img src={frame.src} alt={`Night lights over Lusaka and the Copperbelt, ${frame.date}`} width={320} height={360} loading="lazy" />
                <figcaption><b>{frame.date}</b> · Lusaka {frame.cities?.Lusaka ? `${frame.cities.Lusaka.vs_baseline_pct > 0 ? '+' : ''}${frame.cities.Lusaka.vs_baseline_pct}% vs Feb 2023` : ''}<br /><span className="muted">{frame.caption}</span></figcaption>
              </figure>
            ) : <p className="insp-n">First frame: Feb 2023.</p>}
          </div>
        ) : <div className="card"><p className="insp-n">Night-light frames exist for Zambia and Ecuador only.</p></div>}
        <p className="dock-foot">Measured data unless marked "model estimate". {cf?.label}</p>
      </aside>
    </div>
  );
}
