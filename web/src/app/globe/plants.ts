/**
 * Map-page globe: reuses the Patronus dashboard Earth (engine.ts, shared with the Plan dashboard on
 * fd/plan-simulator: same WebGPU/TSL day-night, clouds, atmosphere) and replaces its Kariba decision
 * layers with the global layers: every GPPD hydro plant as a column (height ~ sqrt(MW)), coloured by
 * the GRACE water-storage trend of its basin, and the 31 G-REALM reservoirs as rings coloured by
 * watch tier that pulse when the tier is warning or danger.
 */
import * as THREE from 'three/webgpu';
import { GlobeEngine, ll, type GeoData, type LL } from './engine';

/** [lon, lat, mw, name, iso3, gppd_id, trend 'd'|'w'|'n'|null, basin name, reservoir id] */
export type PlantRow = [number, number, number, string, string, string, 'd' | 'w' | 'n' | null, string | null, string | null];
export interface ResMarker { id: string; name: string; at: LL; tier: string; mw: number }
export type GlobePick = { kind: 'plant'; index: number } | { kind: 'reservoir'; id: string };

export const TREND_COL: Record<string, number> = { d: 0xc4a266, w: 0x6faec6, n: 0xc2ccd0, x: 0xc2ccd0 };
export const TIER_COL: Record<string, number> = { danger: 0x6e4b1b, warning: 0xb08945, watch: 0xd9c29a, low: 0xe8f1f4 };
/** Southern Africa plants that get a permanent label when zoomed in. */
const LABEL = /^(Kariba|Kariba Dam South|Kafue Gorge|Itezhi|Cahora Bassa)/;

/** Short label: GPPD lists Kariba North as 'Kariba' and the south bank as a long name. */
export const shortName = (n: string) => /^Kariba Dam South/.test(n) ? 'Kariba South' : n === 'Kariba' ? 'Kariba North' : n.replace(/-\s+/, '-');
export const colH = (mw: number) => 0.0015 + Math.sqrt(Math.max(mw, 0)) * 0.0005;
const colR = (mw: number) => 0.0016 + Math.sqrt(Math.max(mw, 0)) * 0.00004;

export class PlantGlobe extends GlobeEngine {
  plants: PlantRow[] = [];
  plantMesh: THREE.InstancedMesh | null = null;
  rings: { m: THREE.Mesh; tier: string; id: string }[] = [];
  onPickItem: (p: GlobePick) => void = () => {};
  t = 0;
  selMesh: THREE.Mesh | null = null;

  /** Global view: no Kariba lake / gauge / provinces, just the Earth. */
  override buildOverlay(_geo: GeoData) {}

  setLayers(plants: PlantRow[], res: ResMarker[]) {
    this.plants = plants;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 10);
    geo.translate(0, 0.5, 0); // base on the surface
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.0 });
    const im = new THREE.InstancedMesh(geo, mat, plants.length);
    const o = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    // plants sharing a site (e.g. Kariba North and South) are nudged apart so both columns show
    const seen = new Map<string, number>();
    plants.forEach((p, i) => {
      const key = `${p[0]},${p[1]}`; const k = seen.get(key) ?? 0; seen.set(key, k + 1);
      const n = ll(p[0] + k * 0.035, p[1] - k * 0.02, 1);
      o.position.copy(n).multiplyScalar(1.0004);
      o.quaternion.setFromUnitVectors(up, n);
      const r = colR(p[2]); o.scale.set(r, colH(p[2]), r);
      o.updateMatrix(); im.setMatrixAt(i, o.matrix);
      im.setColorAt(i, c.setHex(TREND_COL[p[6] ?? 'x']));
      if (LABEL.test(p[3]) && Math.abs(p[1] + 16) < 4) this.label(`p-${i}`, shortName(p[3]), ll(p[0] + k * 0.035, p[1] - k * 0.02 - k * 0.22, 1 + colH(p[2]) * (k ? 0.2 : 1) + 0.002), 'is-plant');
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.userData.pick = { kind: 'plants' };
    this.plantMesh = im; this.scene.add(im);
    for (const r of res) {
      const n = ll(r.at[0], r.at[1], 1);
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0016, 8, 40), new THREE.MeshBasicMaterial({ color: TIER_COL[r.tier] ?? TIER_COL.low, transparent: true, opacity: 0.95, depthWrite: false }));
      m.position.copy(n).multiplyScalar(1.0012);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      m.userData.pick = { kind: 'reservoir', id: r.id };
      this.scene.add(m); this.rings.push({ m, tier: r.tier, id: r.id });
    }
  }

  select(at: LL | null, h = 0.02) {
    if (this.selMesh) { this.scene.remove(this.selMesh); this.selMesh.geometry.dispose(); this.selMesh = null; }
    if (!at) return;
    const n = ll(at[0], at[1], 1);
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0008, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    m.position.copy(n).multiplyScalar(1 + Math.min(h, 0.08) + 0.003);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.selMesh = m; this.scene.add(m);
  }

  override bindPick() {
    const ray = new THREE.Raycaster();
    let down: [number, number] | null = null;
    const cv = this.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    cv.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const r = cv.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const objs: THREE.Object3D[] = [...this.rings.map((x) => x.m)]; if (this.plantMesh) objs.push(this.plantMesh);
      const hits = ray.intersectObjects(objs, false);
      // hits behind the globe are hidden: keep only those nearer than the Earth surface along the ray
      const earth = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
      const lim = earth ? earth.distanceTo(ray.ray.origin) + 0.01 : Infinity;
      const hit = hits.find((h) => h.distance <= lim + 0.1);
      if (!hit) return;
      if (hit.object === this.plantMesh && hit.instanceId !== undefined) this.onPickItem({ kind: 'plant', index: hit.instanceId });
      else if (hit.object.userData.pick?.kind === 'reservoir') this.onPickItem({ kind: 'reservoir', id: hit.object.userData.pick.id });
    });
  }

  override frame() {
    if (this.disposed || !this.visible || document.hidden) return;
    this.t += 1 / 60;
    for (const r of this.rings) {
      const hot = r.tier === 'danger' || r.tier === 'warning';
      const s = hot ? 1 + 0.35 * (0.5 + 0.5 * Math.sin(this.t * (r.tier === 'danger' ? 3.2 : 2.2))) : 1;
      r.m.scale.setScalar(s);
    }
    super.frame();
  }

  override dispose() {
    this.plantMesh?.geometry.dispose();
    for (const r of this.rings) r.m.geometry.dispose();
    super.dispose();
  }
}
