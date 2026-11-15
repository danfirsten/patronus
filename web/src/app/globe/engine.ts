/**
 * Patronus globe: three.js WebGPU renderer (falls back to its WebGL2 backend) + TSL Earth shading.
 * Own implementation of the day/night + clouds + atmosphere technique from the three.js
 * webgpu_tsl_earth example (MIT). Textures: NASA Blue Marble / Black Marble derived maps shipped
 * with the three.js examples (MIT; NASA imagery public domain).
 *
 * Decision layers: Lake Kariba as a height-field water surface (vertical scale exaggerated) driven
 * by simulated storage, a damped 2-D wave equation that runs when the level changes and settles,
 * a translucent P10-P90 band, a dam gauge, river flow particles scaled by release, import arcs
 * (tube radius by MW) with moving pulses, province fills that darken with demand cuts, plants,
 * rental and solar markers. All numbers come from the simulator; the motion is illustrative.
 */
import * as THREE from 'three/webgpu';
import { normalWorld, output, texture, vec3, vec4, normalize, positionWorld, bumpMap, cameraPosition, color, uniform, mix, uv, max, step } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type LL = [number, number];
type Poly = number[][][]; // rings of [lon, lat]
export interface GeoData {
  provinces: { properties: { name: string; lat: number; lon: number }; geometry: { type: string; coordinates: any } }[];
  countries: { properties: { iso3: string; name: string }; geometry: { type: string; coordinates: any } }[];
  rivers: { properties: { name: string }; geometry: { type: string; coordinates: any } }[];
  lakes: { properties: { name: string }; geometry: { type: string; coordinates: any } }[];
}

export interface Arc { id: string; from: LL; to: LL; mw: number; available: boolean; label: string }
export interface Pin { id: string; at: LL; label: string; kind: 'plant' | 'source' | 'reservoir'; mw?: number; dim?: boolean }
export interface SceneState {
  /** usable % for the lake surface (P50) and translucent band */
  level: number; band: [number, number] | null;
  /** ghost surface (replay counterfactual), usable % */
  ghost: number | null;
  holdPct: number; releaseFactor: number;
  arcs: Arc[]; cuts: Record<string, number>; rentalMw: number; solarMw: number;
  pins: Pin[]; selected: string | null;
  /** extra gauge columns for other reservoirs (replay), value 0-100 */
  gauges: { id: string; at: LL; value: number; label: string }[];
}
export type Pick = { kind: 'source' | 'plant' | 'province' | 'reservoir' | 'lake'; id: string };

const R = 1;
const EXAG = 0.00011; // globe units per 1% usable storage (~0.7 km per %): vertical scale exaggerated
const BASE = 0.0006;

export function ll(lon: number, lat: number, r = R) {
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const th = ((90 - lat) / 180) * Math.PI;
  return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(th), r * Math.cos(th), r * Math.sin(phi) * Math.sin(th));
}
const polysOf = (g: { type: string; coordinates: any }): Poly[] => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const linesOf = (g: { type: string; coordinates: any }): number[][][] => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);
function inRing(x: number, y: number, ring: number[][]) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
const inPoly = (x: number, y: number, p: Poly) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h));

const C = { ink: 0x0b1f2a, water: 0x2c7fa0, shallow: 0x8dc3d6, ring: 0xd9c9a3, rock: 0xb08945, line: 0xe8f1f4, danger: 0x6e4b1b };

