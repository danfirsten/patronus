/**
 * Renderer choice for the dashboard globe: WebGPU (three.js WebGPURenderer + TSL) -> WebGL 2/1
 * (three.js WebGLRenderer + GLSL, no TSL nodes) -> 2-D SVG map. Override with ?globe=webgpu|webgl|2d.
 */
export type Kind = 'webgpu' | 'webgl';

function override(): Kind | '2d' | null {
  const v = new URLSearchParams(window.location.search).get('globe') ?? (window.location.hash.match(/[?&]globe=(\w+)/)?.[1] ?? null);
  return v === 'webgpu' || v === 'webgl' || v === '2d' ? v : null;
}

/** Apple WebKit (Safari on macOS / iPadOS, every browser on iOS). Its WebGPU is new and uneven, so WebGL goes first there. */
export function isAppleWebKit() {
  const ua = navigator.userAgent;
  const ios = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios || (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|OPR|Android/.test(ua));
}

let glOk: boolean | null = null;
export function hasWebGL() {
  if (glOk !== null) return glOk;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    glOk = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { glOk = false; }
  return glOk;
}

/** True only if an adapter is actually granted (navigator.gpu alone is not enough on Safari / Linux). */
export async function hasWebGPU(timeoutMs = 2000): Promise<boolean> {
  const gpu = (navigator as any).gpu;
  if (!gpu?.requestAdapter) return false;
  try {
    const a = await Promise.race([gpu.requestAdapter(), new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
    return !!a;
  } catch { return false; }
}

/** Ordered list of 3-D renderers to try. Empty -> 2-D map. */
export async function rendererOrder(): Promise<Kind[]> {
  const o = override();
  if (o === '2d') return [];
  if (o === 'webgl') return hasWebGL() ? ['webgl'] : [];
  if (o === 'webgpu') return ['webgpu', ...(hasWebGL() ? ['webgl' as const] : [])];
  const gl = hasWebGL();
  const gpu = !isAppleWebKit() && (await hasWebGPU());
  return [...(gpu ? ['webgpu' as const] : []), ...(gl ? ['webgl' as const] : [])];
}

/** Synchronous reasons to start on the 2-D map: only when no WebGL exists (Sean: Safari must get full 3-D). */
export function shouldUse2D(): string | null {
  if (override() === '2d') return 'set by ?globe=2d';
  if (!('gpu' in navigator) && !hasWebGL()) return 'this browser has no WebGPU or WebGL';
  return null;
}

/** Phones / tablets / WebKit get 2048 px textures (GPU memory); desktops 4096 px (never larger: iOS limit). */
export function texSize(): 2048 | 4096 {
  const small = Math.min(window.screen?.width ?? 9999, window.screen?.height ?? 9999) < 900;
  return small || isAppleWebKit() ? 2048 : 4096;
}
