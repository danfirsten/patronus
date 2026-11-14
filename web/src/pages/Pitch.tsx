import { useMemo } from 'react';
import { useData } from '../data/load';
import { RISK_ORDER } from '../lib/risk';
import '../components/pitch/pitch.css';
import { Sources } from '../components/pitch/sources';
import {
  Audience, CalledIt, Cost, Hero, Next, Proof,
  type Crisis, type EnsembleScore, type EnsoCpc, type KaribaLite, type LedgerLite, type ScoreRow, type Skill, type WatchRow,
} from '../components/pitch/sections';

/** Landing page as a pitch: hero, track record, cost, 2027 forecast, proof, audience. */
export default function Pitch() {
  const score = useData<any>('scoreboard.json');
  const crises = useData<any>('crises.json');
  const kariba = useData<any>('kariba.json');
  const enso = useData<any>('enso.json');
  const watch = useData<any>('watchlist.json');
  const ledger = useData<any>('ledger.json');

  const rows: ScoreRow[] | null = score.data?.rows ?? null;
  const karibaRow = rows?.find((r) => r.id === 'kariba-2024') ?? null;

  const skill: Skill | null = useMemo(() => {
    const bh: any[] = kariba.data?.backtest?.by_horizon ?? [];
    const at = (h: number) => bh.find((x) => x.horizon === h)?.warning;
    const [a, b, c] = [at(1), at(6), at(12)];
    if (!a || !b || !c) return null;
    const p = (w: any) => ({ clim: w.bss_vs_climatology, pers: w.bss_vs_persistence });
    return { h1: p(a), h6: p(b), h12: p(c) };
  }, [kariba.data]);

  const ens: EnsembleScore | null = score.data?.false_alarms?.kariba_next_model_warning?.el_nino_seasons?.ensemble ?? null;

  const led: LedgerLite | null = useMemo(() => {
    const e: any[] = ledger.data?.entries;
    if (!e) return null;
    const times = e.map((x) => x.logged_at).filter(Boolean).sort();
    return { n: e.length, loggedAt: times[times.length - 1] ?? null, ots: e.find((x) => x.ots)?.ots ?? null };
  }, [ledger.data]);

  const top: WatchRow[] | null = useMemo(() => {
    const c: WatchRow[] | undefined = watch.data?.countries;
    if (!c) return null;
    const k = (r: WatchRow) => (RISK_ORDER[r.risk_level ?? ''] ?? -1) * 10 + (r.max_p_shortfall ?? 0);
    return [...c].sort((a, b) => k(b) - k(a));
  }, [watch.data]);

  const cpc: EnsoCpc | null = enso.data?.outlook?.cpc ?? null;

  return (
    <div className="pt">
      <Hero kariba={karibaRow} />
      <CalledIt rows={rows} crises={(crises.data?.crises as Crisis[]) ?? null} summary={score.data?.summary} loading={score.loading} />
      <Cost />
      <Next kariba={(kariba.data as KaribaLite) ?? null} cpc={cpc} watch={top} loading={kariba.loading || enso.loading || watch.loading} />
      <Proof skill={skill} ens={ens} ledger={led} />
      <Audience />
      <Sources />
    </div>
  );
}
