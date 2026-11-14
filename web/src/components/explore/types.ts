export type RegionType = 'basin' | 'country' | 'reservoir';

export interface ExRegion {
  id: string;
  name: string;
  type: RegionType;
  countries: string[];
  lat: number | null;
  lon: number | null;
  hydro_gw: number | null;
  area_km2?: number | null;
  plants?: string[];
  note?: string | null;
  span?: Record<string, [string, string]>;
}

export interface ExVariable {
  id: string;
  name: string;
  short: string;
  definition: string;
  units: string;
  unit_short: string;
  rate_unit: string;
  rate_mode: 'abs' | 'pct';
  decimals: number;
  source: string;
  mission: string;
  nasa: boolean;
  global?: boolean;
  seasonal?: boolean;
  default_period: [string | null, string | null];
  caveats: string[];
  warning?: string;
}

export interface ExValidationRow {
  basin_id: string;
  region_id: string;
  name: string;
  browser_slope_cm_per_decade: number | null;
  browser_p: number | null;
  trends_slope_cm_per_decade: number | null;
  trends_p: number | null;
}

export interface ExIndex {
  generated_at?: string;
  axis: { from: string; to: string };
  counts: Record<string, number>;
  regions: ExRegion[];
  variables: ExVariable[];
  matrix: Record<string, string[]>;
  methods?: Record<string, string>;
  validation?: { what: string; rows: ExValidationRow[]; all_same_verdict: boolean; max_slope_abs_diff_cm_per_decade: number; max_p_abs_diff: number };
  notes?: string[];
}

export interface ExSeries {
  months: string[];
  series: Record<string, (number | null)[]>;
}

export const TYPE_LABEL: Record<RegionType, string> = {
  basin: 'River basin',
  country: 'Country grid',
  reservoir: 'Reservoir',
};

/** Words for the direction of change, per variable: [falling, rising]. */
export const DIRECTION: Record<string, [string, string]> = {
  tws: ['drying (losing stored water)', 'wetting (gaining stored water)'],
  rain: ['drying (less rain)', 'wetter (more rain)'],
  rain_m2: ['drying (less rain)', 'wetter (more rain)'],
  soil_root: ['drying (drier soil)', 'wetting (wetter soil)'],
  soil_top: ['drying (drier soil)', 'wetting (wetter soil)'],
  t2m: ['cooling', 'warming'],
  lake: ['falling (lake level)', 'rising (lake level)'],
  hydro: ['falling (hydro output)', 'rising (hydro output)'],
  oni: ['La Niña-ward', 'El Niño-ward'],
};

/** Does a fall in this variable mean less water? (colours the verdict: rock = less water, water = more). */
export const WATER_LIKE = new Set(['tws', 'rain', 'rain_m2', 'soil_root', 'soil_top', 'lake', 'hydro']);
