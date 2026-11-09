/**
 * Detailed toon log cabin: logs, gable roof with thick snow and icicles,
 * framed windows with shutters, door with a wreath, porch, firewood, smoke.
 * Local space: the door faces +Z.
 */
import * as THREE from 'three';

export interface Kit {
  toon(color: number, extra?: Partial<THREE.MeshToonMaterialParameters>): THREE.MeshToonMaterial;
  hull(mesh: THREE.Mesh, thickness?: number): THREE.Mesh;
  outline(mesh: THREE.Mesh, scale?: number): THREE.Mesh;
  glow(color: number, size: number, opacity?: number): THREE.Sprite;
  glowTex: THREE.Texture;
}

export interface Cabin {
  group: THREE.Group;
  windows: THREE.Mesh[];
  lights: THREE.Sprite[];
  update(t: number, dt: number): void;
}

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

const W = 2.2; // half width (x)
const D = 1.7; // half depth (z)
const LOG = 0.15; // log radius
const ROWS = 8;
const H = ROWS * LOG * 2; // wall height
const RIDGE = 1.55; // roof height above the walls
const OVER = 0.45; // roof overhang

export function buildCabin(kit: Kit): Cabin {
  const g = new THREE.Group();
  const windows: THREE.Mesh[] = [];
  const lights: THREE.Sprite[] = [];
  const logA = kit.toon(0x7a4a34);
  const logB = kit.toon(0x8c5a3e);
  const trim = kit.toon(0xd8b48a);
  const snow = kit.toon(0xf4f7ff);
  const stone = kit.toon(0x7d7f9c);

  // Foundation
  const base = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.3, 0.3, D * 2 + 0.3), stone), 1.02);
  base.position.y = 0.15;
  g.add(base);

  // Log walls: logs cross at the corners
  const logGeo = (len: number) => new THREE.CylinderGeometry(LOG, LOG, len, 8);
  const frontGeo = logGeo(W * 2 + 0.5);
  const sideGeo = logGeo(D * 2 + 0.5);
  for (let r = 0; r < ROWS; r++) {
    const mat = r % 2 ? logA : logB;
    for (const z of [-D, D]) {
      const log = kit.hull(new THREE.Mesh(frontGeo, mat), 0.012);
      log.rotation.z = Math.PI / 2;
      log.position.set(0, 0.3 + LOG + r * LOG * 2, z);
      g.add(log);
    }
    for (const x of [-W, W]) {
      const log = kit.hull(new THREE.Mesh(sideGeo, mat), 0.012);
      log.rotation.x = Math.PI / 2;
      log.position.set(x, 0.3 + LOG * 2 + r * LOG * 2, 0);
      g.add(log);
    }
  }
  // Inner fill so there are no gaps between round logs
  const core = new THREE.Mesh(new THREE.BoxGeometry(W * 2 - 0.1, H, D * 2 - 0.1), kit.toon(0x5a3424));
  core.position.y = 0.3 + H / 2;
  g.add(core);

  const top = 0.3 + H;

  // Gables
  const gable = new THREE.Shape();
  gable.moveTo(-W - 0.05, 0);
  gable.lineTo(0, RIDGE);
  gable.lineTo(W + 0.05, 0);
  gable.lineTo(-W - 0.05, 0);
  const gableGeo = new THREE.ExtrudeGeometry(gable, { depth: 0.14, bevelEnabled: false });
  for (const z of [D - 0.07, -D - 0.07]) {
    const m = kit.outline(new THREE.Mesh(gableGeo, logB), 1.01);
    m.position.set(0, top, z);
    g.add(m);
  }
  // Round attic window
  const attic = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), new THREE.MeshBasicMaterial({ color: 0x1c1a33 }));
  attic.position.set(0, top + 0.55, D + 0.08);
  windows.push(attic);
  const atticFrame = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.04, 6, 16), trim);
  atticFrame.position.copy(attic.position);
  g.add(attic, atticFrame);

  // Roof slabs with a thick snow layer, drips and icicles
  const slope = Math.atan2(RIDGE, W);
  const slabLen = Math.hypot(W + OVER, RIDGE + OVER * Math.tan(slope));
  const roofMat = kit.toon(0x4a2c22);
  const icicleMat = kit.toon(0xcfe6ff, { transparent: true, opacity: 0.9 });
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, top + RIDGE, 0);
    pivot.rotation.z = side === 1 ? -slope : slope;
    const dir = side; // slab goes down to this side

    const slab = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(slabLen, 0.16, D * 2 + OVER * 2), roofMat), 1.02);
    slab.position.set((dir * slabLen) / 2, 0, 0);
    pivot.add(slab);

    const snowLayer = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(slabLen + 0.06, 0.2, D * 2 + OVER * 2 + 0.08), snow), 1.02);
    snowLayer.position.set((dir * slabLen) / 2, 0.17, 0);
    pivot.add(snowLayer);

    // Snow hanging over the eave
    const eaveX = dir * (slabLen + 0.02);
    for (let k = 0; k < 11; k++) {
      const z = -D - OVER + 0.2 + (k / 10) * (D * 2 + OVER * 2 - 0.4);
      const drip = new THREE.Mesh(new THREE.SphereGeometry(0.16 + rand(k + side) * 0.06, 8, 6), snow);
      drip.scale.set(0.9, 0.7, 1.3);
      drip.position.set(eaveX, 0.08 - rand(k * 3 + side) * 0.06, z);
      pivot.add(drip);
      if (k % 2 === 0) {
        const len = 0.2 + rand(k * 7 + side) * 0.35;
        const icicle = new THREE.Mesh(new THREE.ConeGeometry(0.035, len, 5), icicleMat);
        icicle.rotation.z = Math.PI + (side === 1 ? slope : -slope);
        icicle.position.set(eaveX - dir * 0.02, -len / 2 - 0.02, z + 0.08);
        pivot.add(icicle);
      }
    }
    g.add(pivot);
  }
  // Ridge snow
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, D * 2 + OVER * 2 + 0.1, 8), snow);
  ridge.rotation.x = Math.PI / 2;
  ridge.scale.set(1, 1, 0.7);
  ridge.position.y = top + RIDGE + 0.22;
  g.add(ridge);

  // Chimney with smoke
  const chimney = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, 0.5), kit.toon(0x8a5a4a)), 1.04);
  chimney.position.set(-1.0, top + RIDGE * 0.55 + 0.5, -0.6);
  const chimneySnow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.6), snow);
  chimneySnow.position.set(chimney.position.x, chimney.position.y + 0.7, chimney.position.z);
  g.add(chimney, chimneySnow);

  const smoke: THREE.Sprite[] = [];
  for (let i = 0; i < 9; i++) {
    const puff = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: kit.glowTex, color: 0xb8bfdc, transparent: true, opacity: 0, depthWrite: false }),
    );
    g.add(puff);
    smoke.push(puff);
  }
  const smokeOrigin = new THREE.Vector3(chimney.position.x, chimney.position.y + 0.8, chimney.position.z);

  // Windows: frame, cross bars, sill with snow, shutters
  const shutterMat = kit.toon(0x2f6b4f);
  const addWindow = (x: number, y: number, z: number, ry: number) => {
    const win = new THREE.Group();
    win.position.set(x, y, z);
    win.rotation.y = ry;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.62), new THREE.MeshBasicMaterial({ color: 0x1c1a33 }));
    glass.position.z = 0.02;
    windows.push(glass);
    const frame = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.78, 0.06), trim), 1.03);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.64), new THREE.MeshBasicMaterial({ color: 0x14122a }));
    hole.position.z = 0.031;
    const barV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.64, 0.04), trim);
    const barH = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.04), trim);
    barV.position.z = barH.position.z = 0.05;
    glass.position.z = 0.035;
    const sill = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.07, 0.2), trim), 1.04);
    sill.position.set(0, -0.43, 0.08);
    const sillSnow = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.82, 4, 8), snow);
    sillSnow.rotation.z = Math.PI / 2;
    sillSnow.position.set(0, -0.36, 0.1);
    win.add(frame, hole, glass, barV, barH, sill, sillSnow);
    for (const sx of [-1, 1]) {
      const shutter = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.04), shutterMat), 1.04);
      shutter.position.set(sx * 0.6, 0, 0.02);
      win.add(shutter);
    }
    g.add(win);
  };
  addWindow(-1.05, 1.45, D + LOG + 0.02, 0);
  addWindow(-W - LOG - 0.02, 1.45, 0.1, -Math.PI / 2);
  addWindow(W + LOG + 0.02, 1.45, -0.3, Math.PI / 2);
  addWindow(0.4, 1.45, -D - LOG - 0.02, Math.PI);

  // Door with a wreath
  const door = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.45, 0.08), kit.toon(0x5b3424)), 1.03);
  door.position.set(0.95, 0.3 + 0.72, D + LOG + 0.02);
  const doorFrame = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(0.98, 1.58, 0.05), trim), 1.02);
  doorFrame.position.set(door.position.x, door.position.y + 0.04, D + LOG - 0.01);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), kit.toon(0xffd36b));
  knob.position.set(1.22, 0.95, D + LOG + 0.08);
  const wreath = kit.hull(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 6, 14), kit.toon(0x1f7a4a)), 0.012);
  wreath.position.set(0.95, 1.38, D + LOG + 0.1);
  const bow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), kit.toon(0xd81e3a));
  bow.position.set(0.95, 1.2, D + LOG + 0.16);
  g.add(doorFrame, door, knob, wreath, bow);
  for (let k = 0; k < 6; k++) {
    const berry = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), kit.toon(0xff2d55));
    const a = (k / 6) * Math.PI * 2;
    berry.position.set(0.95 + Math.cos(a) * 0.2, 1.38 + Math.sin(a) * 0.2, D + LOG + 0.17);
    g.add(berry);
  }

  // Porch: deck, steps, posts, lantern
  const plank = kit.toon(0x9a6b4c);
  const deck = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.16, 1.0), plank), 1.02);
  deck.position.set(0.95, 0.3, D + 0.75);
  const deckSnow = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.04, 0.3), snow);
  deckSnow.position.set(0.95, 0.4, D + 1.12);
  g.add(deck, deckSnow);
  for (let s = 0; s < 2; s++) {
    const step = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.32), plank), 1.03);
    step.position.set(0.95, 0.18 - s * 0.12, D + 1.38 + s * 0.3);
    g.add(step);
  }
  for (const px of [1.9]) {
    const post = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), plank), 1.06);
    post.position.set(px, 0.85, D + 1.2);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.18), snow);
    cap.position.set(px, 1.39, D + 1.2);
    g.add(post, cap);
  }
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.18), kit.toon(0xffd27a, { emissive: 0xffa040 }));
  lamp.position.set(1.9, 1.58, D + 1.2);
  const lampGlow = kit.glow(0xffc070, 1.8, 0);
  lampGlow.position.copy(lamp.position);
  windows.push(lamp);
  lights.push(lampGlow);
  g.add(lamp, lampGlow);

  // Firewood stack by the side wall
  const woodEnd = kit.toon(0xc49a6c);
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 4 - row; k++) {
      const log = kit.hull(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.7, 7), [logA, woodEnd, woodEnd]), 0.01);
      log.rotation.x = Math.PI / 2;
      log.position.set(W + 0.45, 0.13 + row * 0.2, -0.9 + k * 0.23 + row * 0.115);
      g.add(log);
    }
  }
  const woodSnow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.6), snow);
  woodSnow.position.set(W + 0.45, 0.68, -0.55);
  g.add(woodSnow);

  // Snowdrifts around the walls
  for (let k = 0; k < 10; k++) {
    const drift = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), snow);
    const side = k % 4;
    const t = rand(k) * 2 - 1;
    drift.position.set(
      side === 0 ? W + 0.2 : side === 1 ? -W - 0.2 : t * W,
      0.05,
      side === 2 ? -D - 0.2 : side === 3 ? D + 0.2 : t * D,
    );
    if (side === 3 && Math.abs(drift.position.x - 0.95) < 0.8) drift.position.x -= 1.6;
    drift.scale.set(1.2, 0.35, 0.8);
    g.add(drift);
  }

  // Warm light falling on the snow in front of the windows
  const pool = kit.glow(0xffb45a, 4.5, 0);
  pool.position.set(-0.6, 0.6, D + 1.4);
  lights.push(pool);
  g.add(pool);

  let smokeT = 0;
  return {
    group: g,
    windows,
    lights,
    update(t: number, dt: number) {
      smokeT += dt;
      smoke.forEach((puff, i) => {
        const life = (smokeT * 0.25 + i / smoke.length) % 1;
        puff.position.set(
          smokeOrigin.x + Math.sin(t * 0.7 + i) * 0.15 + life * 0.6,
          smokeOrigin.y + life * 2.4,
          smokeOrigin.z + life * 0.2,
        );
        puff.scale.setScalar(0.4 + life * 1.2);
        puff.material.opacity = Math.sin(life * Math.PI) * 0.45;
      });
    },
  };
}
