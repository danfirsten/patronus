"""Night-lights replay from NASA Black Marble (VNP46A2) display imagery via NASA GIBS.

Run from the repo root:  python3 -m pipeline.nightlights

For each frame we fetch several nights of the GIBS layer
VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance (the VNP46A2 visualization,
Suomi NPP VIIRS Day/Night Band, BRDF/moonlight-corrected, gap-filled) through the
GIBS WMS endpoint (no login), take a per-pixel median composite to suppress
single-night noise, and save it as a PNG.

Brightness change: the PNGs are 8-bit display images. We map each gray level back to
the radiance bin it encodes, using the layer's published GIBS colormap
(VIIRS_DayNightBand_At_Sensor_Radiance, nW/(cm^2 sr), saturating at 38.2), then sum the
decoded radiance inside fixed city boxes and compare with the baseline frame. This is
an APPROXIMATE brightness change from display imagery, not a calibrated VNP46A2
radiance analysis. Bright city cores saturate at 38.2 nW/(cm^2 sr) in the display
colormap, which understates dimming in the brightest pixels.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import re
import time
import xml.etree.ElementTree as ET

import numpy as np
import requests
from PIL import Image

from pipeline.paths import CACHE, OUT, ROOT

LAYER = "VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance"
WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
WMTS_CAPS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities"
COLORMAP = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/VIIRS_DayNightBand_At_Sensor_Radiance.xml"
DEG_PER_PX = 1 / 240  # ~500 m, the layer's native grid (15 arc-seconds)
NIGHTS_PER_FRAME = 9

IMG_DIR = ROOT / "web" / "public" / "img" / "nightlights"
CACHE_DIR = CACHE / "gibs_nightlights"

# bbox = [min_lon, min_lat, max_lon, max_lat]
REGIONS = {
    "zambia": {
        "place": "Lusaka and the Copperbelt, Zambia",
        "bbox": [26.0, -16.5, 30.0, -12.0],
        "cities": {
            "Lusaka": [28.15, -15.55, 28.45, -15.30],
            "Kabwe": [28.38, -14.52, 28.52, -14.38],
            "Copperbelt (Ndola, Kitwe, Chingola, Mufulira, Luanshya)": [27.75, -13.25, 28.75, -12.45],
        },
    },
    "ecuador": {
        "place": "Quito, Guayaquil and Cuenca, Ecuador",
        "bbox": [-81.0, -3.5, -77.5, 0.5],
        "cities": {
            "Quito": [-78.60, -0.40, -78.35, -0.05],
            "Guayaquil": [-80.05, -2.30, -79.80, -2.00],
            "Cuenca": [-79.08, -2.96, -78.92, -2.85],
        },
    },
}

# Each frame: a window of nights; we use up to NIGHTS_PER_FRAME available nights, spread evenly.
FRAMES = [
    dict(id="zambia-2023-02", region="zambia", start="2023-02-08", end="2023-02-22", baseline=True,
         caption="Baseline, Feb 2023: before the 2023-24 drought crisis"),
    dict(id="zambia-2024-02", region="zambia", start="2024-02-08", end="2024-02-22",
         caption="Feb 2024: drought declared a national disaster (29 Feb 2024); load-shedding growing"),
    dict(id="zambia-2024-06", region="zambia", start="2024-06-08", end="2024-06-22",
         caption="Jun 2024: Kariba low, long daily load-shedding"),
    dict(id="zambia-2024-10", region="zambia", start="2024-09-20", end="2024-10-10",
         caption="Late Sep to early Oct 2024: peak load-shedding; Kariba North Bank generation largely halted from about 14 Sep 2024, households got about 3 h of power a day"),
    dict(id="zambia-2026-11", region="zambia", start="2026-10-22", end="2026-11-02",
         caption="Late Oct to early Nov 2026: now (latest nights available on GIBS)"),
    dict(id="ecuador-2024-09", region="ecuador", start="2024-09-05", end="2024-09-19", baseline=True,
         caption="Baseline, early Sep 2024: before the 22-23 Sep 2024 nationwide cuts"),
    dict(id="ecuador-2024-10", region="ecuador", start="2024-10-25", end="2024-11-15",
         caption="Late Oct to mid Nov 2024: cuts of up to 14 h/day from 24 Oct 2024"),
    dict(id="ecuador-2025-02", region="ecuador", start="2025-02-05", end="2025-02-20",
         caption="Feb 2025: after the cuts ended (Dec 2024)"),
]


def _session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = "patronus-pipeline/0.1"
    return s


def _get(s: requests.Session, url: str, params=None, tries: int = 4) -> requests.Response:
    for i in range(tries):
        try:
            r = s.get(url, params=params, timeout=90)
            if r.status_code == 200:
                return r
            err = f"HTTP {r.status_code}"
        except requests.RequestException as e:  # noqa: PERF203
            err = str(e)
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET failed {url}: {err}")


def available_ranges(s) -> list[tuple[dt.date, dt.date]]:
    """Daily availability ranges for the layer from the GIBS WMTS capabilities."""
    xml = _get(s, WMTS_CAPS).text
    i = xml.find(f"<ows:Identifier>{LAYER}</ows:Identifier>")
    j = xml.find("</Layer>", i)
    block = xml[i:j]
    out = []
    for a, b in re.findall(r"<Value>(\d{4}-\d{2}-\d{2})/(\d{4}-\d{2}-\d{2})/P1D</Value>", block):
        out.append((dt.date.fromisoformat(a), dt.date.fromisoformat(b)))
    return out


def gray_to_radiance_table(s) -> np.ndarray:
    """256-entry lookup: display gray level -> radiance (bin midpoint, nW/(cm^2 sr))."""
    root = ET.fromstring(_get(s, COLORMAP).content)
    grays, rads = [0.0], [0.0]
    for e in root.iter("ColorMapEntry"):
        if e.get("nodata") == "true":
            continue
        g = int(e.get("rgb").split(",")[0])
        lo, hi = (float(x) for x in e.get("value").strip("[)").split(","))
        mid = lo if hi > 1000 else (lo + hi) / 2  # top bin is open-ended: saturates
        grays.append(g)
        rads.append(mid)
    # WMS resampling can produce in-between gray levels; interpolate between bins.
    return np.interp(np.arange(256), grays, rads)


def pick_nights(start: str, end: str, ranges, n: int) -> list[dt.date]:
    d0, d1 = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    days = [d0 + dt.timedelta(k) for k in range((d1 - d0).days + 1)]
    ok = [d for d in days if any(a <= d <= b for a, b in ranges)]
    if len(ok) <= n:
        return ok
    idx = np.linspace(0, len(ok) - 1, n).round().astype(int)
    return [ok[k] for k in sorted(set(idx))]


def fetch_night(s, region: str, bbox, day: dt.date) -> np.ndarray:
    w = round((bbox[2] - bbox[0]) / DEG_PER_PX)
    h = round((bbox[3] - bbox[1]) / DEG_PER_PX)
    f = CACHE_DIR / f"{region}_{day.isoformat()}_{w}x{h}.png"
    if not f.exists():
        params = {
            "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.3.0", "LAYERS": LAYER,
            "CRS": "EPSG:4326",
            # WMS 1.3.0 + EPSG:4326 uses lat,lon axis order
            "BBOX": f"{bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]}",
            "WIDTH": w, "HEIGHT": h, "FORMAT": "image/png", "TIME": day.isoformat(),
        }
        r = _get(s, WMS, params)
        if not r.headers.get("content-type", "").startswith("image/png"):
            raise RuntimeError(f"GIBS returned {r.headers.get('content-type')} for {region} {day}")
        f.write_bytes(r.content)
    im = Image.open(f).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    gray = a[..., 0]
    gray[a[..., 3] == 0] = np.nan  # transparent = no data
    return gray


def box_mask(bbox, box, shape) -> tuple[slice, slice]:
    h, w = shape
    x0 = int((box[0] - bbox[0]) / (bbox[2] - bbox[0]) * w)
    x1 = int(np.ceil((box[2] - bbox[0]) / (bbox[2] - bbox[0]) * w))
    y0 = int((bbox[3] - box[3]) / (bbox[3] - bbox[1]) * h)  # row 0 = north edge
    y1 = int(np.ceil((bbox[3] - box[1]) / (bbox[3] - bbox[1]) * h))
    return slice(max(y0, 0), min(y1, h)), slice(max(x0, 0), min(x1, w))


def main() -> None:
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    s = _session()
    ranges = available_ranges(s)
    lut = gray_to_radiance_table(s)
    sat = float(lut[255])

    frames_out, notes = [], []
    baseline: dict[str, dict] = {}
    for fr in FRAMES:
        reg = REGIONS[fr["region"]]
        bbox = reg["bbox"]
        nights = pick_nights(fr["start"], fr["end"], ranges, NIGHTS_PER_FRAME)
        if not nights:
            notes.append(f"{fr['id']}: no GIBS nights available in {fr['start']}..{fr['end']}; frame skipped.")
            continue
        stack = []
        for d in nights:
            try:
                stack.append(fetch_night(s, fr["region"], bbox, d))
            except RuntimeError as e:
                notes.append(f"{fr['id']}: night {d} not fetched ({e}).")
        if not stack:
            continue
        comp = np.nanmedian(np.stack(stack), axis=0)
        comp = np.nan_to_num(comp, nan=0.0)
        g8 = np.clip(np.round(comp), 0, 255).astype(np.uint8)
        center = nights[len(nights) // 2]
        src = f"img/nightlights/{fr['id']}.png"
        Image.fromarray(g8, mode="L").save(ROOT / "web" / "public" / src, optimize=True)

        rad = lut[g8]
        cities = {}
        for name, box in reg["cities"].items():
            sl = box_mask(bbox, box, g8.shape)
            r = rad[sl]
            cities[name] = {
                "box": box,
                "sum_radiance": round(float(r.sum()), 1),
                "mean_gray": round(float(g8[sl].mean()), 2),
                "saturated_px_pct": round(float((g8[sl] >= 255).mean() * 100), 2),
            }
        total = sum(c["sum_radiance"] for c in cities.values())
        bg = float(np.median(rad))  # frame-wide background (mostly unlit land)
        lit = sum(float(np.clip(rad[box_mask(bbox, b, g8.shape)] - bg, 0, None).sum()) for b in reg["cities"].values())
        per_night = []
        for g in stack:
            gg = lut[np.clip(np.round(np.nan_to_num(g, nan=0.0)), 0, 255).astype(np.uint8)]
            per_night.append(sum(float(gg[box_mask(bbox, b, g8.shape)].sum()) for b in reg["cities"].values()))
        total_gray = sum(float(g8[box_mask(bbox, b, g8.shape)].astype(float).sum()) for b in reg["cities"].values())
        rec = {
            "id": fr["id"],
            "region": fr["region"],
            "place": reg["place"],
            "date": center.isoformat(),
            "window": {"from": nights[0].isoformat(), "to": nights[-1].isoformat()},
            "nights_used": [d.isoformat() for d in nights],
            "composite": f"per-pixel median of {len(stack)} nights",
            "src": src,
            "bbox": bbox,
            "caption": fr["caption"],
            "is_baseline": bool(fr.get("baseline")),
            "city_sum_radiance": round(total, 1),
            "background_radiance": round(bg, 3),
            "_gray_sum": total_gray,
            "_lit": lit,
            "_per_night": per_night,
            "cities": cities,
        }
        if fr.get("baseline"):
            baseline[fr["region"]] = rec
        b = baseline.get(fr["region"])
        if b is not None:
            rec["baseline_id"] = b["id"]
            rec["brightness_vs_baseline_pct"] = round((total / b["city_sum_radiance"] - 1) * 100, 1)
            rec["above_background_vs_baseline_pct"] = round((lit / b["_lit"] - 1) * 100, 1)
            rec["single_night_range_vs_baseline_pct"] = [
                round((min(per_night) / b["city_sum_radiance"] - 1) * 100, 1),
                round((max(per_night) / b["city_sum_radiance"] - 1) * 100, 1)]
            rec["gray_sum_vs_baseline_pct"] = round((total_gray / b["_gray_sum"] - 1) * 100, 1)
            for name, c in cities.items():
                bc = b["cities"][name]["sum_radiance"]
                c["vs_baseline_pct"] = round((c["sum_radiance"] / bc - 1) * 100, 1) if bc else None
        else:
            rec["brightness_vs_baseline_pct"] = None
        frames_out.append(rec)
        print(f"{fr['id']}: {len(stack)} nights {nights[0]}..{nights[-1]}  "
              f"vs baseline {rec.get('brightness_vs_baseline_pct')}%  "
              + "  ".join(f"{k.split(' ')[0]} {v.get('vs_baseline_pct')}" for k, v in cities.items()))

    for rec in frames_out:
        for k in ("_gray_sum", "_lit", "_per_night"):
            rec.pop(k, None)
        rec["notes"] = frame_note(rec)

    doc = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "sources": ["gibs_blackmarble", "news"],
        "layer": LAYER,
        "product": "NASA Black Marble VNP46A2 (Suomi NPP VIIRS Day/Night Band, BRDF/moonlight-corrected, gap-filled), display imagery via NASA GIBS",
        "method": (
            "For each frame, up to 9 nights in the window are fetched from the GIBS WMS at about 500 m and "
            "combined with a per-pixel median. Display gray levels are mapped back to radiance bins with the "
            "layer's GIBS colormap (nW/(cm^2 sr), saturating at %.1f), summed inside fixed city boxes, and "
            "compared with the region's baseline frame. Robustness checks per frame: "
            "above_background_vs_baseline_pct subtracts the frame-wide median radiance before summing; "
            "single_night_range_vs_baseline_pct gives the spread of the individual nights; "
            "gray_sum_vs_baseline_pct sums raw display gray levels (dominated by the dark background). "
            "brightness_vs_baseline_pct is an approximate "
            "brightness change from display imagery, not a calibrated radiance analysis." % sat
        ),
        "metric_label": "Approximate brightness change from display imagery",
        "saturation_radiance": sat,
        "notes": notes + [
            "Approximate brightness change from display imagery (8-bit GIBS PNGs), not calibrated VNP46A2 radiance.",
            "Suomi NPP passes over at about 01:30 local time. Scheduled cuts that do not cover that hour cannot show up, so a small or zero dip does not mean there were no cuts.",
            "Bright city cores saturate in the display colormap, so dimming in the brightest pixels is understated.",
            "Frames from different seasons differ for reasons other than power cuts (clouds that the gap-filling could not remove, haze, seasonal fires in Zambia from about Jun to Oct).",
        ] + summary_notes(frames_out),
        "frames": frames_out,
    }
    (OUT / "nightlights.json").write_text(json.dumps(doc, indent=1))
    print(f"wrote {OUT / 'nightlights.json'} with {len(frames_out)} frames")


def frame_note(rec: dict) -> str | None:
    p = rec.get("brightness_vs_baseline_pct")
    if rec["is_baseline"]:
        return "Baseline frame."
    if p is None:
        return "No baseline available for comparison."
    city_bits = ", ".join(f"{k.split(' (')[0]} {v['vs_baseline_pct']:+.0f}%" for k, v in rec["cities"].items()
                          if v.get("vs_baseline_pct") is not None)
    if p <= -10:
        verdict = "A dip is visible against the baseline."
    elif p < -3:
        verdict = "A small dip against the baseline; within what season and clouds alone could cause, so treat it as weak evidence."
    elif p <= 3:
        verdict = "No clear change against the baseline in this display imagery."
    else:
        verdict = "Brighter than the baseline in this display imagery; no dip visible."
    return f"{verdict} By city box: {city_bits}."


def summary_notes(frames: list[dict]) -> list[str]:
    return [f"{f['id']}: {f['brightness_vs_baseline_pct']:+.1f}% vs {f['baseline_id']}"
            for f in frames if f.get("brightness_vs_baseline_pct") is not None and not f["is_baseline"]]


if __name__ == "__main__":
    main()
