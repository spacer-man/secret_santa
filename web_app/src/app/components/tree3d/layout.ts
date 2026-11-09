/**
 * Anti-intersection for courtyard objects.
 *
 * Every object has a footprint on the ground made of one or more circles,
 * sized from its own model: round things are one circle, long things (a sled)
 * are a row of circles, so turning them really changes the space they take.
 * Objects are pushed out of each other and of fixed obstacles, kept inside a
 * ring and pulled softly back to their own place.
 */
import * as THREE from 'three';

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** A circle of a footprint, relative to the object's position (already rotated) */
export interface Part {
  dx: number;
  dz: number;
  r: number;
}

export interface Body {
  x: number;
  z: number;
  homeX: number;
  homeZ: number;
  parts: Part[];
}

export interface Ring {
  min: number;
  max: number;
}

export const FREE: Ring = { min: 0, max: 1e9 };

const GAP = 0.06;

/**
 * Footprint of a model (scaled, not rotated) turned by `yaw` (three.js rotation.y).
 * Long models become a row of circles along their long side.
 */
export function shape(obj: THREE.Object3D, yaw: number): Part[] {
  const saved = obj.rotation.y;
  obj.rotation.y = 0;
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.rotation.y = saved;
  obj.updateMatrixWorld(true);

  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3()).sub(obj.position);
  const long = Math.max(size.x, size.z);
  const short = Math.min(size.x, size.z);
  const alongX = size.x >= size.z;

  const local: Part[] = [];
  if (long / Math.max(short, 1e-3) < 1.35) {
    local.push({ dx: centre.x, dz: centre.z, r: (long / 2) * 0.92 });
  } else {
    // A row of circles covering the long side
    const r = (short / 2) * 1.02;
    const n = Math.ceil(long / short);
    const span = long / 2 - r;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : -span + (2 * span * i) / (n - 1);
      local.push(alongX ? { dx: centre.x + t, dz: centre.z, r } : { dx: centre.x, dz: centre.z + t, r });
    }
  }
  // rotation.y = yaw maps local (x, z) to (x cos + z sin, -x sin + z cos)
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return local.map((p) => ({ dx: p.dx * c + p.dz * s, dz: -p.dx * s + p.dz * c, r: p.r }));
}

export function makeBody(x: number, z: number, parts: Part[]): Body {
  return { x, z, homeX: x, homeZ: z, parts };
}

/** Circles of a body in the world: to use a placed body as an obstacle */
export function circlesOf(b: Body): Circle[] {
  return b.parts.map((p) => ({ x: b.x + p.dx, z: b.z + p.dz, r: p.r }));
}

/** Moves bodies until nothing overlaps (or the iterations run out) */
export function resolve(bodies: Body[], statics: Circle[], ring: Ring, iterations = 90): void {
  for (let it = 0; it < iterations; it++) {
    let moved = false;

    // Soft pull back home: objects stay close to their places
    for (const b of bodies) {
      b.x += (b.homeX - b.x) * 0.03;
      b.z += (b.homeZ - b.z) * 0.03;
    }

    // Bodies push each other apart (half each)
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const push = bodyPush(bodies[i], circlesOf(bodies[j]));
        if (push) {
          bodies[i].x += push.x / 2;
          bodies[i].z += push.z / 2;
          bodies[j].x -= push.x / 2;
          bodies[j].z -= push.z / 2;
          moved = true;
        }
      }
    }

    for (const b of bodies) {
      // Fixed obstacles push fully
      const push = bodyPush(b, statics);
      if (push) {
        b.x += push.x;
        b.z += push.z;
        moved = true;
      }
      // Keep every circle inside the ring
      let delta = 0;
      for (const p of b.parts) {
        const d = Math.hypot(b.x + p.dx, b.z + p.dz);
        if (d < ring.min + p.r) delta = Math.max(delta, ring.min + p.r - d);
        else if (d > ring.max - p.r) delta = Math.min(delta, ring.max - p.r - d);
      }
      if (delta) {
        const d = Math.hypot(b.x, b.z) || 1e-6;
        b.x += (b.x / d) * delta;
        b.z += (b.z / d) * delta;
        moved = true;
      }
    }

    if (!moved && it > 10) break;
  }
}

/** How much `b` must move to get out of the circles (sum over overlapping pairs) */
function bodyPush(b: Body, circles: Circle[]): { x: number; z: number } | null {
  let x = 0;
  let z = 0;
  let hit = false;
  for (const p of b.parts) {
    const px = b.x + p.dx;
    const pz = b.z + p.dz;
    for (const c of circles) {
      let dx = px - c.x;
      let dz = pz - c.z;
      let d = Math.hypot(dx, dz);
      const min = p.r + c.r + GAP;
      if (d >= min) continue;
      if (d < 1e-6) {
        dx = 1;
        dz = 0.3;
        d = Math.hypot(dx, dz);
      }
      x += (dx / d) * (min - d);
      z += (dz / d) * (min - d);
      hit = true;
    }
  }
  return hit ? { x, z } : null;
}

/** Distance an object had to move from its place: lower is better */
export function displacement(b: Body): number {
  return Math.hypot(b.x - b.homeX, b.z - b.homeZ);
}
