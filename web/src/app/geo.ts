/**
 * Dashboard geography + the simulator tool dispatcher shared by the chat, the globe/map and the
 * bottom dock. The simulator itself (lib/plan/sim.ts) only knows "imports MW" and "demand % of the
 * 1,520 MW sheddable load"; this file splits those across import sources and Zambian provinces.
 *
 * Honesty: plant MW from GPPD (via reservoirs.json) or operator figures; import caps are INDICATIVE
 * (only the 2024 Eskom figure is sourced); the province demand split is ILLUSTRATIVE (no sourced
 * split in the repo). Both are labelled as such in the UI.
 */
import { ACTION, type Constraints, type Plan, type Result, digest } from '../lib/plan/sim';
import { applyTools, type ToolCall } from '../lib/plan/chat';

export type LonLat = [number, number];
export const LUSAKA: LonLat = [28.29, -15.42];
export const KARIBA_DAM: LonLat = [28.7619, -16.5222];
export const KARIBA_CENTER: LonLat = [27.9, -17.05];

export interface Plant { id: string; name: string; mw: number; at: LonLat; src: string; onKariba?: boolean }
export const PLANTS: Plant[] = [
  { id: 'kariba_n', name: 'Kariba North Bank', mw: 930, at: [28.765, -16.515], src: 'GPPD WRI1000021', onKariba: true },
  { id: 'kariba_s', name: 'Kariba South Bank', mw: 750, at: [28.758, -16.53], src: 'GPPD GEODB0003803', onKariba: true },
  { id: 'kgu', name: 'Kafue Gorge Upper', mw: 990, at: [28.42, -15.81], src: 'ZESCO (operator); not modelled here' },
  { id: 'kgl', name: 'Kafue Gorge Lower', mw: 750, at: [28.52, -15.95], src: 'ZESCO (operator); not modelled here' },
  { id: 'itt', name: 'Itezhi-Tezhi', mw: 120, at: [26.03, -15.76], src: 'ZESCO (operator); not modelled here' },
];

export interface Source {
  id: string; name: string; iso3: string; at: LonLat; to: LonLat;
  cap: number; basis: 'sourced' | 'indicative' | 'none'; note: string;
}
export const SOURCES: Source[] = [
  { id: 'zaf', name: 'South Africa (Eskom)', iso3: 'ZAF', at: [28.19, -25.75], to: LUSAKA, cap: 300, basis: 'indicative',
    note: '168 MW secured from Eskom in Aug 2024 (Zambia PDU, 16 Aug 2024); 300 MW cap indicative. Wheeled via Zimbabwe/Botswana.' },
  { id: 'moz', name: 'Mozambique (HCB / EDM)', iso3: 'MOZ', at: [32.70, -15.59], to: LUSAKA, cap: 150, basis: 'indicative',
    note: 'Cahora Bassa is on the same Zambezi and was in the same drought in 2024. Cap indicative.' },
  { id: 'cod', name: 'DR Congo (SNEL)', iso3: 'COD', at: [27.48, -11.66], to: [28.21, -12.82], cap: 100, basis: 'indicative',
    note: 'Copperbelt link. Cap indicative.' },
  { id: 'nam', name: 'Namibia (NamPower)', iso3: 'NAM', at: [24.27, -17.5], to: [25.85, -17.85], cap: 150, basis: 'indicative',
    note: 'Caprivi link at Katima Mulilo. Namibia is itself a net importer; cap indicative.' },
  { id: 'bwa', name: 'Botswana (BPC)', iso3: 'BWA', at: [25.91, -24.65], to: [25.85, -17.85], cap: 50, basis: 'indicative',
    note: 'Mostly a wheeling path for Eskom power. Cap indicative.' },
  { id: 'tza', name: 'Tanzania (TANESCO)', iso3: 'TZA', at: [33.46, -8.9], to: [31.2, -10.2], cap: 0, basis: 'none',
    note: 'Zambia-Tanzania (TAZA) line not in service; 0 MW.' },
  { id: 'mwi', name: 'Malawi (ESCOM)', iso3: 'MWI', at: [33.79, -13.96], to: [32.65, -13.64], cap: 0, basis: 'none',
    note: 'Zambia-Malawi line not in service; 0 MW.' },
];
export const SOURCE = Object.fromEntries(SOURCES.map((s) => [s.id, s])) as Record<string, Source>;

