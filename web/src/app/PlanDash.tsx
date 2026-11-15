import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useData } from '../data/load';
import {
  ACTIONS, ACTION, defaultPlan, simulatePlan, optimize, digest, planDigest, monthName, monthLabel,
  type ActionId, type Constraints, type OptResult, type Plan, type SimInput,
} from '../lib/plan/sim';
import { askExplain, askPlan, type ToolCall } from '../lib/plan/chat';
import { FanChart, ShedChart, Chat, templateExplain, planLine, type Msg } from '../pages/Plan';
import {
  SOURCES, SOURCE, PLANTS, PROVINCES, PROVINCE_SHARE, defaultGeo, applySimTools, geoParse, planFromGeo, geoFromPlan, demandPct,
  type GeoState, KARIBA_CENTER,
} from './geo';
import type { GeoData, Pick, SceneState } from './globe/engine';
import { shouldUse2D } from './globe/detect';
import Map2D from './Map2D';
import { Info } from './Shell';
import '../components/plan/plan.css';

const GlobeView = lazy(() => import('./globe/GlobeView'));
const FILE = 'kariba_sim.json';
const m0 = (v: number) => Math.round(v).toLocaleString('en-US');
const m1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const usd = (v: number) => `${v < 0 ? '−' : ''}$${m0(Math.abs(v))}M`;
const SHORT: Record<ActionId, string> = { hold: 'Hold water', imports: 'Imports', rental: 'Rental thermal', demand: 'Demand cuts', solar: 'Fast solar', schedule: 'Shed schedule' };
const START_OPTS = Array.from({ length: 13 }, (_, i) => i + 1);


/** Big plain-language lines for the presenter screen. */
function headline(p: Plan, g: GeoState): string[] {
  const out: string[] = [];
  const on = (id: ActionId) => p[id].on && p[id].possible;
  if (on('hold')) out.push(`Hold the water: keep back ${p.hold.amount}% of Kariba's releases from ${monthName(p.hold.start)}`);
  if (on('imports')) { const mw = SOURCES.reduce((t, s) => t + (g.sources[s.id]?.available ? g.sources[s.id].mw : 0), 0); if (mw > 0) out.push(`Import ${m0(mw)} MW from neighbours from ${monthName(p.imports.start)}`); }
  if (on('rental')) out.push(`Rent ${p.rental.amount} MW of diesel power from ${monthName(p.rental.start)}`);
  if (on('demand')) out.push(`Cut demand ${Math.round(demandPct(g))}% from ${monthName(p.demand.start)}`);
  if (on('solar')) out.push(`Build ${p.solar.amount} MW of fast solar from ${monthName(p.solar.start)}`);
  if (on('schedule')) out.push(`Publish a load-shedding schedule from ${monthName(p.schedule.start)}`);
  if (!out.length) out.push('No action');
  return out;
}

export function useGeo() {
  const { data } = useData<GeoData>('geo/dash_geo.json');
  return data;
}

/** Stage: lazy globe, or the 2-D map when the device / settings call for it or the renderer fails. */
export function Stage({ geo, scene, onPick, fly }: { geo: GeoData | null; scene: SceneState; onPick: (p: Pick) => void; fly: { at: [number, number]; dist?: number; key: string } | null }) {
  const [why2d, setWhy2d] = useState<string | null>(() => shouldUse2D());
  const [force2d, setForce2d] = useState(false);
  const use2d = force2d || why2d !== null;
  if (!geo) return <div className="stage"><div className="globe-wait">Loading map…</div></div>;
  return (
    <div className="stage">
      {use2d ? <Map2D geo={geo} scene={scene} onPick={onPick} why={force2d ? null : why2d} />
        : (
          <Suspense fallback={<div className="globe-wait">Loading globe…</div>}>
            <GlobeView geo={geo} scene={scene} onPick={onPick} fly={fly} onFail={setWhy2d} />
          </Suspense>
        )}
      <div className="stage-tools">
        <button type="button" className="tb" aria-pressed={use2d} onClick={() => { if (why2d && !force2d) setWhy2d(null); else setForce2d(!force2d); }}>{use2d ? '3D' : '2D'}</button>
      </div>
    </div>
  );
}

