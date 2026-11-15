import { fmtNum, isNum } from '../../lib/format';
import { Tip } from './Tip';
import { Fn } from './sources';

/**
 * Plain-language units. Household comparisons are our arithmetic on EIA's figure:
 * an average U.S. residential customer bought 10,791 kWh in 2022 (EIA FAQ id=97).
 */
export const EIA_KWH_PER_HOME = 10791;
const HOURS_PER_YEAR = 8760;
const round = (v: number, to: number) => Math.round(v / to) * to;
export const HOMES_PER_TWH = round(1e9 / EIA_KWH_PER_HOME, 1000);            // about 93,000
export const HOMES_PER_GW_YEAR = round((HOURS_PER_YEAR * 1e6) / EIA_KWH_PER_HOME, 10000); // about 810,000

/** "54 gigawatts (GW)" with the size explained on hover or tap. */
export function GW({ value, digits = 0 }: { value: number; digits?: number }) {
  return (
    <Tip label={<>{fmtNum(value, digits)} gigawatts (GW)</>}>
      <b>Gigawatt (GW)</b>: a billion watts, roughly one large power station. One GW running for a whole year makes {fmtNum(HOURS_PER_YEAR / 1000, 2)} TWh, about what {fmtNum(HOMES_PER_GW_YEAR)} average US homes use in a year. Our estimate from EIA’s 2022 average of {fmtNum(EIA_KWH_PER_HOME)} kWh per home.<Fn k="eia" />
    </Tip>
  );
}

/** "1 terawatt-hour (TWh)" with the amount explained. */
export function TWh({ value, digits = 0 }: { value: number; digits?: number }) {
  return (
    <Tip label={<>{fmtNum(value, digits)} terawatt-hour{value === 1 ? '' : 's'} (TWh)</>}>
      <b>Terawatt-hour (TWh)</b>: a billion kilowatt-hours of electricity. One TWh is about a year of power for {fmtNum(HOMES_PER_TWH)} average US homes. Our estimate from EIA’s 2022 average of {fmtNum(EIA_KWH_PER_HOME)} kWh per home.<Fn k="eia" />
    </Tip>
  );
}

export function UsableStorage({ min, max, danger }: { min?: number; max?: number; danger?: number }) {
  return (
    <Tip label="usable storage">
      <b>Usable storage</b>: the share of the lake’s water that can still turn the turbines.
      {isNum(min) && isNum(max) ? <> It reads 0% at {fmtNum(min, 1)} m above sea level and 100% at {fmtNum(max, 1)} m.</> : null}
      {isNum(danger) ? <> Below {danger}%, power generation has to be cut.</> : null}<Fn k="zralevels" />
    </Tip>
  );
}

export function ElNino({ label = 'El Niño', zmbEffect }: { label?: string; zmbEffect?: number | null }) {
  return (
    <Tip label={label}>
      <b>El Niño</b>: a periodic warming of the sea surface in the central and eastern tropical Pacific, which shifts rainfall around the world.<Fn k="noaafaq" />
      {isNum(zmbEffect) && zmbEffect < 0 ? <> In Zambia’s hydro basins, El Niño years bring about {fmtNum(Math.abs(zmbEffect), 0)}% less rain.<Fn k="enso" /></> : null}
    </Tip>
  );
}
