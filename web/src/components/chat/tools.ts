/**
 * Client-side tool execution for the data chat. Tool names and schemas live on the server
 * (deploy/plan-worker/chat.js); this file runs them against web/public/data and the plan bridge.
 */
import { loadData } from '../../data/load';
import type { ToolCall } from '../../lib/plan/chat';
import { getPlanBridge } from './planBridge';
import {
  countrySummary, crisisActionsSummary, ensoSummary, karibaSummary, overviewSummary, resolveCountry,
  scoreboardSummary, sourcesSummary, trendsSummary, watchlistSummary,
} from './summaries';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Loader = (file: string) => Promise<{ data: any; source: string }>;

export const PLAN_TOOL_NAMES = ['get_plan', 'set_action', 'disable_action', 'enable_action', 'set_limit', 'set_budget', 'run_optimizer'];
export const DATA_TOOL_NAMES = ['get_overview', 'get_kariba_forecast', 'get_country', 'get_watchlist', 'get_enso_exposure', 'get_drying_trends', 'get_scoreboard', 'get_crisis_actions', 'get_sources'];

const defaultLoader: Loader = (file) => loadData<any>(file);

/** Load several files; marks the result as sample data when any came from fixtures. */
async function files(load: Loader, names: string[]) {
  const got = await Promise.all(names.map((n) => load(n)));
  const data = Object.fromEntries(names.map((n, i) => [n.replace(/\.json$/, ''), got[i].data]));
  const missing = names.filter((_, i) => got[i].data == null);
  const sample = names.filter((_, i) => got[i].source === 'fixture');
  return { data, missing, sample };
}

function tag<T extends object>(o: T, f: { missing: string[]; sample: string[] }) {
  const extra: Record<string, unknown> = {};
  if (f.missing.length) extra.missing_files = f.missing;
  if (f.sample.length) extra.sample_data_warning = `Sample fixtures, not pipeline output: ${f.sample.join(', ')}. Tell the user these are sample numbers.`;
  return { ...o, ...extra };
}

/** Run one tool. Never throws: errors come back as {error} so the model can say so. */
export async function runTool(name: string, args: Record<string, any> = {}, load: Loader = defaultLoader): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case 'get_overview': {
        const f = await files(load, ['kariba.json', 'enso.json', 'watchlist.json', 'trends.json', 'scoreboard.json', 'reservoirs.json']);
        const d = f.data;
        return tag(overviewSummary({ kariba: d.kariba, enso: d.enso, watchlist: d.watchlist, trends: d.trends, scoreboard: d.scoreboard, reservoirs: d.reservoirs }), f);
      }
      case 'get_kariba_forecast': {
        const f = await files(load, ['kariba.json']);
        if (!f.data.kariba) return { error: 'kariba.json is not available.' };
        return tag(karibaSummary(f.data.kariba), f);
      }
      case 'get_country': {
        const f = await files(load, ['countries.json', 'watchlist.json', 'enso.json', 'trends.json', 'kariba.json']);
        const ref = resolveCountry(String(args.country ?? ''), f.data.countries);
        if (!ref) return { error: `We don't track "${String(args.country ?? '').slice(0, 40)}". Patronus covers the countries in countries.json.` };
        return tag(countrySummary(ref, f.data as any), f);
      }
      case 'get_watchlist': {
        const f = await files(load, ['watchlist.json']);
        return tag(watchlistSummary(f.data.watchlist), f);
      }
      case 'get_enso_exposure': {
        const f = await files(load, ['enso.json', 'countries.json']);
        const ref = args.country ? resolveCountry(String(args.country), f.data.countries) : null;
        return tag(ensoSummary(f.data.enso, ref?.iso3), f);
      }
      case 'get_drying_trends': {
        const f = await files(load, ['trends.json', 'countries.json']);
        const ref = args.country ? resolveCountry(String(args.country), f.data.countries) : null;
        return tag(trendsSummary(f.data.trends, ref?.iso3), f);
      }
      case 'get_scoreboard': {
        const f = await files(load, ['scoreboard.json', 'reservoirs.json']);
        return tag(scoreboardSummary(f.data.scoreboard, f.data.reservoirs), f);
      }
      case 'get_crisis_actions': {
        const f = await files(load, ['crisis_actions.json']);
        if (!f.data.crisis_actions) return { error: 'crisis_actions.json is not available.' };
        return crisisActionsSummary(f.data.crisis_actions, args.crisis_id);
      }
      case 'get_sources': {
        const f = await files(load, ['meta.json']);
        return tag(sourcesSummary(f.data.meta), f);
      }
      default: {
        if (!PLAN_TOOL_NAMES.includes(name)) return { error: `Unknown tool ${name}.` };
        const b = getPlanBridge();
        if (!b) return { error: 'The plan simulator is not open. Open the Plan page (#/plan) to simulate options.' };
        if (name === 'get_plan') return b.snapshot();
        return b.apply([{ name, arguments: args } as ToolCall]);
      }
    }
  } catch (e) {
    return { error: `Tool failed: ${String(e).slice(0, 120)}` };
  }
}

/** Short label for the "Sources" line under an answer. */
export function sourceLabel(result: Record<string, unknown>): string | null {
  const s = result.source_file ?? result.source;
  return typeof s === 'string' ? s.split(' (')[0] : null;
}