/** ILLUSTRATIVE share of Zambia's sheddable load by province (no sourced split in the repo). */
export const PROVINCE_SHARE: Record<string, number> = {
  Copperbelt: 0.35, Lusaka: 0.25, 'North-Western': 0.12, Central: 0.08, Southern: 0.07,
  Eastern: 0.04, Northern: 0.03, Luapula: 0.02, Muchinga: 0.02, Western: 0.02,
};
export const PROVINCES = Object.keys(PROVINCE_SHARE);

export interface SrcState { mw: number; available: boolean }
export interface GeoState { sources: Record<string, SrcState>; cuts: Record<string, number> }

export function defaultGeo(): GeoState {
  return {
    sources: Object.fromEntries(SOURCES.map((s) => [s.id, { mw: 0, available: s.cap > 0 }])),
    cuts: Object.fromEntries(PROVINCES.map((p) => [p, 0])),
  };
}

export const availableCap = (g: GeoState) => SOURCES.reduce((a, s) => a + (g.sources[s.id].available ? s.cap : 0), 0);
export const importTotal = (g: GeoState) => SOURCES.reduce((a, s) => a + (g.sources[s.id].available ? g.sources[s.id].mw : 0), 0);
export const demandPct = (g: GeoState) => PROVINCES.reduce((a, p) => a + PROVINCE_SHARE[p] * g.cuts[p], 0);

/** Geo -> plan: imports = sum of sources, demand = share-weighted province cuts. */
export function planFromGeo(plan: Plan, g: GeoState): Plan {
  const p: Plan = JSON.parse(JSON.stringify(plan));
  const cap = Math.min(ACTION.imports.hardMax, availableCap(g));
  p.imports.max = cap;
  const imp = Math.min(cap, importTotal(g));
  p.imports.amount = imp;
  p.imports.on = imp > 0 && p.imports.possible;
  if (cap === 0) { p.imports.possible = false; p.imports.on = false; }
  const d = Math.min(ACTION.demand.hardMax, Math.round(demandPct(g) * 10) / 10);
  p.demand.amount = d;
  p.demand.on = d > 0 && p.demand.possible;
  return p;
}

/** Plan -> geo: spread an imports total over available sources in list order; demand % evenly. */
export function geoFromPlan(plan: Plan, g0: GeoState): GeoState {
  const g: GeoState = JSON.parse(JSON.stringify(g0));
  let left = plan.imports.on && plan.imports.possible ? plan.imports.amount : 0;
  if (Math.abs(left - importTotal(g)) > 0.5) {
    for (const s of SOURCES) {
      const st = g.sources[s.id];
      st.mw = st.available ? Math.min(s.cap, left) : 0;
      left -= st.mw;
    }
  }
  const d = plan.demand.on && plan.demand.possible ? plan.demand.amount : 0;
  if (Math.abs(d - demandPct(g)) > 0.15) for (const p of PROVINCES) g.cuts[p] = d;
  return g;
}

export interface SimState { plan: Plan; limits: Constraints; geo: GeoState }
export interface SimApply extends SimState { runOptimizer: boolean; changes: string[]; wantResults: boolean }

const findSource = (v: unknown) => {
  const t = String(v ?? '').toLowerCase();
  return SOURCES.find((s) => s.id === t || s.iso3.toLowerCase() === t || s.name.toLowerCase().includes(t) || t.includes(s.name.split(' (')[0].toLowerCase()));
};
const findProvince = (v: unknown) => {
  const t = String(v ?? '').toLowerCase().replace(/\s+province$/, '');
  return PROVINCES.find((p) => p.toLowerCase() === t || p.toLowerCase().replace('-', ' ') === t.replace('-', ' '));
};

/**
 * Apply simulator tool calls (see CHAT-INTERFACE.md). Superset of lib/plan/chat.ts applyTools:
 * adds set_import_source, set_region_cut, set_shedding_cap, get_results.
 */
