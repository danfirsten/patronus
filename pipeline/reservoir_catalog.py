"""Reservoir list for the global reservoir watch, and the match to WRI GPPD hydro plants.

Each entry: G-REALM lake id, display name, ISO3 countries (first = main hydro owner), and the GPPD
plants whose output depends on this lake's storage:
  * `dams`: plants at the reservoir itself (their MW is the reservoir's `mw`);
  * `cascade`: downstream plants whose flow is set by releases from this lake (reported apart, as
    `cascade_mw`). For Lake Malawi and Lake Victoria the lake has no storage power plant of its own;
    the outlet plants are listed as `dams` because the lake level sets their flow.
GPPD matching is by country and an exact plant name, so it is reproducible.

Lakes from G-REALM that were considered and left out (see docs/RESERVOIRS.md):
  Nam Ngum (G-REALM 001739, series ends Sep 2016), Kafue (000415, target is the Kafue Flats, not
  Itezhi-Tezhi), Kpong (003765, run-of-river headpond), Gilgel Gibe III and GERD/Millennium (still
  filling, so a same-month percentile is meaningless), Jirau and Xayaburi (run-of-river).
  Not in G-REALM: Mangla, Bhakra, Tucurui, Furnas, Tres Marias, Hoa Binh, Son La, Kossou, Itezhi-Tezhi,
  Mazar/Paute (Ecuador 2023-24 crisis).
"""
from __future__ import annotations

from functools import lru_cache

import pandas as pd

from pipeline.paths import RAW

