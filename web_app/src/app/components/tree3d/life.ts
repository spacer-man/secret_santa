/**
 * Small things that make the courtyard alive: bullfinches on the fence,
 * shooting stars, footprints on the path to the cabin.
 */
import * as THREE from 'three';
import { withOutline } from './outline';

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

type Toon = (color: number) => THREE.MeshToonMaterial;

// ====== Bullfinches ====== //

interface Bird {
  root: THREE.Group;
  body: THREE.Group;
  wings: THREE.Mesh[];
  perch: number;
  yaw: number;
  /** Current action and its progress */
  act: 'idle' | 'hop' | 'peck' | 'fly';
  t: number;
  wait: number;
  fromYaw: number;
  toYaw: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  n: number;
}

function buildBird(toon: Toon): { root: THREE.Group; body: THREE.Group; wings: THREE.Mesh[] } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const red = toon(0xe8452c);
  const grey = toon(0x7684a0);
  const black = toon(0x17171f);

  // Faces +Z, stands on y = 0
  const breast = withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), red), 0.002);
  breast.scale.set(0.92, 0.9, 1.12);
  breast.position.y = 0.105;
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), grey);
  back.scale.set(0.95, 0.95, 1.16);
  back.position.set(0, 0.108, -0.012);
  back.rotation.x = -0.75;
  const head = withOutline(new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), black), 0.002);
  head.position.set(0, 0.2, 0.062);
  const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.056, 10, 8), red);
  cheek.position.set(0, 0.182, 0.075);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 6), toon(0x3a3a46));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.2, 0.135);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.13), black);
  tail.position.set(0, 0.105, -0.16);
  tail.rotation.x = 0.35;
  body.add(breast, back, head, cheek, beak, tail);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eye.position.set(sx * 0.04, 0.212, 0.108);
    body.add(eye);
  }

  // Wings: pivots at the shoulders, folded along the body
  const wings: THREE.Mesh[] = [];
  const wingGeo = new THREE.BoxGeometry(0.11, 0.012, 0.13);
  wingGeo.translate(0.055, 0, -0.02);
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, black);
    wing.position.set(sx * 0.07, 0.14, -0.01);
    wing.scale.x = sx;
    body.add(wing);
    wings.push(wing);
  }
  root.scale.setScalar(1.35);
  return { root, body, wings };
}

/** Folded: pressed to the sides; in flight: flapping */
function setWings(b: Bird, flap: number | null): void {
  b.wings.forEach((w, i) => {
    const s = i ? 1 : -1;
    w.rotation.z = flap === null ? s * -1.35 : s * flap;
  });
}

export interface Birds {
  group: THREE.Group;
  update(t: number, dt: number): void;
}

/** A few bullfinches living on the given perches (tops of the fence posts) */
export function buildBirds(perches: THREE.Vector3[], toon: Toon, count = 3): Birds {
  const group = new THREE.Group();
  const taken = new Set<number>();
  const birds: Bird[] = [];
  for (let i = 0; i < Math.min(count, perches.length - 1); i++) {
    let perch = Math.floor(rand(i * 7.3 + 2) * perches.length);
    while (taken.has(perch)) perch = (perch + 1) % perches.length;
    taken.add(perch);
    const parts = buildBird(toon);
    parts.root.position.copy(perches[perch]);
    const p = perches[perch];
    // Looks into the courtyard
    const yaw = Math.atan2(-p.x, -p.z) + (rand(i) - 0.5);
    parts.root.rotation.y = yaw;
    group.add(parts.root);
    const bird: Bird = {
      ...parts,
      perch,
      yaw,
      act: 'idle',
      t: 0,
      wait: 1 + rand(i * 3.1) * 3,
      fromYaw: yaw,
      toYaw: yaw,
      from: p.clone(),
      to: p.clone(),
      n: i * 100,
    };
    setWings(bird, null);
    birds.push(bird);
  }

  const next = (b: Bird) => {
    b.n++;
    const r = rand(b.n * 1.37);
    b.t = 0;
    if (r < 0.5) {
      b.act = 'hop';
      b.fromYaw = b.yaw;
      b.toYaw = b.yaw + (rand(b.n * 2.1) - 0.5) * 2.4;
    } else if (r < 0.82) {
      b.act = 'peck';
    } else {
      // Fly to a free perch not too far away
      let best = -1;
      for (let k = 0; k < 8; k++) {
        const cand = Math.floor(rand(b.n * 3.3 + k) * perches.length);
        if (taken.has(cand)) continue;
        const d = perches[cand].distanceTo(perches[b.perch]);
        if (d > 1.5 && d < 9) {
          best = cand;
          break;
        }
      }
      if (best < 0) {
        b.act = 'peck';
        return;
      }
      taken.delete(b.perch);
      taken.add(best);
      b.act = 'fly';
      b.from.copy(perches[b.perch]);
      b.to.copy(perches[best]);
      b.perch = best;
      b.fromYaw = b.yaw;
      b.toYaw = Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z);
    }
  };

  const angleLerp = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
  const rest = (b: Bird) => {
    b.act = 'idle';
    b.t = 0;
    b.wait = 0.6 + rand(b.n * 5.9) * 3.4;
    b.body.rotation.x = 0;
    b.body.position.y = 0;
  };

  return {
    group,
    update(t, dt) {
      for (const b of birds) {
        b.t += dt;
        if (b.act === 'idle') {
          // Breathing; a quick look around now and then
          b.body.rotation.x = 0;
          b.body.position.y = 0;
          b.body.scale.y = 1 + 0.03 * Math.sin(t * 5 + b.n);
          if (b.t > b.wait) next(b);
        } else if (b.act === 'hop') {
          const k = Math.min(1, b.t / 0.28);
          b.body.position.y = Math.sin(k * Math.PI) * 0.07;
          b.yaw = angleLerp(b.fromYaw, b.toYaw, k);
          b.root.rotation.y = b.yaw;
          if (k >= 1) rest(b);
        } else if (b.act === 'peck') {
          const k = Math.min(1, b.t / 0.9);
          b.body.rotation.x = Math.pow(Math.abs(Math.sin(k * Math.PI * 2)), 0.6) * 0.75;
          if (k >= 1) rest(b);
        } else {
          const dist = b.from.distanceTo(b.to);
          const k = Math.min(1, b.t / (0.5 + dist * 0.16));
          const e = k * k * (3 - 2 * k);
          b.root.position.lerpVectors(b.from, b.to, e);
          b.root.position.y += Math.sin(k * Math.PI) * (0.35 + dist * 0.09);
          b.yaw = angleLerp(b.fromYaw, b.toYaw, Math.min(1, k * 5));
          b.root.rotation.y = b.yaw;
          b.body.rotation.x = -0.25 * Math.sin(k * Math.PI);
          setWings(b, Math.sin(t * 34) * 0.9);
          if (k >= 1) {
            b.root.position.copy(b.to);
            setWings(b, null);
            rest(b);
          }
        }
      }
    },
  };
}

