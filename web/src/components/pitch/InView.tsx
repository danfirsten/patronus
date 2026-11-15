import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { prefersReducedMotion } from '../../lib/motion';

/**
 * Scroll reveal for the pitch page.
 * Inspired by 21st.dev "Blur Fade" (Dillion Verma) and the motion `useInView({ once: true })`
 * pattern it uses, rebuilt on the Drawdown motion rules: it only sets data-reveal, and the
 * fade-up itself is the design system's [data-reveal] transition (--dur-3, --ease-expo,
 * --stagger by sibling via --i). No blur and no glow, to stay inside the design system.
 * Under prefers-reduced-motion it renders in its final state.
 */
export function useInViewOnce<T extends HTMLElement>(margin = '0px 0px -10% 0px') {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); }
    }, { rootMargin: margin, threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, inView] as const;
}

export function InView({ as: Tag = 'div', i = 0, className, children, id }: { as?: ElementType; i?: number; className?: string; children: ReactNode; id?: string }) {
  const [ref, inView] = useInViewOnce<HTMLElement>();
  return (
    <Tag ref={ref} id={id} className={className} data-reveal={inView ? 'in' : 'wait'} style={{ ['--i' as string]: String(i) }}>
      {children}
    </Tag>
  );
}
