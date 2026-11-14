// Types mirror docs/CONTRACTS.md. Everything is optional-friendly because
// pipeline files may be partial while the team is building.

export type RiskLevel = 'low' | 'watch' | 'warning' | 'danger';
export type Exposure = 'el_nino_loser' | 'la_nina_loser' | 'both' | 'neutral';

export interface Base {
  generated_at?: string;
  sources?: string[];
  notes?: string[];
  limitations?: string[];
  _fixture?: boolean;
}

export interface Source {
  id: string;
  name: string;
  provider?: string;
  nasa?: boolean;
  url?: string;
  coverage?: string;
  license?: string;
}
export interface Meta extends Base {
  issue_date?: string;
  sources?: any;
}

export interface Country {
  iso3: string;
  name: string;
  continent?: string;
  tier?: number;
  hydro_share_pct?: number | null;
  hydro_twh?: number | null;
  hydro_gw?: number | null;
  lat?: number | null;
  lon?: number | null;
  has_country_page?: boolean;
}
export interface Countries extends Base {
  countries: Country[];
}

export interface Basin {
  basin_id: string;
  name?: string | null;
  countries?: string[];
  hydro_gw?: number | null;
  n_plants?: number | null;
  centroid?: [number, number];
  tws_slope_cm_per_decade?: number | null;
  tws_p?: number | null;
  tws_q?: number | null;
  precip_slope_pct_per_decade?: number | null;
  precip_p?: number | null;
  precip_q?: number | null;
  trend_class?: 'drying' | 'wetting' | 'no_significant_trend' | string;
  series?: { months: string[]; tws_anom_cm: (number | null)[] };
}
export interface Trends extends Base {
  method?: string;
  period?: { from: string; to: string };
  summary?: {
    n_basins?: number;
    n_drying?: number;
    n_wetting?: number;
    gw_total?: number;
    gw_drying?: number;
    gw_wetting?: number;
    headline?: string;
  };
  basins: Basin[];
}

export interface EnsoCountry {
  iso3: string;
  name: string;
  variable?: string;
  el_nino_effect_pct?: number | null;
  el_nino_p?: number | null;
  la_nina_effect_pct?: number | null;
  la_nina_p?: number | null;
  n_el_nino?: number | null;
  n_la_nina?: number | null;
  record?: string;
  exposure?: Exposure | string;
  season_note?: string | null;
}
export interface Enso extends Base {
  method?: string;
  summary?: {
    gw_el_nino_losers?: number;
    gw_la_nina_losers?: number;
    n_el_nino_losers?: number;
    n_la_nina_losers?: number;
    headline?: string;
  };
  countries: EnsoCountry[];
  outlook?: {
    source?: string;
    issued?: string;
    oni_latest?: { season?: string; value?: number | null };
    status?: string;
    summary?: string;
    geos_nino34_forecast?: { season: string; value: number | null }[];
  };
  projections?: { text?: string; refs?: { title: string; url: string }[] };
}

export interface ForecastMonth {
  month: string;
  p_shortfall?: number | null;
  p_severe?: number | null;
  anomaly_p10_pct?: number | null;
  anomaly_p50_pct?: number | null;
  anomaly_p90_pct?: number | null;
}
export interface WatchRow {
  iso3: string;
  name: string;
  tier?: number;
  risk_level?: RiskLevel | string;
  max_p_shortfall?: number | null;
  months?: ForecastMonth[];
  drivers?: string[];
  enso_exposure?: string;
}
export interface Watchlist extends Base {
  issued?: string;
  first_month?: string;
  countries: WatchRow[];
}

export interface CountryPage extends Base {
  iso3: string;
  name: string;
  tier?: number;
  history?: { month: string; hydro_twh?: number | null; cf_anom_pct?: number | null; shortfall?: boolean | null; severe?: boolean | null }[];
  drivers_now?: Record<string, number | null>;
  backtest?: { issue: string; target: string; horizon: number; p_shortfall: number | null; observed_shortfall?: boolean | null }[];
  forecast?: { issued?: string; months?: ForecastMonth[] };
  analogs?: { month: string; similarity?: number | null; shortfall_next_6m?: boolean | null }[];
  costs?: {
    replacement_usd_per_kwh?: number | null;
    voll_usd_per_kwh?: number | null;
    expected_cost_next_6m_musd?: { p10?: number | null; p50?: number | null; p90?: number | null };
  };
}

