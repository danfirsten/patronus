# Patronus: 30-second pitch video (DRAFT)

**File:** `media/video/patronus-30s.mp4`. 1920x1080, 30 fps, H.264 (High) + AAC, 30.0 s, about 11.6 MB.
**Status:** a draft recorded on 14 Nov 2026 from the live site, https://patronus-blackout-watch.aui-svi.workers.dev. Re-record it after PR #3 (the new landing page) merges. See "Re-recording" below.
**Format:** screen capture of the real site, captions burned in, no voiceover. A quiet generated pad plays underneath (see "Music").

## The story in one line
Lake Kariba's 2024 drought blackout. Patronus' El Niño model, built on NASA water data, fired in Jul 2023: 5 months before the official cut. Today it gives about a 1-in-3 chance of the danger zone by end-2027. The same GRACE trend test covers hydro basins worldwide.

## Shot list
Times are on the final 30 s timeline. Shots cross-fade over 0.25 s. Each still pushes in slowly by 4%.

| # | Time (s) | Screen (live site) | Caption (main line) | Caption (sub line) |
|---|---|---|---|---|
| 1 | 0.0–3.75 | Story page hero: "When the reservoirs drain, the lights go out…" and the 4 stat tiles | When the reservoirs drain, hydropower countries go dark. | Patronus turns NASA water data into a warning months ahead. |
| 2 | 3.75–7.5 | Kariba page: "Usable storage since 1992" chart | Lake Kariba, Zambia and Zimbabwe: 2.89% usable storage, Dec 2024. | Satellite lake levels since 1992: G-REALM (NASA/USDA) |
| 3 | 7.5–13.25 | Kariba page: "The 2024 crisis…" headline and the 2023–2025 chart with alarm lines | Our El Niño alarm fired in Jul 2023: 5 months before the official cut. | Fair backtest, only data known at the time. 8 months before load-shedding. |
| 4 | 13.25–17.0 | Kariba page: "Not cherry-picked: every season since 1995" panel and the season strip | Not cherry-picked: every El Niño season since 1995. | 3 hits, 2 misses, 2 false alarms. We show the misses. |
| 5 | 17.0–20.75 | Kariba page: "What the 2024 blackout looked like from space", first row of night-light frames | From space: Zambia's cities 36% darker in Sep-Oct 2024. | NASA Black Marble night lights vs Feb 2023 (Lusaka -52%) |
| 6 | 20.75–25.0 | Kariba page: 2027 forecast fan chart and probability table | 2027: about a 1-in-3 chance (36%) Kariba falls below 10% usable. | Forecast inputs: G-REALM, GRACE-FO, NASA POWER, GPCP, GEOS-S2S El Niño outlook |
| 7 | 25.0–30.0 | Map page: "Hydropower basins by trend in total water storage" world map | Worldwide: 392 GW of hydropower sits in basins losing water. | GRACE/GRACE-FO 2002-2026, Sen's slope, Mann-Kendall + FDR · patronus-blackout-watch.aui-svi.workers.dev |

The picture fades in from and out to the brand's deep blue (`#0B2A3C`). Captions sit on a deep-blue lower-third band in Helvetica Neue: white main line, `--shallow` (`#8DC3D6`) sub line.

## Where each number comes from
Every number matches `DESIGN.md` section 12 or section 8, and the live site showed the same value on 14 Nov 2026.

| Caption number | Source |
|---|---|
| 2.89% usable, Dec 2024 | Kariba page (lowest point, 11 Dec 2024); `kariba.json` |
| Jul 2023, 5 months before the official cut, 8 before load-shedding | §12 "Next" El Niño ensemble; Kariba page headline |
| 3 hits, 2 misses, 2 false alarms (El Niño seasons since 1995) | §12; Kariba page backtest panel |
| 36% darker Sep–Oct 2024, Lusaka −52% (vs Feb 2023) | §12 night lights; `nightlights.json` (zambia-2024-10: −36.2%) |
| 36% chance below 10% by Dec 2027 ("about 1-in-3") | §12 live forecast, P(below 10%) = 0.36; Kariba page table, Dec '27 |
| 392 GW in significantly drying basins | §12 global trend map; Map page tiles |

**Challenge fit (Relevance):** shot 7 names the variable (GRACE/GRACE-FO total water storage), the trend (Sen's slope) and the significance test (Mann-Kendall + FDR). Shots 2, 3 and 6 name the NASA inputs: G-REALM, GRACE-FO, POWER, GPCP, GEOS-S2S and Black Marble.

## Music
The pad underneath is synthesised in `capture.sh` with ffmpeg's `aevalsrc`: four sine tones with slow tremolo, low-pass filtered and echoed. It uses no third-party audio, samples or loops, so no licence is needed. The team can release it as CC0. To make a silent version, delete the audio part of the graph and the `-map "[aout]"` and `-c:a` options.

## How to rebuild
Needs Node 18+ and ffmpeg built with libass (Homebrew's `ffmpeg` has it).

```bash
cd media/video
npm i --no-save playwright@1.58.2 && npx playwright install chromium
node capture.mjs            # writes build/shots/*.png and build/manifest.json (about 1 min)
./capture.sh                # writes patronus-30s.mp4 (about 20 s)
```

- `capture.mjs` opens each page in headless Chromium (1920x1080 at device scale 2, reduced motion, light theme). It scrolls the page so reveals and images load, finds each shot's element by its heading text, and saves a 16:9 crop of it. It leaves room at the bottom for the caption band. `node capture.mjs --url <other deploy>` records a preview deploy instead.
- `capture.sh` holds the shot durations and the caption text. It builds `build/captions.ass`, then runs one ffmpeg pass: scale, push-in, cross-fades, band, captions, fades and audio, encoded as H.264 CRF 20.
- `build/` is git-ignored.

## Re-recording after PR #3 (new landing page)
1. If headings moved or were renamed, update the `SHOTS` anchors in `capture.mjs`. Shot 1 frames the landing page's first `<section>` with `<h1>` "When the reservoirs drain"; point it at the new hero.
2. If the pipeline numbers change, update the captions in `capture.sh`, this file and `DESIGN.md` §12 together.
3. Run the two commands above, watch the MP4 all the way through and check every caption against the frame behind it.

## Known limits of this draft
- The pictures are stills with a slow push-in, not live scrolling. The result is crisper and repeatable, but static.
- The charts in shots 3 and 6 are fairly small at 1080p, so the captions carry the numbers.
- The caption font is a macOS system font. On another OS, libass substitutes a similar sans-serif.
