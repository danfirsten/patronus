/**
 * WebGPU path: three.js WebGPURenderer + TSL Earth shading (own implementation of the
 * day/night + clouds + atmosphere technique from the three.js webgpu_tsl_earth example, MIT).
 * Throws if the renderer only got its WebGL2 backend, so the caller switches to the classic
 * WebGLRenderer path (earth-gl.ts) instead of running TSL on WebGL.
 */
import * as THREE from 'three/webgpu';
import { normalWorld, output, texture, vec3, vec4, normalize, positionWorld, bumpMap, cameraPosition, color, uniform, mix, uv, max, step } from 'three/tsl';
import type { EarthBuild } from './engine';

export async function createGPU(canvasHost: HTMLElement, onLost: (why: string) => void): Promise<EarthBuild> {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await Promise.race([
    renderer.init(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('WebGPU init timed out')), 8000)),
  ]);
  const be = renderer.backend as any;
  if (!be?.isWebGPUBackend) { renderer.dispose(); throw new Error('WebGPU backend unavailable'); }
  be.device?.lost?.then((info: any) => { if (info?.reason !== 'destroyed') onLost(`WebGPU device lost (${info?.reason ?? 'unknown'})`); });
  be.device?.addEventListener?.('uncapturederror', (e: any) => onLost(`WebGPU error (${String(e?.error?.message ?? '').slice(0, 50)})`), { once: true });
  canvasHost.prepend(renderer.domElement);
  return {
    renderer: renderer as any,
    label: 'WebGPU',
    maxTex: be.device?.limits?.maxTextureDimension2D ?? 8192,
    earth(tex, sunDir, R) {
      const { day, night, brc } = tex;
      const dayAtmo = uniform(color('#5fa9d6')), twilight = uniform(color('#a85a2a'));
      const view = positionWorld.sub(cameraPosition).normalize();
      const fres = view.dot(normalWorld).abs().oneMinus().toVar();
      const sunO = normalWorld.dot(normalize(vec3(sunDir.x, sunDir.y, sunDir.z))).toVar();
      const atmoCol = mix(twilight, dayAtmo, sunO.smoothstep(-0.25, 0.75));
      const mat = new THREE.MeshStandardNodeMaterial();
      const clouds = texture(brc, uv()).b.smoothstep(0.2, 1);
      mat.colorNode = mix(texture(day), vec3(1), clouds.mul(1.6));
      mat.roughnessNode = max(texture(brc).g, step(0.01, clouds)).remap(0, 1, uniform(0.22), uniform(0.4));
      const dayK = sunO.smoothstep(-0.25, 0.5);
      let out = mix(texture(night).rgb, output.rgb, dayK);
      out = mix(out, atmoCol, sunO.smoothstep(-0.5, 1).mul(fres.pow(2)).clamp(0, 1));
      mat.outputNode = vec4(out, output.a);
      mat.normalNode = bumpMap(max(texture(brc).r, clouds));
      const sph = new THREE.SphereGeometry(R, 96, 96);
      const atmo = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false });
      atmo.outputNode = vec4(atmoCol, fres.remap(0.73, 1, 1, 0).pow(3).mul(sunO.smoothstep(-0.5, 1)));
      const am = new THREE.Mesh(sph, atmo); am.scale.setScalar(1.035);
      return [new THREE.Mesh(sph, mat), am];
    },
  };
}
