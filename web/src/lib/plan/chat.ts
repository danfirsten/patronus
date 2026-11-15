import { ACTION, type ActionId, type Constraints, type Plan, MONTH_LABELS } from './sim';

/** A simulator change requested by the assistant (Workers AI tool call or the rule-based parser). */
export interface ToolCall { name: string; arguments: Record<string, any> }

const IDS: ActionId[] = ['hold', 'imports', 'rental', 'demand', 'solar', 'schedule'];

export interface ApplyOut { plan: Plan; limits: Constraints; runOptimizer: boolean; changes: string[] }

export function applyTools(plan0: Plan, lim0: Constraints, calls: ToolCall[]): ApplyOut {
  const plan: Plan = JSON.parse(JSON.stringify(plan0));
  const limits: Constraints = { ...lim0 };
  let runOptimizer = false;
  const changes: string[] = [];
  for (const c of calls) {
    const a = c.arguments ?? {};
    const id = a.action as ActionId;
    const ok = IDS.includes(id);
    const title = ok ? ACTION[id].title : '';
    switch (c.name) {
      case 'set_action': {
        if (!ok) break;
        const s = plan[id];
        if (typeof a.amount === 'number' && Number.isFinite(a.amount)) {
          s.amount = Math.max(0, Math.min(ACTION[id].hardMax, Math.round(a.amount)));
          if (s.amount > s.max) s.max = s.amount;
        }
        if (typeof a.start_month === 'string') {
          const k = MONTH_LABELS.indexOf(a.start_month);
          if (k >= 1) s.start = k;
        }
        s.on = a.on === false ? false : true;
        if (s.on) s.possible = true;
        changes.push(`${title}: ${s.on ? 'on' : 'off'}${s.on && ACTION[id].unit ? `, ${s.amount}${ACTION[id].unit === '%' ? '%' : ' MW'}` : ''}`);
        break;
      }
      case 'disable_action':
        if (!ok) break;
        plan[id].possible = false; plan[id].on = false;
        changes.push(`${title}: marked not possible`);
        break;
      case 'enable_action':
        if (!ok) break;
        plan[id].possible = true;
        changes.push(`${title}: possible again`);
        break;
      case 'set_limit':
        if (!ok || typeof a.max !== 'number') break;
        plan[id].max = Math.max(0, Math.min(ACTION[id].hardMax, a.max));
        if (plan[id].amount > plan[id].max) plan[id].amount = plan[id].max;
        changes.push(`${title}: at most ${plan[id].max}${ACTION[id].unit === '%' ? '%' : ' MW'}`);
        break;
      case 'set_budget':
        if (typeof a.musd !== 'number' || !Number.isFinite(a.musd)) break;
        limits.budgetMusd = Math.max(0, a.musd);
        changes.push(`Budget for actions: $${limits.budgetMusd}M`);
        break;
      case 'run_optimizer':
        runOptimizer = true;
        break;
    }
  }
  return { plan, limits, runOptimizer, changes };
}

/** Rule-based parser for common phrases: used when Workers AI is unavailable. */
export function ruleParse(text: string): ToolCall[] {
  const t = text.toLowerCase();
  const calls: ToolCall[] = [];
  const neg = /(can'?t|cannot|can not|no |not possible|impossible|unable|won'?t|without|unavailable|blocked)/;
  const words: [ActionId, RegExp][] = [
    ['imports', /(import|argentina|south africa|eskom|mozambique|neighbou?r|interconnect|sapp)/],
    ['rental', /(rent|diesel|barge|generator|thermal|aggreko|powership)/],
    ['demand', /(mine|mining|smelter|industr|demand|curtail|big users?)/],
    ['hold', /(hold|releas|water back|save water|conserv)/],
    ['solar', /(solar|panel|pv)/],
    ['schedule', /(schedule|rotat|load.?shed)/],
  ];
  // split into clauses so "no imports but rent 200 MW" works
  for (const clause of t.split(/,|;| but | and | so /)) {
    for (const [id, re] of words) {
      if (!re.test(clause)) continue;
      if (neg.test(clause)) { calls.push({ name: 'disable_action', arguments: { action: id } }); continue; }
      const num = clause.match(/(\d+(?:\.\d+)?)\s*(mw|%|percent)?/);
      const mon = clause.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(2026|2027)?/);
      const args: Record<string, any> = { action: id, on: true };
      if (num) args.amount = +num[1];
      if (mon) {
        const mi = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mon[1]) + 1;
        const yr = mon[2] ?? (mi === 12 ? '2026' : '2027');
        args.start_month = `${yr}-${String(mi).padStart(2, '0')}`;
      }
      if (/(turn off|switch off|stop|drop|remove)/.test(clause)) args.on = false;
      calls.push({ name: 'set_action', arguments: args });
    }
  }
  const b = t.match(/\$?\s*(\d+(?:\.\d+)?)\s*(m|million|mn|bn|billion)\b/);
  if (b && /(budget|only|afford|spend|have|money)/.test(t)) {
    calls.push({ name: 'set_budget', arguments: { musd: +b[1] * (/(bn|billion)/.test(b[2]) ? 1000 : 1) } });
  }
  if (/(what (should|can|do)|best|cheapest|optimi|recommend|now\?|what now|instead|plan)/.test(t) || calls.some((c) => c.name === 'disable_action')) {
    calls.push({ name: 'run_optimizer', arguments: {} });
  }
  return calls;
}

function coerce(c: ToolCall): ToolCall {
  const a: Record<string, any> = { ...(c.arguments ?? {}) };
  for (const k of ['amount', 'max', 'musd']) if (typeof a[k] === 'string' && a[k].trim() !== '' && !isNaN(+a[k])) a[k] = +a[k];
  if (typeof a.on === 'string') a.on = a.on !== 'false';
  return { name: c.name, arguments: a };
}

export interface PlanReply { calls: ToolCall[]; via: 'ai' | 'rules'; model?: string; note?: string }

export async function askPlan(message: string, plan: unknown, limits: unknown): Promise<PlanReply> {
  try {
    const res = await fetch('/api/plan-chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phase: 'plan', message, plan, limits }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const calls: ToolCall[] = (Array.isArray(j.tool_calls) ? j.tool_calls : []).map(coerce);
    if (calls.length) {
      // the model sometimes makes one call only: add the budget / optimizer / not-possible calls the
      // rule parser finds that the model missed
      const extra = ruleParse(message).filter((r) =>
        (r.name === 'set_budget' || r.name === 'run_optimizer' || r.name === 'disable_action') &&
        !calls.some((c) => c.name === r.name && (r.name !== 'disable_action' || c.arguments.action === r.arguments.action)));
      return { calls: [...calls, ...extra], via: 'ai', model: j.model, note: extra.length ? 'AI tool calls plus the rule parser for budget/optimizer phrases.' : undefined };
    }
    {
      const r = ruleParse(message);
      return { calls: r, via: 'rules', note: 'The AI returned no change; the rule-based parser read your sentence.' };
    }
  } catch {
    return { calls: ruleParse(message), via: 'rules', note: 'AI assistant unreachable here; used the rule-based parser.' };
  }
}

export async function askExplain(payload: Record<string, unknown>): Promise<{ text: string | null; model?: string }> {
  try {
    const res = await fetch('/api/plan-chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phase: 'explain', ...payload }),
    });
    if (!res.ok) return { text: null };
    const j = await res.json();
    return { text: typeof j.text === 'string' && j.text ? j.text : null, model: j.model };
  } catch {
    return { text: null };
  }
}
