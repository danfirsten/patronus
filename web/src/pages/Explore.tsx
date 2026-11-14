import { useEffect, useMemo, useRef, useState } from 'react';
import { loadData, useData } from '../data/load';
import { Loading } from '../components/common';
import { LocatorMap } from '../components/explore/LocatorMap';
import { TrendChart } from '../components/explore/TrendChart';
import { trendStats, fmtP, MIN_POINTS, type TrendResult } from '../components/explore/stats';
import { absRateText, ciText, rateText, testName, verdict } from '../components/explore/describe';
import { DEMOS, type ExState } from '../components/explore/demos';
import { TYPE_LABEL, type ExIndex, type ExRegion, type ExSeries, type ExVariable, type RegionType } from '../components/explore/types';
import { fmtMonth, fmtNum } from '../lib/format';

const DEFAULT: Omit<ExState, 'from' | 'to'> = { r: 'b4040794730', v: 'tws', c: null, ds: true, hr: true };
const YM = /^\d{4}-\d{2}$/;

function readHash(): Partial<ExState> {
  const q = window.location.hash.split('?')[1];
  if (!q) return {};
  const p = new URLSearchParams(q);
  const out: Partial<ExState> = {};
  if (p.get('r')) out.r = p.get('r')!;
  if (p.get('v')) out.v = p.get('v')!;
  if (p.has('c')) out.c = p.get('c') || null;
  if (YM.test(p.get('from') ?? '')) out.from = p.get('from')!;
  if (YM.test(p.get('to') ?? '')) out.to = p.get('to')!;
  if (p.has('ds')) out.ds = p.get('ds') !== '0';
  if (p.has('hr')) out.hr = p.get('hr') !== '0';
  return out;
}

function writeHash(s: ExState) {
  const p = new URLSearchParams({ r: s.r, v: s.v, from: s.from, to: s.to });
  if (s.c) p.set('c', s.c);
  if (!s.ds) p.set('ds', '0');
  if (!s.hr) p.set('hr', '0');
  const h = `#/explore?${p.toString()}`;
  // replaceState does not fire hashchange, so the router does not re-render or scroll.
  if (window.location.hash !== h) window.history.replaceState(null, '', h);
}

const maxS = (a: string, b: string) => (a > b ? a : b);
const minS = (a: string, b: string) => (a < b ? a : b);

/** The variable's default window, clipped to what this region has. */
function defaultWindow(v: ExVariable, span: [string, string] | undefined, axis: { from: string; to: string }): [string, string] {
  const s = span ?? [axis.from, axis.to];
  const from = v.default_period[0] ? maxS(v.default_period[0], s[0]) : s[0];
  const to = v.default_period[1] ? minS(v.default_period[1], s[1]) : s[1];
  return from < to ? [from, to] : [s[0], s[1]];
}

function useSeries(id: string | null) {
  const [state, setState] = useState<{ id: string | null; data: ExSeries | null; error?: string }>({ id: null, data: null });
  useEffect(() => {
    if (!id) return;
    let alive = true;
    loadData<ExSeries>(`explorer/r/${id}.json`).then((r) => {
      if (alive) setState({ id, data: r.source === 'real' ? r.data : null, error: r.source === 'real' ? undefined : r.reason });
    });
    return () => { alive = false; };
  }, [id]);
  return state.id === id ? state : { id, data: null as ExSeries | null, error: undefined, loading: true };
}

