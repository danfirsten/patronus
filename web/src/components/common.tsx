import { Component, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { RISK_LABEL, riskTextVar, riskVar, EXPOSURE_LABEL, exposureVar } from '../lib/risk';
import { SampleContext } from './sample';

/** Measure an element's width so charts draw at real pixel size. */
export function useWidth<T extends HTMLElement>(fallback = 600): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.max(240, Math.floor(el.getBoundingClientRect().width)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Every chart states its source and period. `files` adds a SAMPLE tag if any came from fixtures. */
export function SourceNote({ children, files }: { children: ReactNode; files?: string[] }) {
  const sample = useContext(SampleContext);
  const isSample = files?.some((f) => sample.has(f));
  return (
    <p className="source-note">
      {isSample && <span className="sample-tag">Sample data</span>}
      <span>Source: {children}</span>
    </p>
  );
}

export function Figure({ title, sub, children, source, files, id }: {
  title: ReactNode; sub?: ReactNode; children: ReactNode; source: ReactNode; files?: string[]; id?: string;
}) {
  return (
    <figure className="figure" id={id}>
      <figcaption>
        <h3>{title}</h3>
        {sub && <p className="muted">{sub}</p>}
      </figcaption>
      <ErrorBoundary label="chart">{children}</ErrorBoundary>
      <SourceNote files={files}>{source}</SourceNote>
    </figure>
  );
}

export function Stat({ value, label, tone }: { value: ReactNode; label: ReactNode; tone?: 'drying' | 'wetting' | 'accent' }) {
  return (
    <div className={`stat ${tone ? 'stat-' + tone : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function RiskPill({ level }: { level?: string | null }) {
  if (!level) return <span className="pill pill-none">No forecast</span>;
  return (
    <span className="pill" style={{ background: riskVar(level), color: riskTextVar(level) }}>
      {RISK_LABEL[level] ?? level}
    </span>
  );
}

export function ExposureTag({ exposure }: { exposure?: string | null }) {
  if (!exposure) return <span className="muted">—</span>;
  return (
    <span className="exposure-tag">
      <i style={{ background: exposureVar(exposure) }} />
      {EXPOSURE_LABEL[exposure] ?? exposure}
    </span>
  );
}

export function Loading({ what = 'data' }: { what?: string }) {
  return <p className="muted loading">Loading {what}…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: String(e) };
  }
  componentDidCatch(e: unknown) {
    // Keep the rest of the page alive when one block hits an unexpected data shape.
    console.warn('Patronus: a block failed to render', e);
  }
  render() {
    if (this.state.err) {
      return <p className="empty">This {this.props.label ?? 'block'} could not be drawn from the current data file.</p>;
    }
    return this.props.children;
  }
}

/** Fades content in when it scrolls into view. Off under prefers-reduced-motion (via CSS). */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setShown(true);
        io.disconnect();
      }
    }, { rootMargin: '0px 0px -10% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${shown ? 'shown' : ''} ${className}`}>{children}</div>;
}

/** Very small Markdown renderer for AI briefs: headings, bullets, paragraphs, bold. */
export function MiniMarkdown({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const t = b.trim();
        if (!t) return null;
        const h = /^(#{1,4})\s+(.*)$/.exec(t);
        if (h && !t.includes('\n')) return <h4 key={i}>{inline(h[2])}</h4>;
        const lines = t.split('\n');
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>)}</ul>;
        }
        return <p key={i}>{inline(t.replace(/^#+\s+/, ''))}</p>;
      })}
    </div>
  );
}
