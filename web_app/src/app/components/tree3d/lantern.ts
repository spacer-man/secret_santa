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
}

export interface Lantern {
  group: THREE.Group;
  glow: THREE.Sprite;
  /** Size of the glow when lit (for the flicker) */
  glowSize: number;
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
      const glowSize = 2.4 * scale;
      const glow = kit.glow(0xffc070, glowSize, 0);
      glow.position.y = 0.21;
      group.add(frame, glass, snow, glow);
      group.scale.setScalar(scale);
      // The glow is a sprite: keep its size in world units
      glow.scale.setScalar(glowSize / scale);
      const lantern = { group, glow, glowSize: glowSize / scale };
      all.push(lantern);
      return lantern;
    },
    setOn(on) {
      glassMat.color.set(on ? 0xffd27a : 0x3a3550);
      glassMat.emissive.set(on ? 0xffa040 : 0x000000);
      all.forEach((l) => (l.glow.material.opacity = on ? 0.9 : 0));
    },
  };
}
