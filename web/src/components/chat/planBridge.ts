/**
 * Plan bridge: lets the chat read and change the simulator that a page owns (Plan.tsx, or the
 * #/app dashboard), so there is one assistant and the page's sliders move when the chat acts.
 *
 *   // in the component that owns the plan state:
 *   usePlanBridge({ inp, plan, setPlan, limits, setLimits, setOpt });
 *
 * While a bridge is registered the chat offers the plan tools (set_action, run_optimizer, ...).
 * The bridge keeps its own latest snapshot so several tool calls in one turn see each other's
 * changes before React re-renders.
 */
import { useEffect, useRef } from 'react';
import { defaultPlan, digest, optimize, planDigest, simulatePlan, type Constraints, type OptResult, type Plan, type SimInput } from '../../lib/plan/sim';
import { applyTools, type ToolCall } from '../../lib/plan/chat';

export interface PlanHost {
  inp: SimInput | null;
  plan: Plan;
  setPlan: (p: Plan) => void;
  limits: Constraints;
  setLimits: (l: Constraints) => void;
  setOpt?: (o: OptResult | null) => void;
}

export interface PlanBridge {
  /** Current plan + simulated results + baseline (numbers the assistant may quote). */
  snapshot(): Record<string, unknown>;
  /** Apply simulator tool calls (lib/plan/chat applyTools), run the optimizer if asked, push to the page. */
  apply(calls: ToolCall[]): Record<string, unknown>;
}

let current: PlanBridge | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function getPlanBridge() { return current; }
export function subscribePlanBridge(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/** Build a bridge over a state holder. Exported for tests and for hosts without React state. */
export function makePlanBridge(get: () => PlanHost, set: (patch: { plan?: Plan; limits?: Constraints; opt?: OptResult | null }) => void): PlanBridge {
  const result = (inp: SimInput, plan: Plan) => digest(simulatePlan(inp, plan));
  return {
    snapshot() {
      const h = get();
      if (!h.inp) return { error: 'The simulator inputs (kariba_sim.json) are still loading.' };
      return {
        source: 'Plan simulator (kariba_sim.json; simulation over past El Nino years, not a forecast)',
        plan: planDigest(h.plan), limits: h.limits,
        results: result(h.inp, h.plan),
        no_action_baseline: result(h.inp, defaultPlan()),
      };
    },
    apply(calls) {
      const h = get();
      if (!h.inp) return { error: 'The simulator inputs (kariba_sim.json) are still loading.' };
      const before = result(h.inp, h.plan);
      const ap = applyTools(h.plan, h.limits, calls);
      let plan = ap.plan;
      let opt: OptResult | null = null;
      if (ap.runOptimizer) { opt = optimize(h.inp, ap.plan, ap.limits); plan = opt.plan; }
      set({ plan, limits: ap.limits, ...(opt ? { opt } : {}) });
      return {
        source: 'Plan simulator (kariba_sim.json; simulation over past El Nino years, not a forecast)',
        changes: ap.changes.length ? ap.changes : (opt ? ['Optimizer run'] : ['No change understood']),
        plan: planDigest(plan), limits: ap.limits,
        results_before: before, results_after: result(h.inp, plan),
        optimizer: opt ? { why: opt.why, plans_tried: opt.tried, plans_meeting_limits: opt.feasible } : null,
      };
    },
  };
}

export function registerPlanBridge(b: PlanBridge) {
  current = b; emit();
  return () => { if (current === b) { current = null; emit(); } };
}

/** Register the page's simulator state as the chat's plan bridge while mounted. */
export function usePlanBridge(host: PlanHost) {
  const ref = useRef(host);
  // latest committed state, plus pending changes the chat made this turn
  const pending = useRef<{ plan?: Plan; limits?: Constraints }>({});
  ref.current = host;
  pending.current = {};
  const ready = !!host.inp;
  useEffect(() => {
    if (!ready) return;
    const b = makePlanBridge(
      () => ({ ...ref.current, plan: pending.current.plan ?? ref.current.plan, limits: pending.current.limits ?? ref.current.limits }),
      (patch) => {
        if (patch.plan) { pending.current.plan = patch.plan; ref.current.setPlan(patch.plan); }
        if (patch.limits) { pending.current.limits = patch.limits; ref.current.setLimits(patch.limits); }
        if (patch.opt !== undefined) ref.current.setOpt?.(patch.opt);
      },
    );
    return registerPlanBridge(b);
  }, [ready]);
}
