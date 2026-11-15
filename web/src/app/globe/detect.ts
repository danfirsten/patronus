/** Use the 2-D map instead: reduced motion, no WebGL2, or a small low-memory phone. */
export function shouldUse2D(): string | null {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'reduced motion is on';
  const c = document.createElement('canvas');
  if (!('gpu' in navigator) && !c.getContext('webgl2')) return 'this browser has no WebGPU or WebGL 2';
  const mem = (navigator as any).deviceMemory as number | undefined;
  const small = Math.min(window.innerWidth, window.innerHeight) < 500;
  if (small && mem !== undefined && mem <= 3) return 'low-memory phone';
  return null;
}
