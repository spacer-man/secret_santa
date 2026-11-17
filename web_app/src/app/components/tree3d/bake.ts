/**
 * Static batching: the courtyard is hundreds of small meshes (fence posts,
 * rails, logs of the cabin, presents...) and every one of them (plus its
 * outline) is a draw call. On phones the draw calls, not the triangles, eat
 * the frame. Meshes that never move are baked into world space and merged:
 * one mesh per material.
 *
 * Only what is safe is merged: plain opaque meshes with one material, visible
 * now, with no moving ancestors (`userData.dynamic`) and not excluded
 * (`userData.noBake`, clickables). A mesh is taken out only if all its
 * children are taken too (sprites, lights stay with their parent).
 * Materials stay shared, so colour/emissive changes (windows, lanterns) work.
 *
 * The merged meshes are expressed in the space of `target` and added to it: a
 * group that moves as a whole (the cabin bounces under the finger) keeps doing so.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function bakeStatic(
  roots: THREE.Object3D[],
  target: THREE.Object3D,
  exclude: Set<THREE.Object3D> = new Set(),
): number {
  roots.forEach((r) => r.updateWorldMatrix(true, true));
  target.updateWorldMatrix(true, false);
  const toTarget = target.matrixWorld.clone().invert();

  const visibleChain = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const isCandidate = (o: THREE.Object3D): o is THREE.Mesh => {
    const m = o as THREE.Mesh;
    if (
      !m.isMesh ||
      (m as THREE.InstancedMesh).isInstancedMesh ||
      (m as THREE.SkinnedMesh).isSkinnedMesh
    )
      return false;
    if (exclude.has(o) || o.userData['noBake'] || o.userData['dynamic']) return false;
    const mat = m.material;
    if (Array.isArray(mat) || !mat.visible || mat.transparent) return false;
    const g = m.geometry;
    if (!g.getAttribute('position') || Object.keys(g.morphAttributes).length) return false;
    return true;
  };

  // Post-order: a mesh can go only together with all of its children
  const removable = new Set<THREE.Mesh>();
  const walk = (o: THREE.Object3D, blocked: boolean): boolean => {
    const block = blocked || !!o.userData['dynamic'] || !!o.userData['noBake'];
    let all = true;
    for (const c of o.children) all = walk(c, block) && all;
    if (!block && all && isCandidate(o) && visibleChain(o)) {
      removable.add(o);
      return true;
    }
    return false;
  };
  roots.forEach((r) => walk(r, false));
  if (!removable.size) return 0;

  // Group by material and attribute layout
  const groups = new Map<string, THREE.Mesh[]>();
  for (const m of removable) {
    const g = m.geometry;
    const attrs = Object.keys(g.attributes)
      .sort()
      .map((n) => `${n}:${g.attributes[n].itemSize}`)
      .join(',');
    // Layers too: some meshes are drawn only in one mode (see HIDDEN_LAYER in scene.ts)
    const key = `${(m.material as THREE.Material).uuid}|${attrs}|${g.index ? 'i' : 'n'}|${m.layers.mask}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(m);
  }

  let merged = 0;
  for (const meshes of groups.values()) {
    const geos = meshes.map((m) => {
      const g = m.geometry.clone();
      g.groups = [];
      const matrix = toTarget.clone().multiply(m.matrixWorld);
      g.applyMatrix4(matrix);
      // A mirrored transform turns the triangles inside out: flip them back
      if (matrix.determinant() < 0) flipWinding(g);
      return g;
    });
    const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!geo) continue;
    geos.forEach((g) => g !== geo && g.dispose());
    const first = meshes[0];
    const baked = new THREE.Mesh(geo, first.material);
    baked.name = 'baked';
    baked.userData = { ...first.userData, baked: true };
    baked.renderOrder = first.renderOrder;
    baked.layers.mask = first.layers.mask;
    baked.matrixAutoUpdate = false;
    baked.updateMatrix();
    target.add(baked);
    merged += meshes.length;
  }
  for (const m of removable) m.removeFromParent();
  return merged;
}

function flipWinding(g: THREE.BufferGeometry): void {
  if (!g.index) {
    // Swap the 2nd and 3rd vertex of every triangle in every attribute
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name] as THREE.BufferAttribute;
      const s = a.itemSize;
      const arr = a.array as Float32Array;
      for (let i = 0; i + 2 < a.count; i += 3) {
        for (let k = 0; k < s; k++) {
          const t = arr[(i + 1) * s + k];
          arr[(i + 1) * s + k] = arr[(i + 2) * s + k];
          arr[(i + 2) * s + k] = t;
        }
      }
    }
    return;
  }
  const idx = g.index.array as Uint16Array | Uint32Array;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
}