/** Height-field lake with a damped wave equation (CPU, ~3k cells). */
class Lake {
  nx = 84; ny = 44;
  mask: Uint8Array; u: Float32Array; v: Float32Array;
  lon0: number; lat0: number; dlon: number; dlat: number;
  geo: THREE.BufferGeometry; mesh: THREE.Mesh;
  band: THREE.Mesh; ghost: THREE.Mesh; bed: THREE.Mesh;
  level = 30; target = 30; bandLo = 0; bandHi = 0; ghostLevel: number | null = null; ghostShown = 0;
  normals: THREE.Vector3[];
  energy = 0;
  constructor(poly: Poly, group: THREE.Group) {
    const xs = poly[0].map((p) => p[0]), ys = poly[0].map((p) => p[1]);
    this.lon0 = Math.min(...xs); this.lat0 = Math.min(...ys);
    this.dlon = (Math.max(...xs) - this.lon0) / (this.nx - 1);
    this.dlat = (Math.max(...ys) - this.lat0) / (this.ny - 1);
    const N = this.nx * this.ny;
    this.mask = new Uint8Array(N); this.u = new Float32Array(N); this.v = new Float32Array(N);
    this.normals = [];
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const lon = this.lon0 + i * this.dlon, lat = this.lat0 + j * this.dlat;
      this.normals.push(ll(lon, lat, 1));
      // a vertex is wet if it or a neighbour half-step away lies in the lake (keeps thin arms)
      const h = 0.5;
      this.mask[j * this.nx + i] = [[0, 0], [h, 0], [-h, 0], [0, h], [0, -h]].some(([a, b]) => inPoly(lon + a * this.dlon, lat + b * this.dlat, poly)) ? 1 : 0;
    }
    const idx: number[] = [];
    for (let j = 0; j < this.ny - 1; j++) for (let i = 0; i < this.nx - 1; i++) {
      const a = j * this.nx + i, b = a + 1, c = a + this.nx, d = c + 1;
      if (this.mask[a] && this.mask[b] && this.mask[c]) idx.push(a, c, b);
      if (this.mask[b] && this.mask[c] && this.mask[d]) idx.push(b, c, d);
    }
    const mk = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      g.setIndex(idx);
      return g;
    };
    this.geo = mk();
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ color: C.water, roughness: 0.18, metalness: 0.05, side: THREE.DoubleSide }));
    this.band = new THREE.Mesh(mk(), new THREE.MeshBasicMaterial({ color: C.shallow, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    this.ghost = new THREE.Mesh(mk(), new THREE.MeshBasicMaterial({ color: C.ring, transparent: true, opacity: 0.45, depthWrite: false, wireframe: true }));
    this.bed = new THREE.Mesh(mk(), new THREE.MeshBasicMaterial({ color: 0x3a3226, side: THREE.DoubleSide }));
    this.setFlat(this.bed.geometry, BASE * 0.6);
    this.mesh.userData.pick = { kind: 'lake', id: 'kariba' };
    group.add(this.bed, this.mesh, this.band, this.ghost);
  }
  setFlat(g: THREE.BufferGeometry, h: number) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < this.normals.length; k++) { const n = this.normals[k]; p.setXYZ(k, n.x * (R + h), n.y * (R + h), n.z * (R + h)); }
    p.needsUpdate = true; g.computeVertexNormals();
  }
  setTarget(pct: number, band: [number, number] | null, ghost: number | null) {
    const d = pct - this.target;
    if (Math.abs(d) > 0.05) this.kick(d);
    this.target = pct;
    this.bandLo = band ? band[0] : pct; this.bandHi = band ? band[1] : pct;
    this.band.visible = !!band && band[1] - band[0] > 0.5;
    this.ghostLevel = ghost; this.ghost.visible = ghost !== null;
    if (ghost !== null && this.ghostShown === 0) this.ghostShown = ghost;
  }
  /** a pulse from the dam end (east) plus a broad slosh, sized by the change */
  kick(d: number) {
    const amp = Math.max(-1, Math.min(1, d / 12)) * 2.2 + Math.sign(d) * 0.6;
    const ci = this.nx - 6, cj = Math.round(this.ny * 0.62);
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const k = j * this.nx + i; if (!this.mask[k]) continue;
      const r2 = ((i - ci) ** 2 + (j - cj) ** 2) / 30;
      this.u[k] += amp * Math.exp(-r2) + amp * 0.25 * Math.sin((i / this.nx) * Math.PI);
    }
    this.energy = 1;
  }
  /** returns true while still moving */
  step(dt: number) {
    const { nx, ny, mask, u, v } = this;
    const sub = 3, c2 = 0.22, damp = Math.pow(0.35, dt);
    for (let s = 0; s < sub; s++) {
      for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i; if (!mask[k]) continue;
        const n = (q: number) => (mask[q] ? u[q] : u[k]);
        v[k] += c2 * (n(k - 1) + n(k + 1) + n(k - nx) + n(k + nx) - 4 * u[k]);
      }
      for (let k = 0; k < u.length; k++) if (mask[k]) { v[k] *= Math.pow(damp, 1 / sub); u[k] += v[k] * 0.5; }
    }
    // mean level eases to the simulated value
    const a = 1 - Math.exp(-dt * 2.2);
    this.level += (this.target - this.level) * a;
    if (this.ghostLevel !== null) this.ghostShown += (this.ghostLevel - this.ghostShown) * a;
    let e = 0;
    const p = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const pb = this.band.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pg = this.ghost.geometry.getAttribute('position') as THREE.BufferAttribute;
    const hL = BASE + Math.max(0, this.level) * EXAG, hB = BASE + Math.max(0, this.bandHi) * EXAG, hG = BASE + Math.max(0, this.ghostShown) * EXAG;
    for (let k = 0; k < this.normals.length; k++) {
      const n = this.normals[k];
      const w = mask[k] ? u[k] * EXAG * 1.6 : 0;
      e += Math.abs(v[k]);
      const r = R + Math.max(BASE * 0.7, hL + w);
      p.setXYZ(k, n.x * r, n.y * r, n.z * r);
      pb.setXYZ(k, n.x * (R + hB), n.y * (R + hB), n.z * (R + hB));
      pg.setXYZ(k, n.x * (R + hG), n.y * (R + hG), n.z * (R + hG));
    }
    p.needsUpdate = true; pb.needsUpdate = true; pg.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.energy = e / 500;
    return this.energy > 0.002 || Math.abs(this.target - this.level) > 0.05;
  }
}

