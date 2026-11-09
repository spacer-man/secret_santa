/**
 * Snowy ground around the courtyard: one smooth uneven surface with drifts
 * (a ridge along the fence, mounds on the field, soft undulation), flat on the
 * cobblestone plaza, at the cabin and on the path to it.
 * Objects standing on the snow take their height from terrainHeight().
 */
import * as THREE from 'three';

const PLAZA = 7.25;
const CABIN_ANGLE = (14 / 20) * Math.PI * 2 - 0.12;
const CABIN = new THREE.Vector2(Math.cos(CABIN_ANGLE) * 12.5, Math.sin(CABIN_ANGLE) * 12.5);
const GATE = new THREE.Vector2(Math.cos(CABIN_ANGLE) * 8.6, Math.sin(CABIN_ANGLE) * 8.6);

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Mounds on the field: x, z, radius, height */
const MOUNDS: [number, number, number, number][] = [];
for (let i = 0; i < 46; i++) {
  const a = rand(i * 1.7 + 3) * Math.PI * 2;
  const r = 11 + Math.pow(rand(i * 2.3 + 1), 0.8) * 32;
  const size = 1.1 + rand(i * 5.1) * 1.8 * (r / 22);
  MOUNDS.push([Math.cos(a) * r, Math.sin(a) * r, size, 0.9 + rand(i * 4.7) * 1.4]);
}

function distToSegment(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < PLAZA) return 0;
  const a = Math.atan2(z, x);
  const p = new THREE.Vector2(x, z);

  // Drift along the outside of the fence, its height varies around the circle
  const ridgeH = 1.0 * (0.65 + 0.35 * Math.sin(a * 5 + 1) * Math.sin(a * 3 - 0.5));
  let h = ridgeH * Math.exp(-(((r - 9.6) / 0.6) ** 2));
  // A small drift on the inner side of the fence
  h += 0.18 * Math.exp(-(((r - 8.15) / 0.28) ** 2));

  // Mounds and gentle waves on the field
  for (const [mx, mz, mr, mh] of MOUNDS) {
    const d2 = (x - mx) ** 2 + (z - mz) ** 2;
    if (d2 < mr * mr * 4) h += mh * Math.exp(-d2 / (mr * mr * 0.6));
  }
  h += smooth(10, 16, r) * 0.25 * (Math.sin(x * 0.23 + 1) * Math.cos(z * 0.19) + 0.5 * Math.sin(x * 0.11 - z * 0.13));

  // Flat around the cabin and on the path from the gate to the porch
  const flat = Math.max(
    1 - smooth(3.6, 5.2, p.distanceTo(CABIN)),
    1 - smooth(0.9, 1.7, distToSegment(p, GATE, CABIN)),
  );
  h *= 1 - flat;

  // Rise smoothly from the plaza edge
  return Math.max(0, h * smooth(PLAZA, PLAZA + 0.5, r));
}

/** Terrain mesh: polar grid, denser near the courtyard */
export function terrainGeometry(): THREE.BufferGeometry {
  const rings = 70;
  const segs = 180;
  const positions: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = PLAZA - 0.05 + (70 - PLAZA) * Math.pow(t, 1.8);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      positions.push(x, terrainHeight(x, z), z);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j;
      const b = i * segs + ((j + 1) % segs);
      const c = (i + 1) * segs + j;
      const d = (i + 1) * segs + ((j + 1) % segs);
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * Outline for the terrain: back faces pushed out along the normals by a
 * constant width on screen. Shows up as ink lines on the crests of drifts.
 */
export function terrainOutline(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * (-mv.z) * 0.004;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `void main() { gl_FragColor = vec4(0.1, 0.11, 0.26, 1.0); }`,
  });
}
