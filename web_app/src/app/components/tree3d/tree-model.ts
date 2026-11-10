/**
 * The fir tree: stacked smooth "skirts" with rounded scalloped branch tips,
 * each topped with a soft snow cap that has a wavy rounded edge.
 *
 * Every tier is a closed, smooth (indexed) surface: a convex top slope that ends
 * in a drooping scalloped rim, then rolls under and closes on the axis. The tier
 * above always overhangs the tier below, so all intersections stay hidden under
 * the skirts. Ball slots and the garland use treeRadius(), which is computed from
 * the same profile functions, so it matches the geometry.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface TreeKit {
  toon(color: number, extra?: Partial<THREE.MeshToonMaterialParameters>): THREE.MeshToonMaterial;
  /** Outline: back faces of `smooth` (or the mesh geometry) pushed out along normals */
  hull(mesh: THREE.Mesh, thickness?: number, smooth?: THREE.BufferGeometry): THREE.Mesh;
  /** Soft snow material */
  snow(): THREE.MeshToonMaterial;
}

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

// Tree tiers: [bottom y, height, radius]
export const TIERS: [number, number, number][] = [
  [0.75, 1.45, 2.1],
  [1.4, 1.35, 1.85],
  [2.0, 1.3, 1.58],
  [2.6, 1.2, 1.3],
  [3.15, 1.1, 1.02],
  [3.7, 1.0, 0.76],
  [4.2, 0.95, 0.5],
];
export const TREE_TOP = 5.15;

// ---- Shared tier profile (geometry and treeRadius use the same functions) ---- //

/** Number of branch tips (lobes) around a tier */
const lobeCount = (i: number) => [13, 12, 11, 10, 9, 8, 7][i] ?? 7;
/** Branch tips stick out by this much, valleys pull in */
const TIP_OUT = 0.07;
const VALLEY_IN = 0.12;
/** Rim droop: valleys and tips */
const DROOP = 0.08;
const DROOP_TIP = 0.12;
const LOBE_POW = 0.6;

/** 0 in the valleys, 1 on the branch tips: broad round branch ends, narrow notches between */
function lobeShape(i: number, theta: number): number {
  const c = 0.5 + 0.5 * Math.cos(lobeCount(i) * theta);
  return Math.pow(c, LOBE_POW);
}

/** Mean of lobeShape() around the circle */
const LOBE_MEAN = (() => {
  let sum = 0;
  for (let k = 0; k < 360; k++) sum += Math.pow(0.5 + 0.5 * Math.cos((k / 360) * Math.PI * 2), LOBE_POW);
  return sum / 360;
})();

/** Slow, smooth variation of the tip length around the tier (no jitter) */
function lobeAmp(i: number, theta: number): number {
  return 1 + 0.035 * Math.sin(3 * theta + i * 1.7) + 0.025 * Math.sin(5 * theta + i * 2.9);
}

/** Radial factor (1 = plain cone) at fraction f down the tier */
function radialFactor(f: number, lobe: number, amp: number): number {
  const w = f * f;
  return 1 + w * (((1 + TIP_OUT) * lobe + (1 - VALLEY_IN) * (1 - lobe)) * amp - 1);
}

/** Downward droop of the slope towards the rim */
function droop(f: number, lobe: number): number {
  return (DROOP + DROOP_TIP * lobe) * f * f * f;
}

/** Point on the top slope of tier i: f = 0 at the apex, 1 at the rim */
function slope(i: number, f: number, theta: number, out: THREE.Vector3): THREE.Vector3 {
  const [bottom, h, r] = TIERS[i];
  const lobe = lobeShape(i, theta);
  const rad = r * Math.pow(f, 0.85) * radialFactor(f, lobe, lobeAmp(i, theta));
  const y = bottom + h - h * f - droop(f, lobe);
  return out.set(Math.cos(theta) * rad, y, Math.sin(theta) * rad);
}

/** Outward normal of the top slope (finite differences) */
function slopeNormal(i: number, f: number, theta: number, out: THREE.Vector3): THREE.Vector3 {
  const e = 1e-3;
  const fa = Math.max(f - e, 1e-3);
  const fb = Math.min(f + e, 1);
  const a = slope(i, fa, theta, new THREE.Vector3());
  const b = slope(i, fb, theta, new THREE.Vector3());
  const c = slope(i, Math.max(f, 2e-3), theta - e, new THREE.Vector3());
  const d = slope(i, Math.max(f, 2e-3), theta + e, new THREE.Vector3());
  const df = b.sub(a);
  const dt = d.sub(c);
  return out.crossVectors(df, dt).normalize().multiplyScalar(-1);
}

