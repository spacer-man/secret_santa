/**
 * The fir tree: tiers with drooping branch tips, painted snow and soft snow clumps.
 * Ball slots and the garland use treeRadius(), so it must match the geometry.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface TreeKit {
  toon(color: number, extra?: Partial<THREE.MeshToonMaterialParameters>): THREE.MeshToonMaterial;
  /** Outline: back faces of `smooth` (or the mesh geometry) pushed out along normals */
  hull(mesh: THREE.Mesh, thickness?: number, smooth?: THREE.BufferGeometry): THREE.Mesh;
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

export function treeRadius(y: number): number {
  let r = 0;
  for (const [bottom, h, radius] of TIERS) {
    if (y >= bottom && y <= bottom + h) r = Math.max(r, radius * (1 - (y - bottom) / h));
  }
  return r;
}

export function buildFirTree(kit: TreeKit): THREE.Group {
  // One material: needles and snow are painted per face (crisp toon look)
  const mat = kit.toon(0xffffff, { vertexColors: true });
  const pillowMat = kit.toon(0xf4f7ff);
  const green = new THREE.Color(0x1f8a55);
  const greenDark = new THREE.Color(0x17734a);
  const white = new THREE.Color(0xf4f7ff);
  const blueSnow = new THREE.Color(0xd5def7);
  const tree = new THREE.Group();

  const trunk = kit.hull(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.6, 10), kit.toon(0x5b3a26)), 0.02);
  trunk.position.y = 0.85;
  tree.add(trunk);

  TIERS.forEach(([bottom, h, r], i) => {
    const segments = 28;
    const geo = new THREE.ConeGeometry(r, h, segments, 9);
    const pos = geo.attributes['position'] as THREE.BufferAttribute;
    const segOf = (x: number, z: number) =>
      Math.round(((Math.atan2(z, x) / (Math.PI * 2)) * segments + segments) % segments);
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const f = (h / 2 - y) / h; // 0 at the apex, 1 at the bottom
      if (f < 0.01) continue;
      // Branch tips: every other segment sticks out and droops
      const tip = segOf(pos.getX(v), pos.getZ(v)) % 2 === 0;
      const k = (tip ? 1.1 : 0.84) + (rand(segOf(pos.getX(v), pos.getZ(v)) + i * 31) - 0.5) * 0.1;
      const kk = 1 + (k - 1) * f * f;
      pos.setX(v, pos.getX(v) * kk);
      pos.setZ(v, pos.getZ(v) * kk);
      if (f > 0.99) pos.setY(v, y - (tip ? 0.18 : 0) - rand(v + i * 17) * 0.05);
      else if (f > 0.7 && tip) pos.setY(v, y - 0.05);
    }
    geo.computeVertexNormals();

    // Faceted copy with per-face colors: snow lies on top of the branches
    const flat = geo.toNonIndexed();
    const fp = flat.attributes['position'] as THREE.BufferAttribute;
    const colors = new Float32Array(fp.count * 3);
    const c = new THREE.Vector3();
    for (let tri = 0; tri < fp.count; tri += 3) {
      c.set(0, 0, 0);
      for (let k = 0; k < 3; k++) c.add(new THREE.Vector3(fp.getX(tri + k), fp.getY(tri + k), fp.getZ(tri + k)));
      c.divideScalar(3);
      const f = (h / 2 - c.y) / h;
      // Segment of the triangle (tips are on even radial lines)
      const seg = Math.floor(((Math.atan2(c.z, c.x) / (Math.PI * 2)) * segments + segments) % segments);
      const noise = rand(seg * 7.13 + i * 13);
      // Snow lies on the visible outer part of the branches; the very edge stays green
      const tipSeg = seg % 2 === 0;
      const isSnow = f < 0.2 || (f > 0.58 && f < (tipSeg ? 0.86 : 0.72) - noise * 0.1);
      const shade = rand(tri * 0.37 + i);
      const color = isSnow ? (shade > 0.85 ? blueSnow : white) : shade > 0.5 ? green : greenDark;
      for (let k = 0; k < 3; k++) colors.set([color.r, color.g, color.b], (tri + k) * 3);
    }
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    flat.computeVertexNormals();

    const tier = kit.hull(new THREE.Mesh(flat, mat), 0.025, geo);
    tier.position.y = bottom + h / 2;
    tier.rotation.y = i * 0.7;
    const pillows = snowPillows(geo, h, r, i);
    if (pillows) tier.add(new THREE.Mesh(pillows, pillowMat));
    tree.add(tier);
  });
  return tree;
}

/**
 * Soft snow clumps lying across the branch ends (tilted with the slope):
 * together they form a wavy snow rim on every tier.
 */
function snowPillows(geo: THREE.BufferGeometry, h: number, r: number, tierIndex: number): THREE.BufferGeometry | null {
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  const tips: THREE.Vector3[] = [];
  const seen = new Set<string>();
  for (let v = 0; v < pos.count; v++) {
    const p = new THREE.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v));
    const radial = Math.hypot(p.x, p.z);
    if (p.y > -h / 2 + 0.02 || radial < r * 1.02) continue; // bottom ring, sticking-out tips only
    const key = `${p.x.toFixed(2)}:${p.z.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tips.push(p);
  }
  if (!tips.length) return null;

  const apex = new THREE.Vector3(0, h / 2, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  tips.forEach((tip, k) => {
    const seed = tierIndex * 100 + k;
    const d = new THREE.Vector3(tip.x, 0, tip.z).normalize();
    const u = tip.clone().sub(apex).normalize(); // along the branch, outwards and down
    const side = new THREE.Vector3().crossVectors(up, d).normalize();
    const n = new THREE.Vector3().crossVectors(u, side).normalize(); // surface normal, outwards and up
    if (n.y < 0) n.negate();
    const z = new THREE.Vector3().crossVectors(u, n).normalize();

    // A clump lying across the branch near its end: neighbours almost join into a wavy rim
    if (rand(seed + 9) < 0.06) return; // a rare gap: snow fell unevenly
    const spacing = (Math.PI * 2 * r) / tips.length;
    const across = spacing * (0.5 + rand(seed) * 0.12);
    const along = Math.min(0.22, r * 0.12) * (0.85 + rand(seed + 1) * 0.3);
    const height = 0.055 + rand(seed + 2) * 0.04;
    const centre = apex.clone().lerp(tip, 0.8 + rand(seed + 4) * 0.08).addScaledVector(n, 0.012);

    // Seam vertices are merged: no dark line across the clump
    const raw = new THREE.SphereGeometry(1, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    raw.deleteAttribute('uv');
    raw.deleteAttribute('normal');
    const dome = mergeVertices(raw);
    const dp = dome.attributes['position'] as THREE.BufferAttribute;
    for (let v = 0; v < dp.count; v++) {
      const x = dp.getX(v);
      const y = dp.getY(v);
      const zz = dp.getZ(v);
      // Bumps depend on the position (not the index), so seams stay closed
      const bump = 1 + (rand(x * 12.9898 + zz * 78.233 + seed) - 0.5) * 0.3 * y;
      dp.setXYZ(v, x * along, y * height * bump, zz * across);
    }
    m.makeBasis(u, n, z).setPosition(centre);
    dome.applyMatrix4(m);
    dome.computeVertexNormals();
    parts.push(dome);
  });
  return parts.length ? mergeGeometries(parts) : null;
}