/** Particles flowing along a polyline (rivers, arcs). */
class Flow {
  pts: THREE.Vector3[]; len: number[]; total: number;
  mesh: THREE.InstancedMesh; t: Float32Array; speed: number; count = 0;
  dummy = new THREE.Object3D();
  constructor(pts: THREE.Vector3[], max: number, size: number, col: number, speed: number, group: THREE.Group) {
    this.pts = pts; this.len = [0];
    for (let i = 1; i < pts.length; i++) this.len.push(this.len[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.total = this.len[this.len.length - 1] || 1;
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(size, 6, 4), new THREE.MeshBasicMaterial({ color: col }), max);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.t = new Float32Array(max).map((_, i) => i / max);
    this.speed = speed;
    group.add(this.mesh);
  }
  at(f: number, out: THREE.Vector3) {
    const d = f * this.total;
    let i = 1; while (i < this.len.length - 1 && this.len[i] < d) i++;
    const s = (d - this.len[i - 1]) / Math.max(1e-9, this.len[i] - this.len[i - 1]);
    return out.lerpVectors(this.pts[i - 1], this.pts[i], s);
  }
  step(dt: number) {
    const n = this.count; this.mesh.count = n;
    for (let k = 0; k < n; k++) {
      this.t[k] = (this.t[k] + (dt * this.speed) / this.total) % 1;
      this.at(this.t[k], this.dummy.position); this.dummy.updateMatrix();
      this.mesh.setMatrixAt(k, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.removeFromParent(); }
}

export class GlobeEngine {
  renderer!: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  controls!: OrbitControls;
  clock = new THREE.Clock();
  el: HTMLElement; labels: HTMLDivElement;
  overlay = new THREE.Group(); dyn = new THREE.Group();
  lake: Lake | null = null;
  provinceFills = new Map<string, THREE.Mesh>();
  provinceLines = new Map<string, THREE.LineSegments>();
  rivers: Flow[] = []; arcFlows: Flow[] = [];
  gauge: THREE.Group | null = null; gaugeFill: THREE.Mesh | null = null;
  holdRing: THREE.Mesh | null = null;
  labelEls = new Map<string, { el: HTMLDivElement; pos: THREE.Vector3 }>();
  pickables: THREE.Object3D[] = [];
  onPick: (p: Pick) => void = () => {};
  fly: { t: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3 } | null = null;
  running = true; disposed = false; backend = 'webgpu';
  state: SceneState | null = null;
  ro: ResizeObserver; io: IntersectionObserver; visible = true;

  constructor(el: HTMLElement) {
    this.el = el;
    this.labels = document.createElement('div');
    this.labels.className = 'globe-labels';
    el.appendChild(this.labels);
    this.ro = new ResizeObserver(() => this.resize());
    this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; });
  }

  async init(geo: GeoData) {
    const renderer = new THREE.WebGPURenderer({ antialias: true });
    await renderer.init();
    this.backend = (renderer.backend as any)?.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer = renderer;
    this.el.prepend(renderer.domElement);
    renderer.domElement.className = 'globe-canvas';
    this.buildEarth();
    this.buildOverlay(geo);
    this.scene.add(this.overlay, this.dyn);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.05; this.controls.maxDistance = 5;
    this.controls.rotateSpeed = 0.5; this.controls.zoomSpeed = 0.7;
    // open on southern Africa
    const sa = ll(26, -18, 1);
    this.camera.position.copy(sa.clone().multiplyScalar(4.6));
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);
    this.ro.observe(this.el); this.io.observe(this.el);
    this.resize();
    this.bindPick();
    renderer.setAnimationLoop(() => this.frame());
  }