LAKES = [
    # id, grealm, name, countries, dams [(iso3, gppd name)], cascade [(iso3, gppd name)], note
    ("kariba", "000394", "Lake Kariba", ["ZMB", "ZWE"],
     [("ZMB", "Kariba"), ("ZWE", "Kariba Dam South Hydroelectric Power Station Zimbabwe")], [], None),
    ("cahora_bassa", "000414", "Cahora Bassa", ["MOZ"], [("MOZ", "Cahora Bassa")], [], None),
    ("volta", "000393", "Lake Volta (Akosombo)", ["GHA"], [("GHA", "Aksombo")], [("GHA", "Kpong")], None),
    ("kainji", "000417", "Kainji", ["NGA"], [("NGA", "Kainji")], [("NGA", "Jebba")], None),
    ("shiroro", "001439", "Shiroro", ["NGA"], [("NGA", "Shiroro")], [], None),
    ("nasser", "000331", "Lake Nasser (Aswan High Dam)", ["EGY", "SDN"], [("EGY", "High Dam")],
     [("EGY", "Aswan Dam II"), ("EGY", "Esna"), ("EGY", "Naga Hamadi")], None),
    ("malawi", "000317", "Lake Malawi (Shire cascade)", ["MWI"],
     [("MWI", "Nkula"), ("MWI", "Tedzani Falls"), ("MWI", "Kapichira")], [],
     "The Shire River plants are run-of-river; their flow is set by the Lake Malawi level."),
    ("victoria", "000314", "Lake Victoria (Owen Falls)", ["UGA", "TZA", "KEN"],
     [("UGA", "Kiira"), ("UGA", "Narubale")], [("UGA", "Bujagali Falls")],
     "Outflow through Nalubaale/Kiira follows the Agreed Curve; the lake level sets the flow."),
    ("mtera", "001458", "Mtera", ["TZA"], [("TZA", "Mtera")], [("TZA", "Kidatu")], None),
    ("garafiri", "003683", "Garafiri", ["GIN"], [("GIN", "Garafiri")], [], None),
    ("guri", "000432", "Guri", ["VEN"], [("VEN", "Simon Bolivar (Guri)")],
     [("VEN", "Antonio Jose de Sucre (Macagua)"), ("VEN", "Fransisco de Miranda (Caruachi)"),
      ("VEN", "Manuel Piar (Tocoma) Hydroelectric Power Plant Venezuela")], None),
    ("la_vueltosa", "001617", "La Vueltosa (Uribante-Caparo)", ["VEN"],
     [("VEN", "Fabricio Ojeda (La Vueltosa) Hydroelectric Power Plant Venezuela")], [], None),
    ("itaipu", "000501", "Itaipu", ["PRY", "BRA"],
     [("PRY", "Itaipu Binacional Dam (Paraguay part)"), ("BRA", "Itaipu (Parte Brasileira)")], [],
     "Itaipu has little live storage and is held near full; its level says little about upstream drought."),
    ("sobradinho", "000345", "Sobradinho", ["BRA"], [("BRA", "Sobradinho")],
     [("BRA", "Luiz Gonzaga (Itaparica)"), ("BRA", "Apolônio Sales (Antiga Moxotó)"), ("BRA", "Paulo Afonso I"),
      ("BRA", "Paulo Afonso II"), ("BRA", "Paulo Afonso III"), ("BRA", "Paulo Afonso IV"), ("BRA", "Xingó")], None),
    ("emborcacao", "001419", "Emborcação", ["BRA"], [("BRA", "Emborcação")], [], None),
    ("itumbiara", "001422", "Itumbiara", ["BRA"], [("BRA", "Itumbiara")], [], None),
    ("nova_ponte", "001621", "Nova Ponte", ["BRA"], [("BRA", "Nova Ponte")], [], None),
    ("sao_simao", "001479", "São Simão", ["BRA"], [("BRA", "São Simão")], [], None),
    ("peixoto", "001554", "Mascarenhas de Moraes (Peixoto)", ["BRA"],
     [("BRA", "Marechal Mascarenhas de Moraes (Antiga Peixoto)")], [], None),
    ("agua_vermelha", "000448", "Água Vermelha", ["BRA"],
     [("BRA", "Água Vermelha (Antiga José Ermírio de Moraes)")], [], None),
    ("balbina", "001778", "Balbina", ["BRA"], [("BRA", "Balbina")], [], None),
    ("daule_peripa", "000728", "Daule-Peripa (Velasco Ibarra)", ["ECU"], [], [],
     "Marcel Laniado de Wind plant (about 213 MW) is not in GPPD, so MW is null."),
    ("junin", "000032", "Lake Junín (Mantaro)", ["PER"], [],
     [("PER", "Antunez de Mayolo (Mantaro)"), ("PER", "Restitucion")],
     "Lake Junín is the regulating reservoir of the Mantaro cascade; the plants are downstream."),
    ("tarbela", "000625", "Tarbela", ["PAK"], [("PAK", "Tarbela")], [("PAK", "Ghazi Barotha")], None),
    ("tehri", "004034", "Tehri", ["IND"], [("IND", "TEHRI ST -1")], [("IND", "KOTESHWAR")], None),
    ("srisailam", "001500", "Srisailam", ["IND"], [("IND", "SRISAILAM"), ("IND", "SRISAILAM LBPH")], [], None),
    ("indravati", "002292", "Upper Indravati", ["IND"], [("IND", "UPPAR INDRAVATI")], [], None),
    ("thac_mo", "001847", "Thac Mo", ["VNM"], [("VNM", "Thac Mo")], [], None),
    ("xiaowan", "001992", "Xiaowan", ["CHN"], [("CHN", "Xiaowan")], [], None),
    ("three_gorges", "001619", "Three Gorges", ["CHN"], [("CHN", "Three Gorges Dam")], [],
     "Operated mainly for flood control and navigation; levels follow a fixed seasonal rule."),
    ("toktogul", "000612", "Toktogul", ["KGZ"], [("KGZ", "Toktogul Hydroelectric Power Plant Kyrgyzstan")],
     [("KGZ", "Tash-Kumyr Hydroelectric Power Project Kyrgyzstan"),
      ("KGZ", "Shamaldy-Say Hydroelectric Power Plant Kyrgyzstan"),
      ("KGZ", "Uch-Kurgan Hydroelectric Power Plant Kyrgyzstan")], None),
    ("mosul", "001534", "Mosul", ["IRQ"], [("IRQ", "Mosul Dam"), ("IRQ", "Mosul Dam Regulator")], [], None),
]


@lru_cache(maxsize=1)
def _gppd() -> pd.DataFrame:
    df = pd.read_csv(RAW / "gppd" / "global_power_plant_database.csv", low_memory=False)
    return df[df["primary_fuel"] == "Hydro"][["country", "name", "capacity_mw", "latitude", "longitude", "gppd_idnr"]]


def match_plants(pairs):
    """Exact (country, name) matches in GPPD. Returns (list of plant dicts, missing names)."""
    g = _gppd()
    out, missing = [], []
    for iso, name in pairs:
        m = g[(g["country"] == iso) & (g["name"] == name)]
        if m.empty:
            missing.append(f"{iso}:{name}")
            continue
        # GPPD can list the same plant name twice in one country (e.g. two "São Simão"); take the largest
        r = m.sort_values("capacity_mw").iloc[-1]
        out.append({"name": r["name"], "iso3": iso, "mw": round(float(r["capacity_mw"]), 1),
                    "gppd_id": r["gppd_idnr"], "lat": round(float(r["latitude"]), 4),
                    "lon": round(float(r["longitude"]), 4)})
    return out, missing
