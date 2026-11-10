/**
 * Anime-style outline ("inverted hull") of constant width on screen.
 *
 * The back faces of a copy are pushed out along smooth normals in view space,
 * proportionally to the depth: lines stay visible far away and don't grow up
 * close. Works for instanced meshes too (forest).
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const materials = new Map<string, THREE.ShaderMaterial>();

export function outlineMaterial(
  width = 0.0035,
  color = new THREE.Color(0.04, 0.04, 0.12),
): THREE.ShaderMaterial {
  const key = `${width}|${color.getHexString()}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { width: { value: width }, color: { value: color } },
      vertexShader: `
        uniform float width;
        void main() {
          vec4 local = vec4(position, 1.0);
          vec3 n = normal;
          #ifdef USE_INSTANCING
            local = instanceMatrix * local;
            n = mat3(instanceMatrix) * n;
          #endif
          vec4 mv = modelViewMatrix * local;
          vec3 vn = normalize(normalMatrix * n);
          mv.xyz += vn * (-mv.z) * width;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); }`,
    });
    materials.set(key, m);
  }
  return m;
}

const smoothCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * Hard-edged low-poly geometry has split normals: a shell pushed along them
 * breaks apart at the edges. Merged vertices + averaged normals keep it closed.
 */
export function smoothForOutline(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = smoothCache.get(geometry);
  if (!g) {
    const copy = new THREE.BufferGeometry();
    copy.setAttribute('position', geometry.getAttribute('position'));
    if (geometry.index) copy.setIndex(geometry.index);
    g = mergeVertices(copy, 1e-4);
    g.computeVertexNormals();
    smoothCache.set(geometry, g);
  }
  return g;
}

/** Adds an outline to a mesh (as a child) and returns the mesh */
export function withOutline<T extends THREE.Mesh>(mesh: T, width?: number): T {
  const hull = new THREE.Mesh(smoothForOutline(mesh.geometry), outlineMaterial(width));
  hull.userData['outline'] = true;
  mesh.add(hull);
  return mesh;
}

/** Outline for an instanced mesh: an instanced hull sharing the instance matrices */
export function instancedOutline(inst: THREE.InstancedMesh, width?: number): THREE.InstancedMesh {
  const hull = new THREE.InstancedMesh(
    smoothForOutline(inst.geometry),
    outlineMaterial(width),
    inst.count,
  );
  hull.instanceMatrix = inst.instanceMatrix;
  hull.userData['outline'] = true;
  return hull;
}