  buildEarth() {
    const tl = new THREE.TextureLoader();
    const day = tl.load('tex/earth_day_4096.jpg'); day.colorSpace = THREE.SRGBColorSpace; day.anisotropy = 8;
    const night = tl.load('tex/earth_night_4096.jpg'); night.colorSpace = THREE.SRGBColorSpace; night.anisotropy = 8;
    const brc = tl.load('tex/earth_bump_roughness_clouds_4096.jpg'); brc.anisotropy = 8;
    // sun from the west-north-west of southern Africa: the terminator falls over the Indian Ocean
    const sunDir = ll(-8, 10, 1).normalize();
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.copy(sunDir.clone().multiplyScalar(5));
    this.scene.add(sun, new THREE.AmbientLight('#ffffff', 0.25));

    const dayAtmo = uniform(color('#5fa9d6')), twilight = uniform(color('#a85a2a'));
    const view = positionWorld.sub(cameraPosition).normalize();
    const fres = view.dot(normalWorld).abs().oneMinus().toVar();
    const sunO = normalWorld.dot(normalize(vec3(sunDir.x, sunDir.y, sunDir.z))).toVar();
    const atmoCol = mix(twilight, dayAtmo, sunO.smoothstep(-0.25, 0.75));
    const mat = new THREE.MeshStandardNodeMaterial();
    const clouds = texture(brc, uv()).b.smoothstep(0.2, 1);
    mat.colorNode = mix(texture(day), vec3(1), clouds.mul(1.6));
    // ocean is low roughness in the G channel: specular sun glint on water, matte land and clouds
    mat.roughnessNode = max(texture(brc).g, step(0.01, clouds)).remap(0, 1, uniform(0.22), uniform(0.4));
    const dayK = sunO.smoothstep(-0.25, 0.5);
    let out = mix(texture(night).rgb, output.rgb, dayK);
    out = mix(out, atmoCol, sunO.smoothstep(-0.5, 1).mul(fres.pow(2)).clamp(0, 1));
    mat.outputNode = vec4(out, output.a);
    mat.normalNode = bumpMap(max(texture(brc).r, clouds));
    const sph = new THREE.SphereGeometry(R, 96, 96);
    this.scene.add(new THREE.Mesh(sph, mat));
    const atmo = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false });
    atmo.outputNode = vec4(atmoCol, fres.remap(0.73, 1, 1, 0).pow(3).mul(sunO.smoothstep(-0.5, 1)));
    const am = new THREE.Mesh(sph, atmo); am.scale.setScalar(1.035);
    this.scene.add(am);
  }

  lineMat(col: number, op: number) { return new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false }); }

  ringSegs(ring: number[][], r: number) {
    const v: number[] = [];
    for (let i = 1; i < ring.length; i++) {
      const a = ll(ring[i - 1][0], ring[i - 1][1], r), b = ll(ring[i][0], ring[i][1], r);
      v.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    return v;
  }

  buildOverlay(geo: GeoData) {
    // neighbour outlines
    const cv: number[] = [];
    for (const f of geo.countries) for (const p of polysOf(f.geometry)) cv.push(...this.ringSegs(p[0], R + 0.0012));
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cv, 3));
    this.overlay.add(new THREE.LineSegments(cg, this.lineMat(C.line, 0.4)));
    // provinces: fill (darkens with cuts) + outline
    for (const f of geo.provinces) {
      const name = f.properties.name;
      const pos: number[] = [], lv: number[] = [];
      for (const p of polysOf(f.geometry)) {
        const outer = p[0].slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y));
        const holes = p.slice(1).map((h) => h.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y)));
        const tris = THREE.ShapeUtils.triangulateShape(outer, holes);
        const all = [...outer, ...holes.flat()];
        for (const t of tris) for (const k of t) { const q = ll(all[k].x, all[k].y, R + 0.0014); pos.push(q.x, q.y, q.z); }
        lv.push(...this.ringSegs(p[0], R + 0.0016));
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
      m.userData.pick = { kind: 'province', id: name };
      this.provinceFills.set(name, m); this.pickables.push(m); this.overlay.add(m);
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lv, 3));
      const l = new THREE.LineSegments(lg, this.lineMat(C.ring, 0.55));
      this.provinceLines.set(name, l); this.overlay.add(l);
    }
    // rivers with flow particles (Zambezi downstream of Kariba scales with release)
    for (const f of geo.rivers) for (const line of linesOf(f.geometry)) {
      const pts = line.map(([x, y]) => ll(x, y, R + 0.0018));
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      this.overlay.add(new THREE.Line(g, this.lineMat(C.shallow, 0.85)));
      // rivers in Natural Earth run downstream; keep the parts near Kariba / Kafue
      const fl = new Flow(pts, 90, 0.0008, 0xcfe8f1, 0.02, this.dyn);
      fl.count = 30; this.rivers.push(fl);
    }
    const kar = geo.lakes.find((f) => /Kariba/.test(f.properties.name));
    if (kar) {
      const p = polysOf(kar.geometry).sort((a, b) => b[0].length - a[0].length)[0];
      this.lake = new Lake(p, this.overlay); this.pickables.push(this.lake.mesh);
    }
    // dam gauge: 0-100% usable column with 10% and 20% rings
    const dam = ll(28.7619, -16.5222, R);
    const up = dam.clone().normalize();
    const gg = new THREE.Group();
    const H = 100 * EXAG * 1.2;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, H, 16, 1, true), new THREE.MeshBasicMaterial({ color: C.line, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
    shell.position.y = H / 2; gg.add(shell);
    this.gaugeFill = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 1, 16), new THREE.MeshStandardMaterial({ color: C.water, roughness: 0.3 }));
    gg.add(this.gaugeFill);
    for (const [pct, col] of [[20, C.rock], [10, C.danger]] as const) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0028, 0.00035, 6, 24), new THREE.MeshBasicMaterial({ color: col }));
      ring.rotation.x = Math.PI / 2; ring.position.y = pct * EXAG * 1.2; gg.add(ring);
    }
    this.holdRing = new THREE.Mesh(new THREE.TorusGeometry(0.004, 0.0009, 8, 32), new THREE.MeshStandardMaterial({ color: C.shallow, roughness: 0.3 }));
    this.holdRing.rotation.x = Math.PI / 2; gg.add(this.holdRing);
    gg.position.copy(dam.clone().multiplyScalar(R + 0.0004));
    gg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    gg.translateX(0.004);
    this.gauge = gg; this.overlay.add(gg);
  }

  /** columns standing on the surface */
  column(at: LL, h: number, rad: number, col: number, op = 1) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, h, 12), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, transparent: op < 1, opacity: op }));
    const n = ll(at[0], at[1], 1);
    m.position.copy(n.clone().multiplyScalar(R + h / 2));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    return m;
  }

  label(id: string, text: string, pos: THREE.Vector3, cls = '') {
    let L = this.labelEls.get(id);
    if (!L) {
      const el = document.createElement('div');
      el.className = `globe-label ${cls}`;
      this.labels.appendChild(el);
      L = { el, pos };
      this.labelEls.set(id, L);
    }
    L.pos = pos; L.el.className = `globe-label ${cls}`; L.el.textContent = text;
  }

  setState(s: SceneState) {
    const prev = this.state; this.state = s;
    this.lake?.setTarget(s.level, s.band, s.ghost);
    if (this.gaugeFill) {
      const h = Math.max(0.0001, s.level * EXAG * 1.2);
      this.gaugeFill.scale.y = h; this.gaugeFill.position.y = h / 2;
    }
    if (this.holdRing) { this.holdRing.visible = s.holdPct > 0; this.holdRing.scale.setScalar(0.6 + s.holdPct / 25); this.holdRing.position.y = Math.max(0.0005, s.level * EXAG * 1.2); }
    for (const [name, m] of this.provinceFills) {
      const c = s.cuts[name] ?? 0;
      (m.material as THREE.MeshBasicMaterial).opacity = c > 0 ? 0.18 + (c / 30) * 0.55 : 0.0;
      (this.provinceLines.get(name)!.material as THREE.LineBasicMaterial).opacity = s.selected === name ? 1 : 0.5;
      (this.provinceLines.get(name)!.material as THREE.LineBasicMaterial).color.setHex(s.selected === name ? 0xffffff : C.ring);
    }
    for (const r of this.rivers) r.count = Math.round(10 + 60 * s.releaseFactor);
    // rebuild dynamic markers only when they changed
    const key = JSON.stringify([s.arcs, s.pins, s.rentalMw, s.solarMw, s.selected, s.gauges]);
    if (prev && JSON.stringify([prev.arcs, prev.pins, prev.rentalMw, prev.solarMw, prev.selected, prev.gauges]) === key) return;
    for (const f of this.arcFlows) f.dispose();
    this.arcFlows = [];
    for (const o of [...this.dyn.children]) if (!this.rivers.some((r) => r.mesh === o)) { this.dyn.remove(o); (o as any).geometry?.dispose?.(); }
    this.pickables = this.pickables.filter((o) => !(o.userData.pick && (o.userData.pick.kind === 'source' || o.userData.pick.kind === 'plant' || o.userData.pick.kind === 'reservoir')));
    const seen = new Set<string>();
    for (const a of s.arcs) {
      const p0 = ll(a.from[0], a.from[1], R + 0.002), p1 = ll(a.to[0], a.to[1], R + 0.002);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const d = p0.distanceTo(p1);
      const ctrl = mid.normalize().multiplyScalar(R + 0.02 + d * 0.35);
      const curve = new THREE.QuadraticBezierCurve3(p0, ctrl, p1);
      const sel = s.selected === a.id;
      // anchor (clickable)
      const anchor = this.column(a.from, 0.008, 0.0035, a.available ? (sel ? 0xffffff : C.ring) : 0x7a7a7a);
      anchor.userData.pick = { kind: 'source', id: a.id };
      this.dyn.add(anchor); this.pickables.push(anchor);
      this.label(`src-${a.id}`, a.label, ll(a.from[0], a.from[1], R + 0.012), `${a.available ? '' : 'is-off'} ${sel ? 'is-sel' : ''}`); seen.add(`src-${a.id}`);
      if (!a.available || a.mw <= 0) continue;
      const rad = 0.0007 + (a.mw / 650) * 0.0045;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, rad, 8, false), new THREE.MeshStandardMaterial({ color: C.rock, roughness: 0.5, transparent: true, opacity: 0.85 }));
      tube.userData.pick = { kind: 'source', id: a.id };
      this.dyn.add(tube); this.pickables.push(tube);
      const fl = new Flow(curve.getPoints(80), 24, rad * 1.5, 0xffffff, 0.12, this.dyn);
      fl.count = Math.max(3, Math.round(a.mw / 25)); this.arcFlows.push(fl);
    }
    for (const p of s.pins) {
      const sel = s.selected === p.id;
      const h = p.kind === 'plant' ? 0.002 + (p.mw ?? 0) * 0.000004 : 0.006;
      const m = this.column(p.at, h, p.kind === 'plant' ? 0.0022 : 0.003, sel ? 0xffffff : p.dim ? 0x8a8a8a : C.ink);
      m.userData.pick = { kind: p.kind, id: p.id };
      this.dyn.add(m); this.pickables.push(m);
      this.label(`pin-${p.id}`, p.label, ll(p.at[0], p.at[1], R + h + 0.003), `is-${p.kind} ${sel ? 'is-sel' : ''}`); seen.add(`pin-${p.id}`);
    }
    for (const g of s.gauges) {
      const H = 0.03;
      this.dyn.add(this.column(g.at, H, 0.004, C.line, 0.25));
      this.dyn.add(this.column(g.at, Math.max(0.0005, (g.value / 100) * H), 0.0034, C.water));
      const hit = this.column(g.at, H, 0.007, 0xffffff, 0.001); hit.userData.pick = { kind: 'reservoir', id: g.id };
      this.dyn.add(hit); this.pickables.push(hit);
      this.label(`g-${g.id}`, g.label, ll(g.at[0], g.at[1], R + H + 0.004), s.selected === g.id ? 'is-sel' : ''); seen.add(`g-${g.id}`);
    }
    // rental (diesel units near Lusaka) and solar markers
    if (s.rentalMw > 0) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: C.danger, roughness: 0.7 }));
      const sz = 0.003 + s.rentalMw * 0.000012; const n = ll(27.9, -15.2, 1);
      m.scale.set(sz, sz, sz); m.position.copy(n.clone().multiplyScalar(R + sz / 2)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      this.dyn.add(m); this.label('rental', `Rental ${s.rentalMw} MW`, ll(27.9, -15.2, R + sz + 0.003), 'is-act'); seen.add('rental');
    }
    if (s.solarMw > 0) {
      const sz = 0.004 + s.solarMw * 0.00002; const n = ll(28.8, -14.9, 1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(sz, 0.0006, sz), new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.2, metalness: 0.3 }));
      m.position.copy(n.clone().multiplyScalar(R + 0.0006)); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      this.dyn.add(m); this.label('solar', `Solar ${s.solarMw} MW`, ll(28.8, -14.9, R + 0.004), 'is-act'); seen.add('solar');
    }
    for (const [id, L] of this.labelEls) if (!seen.has(id)) { L.el.remove(); this.labelEls.delete(id); }
  }

  flyTo(at: LL, dist = 0.42, dur = 2.6, tilt = 0.75) {
    const t1 = ll(at[0], at[1], R);
    const n = t1.clone().normalize();
    const south = new THREE.Vector3(0, -1, 0).projectOnPlane(n).normalize();
    const p1 = t1.clone().add(n.clone().multiplyScalar(dist * Math.cos(tilt))).add(south.multiplyScalar(dist * Math.sin(tilt)));
    this.fly = { t: 0, dur, p0: this.camera.position.clone(), p1, t0: this.controls.target.clone(), t1 };
  }

  bindPick() {
    const ray = new THREE.Raycaster();
    let down: [number, number] | null = null;
    const cv = this.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    cv.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const r = cv.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.pickables, false).find((h) => h.object.userData.pick);
      if (hit) this.onPick(hit.object.userData.pick as Pick);
    });
  }

  resize() {
    if (!this.renderer) return;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`; this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  frame() {
    if (this.disposed || !this.visible || document.hidden) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.fly) {
      this.fly.t += dt;
      const k = Math.min(1, this.fly.t / this.fly.dur), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      // arc over the surface: slerp the direction, lerp the distance
      const d0 = this.fly.p0.length(), d1 = this.fly.p1.length();
      const dir = this.fly.p0.clone().normalize().lerp(this.fly.p1.clone().normalize(), e).normalize();
      this.camera.position.copy(dir.multiplyScalar(d0 + (d1 - d0) * e));
      this.controls.target.lerpVectors(this.fly.t0, this.fly.t1, e);
      if (k >= 1) this.fly = null;
    }
    this.controls.update();
    this.lake?.step(dt);
    for (const r of this.rivers) r.step(dt);
    for (const f of this.arcFlows) f.step(dt);
    this.renderer.render(this.scene, this.camera);
    // labels
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const cam = this.camera.position;
    for (const L of this.labelEls.values()) {
      const facing = L.pos.clone().normalize().dot(cam.clone().sub(L.pos).normalize()) > 0.05;
      const p = L.pos.clone().project(this.camera);
      const show = facing && p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05 && cam.length() < 2.2;
      L.el.style.display = show ? '' : 'none';
      if (show) L.el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }

  dispose() {
    this.disposed = true;
    this.ro.disconnect(); this.io.disconnect();
    this.renderer?.setAnimationLoop(null);
    this.controls?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.labels.remove();
  }
}

