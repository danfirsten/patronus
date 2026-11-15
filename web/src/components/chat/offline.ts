/**
 * Offline answers: used when /api/chat is unreachable or has no key. Rule-based, grounded in the
 * same tool results as the AI path, and labelled as such in the UI.
 */
import { ruleParse } from '../../lib/plan/chat';
import { getPlanBridge } from './planBridge';
import { runTool, type Loader } from './tools';
import { findCountriesInText } from './summaries';
import { loadData } from '../../data/load';

/* eslint-disable @typescript-eslint/no-explicit-any */
const f1 = (v: any) => (typeof v === 'number' ? (Math.round(v * 10) / 10).toString() : 'n/a');
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mon = (m: string) => (m && /^\d{4}-\d{2}/.test(m) ? `${MN[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : m);

export interface OfflineAnswer { text: string; sources: string[]; changes?: string[] }

function planText(r: any): string {
  const a = r.results_after ?? r.results;
  if (!a) return r.error ?? 'The simulator is not ready.';
  const parts = [];
  parts.push(`By Sep 2027 the lake is most likely at ${f1(a.sep_2027_storage_pct_p50)}% usable (${f1(a.sep_2027_storage_pct_p10)}% in the driest 1 in 10 years).`);
  parts.push(`Extra load-shedding peaks at ${f1(a.peak_shedding_h_per_day_avg)} h/day on average; actions cost about $${a.action_cost_musd}M and the expected total is $${a.total_cost_musd_voll_1}M at $1/kWh.`);
  if (r.optimizer?.why?.length) parts.push(r.optimizer.why[0]);
  parts.push('This is a simulation over past El Niño years, not a forecast.');
  return parts.join(' ');
}

function karibaText(k: any): string {
  const d = k.dec_2027;
  return `Lake Kariba was at ${f1(k.latest?.usable_pct)}% usable on ${k.latest?.date} (satellite). For Dec 2027 our median is ${f1(d?.usable_pct_p50)}% usable, with a ${f1(d?.chance_below_danger_pct)}% chance of falling below the ${k.thresholds?.danger_usable_pct}% danger line; ZRA projects ${k.zra_projection?.end_2027_usable_pct}%. These are probabilities, not certainties.`;
}

function countryText(c: any): string {
  const parts = [`${c.name} gets ${c.hydro_share_pct ?? 'n/a'}% of its electricity from hydropower (${c.data_year ?? 'latest year'}).`];
  if (c.six_month_forecast) parts.push(`Our experimental 6-month model gives a ${f1(c.six_month_forecast.chance_any_shortfall_6m_pct)}% chance of a shortfall (risk level: ${c.six_month_forecast.risk_level}${c.six_month_forecast.alarm ? ', on alarm' : ''}).`);
  if (c.kariba) parts.push(`It is forecast through Lake Kariba: median ${f1(c.kariba.dec_2027?.usable_pct_p50)}% usable in Dec 2027, ${f1(c.kariba.dec_2027?.chance_below_danger_pct)}% chance below the danger line.`);
  if (c.enso) parts.push(`El Niño exposure: ${String(c.enso.exposure).replace(/_/g, ' ')}${c.enso.el_nino_effect_pct != null ? ` (${c.enso.el_nino_effect_pct}% effect, p=${c.enso.el_nino_p})` : ''}.`);
  if (c.six_month_forecast_note && !c.kariba) parts.push(c.six_month_forecast_note);
  return parts.join(' ');
}

export async function offlineAnswer(text: string, opts: { page: string; load?: Loader } = { page: '' }): Promise<OfflineAnswer> {
  const t = text.toLowerCase();
  const load = opts.load ?? ((f: string) => loadData<any>(f));
  const bridge = getPlanBridge();
  if (bridge) {
    const calls = ruleParse(text);
    if (calls.length) {
      const r = bridge.apply(calls);
      return { text: planText(r), sources: ['Plan simulator (kariba_sim.json)'], changes: (r as any).changes };
    }
    if (/(plan|current|now|result|cost)/.test(t) && !/(country|enso|everything|overall)/.test(t)) {
      return { text: planText(bridge.snapshot()), sources: ['Plan simulator (kariba_sim.json)'] };
    }
  }
  const countries = (await load('countries.json')).data;
  const found = findCountriesInText(text, countries);
  if (found.length && !/kariba/.test(t)) {
    const c = await runTool('get_country', { country: found[0].iso3 }, load);
    if (!c.error) return { text: countryText(c), sources: ['countries.json', 'watchlist.json', 'enso.json', 'kariba.json'].filter((s) => s !== 'kariba.json' || !!c.kariba) };
  }
  if (/(kariba|lake|zambezi|2027)/.test(t)) {
    const k = await runTool('get_kariba_forecast', {}, load);
    if (!k.error) return { text: karibaText(k), sources: ['kariba.json'] };
  }
  if (/(el ni|enso|la ni)/.test(t)) {
    const e: any = await runTool('get_enso_exposure', {}, load);
    return { text: `${e.outlook?.status ?? 'ENSO status unknown'}: ${e.outlook?.summary ?? ''} ${e.gw_el_nino_losers} GW of hydropower sits in ${e.n_el_nino_losers} grids that lose under El Niño.`.trim(), sources: ['enso.json'] };
  }
  if (/(scoreboard|track record|caught|miss|backtest|skill|proof)/.test(t)) {
    const s: any = await runTool('get_scoreboard', {}, load);
    return { text: `${s.headline} Across ${s.reservoir_backtest?.crises_scored} reservoir crises the reservoir watch caught ${s.reservoir_backtest?.caught} and missed ${s.reservoir_backtest?.missed}.`, sources: ['scoreboard.json', 'reservoirs.json'] };
  }
  if (/(watchlist|alarm|which countries|at risk)/.test(t)) {
    const w: any = await runTool('get_watchlist', {}, load);
    return { text: `On alarm in the 6-month watchlist (issued ${w.issued}): ${w.on_alarm.join(', ') || 'none'}. The country monthly model is experimental and has little skill.`, sources: ['watchlist.json'] };
  }
  if (/(drying|trend|grace|groundwater|storage)/.test(t)) {
    const tr: any = await runTool('get_drying_trends', {}, load);
    return { text: tr.headline ?? 'No trend summary available.', sources: ['trends.json'] };
  }
  if (/(what did|actions|remediation|respond|did they do)/.test(t)) {
    const a: any = await runTool('get_crisis_actions', { crisis_id: 'kariba-2024' }, load);
    const acts = (a.entries ?? []).filter((e: any) => e.type === 'action').slice(0, 3).map((e: any) => `${mon(e.date)}: ${e.text}`);
    return { text: `In the Kariba 2024 crisis: ${acts.join('; ')}.`, sources: ['crisis_actions.json'] };
  }
  const o: any = await runTool('get_overview', {}, load);
  if (o.error) return { text: 'The assistant is offline and the data could not be loaded.', sources: [] };
  return {
    text: `${karibaText(o.kariba)} ENSO: ${o.enso_outlook?.status ?? 'n/a'}. On alarm in the 6-month watchlist: ${o.watchlist.on_alarm.join(', ') || 'none'}.`,
    sources: ['kariba.json', 'enso.json', 'watchlist.json'],
  };
}