// ====== Shooting stars ====== //

export interface ShootingStar {
  mesh: THREE.Mesh;
  /** `clear`: 0..1 how clear the sky is; `azimuth`: where the camera stands */
  update(t: number, clear: number, azimuth: number): void;
}

export function buildShootingStar(): ShootingStar {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.8, 'rgba(200,220,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(120, 4);
  ctx.quadraticCurveTo(128, 8, 120, 12);
  ctx.closePath();
  ctx.fill();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.visible = false;

  const R = 86;
  const LENGTH = 11;
  const WIDTH = 0.55;
  let n = 0;
  let nextAt = 6;
  let startAt = -1;
  const start = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const out = new THREE.Vector3();
  const pos = new THREE.Vector3();

  return {
    mesh,
    update(t, clear, azimuth) {
      if (startAt < 0) {
        if (t < nextAt) return;
        n++;
        nextAt = t + 9 + rand(n * 1.9) * 14;
        if (clear < 0.5) return;
        // In the part of the sky the camera looks at (beyond the tree)
        const a = azimuth + Math.PI + (rand(n * 2.3) - 0.5) * 0.7;
        const el = 0.2 + rand(n * 3.1) * 0.22;
        start.set(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el)).multiplyScalar(R);
        out.copy(start).normalize();
        // Flies sideways and a little down
        const way = rand(n * 4.7) < 0.5 ? -1 : 1;
        dir.set(Math.cos(a) * way, -0.35 - rand(n * 5.3) * 0.3, -Math.sin(a) * way).normalize();
        side.crossVectors(out, dir).normalize();
        startAt = t;
        mesh.visible = true;
      }
      const k = (t - startAt) / 0.75;
      if (k >= 1) {
        startAt = -1;
        mesh.visible = false;
        mat.opacity = 0;
        return;
      }
      pos.copy(start).addScaledVector(dir, k * 26);
      mesh.matrix.makeBasis(dir.clone().multiplyScalar(LENGTH), side.clone().multiplyScalar(WIDTH), out);
      // The head of the streak is at +X of the plane
      mesh.matrix.setPosition(pos.x - (dir.x * LENGTH) / 2, pos.y - (dir.y * LENGTH) / 2, pos.z - (dir.z * LENGTH) / 2);
      mesh.matrixWorldNeedsUpdate = true;
      mat.opacity = Math.sin(k * Math.PI) * Math.min(1, clear);
    },
  };
}

// ====== Footprints ====== //

/** A trail of footprints in the snow along a path (points on the ground) */
export function buildFootprints(path: THREE.Vector3[], step = 0.4): THREE.InstancedMesh {
  const curve = new THREE.CatmullRomCurve3(path);
  const n = Math.floor(curve.getLength() / step);
  const geo = new THREE.CircleGeometry(1, 10);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0x5b68a8, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    n,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const p = curve.getPointAt(u);
    const tan = curve.getTangentAt(u);
    const sideways = new THREE.Vector3(-tan.z, 0, tan.x).multiplyScalar((i % 2 ? 1 : -1) * 0.11);
    q.setFromAxisAngle(up, Math.atan2(tan.x, tan.z) + (rand(i) - 0.5) * 0.25 + (i % 2 ? 0.12 : -0.12));
    m.compose(new THREE.Vector3(p.x + sideways.x, p.y + 0.012, p.z + sideways.z), q, new THREE.Vector3(0.075, 1, 0.135));
    mesh.setMatrixAt(i, m);
  }
  return mesh;
}
