/**
 * Classic three.js WebGLRenderer path (Safari / iOS, browsers without WebGPU). No TSL nodes:
 * the Earth is an unlit GLSL ShaderMaterial (day/night blend on the sun angle, clouds, ocean
 * specular, fresnel atmosphere tint) plus a back-face atmosphere shell. Same technique as the
 * TSL material in earth-gpu.ts and the well-known "realistic earth" WebGL shader approach;
 * own implementation. Texture channels: R bump, G roughness (ocean dark), B clouds.
 */
import * as THREE from 'three';
import type { EarthBuild } from './engine';

const VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const EARTH_FRAG = /* glsl */ `
uniform sampler2D tDay; uniform sampler2D tNight; uniform sampler2D tBrc;
uniform vec3 sunDir; uniform vec3 atmoDay; uniform vec3 atmoTwi; uniform float ready;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 toCam = normalize(cameraPosition - vW);
  float sunO = dot(n, sunDir);
  vec4 brc = texture2D(tBrc, vUv);
  float cloud = smoothstep(0.2, 1.0, brc.b);
  vec3 day = mix(texture2D(tDay, vUv).rgb, vec3(1.0), clamp(cloud * 1.6, 0.0, 1.0));
  // lit day side: soft lambert so the terminator matches the WebGPU look
  vec3 lit = day * (0.12 + 1.05 * max(sunO, 0.0));
  // ocean glint: low roughness (G) and no cloud
  float glossy = (1.0 - max(brc.g, step(0.01, cloud)));
  vec3 refl = reflect(-sunDir, n);
  float spec = pow(max(dot(refl, toCam), 0.0), 28.0) * glossy * step(0.0, sunO);
  float fres = 1.0 - abs(dot(toCam, n));
  vec3 atmo = mix(atmoTwi, atmoDay, smoothstep(-0.25, 0.75, sunO));
  lit += spec * mix(vec3(0.9), atmo, fres) * 0.7;
  vec3 col = mix(texture2D(tNight, vUv).rgb, lit, smoothstep(-0.25, 0.5, sunO));
  col = mix(col, atmo, clamp(smoothstep(-0.5, 1.0, sunO) * fres * fres, 0.0, 1.0));
  // until textures arrive show a plain ocean-blue sphere, never a blank canvas
  col = mix(vec3(0.03, 0.12, 0.2) + atmo * 0.2 * max(sunO, 0.0), col, ready);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 sunDir; uniform vec3 atmoDay; uniform vec3 atmoTwi;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 toCam = normalize(cameraPosition - vW);
  float sunO = dot(n, sunDir);
  float fres = 1.0 - abs(dot(toCam, n));
  vec3 atmo = mix(atmoTwi, atmoDay, smoothstep(-0.25, 0.75, sunO));
  float a = pow(clamp((1.0 - fres) / 0.27, 0.0, 1.0), 3.0) * smoothstep(-0.5, 1.0, sunO);
  gl_FragColor = vec4(atmo, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export async function createGL(canvasHost: HTMLElement, onLost: (why: string) => void): Promise<EarthBuild> {
  const canvas = document.createElement('canvas');
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onLost('WebGL context lost'); }, { once: true });
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false });
  if (!renderer.getContext()) throw new Error('no WebGL context');
  canvasHost.prepend(canvas);
  const gl2 = renderer.capabilities.isWebGL2;
  return {
    renderer,
    label: gl2 ? 'WebGL 2' : 'WebGL',
    maxTex: renderer.capabilities.maxTextureSize,
    earth(tex, sunDir, R, onTex) {
      const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      for (const t of [tex.day, tex.night, tex.brc]) t.anisotropy = aniso;
      const u = {
        tDay: { value: tex.day }, tNight: { value: tex.night }, tBrc: { value: tex.brc },
        sunDir: { value: sunDir.clone().normalize() },
        atmoDay: { value: new THREE.Color('#5fa9d6') }, atmoTwi: { value: new THREE.Color('#a85a2a') },
        ready: { value: 0 },
      };
      onTex(() => { u.ready.value = 1; });
      const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: EARTH_FRAG, uniforms: u });
      const sph = new THREE.SphereGeometry(R, 96, 96);
      const atmo = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false,
        uniforms: { sunDir: u.sunDir, atmoDay: u.atmoDay, atmoTwi: u.atmoTwi },
      });
      const am = new THREE.Mesh(sph, atmo); am.scale.setScalar(1.035);
      return [new THREE.Mesh(sph, mat), am];
    },
  };
}
