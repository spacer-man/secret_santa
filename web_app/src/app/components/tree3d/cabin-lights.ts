/**
 * Fringe (icicle) lights under the cabin roof: a line of bulbs along every
 * roof edge with strands of different length hanging from it. The look is a
 * "skin" bought for mandarins: colours + animation.
 */
import * as THREE from 'three';

import type { LightSkin } from './skins';

export type { LightSkin };

const PALETTES: Record<LightSkin, number[]> = {
  multi: [0xff3b4e, 0x2fe08a, 0x3d8bff, 0xffd34a, 0xff7ad9, 0xff9330],
  warm: [0xffe7b0],
  gold: [0xffc23a, 0xffe08a],
  icy: [0x9fd8ff, 0xffffff, 0x6fb8ff],
  candy: [0xff2d45, 0xffffff],
};

const STEP = 0.19; // between bulbs along the roof edge
const DROP = 0.13; // between bulbs down a strand
const PATTERN = [1, 3, 2, 4, 2, 3, 1, 2]; // strand lengths, in bulbs

interface Bulb {
  pos: THREE.Vector3;
  /** Index along the line (for chases) */
  along: number;
  /** 0 on the line, 1.. down a strand */
  depth: number;
  seed: number;
}

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export class CabinLights {
  readonly group = new THREE.Group();
  private readonly bulbs: Bulb[] = [];
  private mesh?: THREE.InstancedMesh;
  private wire?: THREE.LineSegments;
  private glows: THREE.Sprite[] = [];
  private readonly light = new THREE.PointLight(0xffd9a0, 0, 7, 1.6);
  private skin: LightSkin | null = null;
  private readonly colors: THREE.Color[] = [];
  private readonly tmp = new THREE.Color();

  /**
   * @param edges roof edges in cabin space: [from, to] (bulbs hang below them)
   * @param glowTex soft round texture for the halo along the roof
   */
  constructor(
    edges: [THREE.Vector3, THREE.Vector3][],
    private readonly glowTex: THREE.Texture,
    lightPos: THREE.Vector3,
  ) {
    let along = 0;
    const wirePts: number[] = [];
    edges.forEach(([a, b], e) => {
      const len = a.distanceTo(b);
      const n = Math.max(2, Math.round(len / STEP));
      for (let k = 0; k <= n; k++) {
        const p = a.clone().lerp(b, k / n);
        this.bulbs.push({ pos: p, along, depth: 0, seed: along * 1.7 + e });
        // A strand of drops (not at the very ends: corners look cleaner)
        if (k > 0 && k < n) {
          const count = PATTERN[(along + e) % PATTERN.length];
          for (let d = 1; d <= count; d++) {
            const q = p.clone().add(new THREE.Vector3(0, -d * DROP, 0));
            this.bulbs.push({ pos: q, along, depth: d, seed: along * 1.7 + d * 13 + e });
          }
          wirePts.push(p.x, p.y, p.z, p.x, p.y - count * DROP, p.z);
        }
        along++;
      }
      wirePts.push(a.x, a.y + 0.02, a.z, b.x, b.y + 0.02, b.z);
    });

    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
    this.wire = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x1d2a20 }));

    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      this.bulbs.length,
    );
    const m = new THREE.Matrix4();
    this.bulbs.forEach((b, i) => {
      m.makeTranslation(b.pos.x, b.pos.y, b.pos.z);
      this.mesh!.setMatrixAt(i, m);
      this.mesh!.setColorAt(i, new THREE.Color(0x333333));
      this.colors.push(new THREE.Color());
    });

    // Soft halo along the edges: a few big sprites instead of one per bulb
    edges.forEach(([a, b]) => {
      const n = Math.max(1, Math.round(a.distanceTo(b) / 0.9));
      for (let k = 0; k <= n; k++) {
        const g = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glowTex,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        g.position.copy(a.clone().lerp(b, k / n)).add(new THREE.Vector3(0, -0.2, 0));
        g.scale.setScalar(1.3);
        this.glows.push(g);
      }
    });

    this.light.position.copy(lightPos);
    this.group.add(this.wire, this.mesh, this.light, ...this.glows);
    this.group.visible = false;
  }

  setSkin(skin: LightSkin | null): void {
    this.skin = skin;
    this.group.visible = !!skin;
    if (!skin) return;
    const palette = PALETTES[skin];
    this.bulbs.forEach((b, i) => {
      // Candy and icy alternate along the line, others mix by position
      const idx =
        skin === 'candy' || skin === 'icy'
          ? (b.along + b.depth) % palette.length
          : (b.along * 7 + b.depth * 3) % palette.length;
      this.colors[i].set(palette[idx]);
    });
    const avg = new THREE.Color(0, 0, 0);
    palette.forEach((c) => avg.add(new THREE.Color(c)));
    avg.multiplyScalar(1 / palette.length);
    this.glows.forEach((g, k) =>
      g.material.color.copy(skin === 'multi' ? new THREE.Color(palette[k % palette.length]) : avg),
    );
    this.light.color.copy(skin === 'multi' ? new THREE.Color(0xffd9b0) : avg);
  }

  update(t: number): void {
    if (!this.skin || !this.mesh) return;
    const skin = this.skin;
    this.bulbs.forEach((b, i) => {
      let k: number;
      switch (skin) {
        case 'multi': // chase along the roof
          k = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 4 - b.along * 0.6));
          break;
        case 'warm': // gentle random twinkle
          k = 0.7 + 0.3 * Math.sin(t * (1.5 + rand(b.seed) * 2.5) + b.seed * 5);
          break;
        case 'gold': // slow wave
          k = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.4 - b.along * 0.25));
          break;
        case 'icy': // light drips down the strands
          k =
            b.depth === 0
              ? 0.75
              : 0.3 + 0.7 * Math.max(0, Math.sin(t * 3 - b.depth * 1.1 + rand(b.seed) * 6)) ** 3;
          break;
        case 'candy': // alternate blink
          k = (Math.floor(t * 1.5) + b.along + b.depth) % 2 ? 1 : 0.35;
          break;
      }
      this.mesh!.setColorAt(i, this.tmp.copy(this.colors[i]).multiplyScalar(k));
    });
    this.mesh.instanceColor!.needsUpdate = true;
    const breathe = 0.85 + 0.15 * Math.sin(t * 1.3);
    this.glows.forEach(
      (g, k) =>
        (g.material.opacity =
          (skin === 'multi' ? 0.35 + 0.25 * Math.sin(t * 4 - k) : 0.45) * breathe),
    );
    this.light.intensity = 3.5 * breathe;
  }
}
