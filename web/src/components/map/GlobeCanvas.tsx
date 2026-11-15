import { useEffect, useRef, useState } from 'react';
import { PlantGlobe, type GlobePick, type PlantRow, type ResMarker } from '../../app/globe/plants';
import type { LL } from '../../app/globe/engine';
import { rendererOrder } from '../../app/globe/detect';

/** Lazy chunk: three.js WebGPU globe (WebGL 2 fallback inside three/webgpu). onFail -> parent shows 2-D. */
export default function GlobeCanvas({ plants, res, fly, sel, onPick, onFail }: {
  plants: PlantRow[]; res: ResMarker[]; fly: { at: LL; dist: number; key: number } | null;
  sel: { at: LL; h: number } | null; onPick: (p: GlobePick) => void; onFail: (why: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const eng = useRef<PlantGlobe | null>(null);
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState('');
  const pickRef = useRef(onPick); pickRef.current = onPick;
  useEffect(() => {
    const e = new PlantGlobe(ref.current!);
    e.onPickItem = (p) => pickRef.current(p);
    let dead = false;
    rendererOrder()
      .then((order) => {
        if (!order.length) throw new Error('no WebGPU or WebGL');
        return e.init({ provinces: [], countries: [], rivers: [], lakes: [] }, order[0]);
      })
      .then(() => { if (dead) return; e.setLayers(plants, res); eng.current = e; setBackend(e.backend); setReady(true); })
      .catch((err) => { e.dispose(); if (!dead) onFail(`3-D renderer failed (${String(err?.message ?? err).slice(0, 60)})`); });
    return () => { dead = true; e.dispose(); eng.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, res]);
  useEffect(() => { if (ready && fly) eng.current?.flyTo(fly.at, fly.dist, 2.4, fly.dist > 1.5 ? 0 : 0.6); }, [ready, fly?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) eng.current?.select(sel?.at ?? null, sel?.h); }, [ready, sel]);
  return (
    <div className="globe" ref={ref}>
      {!ready && <div className="globe-wait">Loading globe…</div>}
      {ready && <span className="globe-backend">{backend} · column height ~ √MW, not to scale</span>}
    </div>
  );
}
