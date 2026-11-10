/**
 * Soft, fluffy snow: its own shading ramp (many soft steps instead of three
 * hard ones, light never goes fully dark: snow scatters it), a cold fuzzy rim
 * at grazing angles, and glitter: tiny glints that flash as time passes and as
 * the camera moves.
 */
import * as THREE from 'three';

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Crystals per unit of length, how exactly a crystal must face the eye to flash (cos), brightness */
const SPARKLE_DENSITY = 30;
const SPARKLE_NARROW = 0.972;
const SPARKLE_STRENGTH = 0.85;

let ramp: THREE.DataTexture | undefined;

/** Shading ramp of the snow: smooth, with bright shadows */
function snowRamp(): THREE.DataTexture {
  if (!ramp) {
    ramp = new THREE.DataTexture(
      new Uint8Array([118, 128, 148, 176, 206, 232, 250, 255]),
      8,
      1,
      THREE.RedFormat,
    );
    ramp.minFilter = ramp.magFilter = THREE.LinearFilter;
    ramp.needsUpdate = true;
  }
  return ramp;
}

/** Toon material for snow: soft ramp + a fuzzy bluish rim (looks powdery, not plastic) */
export function snowMaterial(color: number, rim = 0.2): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: snowRamp() });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSnowPos;')
      .replace(
        '#include <fog_vertex>',
        'vSnowPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <fog_vertex>',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vSnowPos;
         float snowHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float snowRim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
         outgoingLight += vec3(0.5, 0.62, 1.0) * snowRim * ${rim.toFixed(3)};

         // Sparkle like real snow: the surface is full of tiny ice crystals,
         // each a mirror turned its own way. A crystal flashes only while it
         // reflects towards the eye, so the glints wander as the camera moves.
         vec3 toEye = cameraPosition - vSnowPos;
         float eyeDist = length(toEye);
         vec3 sp = vSnowPos * ${SPARKLE_DENSITY.toFixed(1)};
         vec3 cell = floor(sp);
         vec3 facet = normalize(vec3(snowHash(cell), snowHash(cell + 17.3), snowHash(cell + 41.7)) * 2.0 - 1.0);
         float aligned = dot(facet, toEye / eyeDist);
         float glint = smoothstep(${SPARKLE_NARROW.toFixed(3)}, 1.0, aligned);
         // A small round grain in the middle of its cell; brightness varies
         float grain = smoothstep(0.42, 0.12, length(fract(sp) - 0.5)) * (0.45 + 0.55 * snowHash(cell + 5.1));
         // Far away the crystals are smaller than a pixel: no noise there
         float near = 1.0 - smoothstep(14.0, 30.0, eyeDist);
         outgoingLight += vec3(0.92, 0.96, 1.0) * glint * grain * near * ${SPARKLE_STRENGTH.toFixed(2)};
         #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `snow-sparkle-${rim}`;
  return mat;
}

export interface Glitter {
  points: THREE.Points;
  update(t: number): void;
  /** 0..1: dimmed when it snows hard */
  setStrength(k: number): void;
}

/**
 * Glints on the snow at the given points (position + normal, 6 numbers each).
 * Each one flashes briefly; the phase also depends on where the camera is, so
 * the snow sparkles when the scene is rotated.
 */
export function buildGlitter(spots: number[], pixelRatio: number): Glitter {
  const n = spots.length / 6;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // Slightly above the surface: never z-fights with it
    pos[i * 3] = spots[i * 6] + spots[i * 6 + 3] * 0.03;
    pos[i * 3 + 1] = spots[i * 6 + 1] + spots[i * 6 + 4] * 0.03;
    pos[i * 3 + 2] = spots[i * 6 + 2] + spots[i * 6 + 5] * 0.03;
    seed.set([rand(i * 1.7) * 6.283, 0.5 + rand(i * 2.9) * 1.2, 0.6 + rand(i * 4.3) * 0.8], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, pixel: { value: pixelRatio }, strength: { value: 1 } },
    vertexShader: `
      attribute vec3 seed;
      uniform float time; uniform float pixel;
      varying float vFlash;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // The camera moving along the snow changes which crystals catch the light
        float view = dot(cameraPosition, vec3(1.9, 1.3, 2.3)) * seed.y;
        float wave = sin(seed.x + time * seed.y * 0.9 + view);
        vFlash = pow(max(wave, 0.0), 14.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 1.0);
        gl_PointSize = pixel * seed.z * (3.0 + 46.0 / dist) * (0.4 + 0.6 * vFlash);
      }`,
    fragmentShader: `
      uniform float strength; varying float vFlash;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        // A four-ray star with a hot core
        float d = length(p);
        float rays = max(0.0, 1.0 - abs(p.x) * 14.0) * max(0.0, 1.0 - abs(p.y) * 2.2)
                   + max(0.0, 1.0 - abs(p.y) * 14.0) * max(0.0, 1.0 - abs(p.x) * 2.2);
        float a = (smoothstep(0.22, 0.0, d) + rays * 0.7) * vFlash * strength;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(0.86, 0.93, 1.0) * a, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return {
    points,
    update: (t) => (mat.uniforms['time'].value = t),
    setStrength: (k) => (mat.uniforms['strength'].value = k),
  };
}

/** Random points with normals on a mesh surface (area-weighted enough for our smooth meshes) */
export function sampleSurface(
  geometry: THREE.BufferGeometry,
  count: number,
  seed: number,
  up = 0.25,
): number[] {
  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  const out: number[] = [];
  for (let i = 0, tries = 0; out.length < count * 6 && tries < count * 8; tries++, i++) {
    const k = Math.floor(rand(seed + i * 3.7) * pos.count);
    // Only where snow would catch the light: faces looking up or outwards
    if (nrm.getY(k) < up) continue;
    out.push(pos.getX(k), pos.getY(k), pos.getZ(k), nrm.getX(k), nrm.getY(k), nrm.getZ(k));
  }
  return out;
}