export default function Explore() {
  const idx = useData<ExIndex>('explorer/index.json');
  const glob = useData<ExSeries>('explorer/global.json');
  const enso = useData<any>('enso.json');
  const index = idx.data;

  const [st, setSt] = useState<ExState | null>(null);
  const [demo, setDemo] = useState<{ id: string; step: number } | null>(null);
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<Set<RegionType>>(new Set(['basin', 'country', 'reservoir']));
  const [info, setInfo] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const varById = useMemo(() => new Map((index?.variables ?? []).map((v) => [v.id, v])), [index]);
  const regById = useMemo(() => new Map((index?.regions ?? []).map((r) => [r.id, r])), [index]);
  const end = index?.axis.to ?? '2026-10';

  const spanOf = (r: ExRegion | undefined, vid: string): [string, string] | undefined => {
    if (vid === 'oni' && glob.data) {
      const s = glob.data.series.oni; const ms = glob.data.months;
      const a = s.findIndex((x) => x != null); let b = s.length - 1; while (b > 0 && s[b] == null) b--;
      return [ms[a], ms[b]];
    }
    return r?.span?.[vid];
  };

  // initial state: URL hash, else the default case
  useEffect(() => {
    if (!index || st) return;
    const h = readHash();
    const r = h.r && regById.has(h.r) ? h.r : DEFAULT.r;
    const avail = index.matrix[r] ?? [];
    const v = h.v && avail.includes(h.v) ? h.v : avail.includes(DEFAULT.v) ? DEFAULT.v : avail[0];
    const [f, t] = defaultWindow(varById.get(v)!, spanOf(regById.get(r), v), index.axis);
    setSt({ r, v, c: h.c && avail.includes(h.c) && h.c !== v ? h.c : null, from: h.from ?? f, to: h.to ?? t, ds: h.ds ?? true, hr: h.hr ?? true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => { if (st) writeHash(st); }, [st]);

  const region = st ? regById.get(st.r) : undefined;
  const mv = st ? varById.get(st.v) : undefined;
  const cv = st?.c ? varById.get(st.c) : undefined;
  const ser = useSeries(st?.r ?? null);

  const getSeries = (vid: string): { months: string[]; values: (number | null)[] } | null => {
    if (vid === 'oni') return glob.data ? { months: glob.data.months, values: glob.data.series.oni } : null;
    const d = ser.data;
    return d && d.series[vid] ? { months: d.months, values: d.series[vid] } : null;
  };

  const main: TrendResult | null = useMemo(() => {
    if (!st || !mv) return null;
    const s = getSeries(st.v);
    if (!s) return null;
    return trendStats(s.months, s.values, st.from, st.to, { deseason: st.ds && mv.seasonal !== false, hamedRao: st.hr });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, mv, ser.data, glob.data]);

  const cmpWin = useMemo((): [string, string] | null => {
    if (!st || !cv) return null;
    let to = st.to;
    if (cv.warning && cv.default_period[1]) to = minS(to, cv.default_period[1]);
    return [st.from, to];
  }, [st, cv]);

  const cmp: TrendResult | null = useMemo(() => {
    if (!st || !cv || !cmpWin) return null;
    const s = getSeries(cv.id);
    if (!s) return null;
    return trendStats(s.months, s.values, cmpWin[0], cmpWin[1], { deseason: st.ds && cv.seasonal !== false, hamedRao: st.hr });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, cv, cmpWin, ser.data, glob.data]);

  // ------------------------------------------------------------------ actions
  function pickRegion(id: string) {
    if (!index || !st) return;
    setDemo(null);
    const avail = index.matrix[id] ?? [];
    const v = avail.includes(st.v) ? st.v : avail.includes('tws') ? 'tws' : avail[0];
    const [from, to] = defaultWindow(varById.get(v)!, spanOf(regById.get(id), v), index.axis);
    setSt({ ...st, r: id, v, c: st.c && avail.includes(st.c) && st.c !== v ? st.c : null, from, to });
  }
  function pickVar(vid: string) {
    if (!index || !st) return;
    setDemo(null);
    const [from, to] = defaultWindow(varById.get(vid)!, spanOf(region, vid), index.axis);
    setSt({ ...st, v: vid, c: st.c === vid ? null : st.c, from, to });
    setInfo(vid);
  }
  function startDemo(id: string, step = 0) {
    const d = DEMOS.find((x) => x.id === id);
    if (!d || !st) return;
    let next = { ...st };
    for (let i = 0; i <= step; i++) next = { ...next, ...d.steps[i].set(end) };
    setSt(next);
    setDemo({ id, step });
    setInfo(next.v);
    if (step === 0) requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // ------------------------------------------------------------------ render
  if (idx.loading) return <div className="wrap page"><Loading what="the Trend Detective" /></div>;
  if (!index) return <div className="wrap page"><h1>Trend Detective</h1><p className="empty">The explorer data (data/explorer/index.json) is not available. Run <code>python3 -m pipeline.explorer</code>.</p></div>;
  if (!st || !region || !mv) return <div className="wrap page"><Loading what="the Trend Detective" /></div>;

  const avail = new Set(index.matrix[st.r] ?? []);
  const q = query.trim().toLowerCase();
  const list = index.regions
    .filter((r) => types.has(r.type))
    .filter((r) => !q || [r.name, ...(r.countries ?? []), ...(r.plants ?? []), TYPE_LABEL[r.type]].join(' ').toLowerCase().includes(q));
  const span = spanOf(region, st.v) ?? [index.axis.from, index.axis.to];
  const years: string[] = [];
  for (let y = +span[0].slice(0, 4); y <= +span[1].slice(0, 4); y++) years.push(String(y));
  const setFromYear = (y: string) => setSt({ ...st, from: maxS(`${y}-01`, span[0]) });
  const setToYear = (y: string) => setSt({ ...st, to: minS(`${y}-12`, span[1]) });
  const [defFrom, defTo] = defaultWindow(mv, span, index.axis);
  const presets: [string, string, string][] = [
    ['Recommended', defFrom, defTo],
    ['Full record', span[0], span[1]],
    ...(maxS('2002-01', span[0]) < minS('2019-12', span[1]) ? [['2002–2019', maxS('2002-01', span[0]), minS('2019-12', span[1])] as [string, string, string]] : []),
    ...(span[1] > '2002-04' ? [['GRACE era (2002 on)', maxS('2002-04', span[0]), span[1]] as [string, string, string]] : []),
  ];
  const uniqPresets: [string, string, string][] = [];
  for (const p of presets) {
    const same = uniqPresets.find((x) => x[1] === p[1] && x[2] === p[2]);
    if (same) same[0] = `${same[0]} = ${p[0].toLowerCase()}`;
    else uniqPresets.push([...p]);
  }
  const infoVar = varById.get(info ?? st.v) ?? mv;
  const ver = main ? verdict(mv, main) : null;
  const deseasonApplies = mv.seasonal !== false;
  const activeDemo = demo ? DEMOS.find((d) => d.id === demo.id) : null;
  const ctx = { main, cmp, mv, cv, enso: enso.data, end };
  const rainDrift = st.v === 'rain' && st.to > '2019-12';
  const tooShort = !main && ser.data && getSeries(st.v);

  return (
    <div className="wrap page explore">
      <p className="eyebrow">Trend Detective</p>
      <h1>Is it really changing?</h1>
      <p className="lede">
        Pick a place and an Earth-science variable measured from space. We plot its monthly record, measure how fast it is changing,
        and test whether that change is real or could just be chance. Everything is computed live in your browser.
      </p>

      {/* ---------------------------------------------------------- demos */}
      <section aria-labelledby="ex-demos" className="ex-demos">
        <h2 id="ex-demos" className="ex-h">Watch a case first</h2>
        <div className="ex-demo-grid">
          {DEMOS.map((d, i) => (
            <div key={d.id} className={`ex-demo ${demo?.id === d.id ? 'on' : ''}`}>
              <span className="step-num">Case {i + 1}</span>
              <h3>{d.title}</h3>
              <p className="small muted">{d.teaser}</p>
              <button type="button" className="ex-btn" onClick={() => startDemo(d.id)} aria-pressed={demo?.id === d.id}>
                {demo?.id === d.id ? 'Restart this case' : 'Watch this case'}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- steps */}
      <div className="ex-steps">
        <section className="panel ex-step" aria-labelledby="ex-where">
          <h2 id="ex-where" className="ex-h"><span className="ex-n">1</span> Where?</h2>
          <div className="ex-where">
            <div className="ex-where-list">
              <label htmlFor="ex-search" className="ex-label">Search regions</label>
              <input id="ex-search" type="search" className="ex-input" placeholder="Kariba, Brazil, Itaipu, IND…" value={query}
                onChange={(e) => setQuery(e.target.value)} />
              <div className="toggle small ex-types" role="group" aria-label="Region types">
                {(['basin', 'country', 'reservoir'] as RegionType[]).map((t) => (
                  <button key={t} type="button" aria-pressed={types.has(t)} className={types.has(t) ? 'on' : ''}
                    onClick={() => { const n = new Set(types); if (n.has(t) && n.size > 1) n.delete(t); else n.add(t); setTypes(n); }}>
                    {TYPE_LABEL[t]} ({index.regions.filter((r) => r.type === t).length})
                  </button>
                ))}
              </div>
              <ul className="ex-list" aria-label={`${list.length} regions`}>
                {list.map((r) => (
                  <li key={r.id}>
                    <button type="button" aria-pressed={r.id === st.r} className={r.id === st.r ? 'on' : ''} onClick={() => pickRegion(r.id)}>
                      <span className="ex-list-name">{r.name}</span>
                      <span className="ex-list-meta">{TYPE_LABEL[r.type]}{r.hydro_gw ? ` · ${fmtNum(r.hydro_gw, r.hydro_gw < 1 ? 2 : 1)} GW hydro` : ''}</span>
                    </button>
                  </li>
                ))}
                {!list.length && <li className="empty">No region matches “{query}”.</li>}
              </ul>
            </div>
            <div className="ex-where-map">
              <LocatorMap regions={list} selected={region} onPick={pickRegion} />
              <p className="ex-picked"><b>{region.name}</b> <span className="pill pill-none">{TYPE_LABEL[region.type]}</span></p>
              <p className="small muted">
                {region.hydro_gw ? `${fmtNum(region.hydro_gw, 1)} GW of hydropower. ` : ''}
                {region.area_km2 ? `${fmtNum(region.area_km2)} km². ` : ''}
                {region.plants?.length ? `Plants: ${region.plants.slice(0, 2).join(', ')}. ` : ''}
                {region.note ?? ''}
              </p>
            </div>
          </div>
        </section>

        <section className="panel ex-step" aria-labelledby="ex-what">
          <h2 id="ex-what" className="ex-h"><span className="ex-n">2</span> What?</h2>
          <div className="ex-chips" role="group" aria-label="Variable">
            {index.variables.map((v) => {
              const ok = avail.has(v.id);
              return (
                <span key={v.id} className={`ex-chip ${st.v === v.id ? 'on' : ''}`}>
                  <button type="button" className="ex-chip-main" disabled={!ok} aria-pressed={st.v === v.id} onClick={() => pickVar(v.id)}
                    title={ok ? undefined : 'Not available for this region'}>
                    {v.short}{v.nasa && <span className="ex-nasa">NASA</span>}
                  </button>
                  <button type="button" className="ex-chip-i" aria-label={`What is ${v.name}?`} aria-expanded={info === v.id}
                    aria-controls="ex-def" onClick={() => setInfo(info === v.id ? st.v : v.id)}>i</button>
                </span>
              );
            })}
          </div>
          <div id="ex-def" className="ex-def" aria-live="polite">
            <p><b>{infoVar.name}.</b> {infoVar.definition}</p>
            <p className="small muted">
              Units: {infoVar.units}. Source: {infoVar.source}{' '}
              {infoVar.nasa ? <span className="nasa-tag">NASA data</span> : <span className="pill pill-none">Not NASA</span>}
              {!avail.has(infoVar.id) && <> · <i>Not available for {region.name}.</i></>}
            </p>
            {infoVar.caveats.length > 0 && <ul className="plain small muted">{infoVar.caveats.map((c) => <li key={c}>{c}</li>)}</ul>}
          </div>
          <div className="ex-compare">
            <label htmlFor="ex-cmp" className="ex-label">Compare with (optional)</label>
            <select id="ex-cmp" className="ex-input" value={st.c ?? ''} onChange={(e) => { setDemo(null); setSt({ ...st, c: e.target.value || null }); }}>
              <option value="">Nothing</option>
              {index.variables.filter((v) => v.id !== st.v && avail.has(v.id)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <p className="small muted">A second variable on a right-hand axis helps link a trend to its cause (rain, El Niño) or its consequence (hydro output).</p>
          </div>
        </section>

        <section className="panel ex-step" aria-labelledby="ex-when">
          <h2 id="ex-when" className="ex-h"><span className="ex-n">3</span> When?</h2>
          <div className="ex-period">
            <div>
              <label htmlFor="ex-from" className="ex-label">From</label>
              <select id="ex-from" className="ex-input" value={st.from.slice(0, 4)} onChange={(e) => { setDemo(null); setFromYear(e.target.value); }}>
                {years.filter((y) => `${y}-01` < st.to).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ex-to" className="ex-label">To</label>
              <select id="ex-to" className="ex-input" value={st.to.slice(0, 4)} onChange={(e) => { setDemo(null); setToYear(e.target.value); }}>
                {years.filter((y) => `${y}-12` > st.from).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="toggle small" role="group" aria-label="Period presets">
            {uniqPresets.map(([label, f, t]) => (
              <button key={label} type="button" aria-pressed={st.from === f && st.to === t} className={st.from === f && st.to === t ? 'on' : ''}
                onClick={() => { setDemo(null); setSt({ ...st, from: f, to: t }); }}>{label}</button>
            ))}
          </div>
          <p className="small muted">{fmtMonth(st.from)} to {fmtMonth(st.to)}. This variable has data {fmtMonth(span[0])} to {fmtMonth(span[1])}.</p>
          {mv.warning && <p className="caveat small">{mv.warning}{rainDrift ? ' Your window includes those years.' : ''}</p>}
          <div className="ex-switches">
            <label className="ex-switch">
              <input type="checkbox" checked={st.ds && deseasonApplies} disabled={!deseasonApplies} onChange={(e) => setSt({ ...st, ds: e.target.checked })} />
              <span><b>Remove seasonal cycle</b><br />
                <span className="small muted">{deseasonApplies
                  ? 'Every year has wet and dry seasons; we subtract each calendar month’s usual value so only the change from year to year is left.'
                  : 'This index is already an anomaly with no seasonal cycle.'}</span></span>
            </label>
            <label className="ex-switch">
              <input type="checkbox" checked={st.hr} onChange={(e) => setSt({ ...st, hr: e.target.checked })} />
              <span><b>Correct for autocorrelation (Hamed-Rao)</b><br />
                <span className="small muted">Neighbouring months are alike (a wet month is often followed by another), so a record holds less
                  independent information than its length suggests. This correction accounts for that and makes the test harder to pass.</span></span>
            </label>
          </div>
        </section>
      </div>

      {/* ---------------------------------------------------------- results */}
      <section className="figure ex-results" aria-labelledby="ex-res" ref={resultsRef}>
        <h2 id="ex-res" className="ex-h">{mv.name} · {region.name}</h2>
        {activeDemo && demo && (
          <div className="ex-annot" role="region" aria-label="Guided case" aria-live="polite">
            <p className="step-num">Case: {activeDemo.title} · step {demo.step + 1} of {activeDemo.steps.length}</p>
            <h3>{activeDemo.steps[demo.step].title}</h3>
            <p>{activeDemo.steps[demo.step].body(ctx)}</p>
            <div className="ex-annot-nav">
              <button type="button" className="ex-btn ghost" disabled={demo.step === 0} onClick={() => startDemo(demo.id, demo.step - 1)}>Back</button>
              {demo.step < activeDemo.steps.length - 1
                ? <button type="button" className="ex-btn" onClick={() => startDemo(demo.id, demo.step + 1)}>Next step</button>
                : <button type="button" className="ex-btn" onClick={() => setDemo(null)}>Done: explore on your own</button>}
              <button type="button" className="ex-btn ghost" onClick={() => setDemo(null)}>Close</button>
            </div>
          </div>
        )}

        {!ser.data && !ser.error && <Loading what="the series" />}
        {ser.error && <p className="empty">Could not load this region's data ({ser.error}).</p>}
        {tooShort && <p className="empty">Fewer than {MIN_POINTS} months of data in this window. Choose a longer period.</p>}

        {main && ver && (
          <>
            <div className="ex-verdict" data-tone={ver.tone}>
              <p className="ex-verdict-head">{ver.head}</p>
              <p className="small">{ver.odds}</p>
            </div>
            <div className="stat-row ex-stats">
              <div className={`stat ${ver.tone !== 'none' ? 'stat-' + ver.tone : ''}`}>
                <div className="stat-value">{rateText(mv, main).split(' ')[0]}</div>
                <div className="stat-label"><b>Rate of change:</b> {rateText(mv, main).split(' ').slice(1).join(' ')}{mv.rate_mode === 'pct' ? ` (${absRateText(mv, main)})` : ''}</div>
              </div>
              <div className="stat">
                <div className="stat-value">{fmtP(main.p).replace('p ', '').replace('= ', '')}</div>
                <div className="stat-label"><b>p-value</b> ({testName(main)}). Below 0.05 counts as significant.</div>
              </div>
              <div className="stat">
                <div className="stat-value ex-ci">{ciText(mv, main)}</div>
                <div className="stat-label"><b>95% confidence interval</b> on the slope, per decade. {main.lo < 0 && main.hi > 0 ? 'It includes zero.' : 'It does not include zero.'}</div>
              </div>
            </div>
            <TrendChart main={{ v: mv, res: main, deseason: st.ds && deseasonApplies }}
              cmp={cv && cmp ? { v: cv, res: cmp, deseason: st.ds && cv.seasonal !== false } : null}
              ariaLabel={`${mv.name} in ${region.name}, ${fmtMonth(main.first)} to ${fmtMonth(main.last)}. Trend ${rateText(mv, main)}, ${fmtP(main.p)}.${cv && cmp ? ` Compared with ${cv.name}: ${rateText(cv, cmp)}, ${fmtP(cmp.p)}.` : ''}`} />
            {cv && cmp && (
              <p className="ex-cmp-line">
                <span className="ex-swatch" aria-hidden="true" /> <b>{cv.name}</b>, {fmtMonth(cmp.first)}–{fmtMonth(cmp.last)}: {rateText(cv, cmp)} ({fmtP(cmp.p)}; 95% CI {ciText(cv, cmp)}). {verdict(cv, cmp).head.split(' (')[0]}.
                {cmpWin && cv.warning && cmpWin[1] < st.to ? ` Stops at ${fmtMonth(cmpWin[1])}: ${cv.warning}` : ''}
              </p>
            )}
            {cv && !cmp && <p className="small muted">Not enough {cv.name.toLowerCase()} data in this window to compare.</p>}
            <p className="source-note">
              Source: {mv.source}{cv ? `; ${cv.source}` : ''}. {main.n} months with data from {fmtMonth(main.first)} to {fmtMonth(main.last)}
              {main.gaps > 0 ? `, ${main.gaps} missing months left as gaps (not filled)` : ', no gaps'}.
              {main.correction != null ? ` Autocorrelation correction ×${main.correction.toFixed(2)} on the variance.` : ''}
              {' '}Finding a trend that's not significant is still a finding.
            </p>
          </>
        )}
      </section>

      {/* ---------------------------------------------------------- how to read */}
      <section className="panel ex-how" aria-labelledby="ex-how">
        <h2 id="ex-how" className="ex-h">How to read this</h2>
        <dl className="ex-defs">
          <div><dt>Trend</dt><dd>A steady rise or fall underneath the ups and downs. Here we look for a straight-line trend, the simplest kind.</dd></div>
          <div><dt>Sen's slope</dt><dd>The rate of change. Take every pair of months, work out the slope between them, and pick the middle one (the median). One freak month can't drag it around, unlike an ordinary best-fit line.</dd></div>
          <div><dt>Mann-Kendall test</dt><dd>Counts how often later months are higher than earlier ones, against how often they are lower. If ups and downs balance, there is no trend. It doesn't care about the size of each change, only its direction.</dd></div>
          <div><dt>p-value</dt><dd>If there were really no trend, how likely is a pattern at least this strong by luck alone? Small p (below 0.05, or 5 in 100) means luck is an unlikely explanation, so we call the trend "significant".</dd></div>
          <div><dt>Confidence interval</dt><dd>The range the true rate of change probably lies in (95% sure). If it includes zero, "no change" can't be ruled out. It is drawn as the shaded fan around the trend line.</dd></div>
          <div><dt>Seasonal cycle</dt><dd>Rainy seasons and summers repeat every year. They hide slow trends, so we remove each month's usual value first.</dd></div>
        </dl>
        <p className="small">A significant trend tells you <i>something</i> is changing, not <i>why</i>. Use "Compare with" to test suspects, as in the cases above.</p>
        <p className="small"><a href="#/map">See every basin's trend at once on the Map</a> · <a href="#/kariba">Follow Lake Kariba month by month</a></p>
        {index.validation && (
          <details className="more">
            <summary>Check: does this page agree with our pipeline?</summary>
            <div className="small muted">
              <p>{index.validation.what}</p>
              <ul className="plain">
                {index.validation.rows.map((r) => (
                  <li key={r.basin_id}>{r.name}: here {fmtNum(r.browser_slope_cm_per_decade, 2)} cm/decade, {r.browser_p != null ? fmtP(r.browser_p) : 'p n/a'}; pipeline (trends.json) {fmtNum(r.trends_slope_cm_per_decade, 2)} cm/decade, {r.trends_p != null ? fmtP(r.trends_p) : 'p n/a'}.</li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
