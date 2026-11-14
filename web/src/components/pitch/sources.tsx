import type { ReactNode } from 'react';

/**
 * Every number on the pitch page points at one of these sources.
 * Wording follows DESIGN.md section 12 and the fact-check in patronus-pitch/FACTS.md.
 */
export interface Source { key: string; label: string; url: string }

export const SOURCES: Source[] = [
  { key: 'scoreboard', label: 'Patronus crisis scoreboard, strictly forward back-test (data/scoreboard.json)', url: 'data/scoreboard.json' },
  { key: 'zra2023', label: 'Zambezi River Authority press statement, 28 Dec 2023: 2024 allocation cut from 30 to 16 BCM', url: 'https://www.zambezira.org/sites/default/files/Press%20Statement%20-%20Water%20allocation%20at%20Kariba%20Dam_28%20December%202023_Final.pdf' },
  { key: 'crises', label: 'Crisis dates and official warnings, with per-crisis news and agency sources (data/crises.json)', url: 'data/crises.json' },
  { key: 'bce', label: 'Banco Central del Ecuador, 2024 national accounts (15 Apr 2025), via El Universo', url: 'https://eluniverso.com/noticias/economia/apagones-cortes-de-luz-perdidas-2000-millones-en-2024-ecuador-nota/' },
  { key: 'rnz', label: 'RNZ / AFP, 26 Oct 2024: Ecuador extends power cuts to 14 hours a day', url: 'https://www.rnz.co.nz/news/top/531977/ecuador-extends-drought-induced-power-cuts-to-14-hours-a-day' },
  { key: 'wb', label: 'World Bank, Taking Stock, Aug 2023 (preliminary estimate for May-June 2023)', url: 'https://documents.worldbank.org/en/publication/documents-reports/documentdetail/099408408092319382' },
  { key: 'agbr', label: 'Agencia Brasil, Aug 2021: crisis cost estimate and new tariff flag', url: 'https://agenciabrasil.ebc.com.br/economia/noticia/2021-08/aneel-cria-nova-bandeira-tarifaria-e-conta-de-luz-fica-mais-cara' },
  { key: 'mme', label: 'Brazil Ministry of Mines and Energy / CREG release, 31 Aug 2021', url: 'https://www.gov.br/mme/pt-br/assuntos/noticias/anexo-1-release-5a-reuniao-da-creg_31-08-2021.pdf' },
  { key: 'imf', label: 'IMF press release 24/413, 11 Nov 2024 (Zambia)', url: 'https://www.imf.org/en/news/articles/2024/11/11/pr-24413-zambia-imf-reaches-agreement-on-4th-review-of-ecf' },
  { key: 'crisis24', label: 'Crisis24 (GardaWorld), Oct 2024: Zambia rolling power cuts (news report)', url: 'https://crisis24.garda.com/alerts/2024/10/zambia-utility-likely-to-maintain-prolonged-rolling-power-cuts-through-late-november-update-8' },
  { key: 'yicai', label: 'Yicai Global, Aug 2022: Sichuan rations power as drought halves hydropower output', url: 'https://www.yicaiglobal.com/news/china-sichuan-province-rations-power-as-record-heat-drought-halves-hydropower-output' },
  { key: 'kariba', label: 'Patronus Kariba forecast, issued 15 Nov 2026 (data/kariba.json)', url: 'data/kariba.json' },
  { key: 'zra2027', label: 'Green Building Africa, 18 Oct 2026: ZRA cuts the 2027 Kariba allocation from 36 to 23 BCM', url: 'https://www.greenbuildingafrica.co.za/zambezi-river-authority-cuts-kariba-water-allocation-for-2027-power-generation/' },
  { key: 'cpc', label: 'NOAA Climate Prediction Center, ENSO Diagnostic Discussion, 12 Nov 2026 (data/enso.json)', url: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml' },
  { key: 'watchlist', label: 'Patronus watchlist, experimental country model, issued 15 Nov 2026 (data/watchlist.json)', url: 'data/watchlist.json' },
  { key: 'design', label: 'Patronus DESIGN.md, section 12: results of the 14 Nov 2026 build', url: 'https://github.com/danfirsten/patronus/blob/main/DESIGN.md' },
  { key: 'ledger', label: 'Patronus public ledger: SHA-256 of each data file, stamped with OpenTimestamps (data/ledger.json)', url: 'data/ledger.json' },
];

export const fnNum = (key: string) => SOURCES.findIndex((s) => s.key === key) + 1;

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Superscript footnote: hover shows the source, click jumps to the source list. */
export function Fn({ k }: { k: string }) {
  const n = fnNum(k);
  const s = SOURCES[n - 1];
  if (!s) return null;
  return (
    <sup className="pt-fn">
      <button type="button" title={s.label} aria-label={`Source ${n}: ${s.label}`} onClick={() => jump(`pt-src-${n}`)}>{n}</button>
    </sup>
  );
}

export function Sources({ children }: { children?: ReactNode }) {
  return (
    <section className="pt-section pt-sources" aria-labelledby="pt-sources-h">
      <div className="pt-wrap">
        <h2 id="pt-sources-h" className="pt-h3">Sources</h2>
        {children}
        <ol>
          {SOURCES.map((s, i) => (
            <li key={s.key} id={`pt-src-${i + 1}`}>
              <a href={s.url} target={s.url.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{s.label}</a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