export function applySimTools(s: SimState, calls: ToolCall[]): SimApply {
  const geo: GeoState = JSON.parse(JSON.stringify(s.geo));
  const base: ToolCall[] = [];
  const changes: string[] = [];
  let limits = { ...s.limits };
  let geoTouched = false, wantResults = false;
  for (const c of calls) {
    const a = c.arguments ?? {};
    if (c.name === 'set_import_source') {
      const src = findSource(a.source);
      if (!src) continue;
      const st = geo.sources[src.id];
      if (a.available === false) { st.available = false; st.mw = 0; changes.push(`${src.name}: not available`); }
      else {
        if (src.cap > 0) st.available = true;
        if (typeof a.mw === 'number' && Number.isFinite(a.mw)) st.mw = Math.max(0, Math.min(src.cap, Math.round(a.mw)));
        changes.push(`Import from ${src.name}: ${st.available ? `${st.mw} MW` : 'no line (0 MW)'}`);
      }
      geoTouched = true;
    } else if (c.name === 'set_region_cut') {
      const pr = findProvince(a.region);
      if (!pr || typeof a.pct !== 'number') continue;
      geo.cuts[pr] = Math.max(0, Math.min(30, a.pct));
      changes.push(`Demand cut in ${pr}: ${geo.cuts[pr]}%`);
      geoTouched = true;
    } else if (c.name === 'set_shedding_cap') {
      limits.maxShedH = typeof a.h === 'number' && Number.isFinite(a.h) ? Math.max(0, a.h) : null;
      changes.push(limits.maxShedH === null ? 'Shedding cap removed' : `Shedding cap: ${limits.maxShedH} h/day`);
    } else if (c.name === 'get_results') {
      wantResults = true;
    } else base.push(c);
  }
  // base tools first (they may toggle imports/demand), then geo overrides
  const ap = applyTools(s.plan, limits, base);
  limits = ap.limits;
  let plan = ap.plan;
  let g = geoFromPlan(plan, geo);
  if (geoTouched) { g = geo; plan = planFromGeo(plan, geo); }
  else plan = planFromGeo(plan, g);
  return { plan, limits, geo: g, runOptimizer: ap.runOptimizer, changes: [...ap.changes, ...changes], wantResults };
}

/** get_results payload: the same digest the explain phase sends, plus the geo split. */
export function getResults(r: Result, g: GeoState) {
  return { ...digest(r), imports_by_source_mw: Object.fromEntries(SOURCES.map((s) => [s.id, g.sources[s.id].available ? g.sources[s.id].mw : 0])), demand_cut_pct_by_province: g.cuts };
}

/**
 * Map-aware phrase parser (dashboard layer, runs before the chat's tool calls are applied):
 * "I can't import from South Africa", "import 200 MW from Mozambique", "cut the mines 15% in Copperbelt".
 */
export function geoParse(text: string): { calls: ToolCall[]; replacesImportDisable: boolean } {
  const t = text.toLowerCase();
  const calls: ToolCall[] = [];
  let replacesImportDisable = false;
  const neg = /(can'?t|cannot|can not|no |not possible|impossible|unable|won'?t|without|unavailable|blocked)/;
  const alias: Record<string, RegExp> = {
    zaf: /(south africa|eskom)/, moz: /(mozambique|cahora|hcb|edm)/, cod: /(congo|drc|snel)/, nam: /(namibia|nampower|caprivi)/,
    bwa: /(botswana|bpc)/, tza: /(tanzania|tanesco)/, mwi: /(malawi)/,
  };
  for (const clause of t.split(/,|;| but | and /)) {
    for (const [id, re] of Object.entries(alias)) {
      if (!re.test(clause)) continue;
      replacesImportDisable = true;
      if (neg.test(clause)) calls.push({ name: 'set_import_source', arguments: { source: id, available: false } });
      else {
        const n = clause.match(/(\d+(?:\.\d+)?)\s*mw/);
        calls.push({ name: 'set_import_source', arguments: { source: id, mw: n ? +n[1] : SOURCE[id].cap } });
      }
    }
    for (const p of PROVINCES) {
      if (!clause.includes(p.toLowerCase())) continue;
      const n = clause.match(/(\d+(?:\.\d+)?)\s*(%|percent)/);
      if (n) calls.push({ name: 'set_region_cut', arguments: { region: p, pct: +n[1] } });
    }
    const cap = clause.match(/(?:cap|limit|no more than|at most|max(?:imum)?)[^\d]*(\d+(?:\.\d+)?)\s*h/);
    if (cap) calls.push({ name: 'set_shedding_cap', arguments: { h: +cap[1] } });
  }
  return { calls, replacesImportDisable };
}