export interface SkillRow {
  horizon: number;
  brier?: number | null;
  bss_vs_climatology?: number | null;
  bss_vs_persistence?: number | null;
  bss_vs_enso_only?: number | null;
  auc_pr?: number | null;
  auc_pr_climatology?: number | null;
  auc_pr_ci90?: [number, number] | null;
}
export interface GenBacktest extends Base {
  design?: string;
  n_countries?: number;
  n_country_months?: number;
  base_rate_shortfall?: number;
  by_horizon?: SkillRow[];
  reliability?: { horizon: number; bins: { p_mean: number; observed_rate: number | null; n?: number }[] }[];
  ablations?: { removed: string; horizon?: number; auc_pr?: number | null; delta_vs_full?: number | null }[];
  feature_importance?: { feature: string; gain_share: number }[];
}

export interface KaribaForecastMonth {
  month: string;
  usable_p10?: number | null;
  usable_p50?: number | null;
  usable_p90?: number | null;
  p_below_warning?: number | null;
  p_below_danger?: number | null;
}
export interface Kariba extends Base {
  thresholds?: { min_operating_m?: number; max_operating_m?: number; warning_usable_pct?: number; danger_usable_pct?: number };
  storage_curve?: { method?: string; points?: { level_m: number; usable_pct: number }[] };
  history?: { date: string; level_m?: number | null; usable_pct?: number | null }[];
  latest?: { date?: string; level_m?: number | null; usable_pct?: number | null; zra_gauge?: { date?: string; level_m?: number | null; usable_pct?: number | null } };
  backtest?: {
    design?: string;
    by_horizon?: SkillRow[];
    ablation_no_grace?: any[];
    crisis_2024?: {
      first_warning_p_gt_0_5?: string | null;
      first_danger_p_gt_0_5?: string | null;
      zra_allocation_cut?: string | null;
      load_shedding_start?: string | null;
      lead_months_vs_load_shedding?: number | null;
      lead_months_vs_zra?: number | null;
    };
  };
  forecast?: { issued?: string; months?: KaribaForecastMonth[] };
  zra_projection?: { end_2027_usable_pct?: number | null; end_2027_level_m?: number | null; allocation_2027_bcm?: number | null; cut_pct?: number | null; source_url?: string };
  enso?: { el_nino_years?: string[]; mean_level_change_el_nino_m?: number | null; mean_level_change_other_m?: number | null; p?: number | null };
  analogs?: { date: string; similarity?: number | null; what_happened?: string }[];
  cost_of_waiting?: {
    assumptions?: Record<string, number | string | null>;
    curve?: { action_month: string; expected_cost_musd_p10?: number | null; expected_cost_musd_p50?: number | null; expected_cost_musd_p90?: number | null }[];
    headline?: string;
  };
  other_reservoirs?: { name: string; country?: string; grealm_id?: string; latest_level_m?: number | null; anomaly_m?: number | null }[];
}

export interface ScoreRow {
  id: string;
  name: string;
  countries?: string[];
  enso?: string;
  official_warning?: string | null;
  onset?: string | null;
  patronus_alarm?: string | null;
  lead_months?: number | null;
  lead_vs_official_months?: number | null;
  caught_by?: 'now' | 'next' | 'both' | 'missed' | string;
  notes?: string;
}
export interface Scoreboard extends Base {
  rows: ScoreRow[];
  false_alarms?: { per_country_5yr?: number | null; definition?: string };
}

// crises.json shape is not fixed in CONTRACTS.md; this is what the web app reads (all optional).
export interface Crisis {
  id: string;
  name?: string;
  countries?: string[];
  enso?: string;
  official_warning?: string | null;
  onset?: string | null;
  what_happened?: string;
  cost_text?: string;
  sources?: ({ title?: string; url?: string } | string)[];
}
export interface Crises extends Base {
  crises?: Crisis[];
}

export interface NightFrame {
  id: string;
  place?: string;
  date?: string;
  src?: string;
  bbox?: number[];
  caption?: string;
}
export interface Nightlights extends Base {
  frames: NightFrame[];
}

export interface LedgerEntry {
  file: string;
  sha256?: string;
  logged_at?: string;
  ots?: string | null;
  verify?: string;
}
export interface Ledger extends Base {
  entries: LedgerEntry[];
}
