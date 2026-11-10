/**
 * Detailed toon log cabin: logs, gable roof with thick snow and icicles,
 * framed windows with shutters, door with a wreath, porch, firewood, smoke.
 * Local space: the door faces +Z.
 */
import * as THREE from 'three';
import { buildPuff, puffScale } from './life';

export interface Kit {
  toon(color: number, extra?: Partial<THREE.MeshToonMaterialParameters>): THREE.MeshToonMaterial;
  /** Soft snow material */
  snow(): THREE.MeshToonMaterial;
  /** The courtyard lantern asset */
  lantern(scale?: number): { group: THREE.Group };
  hull(mesh: THREE.Mesh, thickness?: number): THREE.Mesh;
  outline(mesh: THREE.Mesh, scale?: number): THREE.Mesh;
  glow(color: number, size: number, opacity?: number): THREE.Sprite;
  glowTex: THREE.Texture;
}

export interface Cabin {
  group: THREE.Group;
  windows: THREE.Mesh[];
  lights: THREE.Sprite[];
  /** The fake pool of window light on the snow (hidden when real lights are used) */
  pool: THREE.Sprite;
  /** Windows that look at the courtyard: centre and outward turn (for real light) */
  windowSpots: { position: THREE.Vector3; ry: number }[];
  /** Roof edges (under the eaves) for the fringe lights */
  roofEdges: [THREE.Vector3, THREE.Vector3][];
  /** The snow blanket on the roof (for the glitter) */
  roofSnow: THREE.Mesh;
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

/**
 * Snow on the gable roof: a single smooth surface lying on both slopes. The
 * ridge is rounded (never a sharp fold, never self-intersecting: the height
 * is a function of x and z), the thickness is a little lumpy, and all four
 * edges roll over the roof edge in a plump lip; over the eaves the lip hangs
 * in soft uneven lobes.
 *
 * `peak`: y of the ridge line, `ex`/`ez`: half sizes of the roof in plan.
 */
function roofSnowGeometry(
  peak: number,
  slope: number,
  ex: number,
  ez: number,
): THREE.BufferGeometry {
  const tan = Math.tan(slope);
  // Top of the roof slab above the ridge line (the slab is 0.16 thick)
  const slabTop = 0.08 / Math.cos(slope);
  const THICK = 0.2;
  const R = 0.22; // how far the lip rounds outwards
  const PHI_MAX = Math.PI / 2 + 1.0; // the lip rolls back under itself into the roof edge

  // Parameter along one axis: the flat part, then the rounded lip
  const axis = (core: number, lip: number): { t: number; phi: number; sign: number }[] => {
    const half: { t: number; phi: number }[] = [];
    for (let k = 0; k <= core; k++) half.push({ t: k / core, phi: 0 });
    for (let k = 1; k <= lip; k++) half.push({ t: 1, phi: (k / lip) * PHI_MAX });
    return [
      ...half
        .slice(1)
        .reverse()
        .map((h) => ({ ...h, sign: -1 })),
      ...half.map((h) => ({ ...h, sign: 1 })),
    ];
  };
  const xs = axis(15, 9);
  const zs = axis(13, 8);

  const pos: number[] = [];
  for (const b of zs) {
    for (const a of xs) {
      // Along the eave: soft lobes of different size hanging over the edge
      const zc = b.sign * b.t * ez;
      const lobe =
        0.5 + 0.5 * Math.sin(zc * 3.1 + a.sign * 1.3) * Math.sin(zc * 1.3 + 0.7 + a.sign);
      const overX = 0.11 + 0.1 * lobe;
      const overZ = 0.08;

      // The lip bulges out by R, then comes back and ends inside the roof slab
      const lip = (phi: number, over: number) =>
        phi <= Math.PI / 2
          ? R * Math.sin(phi)
          : R - (over + 0.04) * ((phi - Math.PI / 2) / (PHI_MAX - Math.PI / 2));
      const x = a.sign * (a.t * (ex + overX - R) + lip(a.phi, overX));
      const z = b.sign * (b.t * (ez + overZ - R) + lip(b.phi, overZ));
      // Rounded ridge: |x| smoothed near zero (always above the real roof)
      const soft = Math.sqrt(x * x + 0.3 * 0.3) - 0.3;
      // Lumpy blanket: slow waves, a bit thicker towards the eaves
      const lumps =
        1 +
        0.16 * Math.sin(x * 2.3 + z * 1.1 + 0.5) * Math.sin(z * 1.9 - x * 0.7) +
        0.1 * Math.sin(z * 4.3 + x * 3.1) +
        0.12 * (Math.abs(x) / ex);
      const topY = peak + slabTop - tan * soft + THICK * lumps;
      // The lip goes all the way down into the real roof surface under it:
      // the snow lies on the roof everywhere, no gap at the ridge or the eaves
      const roofY = peak + slabTop - tan * Math.abs(x);
      const down = (phi: number) => (1 - Math.cos(phi)) / (1 - Math.cos(PHI_MAX));
      const k = 1 - (1 - down(a.phi)) * (1 - down(b.phi));
      const y = topY - (topY - (roofY - 0.07)) * k;
      pos.push(x, y, z);
    }
  }
  const nx = xs.length;
  const index: number[] = [];
  for (let i = 0; i < zs.length - 1; i++) {
    for (let j = 0; j < nx - 1; j++) {
      const p = i * nx + j;
      index.push(p, p + nx, p + 1, p + 1, p + nx, p + nx + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Snow on the chimney rim: a soft lumpy ring following the square top (a
 * rounded square), open in the middle for the smoke; the outer side hangs
 * over the bricks. Local space: y = 0 is the top of the chimney.
 */
function chimneySnowGeometry(): THREE.BufferGeometry {
  const N = 40; // around
  const M = 13; // across the ring
  const pos: number[] = [];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    // Rounded square: 1 on the sides, ~1.19 on the corners
    const sq = 1 / Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(sn), 4), 0.25);
    const lump = 1 + 0.22 * Math.sin(th * 3 + 0.6) + 0.14 * Math.sin(th * 5 + 2.1);
    const inner = 0.165 * sq;
    const outer = (0.3 + 0.03 * lump) * sq;
    for (let j = 0; j <= M; j++) {
      const sj = j / M;
      // From the inner edge (on the bricks) over the top, out over the edge,
      // then the lip tucks back into the bricks: no cut-off edge in the air
      const over = Math.min(1, sj / 0.68);
      const tuck = THREE.MathUtils.smoothstep(sj, 0.68, 1);
      const r =
        inner +
        (outer - inner) * (0.5 - 0.5 * Math.cos(Math.PI * over)) -
        (outer - 0.235 * sq) * tuck;
      const y = Math.sin(Math.PI * over) * 0.12 * lump - 0.15 * sj * sj - 0.005;
      pos.push(c * r, y, sn * r);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < N; i++) {
    const n = (i + 1) % N;
    for (let j = 0; j < M; j++) {
      const p = i * (M + 1) + j;
      const q = n * (M + 1) + j;
      index.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

export function buildCabin(kit: Kit): Cabin {
  const g = new THREE.Group();
  const windows: THREE.Mesh[] = [];
  const lights: THREE.Sprite[] = [];
  const logA = kit.toon(0x7a4a34);
  const logB = kit.toon(0x8c5a3e);
  const trim = kit.toon(0xd8b48a);
  const snow = kit.snow();
  const stone = kit.toon(0x7d7f9c);

  // Foundation
  const base = kit.outline(
    new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.3, 0.3, D * 2 + 0.3), stone),
    1.02,
  );
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
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(W * 2 - 0.1, H, D * 2 - 0.1),
    kit.toon(0x5a3424),
  );
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
    // No outline: the gable sits flush under the roof and on the logs
    const m = new THREE.Mesh(gableGeo, logB);
    m.position.set(0, top, z);
    g.add(m);
  }
  // Round attic window
  const attic = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 16),
    new THREE.MeshBasicMaterial({ color: 0x1c1a33 }),
  );
  attic.position.set(0, top + 0.55, D + 0.08);
  windows.push(attic);
  const atticFrame = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.04, 6, 16), trim);
  atticFrame.position.copy(attic.position);
  g.add(attic, atticFrame);

  // Roof slabs with a thick snow layer, drips and icicles
  const slope = Math.atan2(RIDGE, W);
  const slabLen = Math.hypot(W + OVER, RIDGE + OVER * Math.tan(slope));
  // Red-brown: stands out from the dark log gables
  const roofMat = kit.toon(0x9a3a2a);
  const icicleMat = kit.toon(0xcfe6ff, { transparent: true, opacity: 0.9 });
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, top + RIDGE, 0);
    pivot.rotation.z = side === 1 ? -slope : slope;
    const dir = side; // slab goes down to this side

    const slab = kit.outline(
      new THREE.Mesh(new THREE.BoxGeometry(slabLen, 0.16, D * 2 + OVER * 2), roofMat),
      1.02,
    );
    slab.position.set((dir * slabLen) / 2, 0, 0);
    pivot.add(slab);

    // Icicles under the eave
    const eaveX = dir * (slabLen + 0.02);
    for (let k = 0; k < 11; k++) {
      const z = -D - OVER + 0.2 + (k / 10) * (D * 2 + OVER * 2 - 0.4);
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
  // One soft blanket of snow over both slopes and the ridge
  const roofSnow = new THREE.Mesh(
    roofSnowGeometry(top + RIDGE, slope, slabLen * Math.cos(slope), D + OVER),
    snow,
  );
  g.add(roofSnow);

  // Chimney with smoke
  const chimney = kit.outline(
    new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, 0.5), kit.toon(0x8a5a4a)),
    1.04,
  );
  chimney.position.set(-1.0, top + RIDGE * 0.55 + 0.5, -0.6);
  // Open chimney: a dark flue inside, snow only on the rim (smoke comes out)
  const topY = chimney.position.y + 0.65;
  const flue = new THREE.Mesh(
    new THREE.PlaneGeometry(0.32, 0.32),
    new THREE.MeshBasicMaterial({ color: 0x120a08 }),
  );
  flue.rotation.x = -Math.PI / 2;
  flue.position.set(chimney.position.x, topY + 0.005, chimney.position.z);
  g.add(chimney, flue);
  // A plump ring of snow on the rim, hanging a little over the bricks
  const rim = new THREE.Mesh(chimneySnowGeometry(), snow);
  rim.position.set(chimney.position.x, topY, chimney.position.z);
  g.add(rim);
  // Icicles hanging from the snowy rim, of different length, irregularly spaced
  [0.25, 0.95, 1.5, 2.3, 2.75, 3.6, 4.35, 4.9, 5.75].forEach((th, k) => {
    const len = 0.1 + rand(k * 5.3 + 2) * 0.24;
    const sq =
      1 / Math.pow(Math.pow(Math.abs(Math.cos(th)), 4) + Math.pow(Math.abs(Math.sin(th)), 4), 0.25);
    const icicle = new THREE.Mesh(new THREE.ConeGeometry(0.022 + len * 0.05, len, 5), icicleMat);
    icicle.rotation.z = Math.PI;
    icicle.position.set(
      chimney.position.x + Math.cos(th) * 0.27 * sq,
      topY - 0.09 - len / 2,
      chimney.position.z + Math.sin(th) * 0.27 * sq,
    );
    g.add(icicle);
  });

  // Snow piled up around the chimney where it comes out of the roof
  const pile = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 10), snow);
  pile.scale.set(1, 0.42, 1.05);
  pile.position.set(
    chimney.position.x - 0.05,
    top + RIDGE + 0.1 - Math.tan(slope) * (Math.abs(chimney.position.x) - 0.12) + 0.14,
    chimney.position.z,
  );
  pile.rotation.z = slope * 0.8;
  g.add(pile);

  // Smoke: solid cartoon puffs rising in a curl
  const smokeMat = kit.toon(0xe6e9f8, { emissive: 0x6f78a8, emissiveIntensity: 0.55 });
  const smoke: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const puff = buildPuff(smokeMat);
    g.add(puff);
    smoke.push(puff);
  }
  const smokeOrigin = new THREE.Vector3(
    chimney.position.x,
    chimney.position.y + 0.62,
    chimney.position.z,
  );

  // Windows: frame, cross bars, sill with snow, shutters
  const shutterMat = kit.toon(0x2f6b4f);
  const windowSpots: Cabin['windowSpots'] = [];
  const addWindow = (x: number, y: number, z: number, ry: number) => {
    const win = new THREE.Group();
    win.position.set(x, y, z);
    win.rotation.y = ry;
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.62),
      new THREE.MeshBasicMaterial({ color: 0x1c1a33 }),
    );
    glass.position.z = 0.02;
    windows.push(glass);
    // The back window looks into the forest: its light is never seen
    if (ry !== Math.PI) windowSpots.push({ position: new THREE.Vector3(x, y, z), ry });
    const frame = kit.outline(new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.78, 0.06), trim), 1.03);
    const hole = new THREE.Mesh(
      new THREE.PlaneGeometry(0.72, 0.64),
      new THREE.MeshBasicMaterial({ color: 0x14122a }),
    );
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
      const shutter = kit.outline(
        new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.04), shutterMat),
        1.04,
      );
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
  const door = kit.outline(
    new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.45, 0.08), kit.toon(0x5b3424)),
    1.03,
  );
  door.position.set(0.95, 0.3 + 0.72, D + LOG + 0.02);
  const doorFrame = kit.outline(
    new THREE.Mesh(new THREE.BoxGeometry(0.98, 1.58, 0.05), trim),
    1.02,
  );
  doorFrame.position.set(door.position.x, door.position.y + 0.04, D + LOG - 0.01);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), kit.toon(0xffd36b));
  knob.position.set(1.22, 0.95, D + LOG + 0.08);
  const wreath = kit.hull(
    new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 6, 14), kit.toon(0x1f7a4a)),
    0.012,
  );
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
    g.add(post);
    // The same lantern as on the fence, on the porch post
    const lamp = kit.lantern(0.8);
    lamp.group.position.set(px, 1.35, D + 1.2);
    g.add(lamp.group);
  }

  // Firewood stack by the side wall
  const woodEnd = kit.toon(0xc49a6c);
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 4 - row; k++) {
      const log = kit.hull(
        new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.7, 7), [logA, woodEnd, woodEnd]),
        0.01,
      );
      log.rotation.x = Math.PI / 2;
      log.position.set(W + 0.45, 0.13 + row * 0.2, -0.9 + k * 0.23 + row * 0.115);
      g.add(log);
    }
  }
  const woodSnow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.6), snow);
  woodSnow.position.set(W + 0.45, 0.68, -0.55);
  g.add(woodSnow);

  // Snowdrifts around the walls
  const driftGeo = new THREE.SphereGeometry(0.5, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let k = 0; k < 10; k++) {
    // Smooth rounded mounds resting on the ground (not flat pancakes)
    const drift = new THREE.Mesh(driftGeo, snow);
    const side = k % 4;
    const t = rand(k) * 2 - 1;
    drift.position.set(
      side === 0 ? W + 0.2 : side === 1 ? -W - 0.2 : t * W,
      -0.02,
      side === 2 ? -D - 0.2 : side === 3 ? D + 0.2 : t * D,
    );
    if (side === 3 && Math.abs(drift.position.x - 0.95) < 0.8) drift.position.x -= 1.6;
    const along = side < 2 ? 0 : 1;
    const len = 1.1 + rand(k * 3 + 1) * 0.7;
    drift.scale.set(along ? len : 0.75, 0.55 + rand(k * 5 + 2) * 0.45, along ? 0.75 : len);
    g.add(drift);
  }

  // Warm light falling on the snow in front of the windows
  const pool = kit.glow(0xffb45a, 4.5, 0);
  pool.position.set(-0.6, 0.6, D + 1.4);
  lights.push(pool);
  g.add(pool);

  // Under the roof edges: front/back rakes and both side eaves
  const eaveX = slabLen * Math.cos(slope) - 0.06;
  const eaveY = top + RIDGE - slabLen * Math.sin(slope) - 0.13;
  const ridgeY = top + RIDGE - 0.16;
  const zEnd = D + OVER - 0.06;
  const roofEdges: [THREE.Vector3, THREE.Vector3][] = [];
  for (const z of [zEnd, -zEnd]) {
    roofEdges.push([new THREE.Vector3(-eaveX, eaveY, z), new THREE.Vector3(0, ridgeY, z)]);
    roofEdges.push([new THREE.Vector3(0, ridgeY, z), new THREE.Vector3(eaveX, eaveY, z)]);
  }
  for (const x of [-eaveX, eaveX]) {
    roofEdges.push([new THREE.Vector3(x, eaveY, -zEnd), new THREE.Vector3(x, eaveY, zEnd)]);
  }

  let smokeT = 0;
  return {
    group: g,
    windows,
    lights,
    pool,
    windowSpots,
    roofEdges,
    roofSnow,
    update(t: number, dt: number) {
      smokeT += dt;
      smoke.forEach((puff, i) => {
        const life = (smokeT * 0.2 + i / smoke.length) % 1;
        const k = puffScale(life) * (0.4 + 0.2 * rand(i * 3.1));
        puff.visible = k > 0.01;
        // Rises in an S-curl and leans with the wind
        puff.position.set(
          smokeOrigin.x + Math.sin(life * 5.5 + i * 0.4) * 0.22 * life + life * life * 0.9,
          smokeOrigin.y + life * 2.9,
          smokeOrigin.z + Math.cos(life * 4.0 + i) * 0.12 * life,
        );
        puff.scale.setScalar(Math.max(k, 0.001));
        puff.rotation.set(i * 1.3, t * 0.3 + i * 2.1, life * 1.5 + i);
      });
    },
  };
}
