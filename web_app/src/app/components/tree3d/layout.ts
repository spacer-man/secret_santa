/**
 * Anti-intersection for courtyard figures.
 *
 * Every object is a circle on the ground ("footprint") sized from its own model.
 * Figures push each other apart and are pushed out of fixed obstacles
 * (present heaps, bench, snow piles), stay inside the ring between the train
 * track and the fence, and are pulled softly back to their own place.
 */
import * as THREE from 'three';

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export interface Body extends Circle {
  homeX: number;
  homeZ: number;
}

export interface Ring {
  min: number;
  max: number;
}

const GAP = 0.06;

/** Footprint radius of a model (already scaled), from its bounding box */
export function footprint(obj: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  // A circle between the inscribed and the circumscribed one of the box
  return (Math.max(size.x, size.z) / 2) * 0.9 + Math.min(size.x, size.z) * 0.1;
}

export function body(x: number, z: number, r: number): Body {
  return { x, z, r, homeX: x, homeZ: z };
}

/** Moves bodies until nothing overlaps (or the iterations run out) */
export function resolve(bodies: Body[], statics: Circle[], ring: Ring, iterations = 80): void {
  for (let it = 0; it < iterations; it++) {
    let moved = false;

    // Soft pull back home: figures stay close to their places
    for (const b of bodies) {
      b.x += (b.homeX - b.x) * 0.04;
      b.z += (b.homeZ - b.z) * 0.04;
    }

    // Figures push each other apart (half each)
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const push = separation(a, b, a.r + b.r + GAP);
        if (push) {
          a.x -= push.x / 2;
          a.z -= push.z / 2;
          b.x += push.x / 2;
          b.z += push.z / 2;
          moved = true;
        }
      }
    }

    // Fixed obstacles push figures fully
    for (const b of bodies) {
      for (const s of statics) {
        const push = separation(s, b, s.r + b.r + GAP);
        if (push) {
          b.x += push.x;
          b.z += push.z;
          moved = true;
        }
      }
      // Between the train track and the fence
      const d = Math.hypot(b.x, b.z) || 1e-6;
      const lo = ring.min + b.r;
      const hi = ring.max - b.r;
      const target = Math.min(Math.max(d, lo), Math.max(lo, hi));
      if (target !== d) {
        b.x *= target / d;
        b.z *= target / d;
        moved = true;
      }
    }

    if (!moved && it > 10) break;
  }
}

/** Vector from a to b to remove their overlap, or null */
function separation(a: Circle, b: Circle, minDist: number): { x: number; z: number } | null {
  let dx = b.x - a.x;
  let dz = b.z - a.z;
  let d = Math.hypot(dx, dz);
  if (d >= minDist) return null;
  if (d < 1e-6) {
    // Same spot: push sideways in a stable direction
    dx = 1;
    dz = 0.3;
    d = Math.hypot(dx, dz);
  }
  const k = (minDist - d) / d;
  return { x: dx * k, z: dz * k };
}
