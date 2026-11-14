/**
 * Patronus motion system. Rules (see DESIGN_SYSTEM.md, "Motion"):
 * - Only transform, opacity and clip-path animate, so everything stays on the compositor.
 * - Entrances use --ease-expo; hovers and colour use --ease-out; the waterline and chart
 *   draw-in use --ease-inout. Durations come from the --dur-* tokens in theme.css.
 * - prefers-reduced-motion: nothing moves, everything renders in its final state.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* Scroll reveal: one observer for the whole page, staggered by sibling */
/* ------------------------------------------------------------------ */

const REVEAL_SELECTOR = [
  '.figure', '.panel', '.stat', '.horizon', '.crisis-card', '.key-grid > div', '.mini-watch-row',
  '.night-frame', '.reservoir-watch', '.callout', '.caveat', '.step', '.ledger-mini', '.data-table tbody tr',
  '.timeline li', '.gauge',
].join(',');
const MAX_STAGGER = 8;

/**
 * Tags matching blocks inside `root` with data-reveal and fades them up as they scroll in.
 * Content that arrives later (data loads) is picked up by a MutationObserver.
 */
export function useAutoReveal(root: RefObject<HTMLElement>) {
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const t = e.target as HTMLElement;
        t.dataset.reveal = 'in';
        io.unobserve(t);
        // Drop the hint once the transition is done so idle pages hold no extra layers.
        window.setTimeout(() => t.style.removeProperty('will-change'), 1200);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });

    const tag = () => {
      el.querySelectorAll<HTMLElement>(REVEAL_SELECTOR).forEach((n) => {
        if (n.dataset.reveal) return;
        // Skip blocks nested in an already-revealing block: the parent carries them.
        const host = n.parentElement?.closest<HTMLElement>('[data-reveal]');
        if (host && el.contains(host)) return;
        const sibs = n.parentElement ? Array.from(n.parentElement.children) : [n];
        const i = Math.min(sibs.indexOf(n), MAX_STAGGER);
        n.style.setProperty('--i', String(Math.max(0, i)));
        n.style.willChange = 'opacity, transform';
        n.dataset.reveal = 'wait';
        io.observe(n);
      });
    };

    let raf = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tag);
    });
    tag();
    mo.observe(el, { childList: true, subtree: true });
    return () => { mo.disconnect(); io.disconnect(); cancelAnimationFrame(raf); };
  }, [root]);
}

/* ------------------------------------------------------------------ */
/* Count-up numbers                                                    */
/* ------------------------------------------------------------------ */

const NUM_RE = /^([^\d−-]*)([−-]?)(\d[\d,]*)(\.\d+)?(.*)$/s;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Counts the first number in `value` up from zero when it scrolls into view
 * ("36.7%", "−24%", "$1,400M", 5). Non-numeric values render as they are.
 */
export function CountUp({ value, duration = 1400 }: { value: ReactNode; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
  const m = text ? NUM_RE.exec(text) : null;
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!m || !text || prefersReducedMotion()) { setShown(null); return; }
    const [, pre, sign, int, frac = '', post] = m;
    const target = parseFloat(int.replace(/,/g, '') + frac);
    const decimals = frac ? frac.length - 1 : 0;
    const comma = int.includes(',');
    const fmt = (v: number) => {
      let s = v.toFixed(decimals);
      if (comma) s = Number(s).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      return pre + sign + s + post;
    };
    setShown(fmt(0));
    let raf = 0, start = 0;
    const el = ref.current;
    const run = () => {
      const tick = (now: number) => {
        if (!start) start = now;
        const k = easeOutExpo(Math.min(1, (now - start) / duration));
        setShown(k >= 1 ? null : fmt(target * k));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    if (!el || typeof IntersectionObserver === 'undefined') { run(); return () => cancelAnimationFrame(raf); }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); run(); }
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, duration]);

  if (!m) return <>{value}</>;
  return <span ref={ref} className={shown === null ? 'countup' : 'countup counting'}>{shown ?? text}</span>;
}

/* ------------------------------------------------------------------ */
/* Mount flag: lets SVG parts transition from a start pose (needle)     */
/* ------------------------------------------------------------------ */

export function useMounted(delay = 60) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion()) { setOn(true); return; }
    const t = window.setTimeout(() => setOn(true), delay);
    return () => window.clearTimeout(t);
  }, [delay]);
  return on;
}

/* ------------------------------------------------------------------ */
/* Waterline: the live level in the logo                               */
/* ------------------------------------------------------------------ */

/** Default brand level when no reservoir is in view (58% cuts through the x-height). */
export const STATIC_WATERLINE = 58;

type WaterlineCtx = { level: number | null; setLevel: (pct: number | null) => void };
export const WaterlineContext = createContext<WaterlineCtx>({ level: null, setLevel: () => {} });

/** A page calls this with its reservoir's live storage (0–100) to set the logo's waterline. */
export function useWaterline(pct: number | null | undefined) {
  const { setLevel } = useContext(WaterlineContext);
  useEffect(() => {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return;
    setLevel(Math.max(0, Math.min(100, pct)));
    return () => setLevel(null);
  }, [pct, setLevel]);
}

/**
 * The Patronus wordmark: water below the line, the bleached ring above it, sky above that.
 * `level` is storage in % (null = brand default). The glyphs' ink band runs roughly from
 * 30% to 80% of the box, so storage maps onto that band.
 */
export function Wordmark({ level, className = '' }: { level?: number | null; className?: string }) {
  const cut = level === null || level === undefined
    ? STATIC_WATERLINE
    : 80 - (Math.max(0, Math.min(100, level)) / 100) * 50;
  return (
    <span className={`wordmark ${className}`} style={{ ['--cut' as string]: `${cut.toFixed(1)}%` }}>
      <span className="wm-sky" aria-hidden="true">patronus</span>
      <span className="wm-ring" aria-hidden="true">patronus</span>
      <span className="wm-water" aria-hidden="true">patronus</span>
      <span className="wm-line" aria-hidden="true" />
      <span className="sr-only">Patronus</span>
    </span>
  );
}