function Kpi({ v, l, sub }: { v: string; l: string; sub?: string }) {
  return <div className="kpi"><span className="kpi-v">{v}</span><span className="kpi-l">{l}</span>{sub && <span className="kpi-s">{sub}</span>}</div>;
}

const isActive = (plan: Plan, id: ActionId, k: number) => {
  const s = plan[id];
  return s.on && s.possible && s.start + ACTION[id].lead <= k + 1;
};

function useBigScreen() {
  const q = '(min-width: 1100px)';
  const get = () => (typeof window !== 'undefined' && window.matchMedia(q).matches ? window.innerHeight : 0);
  const [vh, setVh] = useState(get);
  useEffect(() => { const f = () => setVh(get()); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  return vh;
}

export default function PlanDash() {
  const bigVh = useBigScreen();
  const { data: inp, loading } = useData<SimInput>(FILE);
  const geoData = useGeo();
  const [plan, setPlanRaw] = useState<Plan>(defaultPlan);
  const [geo, setGeo] = useState<GeoState>(defaultGeo);
  const [limits, setLimits] = useState<Constraints>({ budgetMusd: null, maxShedH: null, voll: 'central' });
  const [opt, setOpt] = useState<OptResult | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(9); // Sep 2027
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<Pick | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [fly, setFly] = useState<{ at: [number, number]; dist?: number; key: string } | null>({ at: KARIBA_CENTER, dist: 0.45, key: 'intro' });

  const base = useMemo(() => (inp ? simulatePlan(inp, defaultPlan()) : null), [inp]);
  const r = useMemo(() => (inp ? simulatePlan(inp, plan) : null), [inp, plan]);

  /** every plan change keeps the geo split in sync */
  const setPlan = (p: Plan) => { setPlanRaw(p); setGeo((g) => geoFromPlan(p, g)); };
  const setGeoAndPlan = (g: GeoState) => { setGeo(g); setPlanRaw((p) => planFromGeo(p, g)); };

  useEffect(() => {
    if (!playing || !r) return;
    const t = setInterval(() => setMonth((m) => { if (m >= r.months.length - 1) { setPlaying(false); return m; } return m + 1; }), 650);
    return () => clearInterval(t);
  }, [playing, r]);

  const scene: SceneState | null = useMemo(() => {
    if (!r) return null;
    const hold = isActive(plan, 'hold', month) ? plan.hold.amount : 0;
    return {
      level: r.fan.p50[month], band: [r.fan.p10[month], r.fan.p90[month]], ghost: null,
      holdPct: hold, releaseFactor: Math.max(0.15, 1 - hold / 100),
      arcs: SOURCES.map((s) => {
        const st = geo.sources[s.id];
        const on = isActive(plan, 'imports', month);
        const mw = on ? st.mw : 0;
        return { id: s.id, from: s.at, to: s.to, mw, available: st.available, label: `${s.name.split(' (')[0]}${st.available ? (mw ? ` ${mw} MW` : '') : ' ✕'}` };
      }),
      cuts: Object.fromEntries(PROVINCES.map((p) => [p, isActive(plan, 'demand', month) ? geo.cuts[p] : 0])),
      rentalMw: isActive(plan, 'rental', month) ? plan.rental.amount : 0,
      solarMw: isActive(plan, 'solar', month) ? plan.solar.amount : 0,
      pins: PLANTS.map((p) => ({ id: p.id, at: p.at, label: sel?.id === p.id ? `${p.name} ${p.mw} MW` : '', kind: 'plant' as const, mw: p.mw, dim: !p.onKariba })),
      selected: sel?.id ?? null, gauges: [],
    };
  }, [r, plan, geo, month, sel]);

  if (loading) return <div className="dash-msg">Loading the Kariba inputs…</div>;
  if (!inp || !r || !base || !scene) return <div className="dash-msg">The simulator inputs (kariba_sim.json) could not be loaded.</div>;

  const runBest = () => {
    const o = optimize(inp, plan, limits);
    setOpt(o); setPlan(o.plan);
  };

  const ask = async (text: string) => {
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const before = digest(r);
      const reply = await askPlan(text, planDigest(plan), limits);
      // dashboard layer: source/province-specific phrases become map tools; they replace a blanket "no imports"
      const gp = geoParse(text);
      let calls = reply.calls as ToolCall[];
      if (gp.replacesImportDisable) calls = calls.filter((c) => !(c.name === 'disable_action' && c.arguments?.action === 'imports') && !(c.name === 'set_action' && c.arguments?.action === 'imports'));
      if (gp.calls.some((c) => c.name === 'set_region_cut')) calls = calls.filter((c) => !(c.name === 'set_action' && c.arguments?.action === 'demand') && !(c.name === 'disable_action' && c.arguments?.action === 'demand'));
      // explicit map choices are kept unless the user asked for the best plan
      if (gp.calls.length && !/(best|cheapest|optimi|recommend|what (should|can|do)|what now)/i.test(text)) calls = calls.filter((c) => c.name !== 'run_optimizer');
      const ap = applySimTools({ plan, limits, geo }, [...calls, ...gp.calls]);
      let newPlan = ap.plan, newGeo = ap.geo;
      let o: OptResult | null = null;
      if (ap.runOptimizer) {
        o = optimize(inp, ap.plan, ap.limits);
        newPlan = o.plan; newGeo = geoFromPlan(newPlan, ap.geo);
        setOpt(o);
      }
      const r2 = simulatePlan(inp, newPlan);
      setPlanRaw(newPlan); setGeo(newGeo); setLimits(ap.limits);
      const firstSrc = gp.calls.find((c) => c.name === 'set_import_source');
      if (firstSrc) { const s = SOURCE[firstSrc.arguments.source]; setSel({ kind: 'source', id: s.id }); setFly({ at: [(s.at[0] + 28.3) / 2, (s.at[1] - 15.4) / 2], dist: 1.1, key: `q${Date.now()}` }); }
      const ex = await askExplain({
        message: text, plan: planDigest(newPlan), limits: ap.limits, results: digest(r2), before,
        optimizer: o ? { why: o.why, plans_tried: o.tried } : null,
      });
      const mdl = (reply.model ?? '').split('/').pop() ?? '';
      const via = reply.via === 'ai' ? (mdl.startsWith('claude') ? `Claude (${mdl})` : `Workers AI (${mdl})`) : 'Rule-based parser';
      setMsgs((m) => [...m, {
        role: 'assistant',
        head: headline(newPlan, newGeo),
        result: [`Lake in Sep 2027: ${m1(r2.sepP50)}%`, `Extra blackout: ${m1(r2.peakShedMean)} h/day`, `Cost: ${usd(r2.actionCost.total)}`],
        text: ex.text ?? templateExplain(r2, newPlan, ap.changes, o),
        changes: ap.changes.length ? ap.changes : (o ? [] : ['No change understood. Try naming an action or a neighbour: imports from Mozambique, rental, Copperbelt mines, hold water, solar.']),
        via: `${via}${ex.text ? ' · numbers checked against the simulator' : ' · template explanation'}`,
        note: reply.note,
      }]);
    } finally {
      setBusy(false);
    }
  };

  const onPick = (p: Pick) => {
    setSel(p);
    if (p.kind === 'lake') setSel({ kind: 'plant', id: 'kariba_n' });
  };

  const upd = (id: ActionId, patch: Partial<Plan[ActionId]>) => setPlan({ ...plan, [id]: { ...plan[id], ...patch } });
  const setSrc = (id: string, patch: Partial<GeoState['sources'][string]>) => setGeoAndPlan({ ...geo, sources: { ...geo.sources, [id]: { ...geo.sources[id], ...patch } } });
  const setCut = (p: string, v: number) => setGeoAndPlan({ ...geo, cuts: { ...geo.cuts, [p]: v } });

  const inspector = (() => {
    if (!sel) return <p className="insp-empty">Click a neighbour, province or plant on the globe.</p>;
    if (sel.kind === 'source') {
      const s = SOURCE[sel.id], st = geo.sources[sel.id];
      return (
        <>
          <div className="insp-h">{s.name}</div>
          {s.cap > 0 ? (
            <div className="row">
              <label className="sw"><input type="checkbox" checked={st.available} onChange={(e) => setSrc(s.id, { available: e.target.checked, mw: e.target.checked ? st.mw : 0 })} />available</label>
              <input aria-label={`Import from ${s.name}, MW`} type="range" min={0} max={s.cap} step={25} value={st.mw} disabled={!st.available} onChange={(e) => setSrc(s.id, { mw: +e.target.value })} />
              <output>{st.mw} MW</output>
            </div>
          ) : <p className="insp-n">No line in service: 0 MW.</p>}
          <p className="insp-n">{s.note}</p>
        </>
      );
    }
    if (sel.kind === 'province') {
      const c = geo.cuts[sel.id] ?? 0;
      return (
        <>
          <div className="insp-h">{sel.id} Province</div>
          <div className="row">
            <span className="lab">Demand cut</span>
            <input aria-label={`Demand cut in ${sel.id}, percent`} type="range" min={0} max={30} step={5} value={c} onChange={(e) => setCut(sel.id, +e.target.value)} />
            <output>{c}%</output>
          </div>
          <p className="insp-n">{Math.round(PROVINCE_SHARE[sel.id] * 100)}% of sheddable load. National effect: {m1(PROVINCE_SHARE[sel.id] * c)}% of 1,520 MW.</p>
        </>
      );
    }
    const p = PLANTS.find((x) => x.id === sel.id);
    if (!p) return null;
    return (
      <>
        <div className="insp-h">{p.onKariba ? 'Kariba Dam (North + South Bank)' : p.name}</div>
        {p.onKariba ? (
          <div className="row">
            <span className="lab">Hold water</span>
            <input aria-label="Cut Kariba releases, percent" type="range" min={0} max={50} step={5} value={plan.hold.on ? plan.hold.amount : 0} disabled={!plan.hold.possible} onChange={(e) => upd('hold', { amount: +e.target.value, on: +e.target.value > 0 })} />
            <output>{plan.hold.on ? plan.hold.amount : 0}%</output>
          </div>
        ) : null}
        <p className="insp-n">{p.onKariba ? 'North Bank 930 MW (GPPD WRI1000021) · South Bank 750 MW (GPPD GEODB0003803).' : `${p.mw} MW · ${p.src}`}</p>
        <p className="insp-n">Lake {monthName(month + 1)}: {m1(r.fan.p50[month])}% usable (P10–P90 {m1(r.fan.p10[month])}–{m1(r.fan.p90[month])}%).</p>
      </>
    );
  })();

  return (
    <div className={`dash ${chatOpen ? 'chat-open' : ''}`}>
      <section className="dash-left" aria-label="Results">
        <div className="kpis">
          <Kpi v={`${m1(r.sepP50)}%`} l="Lake, Sep 2027" sub={`P10 ${m1(r.sepP10)}% · no action ${m1(base.sepP50)}%`} />
          <Kpi v={`${m1(r.peakShedMean)} h`} l="Peak extra shedding /day" sub={`P90 ${m1(r.peakShedP90)} h`} />
          <Kpi v={`${m0(r.unservedGwhMean)}`} l="Unserved GWh (mean)" sub={`no action ${m0(base.unservedGwhMean)}`} />
          <Kpi v={usd(r.actionCost.total)} l="Cost of plan" sub={`total at VoLL $0.39: ${usd(r.total.voll)}`} />
        </div>
        <div className="card">
          <div className="card-h">Lake Kariba water, % usable <Info label="Storage chart">Month-end usable storage over {r.years.length} El Niño years ({r.years.join(', ')}), from the latest G-REALM satellite level ({inp.start.usable_pct.toFixed(1)}% on {inp.start.date}). Dashed: no action median. Lines: 20% warning, 10% danger.</Info></div>
          <FanChart r={r} base={base} inp={inp} h={bigVh ? Math.max(200, Math.round((bigVh - 260) * 0.55)) : 200} mark={month} />
        </div>
        <div className="card">
          <div className="card-h">Extra blackout, hours a day <Info label="Shedding chart">Unserved MW ÷ 1,520 MW sheddable load × 24 (calibrated on Zambia, 31 Jul 2024). Extra beyond what the 23 BCM allocation already implies; Zambia (ZESCO) only.</Info></div>
          <ShedChart r={r} h={bigVh ? Math.max(150, Math.round((bigVh - 260) * 0.33)) : 150} mark={month} />
        </div>
      </section>

      <section className="dash-stage" aria-label="Globe">
        <Stage geo={geoData} scene={scene} onPick={onPick} fly={fly} />
        <div className="stage-kpis">
          <div><b>{m1(r.sepP50)}%</b><span>Lake, Sep 2027</span></div>
          <div><b>{m1(r.peakShedMean)} h</b><span>Blackout h/day</span></div>
          <div><b>{usd(r.actionCost.total)}</b><span>Cost</span></div>
        </div>
        <div className="stage-bar">
          <button type="button" className="tb" onClick={() => { if (month >= r.months.length - 1) setMonth(0); setPlaying(!playing); }} aria-label={playing ? 'Pause' : 'Play months'}>{playing ? '❚❚' : '▶'}</button>
          <input type="range" min={0} max={r.months.length - 1} value={month} onChange={(e) => { setPlaying(false); setMonth(+e.target.value); }} aria-label="Month" />
          <span className="stage-month">{monthLabel(r.months[month])} · {m1(r.fan.p50[month])}% <span className="muted">({m1(r.fan.p10[month])}–{m1(r.fan.p90[month])})</span></span>
          <button type="button" className="tb" onClick={() => setFly({ at: KARIBA_CENTER, dist: 0.45, key: `k${Date.now()}` })}>Kariba</button>
          <button type="button" className="tb" onClick={() => setFly({ at: [27, -18], dist: 2.6, key: `s${Date.now()}` })}>SAPP</button>
          <a className="tb" href="#/app/replay">Replay 2023–24</a>
        </div>
        <div className="insp" aria-live="polite">{inspector}</div>
      </section>

      <aside className="dash-chat" aria-label="Assistant">
        <button type="button" className="chat-close tb" onClick={() => setChatOpen(false)}>Close</button>
        <Chat onAsk={ask} msgs={msgs} busy={busy} />
      </aside>
      <button type="button" className="chat-fab" onClick={() => setChatOpen(true)}>Ask the simulator</button>

      <section className="dock" aria-label="Plan parameters">
        {ACTIONS.map((a) => {
          const s = plan[a.id];
          const on = s.on && s.possible;
          return (
            <div key={a.id} className={`dk ${on ? 'is-on' : ''} ${!s.possible ? 'is-off' : ''}`}>
              <div className="dk-h">
                <label className="sw"><input type="checkbox" checked={on} disabled={!s.possible} onChange={(e) => upd(a.id, { on: e.target.checked })} />{SHORT[a.id]}</label>
                <Info label={a.title}><b>Lead time.</b> {a.leadText} <b>Cost.</b> {a.costText}</Info>
              </div>
              {a.id === 'imports' ? (
                <div className="dk-src">
                  {SOURCES.filter((x) => x.cap > 0).map((x) => (
                    <label key={x.id} className={geo.sources[x.id].available ? '' : 'is-off'} title={x.note}>
                      <span>{x.iso3}</span>
                      <input type="number" min={0} max={x.cap} step={25} value={geo.sources[x.id].mw} disabled={!geo.sources[x.id].available || !s.possible}
                        onChange={(e) => setSrc(x.id, { mw: Math.max(0, Math.min(x.cap, +e.target.value || 0)) })} aria-label={`${x.name} MW`} />
                    </label>
                  ))}
                </div>
              ) : a.id === 'demand' ? (
                <div className="dk-row">
                  <input type="range" min={0} max={30} step={5} value={Math.round(demandPct(geo) / 5) * 5} disabled={!s.possible} aria-label="Demand cut, all provinces"
                    onChange={(e) => setGeoAndPlan({ ...geo, cuts: Object.fromEntries(PROVINCES.map((p) => [p, +e.target.value])) })} />
                  <output>{m1(demandPct(geo))}%</output>
                </div>
              ) : a.unit ? (
                <div className="dk-row">
                  <input type="range" min={0} max={a.hardMax} step={a.step} value={s.amount} disabled={!s.possible} aria-label={`${a.title} amount`} onChange={(e) => upd(a.id, { amount: +e.target.value, on: true })} />
                  <output>{s.amount}{a.unit === '%' ? '%' : ' MW'}</output>
                </div>
              ) : <div className="dk-row"><span className="muted">on/off</span></div>}
              <div className="dk-row dk-meta">
                <select value={s.start} disabled={!s.possible} onChange={(e) => upd(a.id, { start: +e.target.value })} aria-label={`${a.title} decision month`}>
                  {START_OPTS.map((k) => <option key={k} value={k}>{monthName(k)}</option>)}
                </select>
                <span className="lead">{a.lead ? `+${a.lead} mo` : 'now'}</span>
                <label className="np"><input type="checkbox" checked={!s.possible} onChange={(e) => upd(a.id, { possible: !e.target.checked, on: e.target.checked ? false : s.on })} />n/a</label>
              </div>
            </div>
          );
        })}
        <div className="dk dk-best">
          <div className="dk-row"><label>Budget $M<input type="number" min={0} step={10} placeholder="none" value={limits.budgetMusd ?? ''} onChange={(e) => setLimits({ ...limits, budgetMusd: e.target.value === '' ? null : Math.max(0, +e.target.value) })} /></label></div>
          <div className="dk-row"><label>Shed cap h<input type="number" min={0} step={0.5} placeholder="none" value={limits.maxShedH ?? ''} onChange={(e) => setLimits({ ...limits, maxShedH: e.target.value === '' ? null : Math.max(0, +e.target.value) })} /></label></div>
          <div className="dk-row">
            <button type="button" className="btn-best" onClick={runBest}>Best plan</button>
            <button type="button" className="tb" onClick={() => { setPlan(defaultPlan()); setGeo(defaultGeo()); setOpt(null); }}>Reset</button>
          </div>
        </div>
        {opt && <p className="dock-opt"><b>Best:</b> {planLine(opt.plan)} · {usd(opt.objective)} vs {usd(limits.voll === 'macro' ? opt.baseline.total.macro : opt.baseline.total.voll)} no action · {opt.feasible}/{opt.tried} plans met limits <Info label="Why this plan"><ul className="plain">{opt.why.map((w) => <li key={w}>{w}</li>)}</ul>{opt.result.credit > 1 && <p>Includes the water credit: water left at end-2027 ({usd(opt.result.credit)} at 17 c/kWh).</p>}</Info></p>}
        <p className="dock-foot">How it works <Info label="Assumptions">
          <ul className="plain">
            <li>Simulation from past El Niño years and a simple water balance; not a guarantee.</li>
            <li>Water: S[m+1] = S[m] + net inflow of a past El Niño year − release; floor 475.5 m; start {inp.start.level_m} m on {inp.start.date}.</li>
            <li>Releases follow the ZRA plan ({inp.releases.allocation_2027_bcm} BCM for 2027); Zambia uses half.</li>
            <li>Gap dispatch: rental, solar (daytime), demand reduction, imports; the rest is shed.</li>
            <li>Prices: imports 17 c/kWh, rental $51M per 300 MW-month (ZESCO filing Jul 2024), demand reduction $93/MWh (Brazil 2021); solar priced at the import rate as a placeholder.</li>
            <li>Import caps per neighbour are indicative (only Eskom's 168 MW in Aug 2024 is sourced). Province demand split is illustrative.</li>
            <li>Globe: NASA Blue Marble / Black Marble textures (three.js examples), Natural Earth borders and rivers. Lake height and wave motion are exaggerated and illustrative; the numbers come from the simulator.</li>
          </ul>
        </Info></p>
      </section>
    </div>
  );
}
