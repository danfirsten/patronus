import { Tip } from './Tip';

/**
 * Every number on the pitch page points at one of these sources.
 * Wording follows DESIGN.md section 12 and the fact-check in patronus-pitch/FACTS.md.
 */
export interface Source { key: string; label: string; url: string }

export const SOURCES: Source[] = [
  { key: 'scoreboard', label: 'Patronus crisis scoreboard, strictly forward back-test (data/scoreboard.json)', url: 'data/scoreboard.json' },
  { key: 'zra2023', label: 'Zambezi River Authority press statement, Dec 28, 2023: 2024 allocation cut from 30 to 16 BCM', url: 'https://www.zambezira.org/sites/default/files/Press%20Statement%20-%20Water%20allocation%20at%20Kariba%20Dam_28%20December%202023_Final.pdf' },
  { key: 'meta', label: 'Patronus data sources, providers, coverage and licences (data/meta.json)', url: 'data/meta.json' },
  { key: 'crises', label: 'Crisis dates and official warnings, with per-crisis news and agency sources (data/crises.json)', url: 'data/crises.json' },
  { key: 'bce', label: 'Banco Central del Ecuador, 2024 national accounts (Apr 15, 2025), via El Universo', url: 'https://www.eluniverso.com/noticias/economia/apagones-cortes-de-luz-perdidas-2000-millones-en-2024-ecuador-nota/' },
  { key: 'rnz', label: 'RNZ / AFP, Oct 26, 2024: Ecuador extends power cuts to 14 hours a day', url: 'https://www.rnz.co.nz/news/top/531977/ecuador-extends-drought-induced-power-cuts-to-14-hours-a-day' },
  { key: 'wb', label: 'World Bank, Taking Stock, Aug 2023 (preliminary estimate for May-June 2023)', url: 'https://documents.worldbank.org/en/publication/documents-reports/documentdetail/099408408092319382' },
  { key: 'agbr', label: 'Agência Brasil, Aug 2021: crisis cost estimate and new tariff flag', url: 'https://agenciabrasil.ebc.com.br/economia/noticia/2021-08/aneel-cria-nova-bandeira-tarifaria-e-conta-de-luz-fica-mais-cara' },
  { key: 'mme', label: 'Brazil Ministry of Mines and Energy / CREG release, Aug 31, 2021', url: 'https://www.gov.br/mme/pt-br/assuntos/noticias/anexo-1-release-5a-reuniao-da-creg_31-08-2021.pdf' },
  { key: 'imf', label: 'IMF press release 24/413, Nov 11, 2024 (Zambia)', url: 'https://www.imf.org/en/news/articles/2024/11/11/pr-24413-zambia-imf-reaches-agreement-on-4th-review-of-ecf' },
  { key: 'crisis24', label: 'Crisis24 (GardaWorld), Oct 2024: Zambia rolling power cuts (news report)', url: 'https://crisis24.garda.com/alerts/2024/10/zambia-utility-likely-to-maintain-prolonged-rolling-power-cuts-through-late-november-update-8' },
  { key: 'yicai', label: 'Yicai Global, Aug 2022: Sichuan rations power as drought halves hydropower output', url: 'https://www.yicaiglobal.com/news/china-sichuan-province-rations-power-as-record-heat-drought-halves-hydropower-output' },
  { key: 'kariba', label: 'Patronus Kariba forecast and lake history (data/kariba.json)', url: 'data/kariba.json' },
  { key: 'zralevels', label: 'Zambezi River Authority, Kariba lake levels and operating band (475.5 to 488.5 m)', url: 'https://www.zambezira.org/hydrology/lake-levels' },
  { key: 'zra2027', label: 'Green Building Africa, Oct 18, 2026: ZRA cuts the 2027 Kariba allocation from 36 to 23 BCM', url: 'https://www.greenbuildingafrica.co.za/zambezi-river-authority-cuts-kariba-water-allocation-for-2027-power-generation/' },
  { key: 'cpc', label: 'NOAA Climate Prediction Center, ENSO Diagnostic Discussion (data/enso.json)', url: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml' },
  { key: 'noaafaq', label: 'NOAA Climate Prediction Center, ENSO frequently asked questions: what El Niño is', url: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ensofaq.shtml' },
  { key: 'enso', label: 'Patronus El Niño exposure by grid, with the 1981-2019 robustness check (data/enso.json)', url: 'data/enso.json' },
  { key: 'eia', label: 'U.S. EIA, How much electricity does an American home use? 10,791 kWh per residential customer in 2022', url: 'https://www.eia.gov/tools/faqs/faq.php?id=97&t=3' },
  { key: 'watchlist', label: 'Patronus watchlist, experimental country model (data/watchlist.json)', url: 'data/watchlist.json' },
  { key: 'ledger', label: 'Patronus public ledger: SHA-256 of each data file, stamped with OpenTimestamps (data/ledger.json)', url: 'data/ledger.json' },
];

export const fnNum = (key: string) => SOURCES.findIndex((s) => s.key === key) + 1;

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Superscript footnote: hover or tap shows the source in an overlay; the overlay links to it. */
export function Fn({ k }: { k: string }) {
  const n = fnNum(k);
  const s = SOURCES[n - 1];
  if (!s) return null;
  const ext = s.url.startsWith('http');
  return (
    <sup className="pt-fn">
      <Tip label={n} className="pt-fn-btn" ariaLabel={`Source ${n}: ${s.label}`}>
        <span className="pt-pop-k">Source {n}</span>
        {s.label}
        <span className="pt-pop-links">
          <a href={s.url} target={ext ? '_blank' : undefined} rel="noreferrer">Open source</a>
          <button type="button" className="pt-pop-jump" onClick={() => jump(`pt-src-${n}`)}>All sources</button>
        </span>
      </Tip>
    </sup>
  );
}

export function Sources() {
  return (
    <section className="pt-section pt-sources" aria-labelledby="pt-sources-h">
      <div className="wrap">
        <p className="eyebrow" id="pt-sources-h">Sources</p>
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
