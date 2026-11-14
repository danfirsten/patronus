import type { ReactNode } from 'react';
import { fmtP, type TrendResult } from './stats';
import { rateText } from './describe';
import type { ExVariable } from './types';

export interface ExState {
  r: string;
  v: string;
  c: string | null;
  from: string;
  to: string;
  ds: boolean;
  hr: boolean;
}

export interface DemoCtx {
  main: TrendResult | null;
  cmp: TrendResult | null;
  mv: ExVariable | undefined;
  cv: ExVariable | undefined;
  enso: any;
  end: string;
}

export interface DemoStep {
  title: string;
  set: (end: string) => Partial<ExState>;
  body: (c: DemoCtx) => ReactNode;
}

export interface Demo {
  id: string;
  title: string;
  teaser: string;
  steps: DemoStep[];
}

/** Live numbers only: every figure in a demo is read from the statistics on screen. */
const R = (r: TrendResult | null, v: ExVariable | undefined) =>
  r && v ? <b>{rateText(v, r)} ({fmtP(r.p)})</b> : <b>(computing…)</b>;

export const DEMOS: Demo[] = [
  {
    id: 'kariba',
    title: 'Is Lake Kariba drying out, or is it El Niño?',
    teaser: 'Lake level from radar satellites, against the El Niño index.',
    steps: [
      {
        title: 'The whole satellite record',
        set: (end) => ({ r: 'l-kariba', v: 'lake', c: null, from: '1993-01', to: end, ds: true, hr: true }),
        body: ({ main, mv }) => (
          <>Radar satellites have measured Lake Kariba's surface since 1993. Over the whole record the trend is {R(main, mv)}.
            The lake has risen and fallen by several metres, but over 30 years there is no significant long-term fall.</>
        ),
      },
      {
        title: 'Where you start matters',
        set: () => ({ from: '2002-01' }),
        body: ({ main, mv }) => (
          <>Start in 2002 instead, when the lake was near full after the wet years of 1999–2001, and the same data give {R(main, mv)}.
            A trend depends on the window, so a good detective always says which years were used.</>
        ),
      },
      {
        title: 'Add El Niño',
        set: () => ({ from: '1993-01', c: 'oni' }),
        body: ({ cmp, cv, enso }) => {
          const k = enso?.kariba;
          return (
            <>The orange line is the El Niño index (right axis). The lake's worst years, such as 2016 and 2024, came after strong El Niño peaks,
              while the index itself has no trend: {R(cmp, cv)}.
              {k && typeof k.el_nino_vs_other_m === 'number' && (
                <> Patronus tested this year by year: in the {k.n_el_nino} El Niño years since 1992 the lake's rainy-season rise was{' '}
                  <b>{Math.abs(k.el_nino_vs_other_m).toFixed(1)} m smaller</b> than in other years (permutation p = {k.el_nino_vs_other_p.toFixed(3)}).</>
              )}{' '}
              Verdict: Kariba swings with El Niño and with how much water is released; it is not on a steady slide.</>
          );
        },
      },
    ],
  },
  {
    id: 'sutlej',
    title: "North India's vanishing groundwater",
    teaser: 'GRACE weighs the water in the Sutlej basin (Nathpa Jhakri, Bhakra) while the rain goes up.',
    steps: [
      {
        title: 'Weighing the water from space',
        set: (end) => ({ r: 'b4040794730', v: 'tws', c: null, from: '2002-04', to: end, ds: true, hr: true }),
        body: ({ main, mv }) => (
          <>The GRACE satellites feel the pull of all the water in the basin that feeds the Nathpa Jhakri and Bhakra dams.
            Stored water is falling by {R(main, mv)}: one of the steepest losses of any hydropower basin on Earth.</>
        ),
      },
      {
        title: 'Is it less rain?',
        set: () => ({ c: 'rain' }),
        body: ({ cmp, cv }) => (
          <>The orange line is rainfall (GPCP, shown to 2019 because the product drifts dry after that).
            Rain went the other way: {R(cmp, cv)}.</>
        ),
      },
      {
        title: 'So it is not the rain',
        set: () => ({}),
        body: () => (
          <>More rain, yet less stored water. Something is taking water out faster than rain puts it back: most likely groundwater
            pumping for irrigation on the plains (NASA's GRACE team reported groundwater depletion in northwest India in 2009),
            and possibly shrinking Himalayan snow and ice. Comparing two variables is how a detective rules out a suspect.</>
        ),
      },
    ],
  },
  {
    id: 'ecuador',
    title: "Is Ecuador's hydro region getting drier?",
    teaser: "Ecuador had blackouts in 2023 and 2024. Rain and stored water around Coca Codo Sinclair.",
    steps: [
      {
        title: 'Rainfall',
        set: () => ({ r: 'b6040280410', v: 'rain', c: null, from: '2002-01', to: '2019-12', ds: true, hr: true }),
        body: ({ main, mv }) => (
          <>Ecuador had power cuts in 2023 and 2024 when its rivers ran low. Is the basin of its largest dam, Coca Codo Sinclair, getting drier?
            Rainfall 2002–2019: {R(main, mv)}.</>
        ),
      },
      {
        title: 'Stored water',
        set: (end) => ({ v: 'tws', c: 'rain', from: '2002-04', to: end }),
        body: ({ main, mv }) => (
          <>Total water storage from GRACE, 2002 to now: {R(main, mv)}. The 95% range of the slope includes zero.</>
        ),
      },
      {
        title: 'An honest "no"',
        set: () => ({}),
        body: () => (
          <>Neither shows a significant long-term drying. Ecuador's crises came from short, sharp dry spells, which a trend test is not built to catch.
            Finding no trend is still a finding: it tells you to look at year-to-year swings and to keep collecting data.</>
        ),
      },
    ],
  },
];