/** Fraction down tier i at which its slope reaches height y (averaged around the tier) */
function fractionAt(i: number, y: number): number {
  const [bottom, h] = TIERS[i];
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    const ym = bottom + h - h * mid - droop(mid, LOBE_MEAN);
    if (ym > y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Outer radius of the silhouette at height y (mean over the branch tips and valleys) */
export function treeRadius(y: number): number {
  let r = 0;
  TIERS.forEach(([bottom, h, radius], i) => {
    const rimY = bottom - droop(1, LOBE_MEAN);
    if (y < rimY || y > bottom + h) return;
    const f = fractionAt(i, y);
    const mean = radialFactor(f, LOBE_MEAN, 1);
    r = Math.max(r, radius * Math.pow(f, 0.85) * mean);
  });
  return r;
}

// ---- Geometry ---- //

/**
 * Indexed grid of rings (wrapping around without a seam, so normals are smooth).
 * Optional single apex vertices close the top and the bottom.
 */
function ringGeometry(
  rings: THREE.Vector3[][],
  colors: THREE.Color[][] | null,
  topApex: THREE.Vector3 | null,
  bottomApex: THREE.Vector3 | null,
  apexColors?: [THREE.Color, THREE.Color],
): THREE.BufferGeometry {
  const m = rings[0].length;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  rings.forEach((ring, ri) =>
    ring.forEach((p, k) => {
      pos.push(p.x, p.y, p.z);
      if (colors) col.push(colors[ri][k].r, colors[ri][k].g, colors[ri][k].b);
    }),
  );
  const at = (ri: number, k: number) => ri * m + (k % m);
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let k = 0; k < m; k++) {
      const a = at(ri, k);
      const b = at(ri, k + 1);
      const c = at(ri + 1, k);
      const d = at(ri + 1, k + 1);
      // Rings go from top to bottom, theta counter-clockwise seen from above: outward faces
      idx.push(a, b, c, b, d, c);
    }
  }
  if (topApex) {
    const t = pos.length / 3;
    pos.push(topApex.x, topApex.y, topApex.z);
    if (colors && apexColors) col.push(apexColors[0].r, apexColors[0].g, apexColors[0].b);
    for (let k = 0; k < m; k++) idx.push(t, at(0, k + 1), at(0, k));
  }
  if (bottomApex) {
    const t = pos.length / 3;
    const last = rings.length - 1;
    pos.push(bottomApex.x, bottomApex.y, bottomApex.z);
    if (colors && apexColors) col.push(apexColors[1].r, apexColors[1].g, apexColors[1].b);
    for (let k = 0; k < m; k++) idx.push(t, at(last, k), at(last, k + 1));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  // Winding check: make the faces point outwards whatever the ring direction is
  geo.computeVertexNormals();
  return geo;
}

const GREEN = new THREE.Color(0x23935a);
const GREEN_TIP = new THREE.Color(0x2ea866);
const GREEN_DEEP = new THREE.Color(0x166b45);
const GREEN_UNDER = new THREE.Color(0x0f4f37);

/** Columns around tier i: several per lobe so the tips are round */
const columns = (i: number) => lobeCount(i) * 7;
/** Snow needs more columns: its wavy edge must stay round */
const snowColumns = (i: number) => lobeCount(i) * 9;

function buildTier(i: number): THREE.BufferGeometry {
  const [bottom, h] = TIERS[i];
  const m = columns(i);
  const rings: THREE.Vector3[][] = [];
  const colors: THREE.Color[][] = [];
  const p = new THREE.Vector3();
  // Top slope: a few rows under the tier above, dense rows on the visible band
  const above = TIERS[i + 1];
  const fVis = above ? Math.max(0.2, fractionAt(i, above[0] + 0.1)) : 0.12;
  const fs: number[] = [];
  for (let k = 1; k <= 2; k++) fs.push((fVis * k) / 2);
  for (let k = 1; k <= 8; k++) fs.push(fVis + (1 - fVis) * (1 - Math.pow(1 - k / 8, 1.3)));
  for (const f of fs) {
    const ring: THREE.Vector3[] = [];
    const cs: THREE.Color[] = [];
    for (let k = 0; k < m; k++) {
      const theta = (k / m) * Math.PI * 2;
      ring.push(slope(i, f, theta, p).clone());
      const lobe = lobeShape(i, theta);
      // Valleys are deeper in shade, tips catch light
      const c = GREEN_DEEP.clone().lerp(GREEN, Math.min(1, lobe * 1.6 + (1 - f) * 0.5));
      if (lobe > 0.6 && f > 0.8) c.lerp(GREEN_TIP, (lobe - 0.6) * 2.5 * (f - 0.8) * 5);
      cs.push(c);
    }
    rings.push(ring);
    colors.push(cs);
  }
  // Rounded rim roll and the underside closing towards the axis
  const under: [number, number, number][] = [
    // [radial scale of the rim, y offset (in h), colour blend to the underside]
    [0.985, 0.025, 0.4],
    [0.92, 0.06, 0.85],
    [0.55, 0.16, 1],
  ];
  const rim = rings[rings.length - 1];
  under.forEach(([s, dy, blend]) => {
    rings.push(rim.map((q) => new THREE.Vector3(q.x * s, q.y + dy * h, q.z * s)));
    colors.push(rim.map(() => GREEN_DEEP.clone().lerp(GREEN_UNDER, blend)));
  });
  const apex = slope(i, 0, 0, new THREE.Vector3());
  return ringGeometry(rings, colors, apex, new THREE.Vector3(0, bottom + h * 0.3, 0), [GREEN, GREEN_UNDER]);
}

/**
 * Soft snow cap on tier i: a smooth blanket lying on the slope, from under the
 * tier above down to a wavy edge (further down along every branch), ending in a
 * rounded lip that tucks into the needles. Thickness varies slowly: lumpy, not noisy.
 */
function buildSnow(i: number): THREE.BufferGeometry {
  const [, h, r] = TIERS[i];
  const m = snowColumns(i);
  const n = lobeCount(i);
  // Where the tier above hides the slope (snow starts under it)
  const above = TIERS[i + 1];
  const fHidden = above ? fractionAt(i, above[0] + 0.12) : 0.02;
  const fVisible = above ? fractionAt(i, above[0] - droop(1, 0)) : 0;
  const thick = 0.06 + r * 0.03;
  // Rows across the blanket: denser at the rounded edge
  const ts = [0, 0.25, 0.45, 0.6, 0.72, 0.82, 0.89, 0.94, 0.975, 1];
  const rings: THREE.Vector3[][] = [];
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (const t of ts) {
    const ring: THREE.Vector3[] = [];
    for (let k = 0; k < m; k++) {
      const theta = (k / m) * Math.PI * 2;
      const lobe = lobeShape(i, theta);
      // Wavy edge: snow runs further down each branch; slow irregularity between tiers
      const wobble = 0.05 * Math.sin(2 * theta + i * 2.3) + 0.04 * Math.sin(3 * theta + i);
      const c = 0.5 + 0.5 * Math.cos(n * theta);
      const bulge = 1 - (1 - c) * (1 - c); // wide round bulges, narrow cusps in the valleys
      const reach = (above ? 0.2 : 0.32) + 0.36 * bulge + wobble;
      const fe = fVisible + (1 - fVisible) * Math.min(0.9, reach);
      const f = fHidden + (fe - fHidden) * t;
      slope(i, f, theta, p);
      slopeNormal(i, f, theta, nrm);
      // Profile: an even blanket rolling into a plump rounded edge that drops steeply
      const lipStart = 0.45;
      const s = Math.max(0, (t - lipStart) / (1 - lipStart));
      const edge = Math.sqrt(Math.max(0, 1 - Math.pow(s, 4)));
      const roll = (0.75 + 0.45 * Math.sin(Math.PI * s * 0.85)) / 1.2;
      const lump = 1 + 0.18 * Math.sin(n * theta + 0.8 + i) * Math.sin(f * 9 + i) + 0.12 * lobe;
      // The very edge tucks just under the needles: no z-fighting, a clean outline
      const d = thick * lump * roll * edge - 0.012 * (1 - edge);
      p.addScaledVector(nrm, d);
      // Heavy snow sags a little at the edge
      p.y -= 0.025 * s * s;
      ring.push(p.clone());
    }
    rings.push(ring);
  }
  const top = above ? null : slope(i, 0, 0, new THREE.Vector3()).add(new THREE.Vector3(0, thick, 0));
  return ringGeometry(rings, null, top, null);
}

export function buildFirTree(kit: TreeKit): THREE.Group {
  const tree = new THREE.Group();

  const trunk = kit.hull(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.6, 12), kit.toon(0x5b3a26)), 0.02);
  trunk.position.y = 0.85;
  tree.add(trunk);

  const tiers = mergeGeometries(TIERS.map((_, i) => buildTier(i)));
  tree.add(kit.hull(new THREE.Mesh(tiers, kit.toon(0xffffff, { vertexColors: true })), 0.025));

  const snowParts = TIERS.map((_, i) => buildSnow(i));
  const snow = mergeGeometries(snowParts);
  tree.add(kit.hull(new THREE.Mesh(snow, kit.snow()), 0.018));
  return tree;
}
