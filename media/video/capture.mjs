// Patronus 30-second pitch video: step 1 of 2 (screen capture).
//
// Opens the live site in headless Chromium, finds each shot's element by its
// heading text, and saves a crisp 16:9 crop of it (device scale 2) to
// media/video/build/shots/NN-name.png. Step 2 (capture.sh) turns the stills
// into the MP4 with ffmpeg.
//
//   cd media/video
//   npm i --no-save playwright@1.58.2 && npx playwright install chromium
//   node capture.mjs [--url https://...]     # default: the live site below
//   ./capture.sh
//
// To re-record after the new landing page merges, change the selectors in
// SHOTS below if headings moved; the timing and captions live in capture.sh.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'build', 'shots');
const argUrl = process.argv.indexOf('--url');
const BASE = argUrl > 0 ? process.argv[argUrl + 1] : 'https://patronus-blackout-watch.aui-svi.workers.dev';

// Each shot: route, the text of a heading (or other element) to anchor on,
// how far up/down to extend the crop around it (CSS px), and optionally which
// ancestor to frame ('figure', '.panel', ...). The crop is widened to 16:9.
const SHOTS = [
  { name: '01-hook', route: '', anchor: 'h1', text: 'When the reservoirs drain', frame: 'section', pad: 40, minW: 1200, top: 0 },
  { name: '02-history', route: 'kariba', anchor: 'h3', text: 'Usable storage since 1992', frame: 'figure', pad: 24 },
  { name: '03-alarm', route: 'kariba', anchor: 'h2', text: 'The 2024 crisis, and when Patronus', extendTo: 'figure', pad: 24 },
  { name: '04-record', route: 'kariba', anchor: 'h3', text: 'Not cherry-picked', frame: '.panel', pad: 24 },
  { name: '05-lights', route: 'kariba', anchor: 'h2', text: 'What the 2024 blackout looked like', extendNext: true, endAt: ['figure', 3], pad: 24 },
  { name: '06-forecast', route: 'kariba', anchor: 'h3', text: 'Forecast usable storage', frame: 'figure', pad: 24 },
  { name: '07-global', route: 'map', anchor: 'h3', text: 'Hydropower basins by trend in total water storage', frame: 'figure', pad: 24 },
];

const ASPECT = 16 / 9;
// capture.sh draws a 200 px caption band over the bottom of the 1080 px frame;
// leave that much empty space under each element so the band covers margin, not data.
const BAND = 200 / 1080;

async function settle(page) {
  // Scroll through the page so scroll-triggered reveals and lazy charts render.
  await page.evaluate(async () => {
    const step = window.innerHeight / 2;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);
}

async function rectFor(page, shot) {
  return page.evaluate((s) => {
    const els = [...document.querySelectorAll(s.anchor)];
    const el = els.find((e) => e.textContent.trim().startsWith(s.text) || e.textContent.includes(s.text));
    if (!el) return null;
    const box = (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    };
    let b = box(s.frame ? el.closest(s.frame) ?? el : el);
    let end = b.y + b.h;
    if (s.extendTo) {
      // From the anchor down to the next matching element (e.g. its figure).
      let n = el.nextElementSibling;
      while (n && !n.matches(s.extendTo) && !n.querySelector(s.extendTo)) n = n.nextElementSibling;
      if (n) { const nb = box(n); end = nb.y + nb.h; b.x = Math.min(b.x, nb.x); b.w = Math.max(b.w, nb.w); }
    }
    if (s.extendNext && el.nextElementSibling) {
      const next = el.nextElementSibling;
      const nb = box(next); end = nb.y + nb.h; b.x = Math.min(b.x, nb.x); b.w = Math.max(b.w, nb.w);
      // Optionally stop at the Nth matching child (e.g. the first row of frames).
      if (s.endAt) { const c = next.querySelectorAll(s.endAt[0])[s.endAt[1]]; if (c) { const cb = box(c); end = cb.y + cb.h; } }
    }
    b.h = end - b.y;
    return { ...b, pageW: document.documentElement.scrollWidth, pageH: document.documentElement.scrollHeight };
  }, shot);
}

function fit(r, pad, minW = 960, top) {
  // Pad, widen to 16:9 around the centre, clamp to the page.
  let w = Math.max(r.w + 2 * pad, minW);
  let h = (r.h + 2 * pad) / (top === undefined ? 1 - BAND : 1);
  if (w / h < ASPECT) w = h * ASPECT; else h = w / ASPECT;
  w = Math.min(w, r.pageW); h = Math.min(h, w / ASPECT);
  const cx = r.x + r.w / 2;
  let x = Math.max(0, Math.min(cx - w / 2, r.pageW - w));
  let y = top ?? Math.max(0, Math.min(r.y - pad, r.pageH - h));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
  colorScheme: 'light',
});
const page = await ctx.newPage();
const manifest = [];
let current = null;
try {
  for (const shot of SHOTS) {
    if (current !== shot.route) {
      await page.goto(`${BASE}/#/${shot.route}`, { waitUntil: 'load', timeout: 90000 });
      await page.waitForTimeout(4000);
      await settle(page);
      current = shot.route;
    }
    const r = await rectFor(page, shot);
    if (!r) throw new Error(`Shot ${shot.name}: no <${shot.anchor}> containing "${shot.text}" on #/${shot.route}`);
    const clip = fit(r, shot.pad ?? 24, shot.minW, shot.top);
    // Bring the region on screen and wait for its images (lazy night-light frames) to decode.
    await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 100)), clip.y);
    await page.waitForTimeout(800);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => Promise.all([...document.images].filter((i) => i.complete).map((i) => i.decode().catch(() => {}))));
    await page.waitForTimeout(1500);
    const file = join(OUT, `${shot.name}.png`);
    await page.screenshot({ path: file, clip, fullPage: true });
    manifest.push({ ...shot, clip, file: `build/shots/${shot.name}.png` });
    console.log(`${shot.name}: ${clip.width}x${clip.height} css px at (${clip.x},${clip.y})`);
  }
} finally {
  await browser.close();
}
writeFileSync(join(HERE, 'build', 'manifest.json'), JSON.stringify({ base: BASE, captured: new Date().toISOString(), shots: manifest }, null, 2));
