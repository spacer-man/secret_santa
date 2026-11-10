/**
 * The courtyard lantern: one asset placed wherever a light is needed (fence
 * posts, the cabin porch). A metal frame with a pyramid roof under a soft cap
 * of snow, warm glass inside, a glow around.
 * Local space: stands on y = 0, about 0.3 wide and 0.55 tall.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { withOutline } from './outline';

export interface LanternKit {
  toon(color: number, extra?: Partial<THREE.MeshToonMaterialParameters>): THREE.MeshToonMaterial;
  snow(): THREE.MeshToonMaterial;
  glow(color: number, size: number, opacity?: number): THREE.Sprite;
  /** A real light for the lantern, or null on weak devices (then only the glow sprite is left) */
  light?(): THREE.PointLight | null;
}

/**
 * Toon shading gives even the faces turned away from a light its darkest band,
 * so a lamp would light its own hood from below. Lights with this exact `decay`
 * shine only on the faces that look at them (see `facingLights()`); the glow
 * inside the tree keeps the usual toon behaviour.
 */
export const FACING_DECAY = 1.7;

let patched = false;
/** Patches three.js once: point lights marked by `FACING_DECAY` skip back faces */
export function facingLights(): void {
  if (patched) return;
  patched = true;
  const facing = 'smoothstep( 0.0, 0.25, dot( geometryNormal, directLight.direction ) )';
  const point = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
  // Spot lights are only the light from the cabin windows: always "facing"
  const spot = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin
    .replace(
      point,
      `${point}
		if ( abs( pointLight.decay - ${FACING_DECAY.toFixed(2)} ) < 0.01 ) directLight.color *= ${facing};`,
    )
    .replace(
      spot,
      `${spot}
		directLight.color *= ${facing};`,
    );
}

/** Power of a lit lantern's real light */
export const LANTERN_LIGHT = 5.5;

export interface Lantern {
  group: THREE.Group;
  glow: THREE.Sprite;
  /** Size of the glow when lit (for the flicker) */
  glowSize: number;
  /** Real light that falls on the snow and things around (absent on weak devices) */
  light?: THREE.PointLight;
}

export interface Lanterns {
  /** A new lantern (all of them share geometry and materials) */
  build(scale?: number): Lantern;
  /** Lights all lanterns up or puts them out */
  setOn(on: boolean): void;
  readonly all: Lantern[];
}

export function lanternFactory(kit: LanternKit): Lanterns {
  // Frame: base, four corner bars, top plate, pyramid roof, knob
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g);
  };
  box(0.3, 0.05, 0.3, 0, 0.025, 0);
  box(0.22, 0.03, 0.22, 0, 0.065, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) box(0.03, 0.27, 0.03, sx * 0.105, 0.2, sz * 0.105);
  box(0.27, 0.03, 0.27, 0, 0.345, 0);
  const roof = new THREE.ConeGeometry(0.24, 0.17, 4).toNonIndexed();
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 0.445, 0);
  parts.push(roof);
  const knob = new THREE.SphereGeometry(0.03, 8, 6).toNonIndexed();
  knob.translate(0, 0.545, 0);
  parts.push(knob);
  const frameGeo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  const frameMat = kit.toon(0x55506e);

  const glassGeo = new THREE.BoxGeometry(0.19, 0.25, 0.19);
  glassGeo.translate(0, 0.205, 0);
  const glassMat = kit.toon(0x3a3550, { emissive: 0x000000 });

  // Snow on the roof: a soft cap on the top of the pyramid (its edges stay visible)
  const profile = new THREE.SplineCurve([
    new THREE.Vector2(0.0, 0.6),
    new THREE.Vector2(0.045, 0.588),
    new THREE.Vector2(0.09, 0.552),
    new THREE.Vector2(0.13, 0.508),
    new THREE.Vector2(0.146, 0.478),
    new THREE.Vector2(0.13, 0.458),
    new THREE.Vector2(0.07, 0.46),
  ])
    .getPoints(14)
    .reverse(); // bottom to top: the lathe faces outwards
  const snowGeo = new THREE.LatheGeometry(profile, 14);
  const snowMat = kit.snow();

  const all: Lantern[] = [];
  return {
    all,
    build(scale = 1) {
      const group = new THREE.Group();
      const frame = withOutline(new THREE.Mesh(frameGeo, frameMat));
      const glass = new THREE.Mesh(glassGeo, glassMat);
      const snow = new THREE.Mesh(snowGeo, snowMat);
      snow.rotation.y = all.length * 1.3;
      const light = kit.light?.() ?? undefined;
      // With a real light the sprite is only a small halo around the flame
      const glowSize = (light ? 1.15 : 2.4) * scale;
      const glow = kit.glow(0xffc070, glowSize, 0);
      glow.position.y = 0.21;
      group.add(frame, glass, snow, glow);
      if (light) {
        light.position.y = 0.3;
        group.add(light);
      }
      group.scale.setScalar(scale);
      // The glow is a sprite: keep its size in world units
      glow.scale.setScalar(glowSize / scale);
      const lantern: Lantern = { group, glow, glowSize: glowSize / scale, light };
      all.push(lantern);
      return lantern;
    },
    setOn(on) {
      glassMat.color.set(on ? 0xffd27a : 0x3a3550);
      glassMat.emissive.set(on ? 0xffa040 : 0x000000);
      all.forEach((l) => {
        l.glow.material.opacity = on ? 0.9 : 0;
        if (l.light) l.light.intensity = on ? LANTERN_LIGHT : 0;
      });
    },
  };
}
