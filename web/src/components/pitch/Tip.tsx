import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Overlay tooltip: opens on hover, focus or tap, floats over the text (never pushes it),
 * stays inside the viewport and closes on Escape or an outside tap.
 * Motion comes from the design system's tip-in keyframes.
 */
export function Tip({ label, children, className = 'pt-term', ariaLabel }: { label: ReactNode; children: ReactNode; className?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [shift, setShift] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const id = useId();
  const close = useCallback(() => { setOpen(false); setPinned(false); }, []);

  useLayoutEffect(() => {
    if (!open || !pop.current) return;
    pop.current.style.setProperty('--shift', '0px');
    const r = pop.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let s = 0;
    if (r.right > vw - 16) s = vw - 16 - r.right;
    if (r.left + s < 16) s = 16 - r.left;
    setShift(s);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: PointerEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) close(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open, close]);

  return (
    <span className="pt-tip" ref={wrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!pinned) setOpen(false); }}>
      <button type="button" className={className} aria-expanded={open} aria-describedby={open ? id : undefined} aria-label={ariaLabel}
        onFocus={() => setOpen(true)} onBlur={() => { if (!pinned) setOpen(false); }}
        onClick={() => { setPinned((p) => !p || !open); setOpen(true); }}>
        {label}
      </button>
      {open && (
        <span ref={pop} id={id} role="tooltip" className="pt-pop" style={{ ['--shift' as string]: `${shift}px` }}>
          {children}
        </span>
      )}
    </span>
  );
}
