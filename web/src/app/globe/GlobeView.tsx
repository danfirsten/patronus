import { useEffect, useRef, useState } from 'react';
import { GlobeEngine, type GeoData, type LL, type Pick, type SceneState } from './engine';

/** Lazy-loaded WebGPU globe. Calls onFail if the renderer cannot start (parent shows the 2-D map). */
export default function GlobeView({ geo, scene, onPick, fly, onFail }: {
  geo: GeoData; scene: SceneState; onPick: (p: Pick) => void; fly: { at: LL; dist?: number; key: string } | null; onFail: (why: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const eng = useRef<GlobeEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState('');
  const pickRef = useRef(onPick); pickRef.current = onPick;
  useEffect(() => {
    const e = new GlobeEngine(ref.current!);
    e.onPick = (p) => pickRef.current(p);
    let dead = false;
    e.init(geo).then(() => { if (dead) return; eng.current = e; setBackend(e.backend); setReady(true); })
      .catch((err) => { e.dispose(); if (!dead) onFail(`3-D renderer failed (${String(err?.message ?? err).slice(0, 60)})`); });
    return () => { dead = true; e.dispose(); eng.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo]);
  useEffect(() => { if (ready) eng.current?.setState(scene); }, [ready, scene]);
  useEffect(() => { if (ready && fly) eng.current?.flyTo(fly.at, fly.dist); }, [ready, fly?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="globe" ref={ref}>
      {!ready && <div className="globe-wait">Loading globe…</div>}
      {ready && <span className="globe-backend">{backend} · vertical scale exaggerated</span>}
    </div>
  );
}
