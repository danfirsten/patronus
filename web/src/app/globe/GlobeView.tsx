import { useEffect, useRef, useState } from 'react';
import { GlobeEngine, type GeoData, type LL, type Pick, type SceneState } from './engine';
import { rendererOrder, type Kind } from './detect';

/**
 * Lazy 3-D globe. Tries renderers in order (WebGPU -> WebGL; Safari/iOS start at WebGL). A failed
 * init, a lost WebGPU device or a lost WebGL context moves to the next renderer; when none is
 * left it calls onFail and the parent shows the 2-D map. Never leaves a blank canvas.
 */
export default function GlobeView({ geo, scene, onPick, fly, onFail }: {
  geo: GeoData; scene: SceneState; onPick: (p: Pick) => void; fly: { at: LL; dist?: number; key: string } | null; onFail: (why: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const eng = useRef<GlobeEngine | null>(null);
  const [order, setOrder] = useState<Kind[] | null>(null);
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState('');
  const pickRef = useRef(onPick); pickRef.current = onPick;
  const failRef = useRef(onFail); failRef.current = onFail;
  const why = useRef<string[]>([]);
  useEffect(() => { let dead = false; rendererOrder().then((o) => { if (!dead) setOrder(o); }); return () => { dead = true; }; }, []);
  useEffect(() => {
    if (!order) return;
    if (!order.length) { failRef.current(why.current.length ? `3-D failed: ${why.current.join('; ')}` : 'no WebGL in this browser'); return; }
    const kind = order[0];
    const next = (msg: string) => { why.current.push(`${kind}: ${msg.slice(0, 60)}`); console.warn('[globe]', kind, msg); setReady(false); setOrder((o) => (o && o[0] === kind ? o.slice(1) : o)); };
    const e = new GlobeEngine(ref.current!);
    e.onPick = (p) => pickRef.current(p);
    let dead = false;
    e.onLost = (m) => { if (!dead) { dead = true; e.dispose(); eng.current = null; next(m); } };
    e.init(geo, kind).then(() => { if (dead) return; eng.current = e; setBackend(e.backend); setReady(true); (window as any).__globe = { renderer: e.backend, kind }; })
      .catch((err) => { if (dead) return; dead = true; e.dispose(); next(String(err?.message ?? err)); });
    return () => { dead = true; e.dispose(); eng.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, order?.[0]]);
  useEffect(() => { if (ready) eng.current?.setState(scene); }, [ready, scene]);
  useEffect(() => { if (ready && fly) eng.current?.flyTo(fly.at, fly.dist); }, [ready, fly?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="globe" ref={ref}>
      {!ready && <div className="globe-wait">Loading globe…</div>}
      {ready && <span className="globe-backend" data-renderer={backend}><b className="r-badge">3D</b> {backend} · vertical scale exaggerated</span>}
    </div>
  );
}
