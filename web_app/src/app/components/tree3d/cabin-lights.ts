/**
 * Lights under the cabin roof. The look is a "skin" bought for mandarins:
 * a shape (fringe, fringe with snowflakes, rainbow of drooping lines, meteor
 * tubes), colours and a set of animation programs that take turns, like the
 * controller of a real garland.
 */
import * as THREE from 'three';
import { TUNING } from '../../core/tuning';
import { HIDDEN_LAYER, emit, pushForward } from './glow';
import { FACING_DECAY } from './lantern';

import type { LightSkin } from './skins';

export type { LightSkin };

type Shape = 'fringe' | 'flakes' | 'rainbow' | 'meteor';

type Program =
  | 'chase'
  | 'twinkle'
  | 'wave'
  | 'drip'
  | 'blink'
  | 'breathe'
  | 'sparkle'
  | 'fill'
  | 'lines'
  | 'cascade'
  | 'roll'
  | 'meteor'
  | 'meteorWave';

const RAINBOW = [0xff2d3a, 0xff8a1e, 0xffe03a, 0x34e06a, 0x2f8cff, 0xa65bff];

interface SkinDef {
  shape: Shape;
  palette: number[];
  /** Taking turns; the first one is the signature of the skin */
  programs: Program[];
  /** Colour of the snowflakes (flakes shape) */
  flake?: number;
  /** Shape of a bulb: a round one (default) or a puffy star with 4 / 5 rays */
  bulb?: Bulb4or5;
}

type Bulb4or5 = 4 | 5;

const SKINS: Record<LightSkin, SkinDef> = {
  multi: {
    shape: 'fringe',
    palette: [0xff3b4e, 0x2fe08a, 0x3d8bff, 0xffd34a, 0xff7ad9, 0xff9330],
    programs: ['chase', 'twinkle', 'blink', 'fill', 'breathe'],
  },
  warm: { shape: 'fringe', palette: [0xffe7b0], programs: ['twinkle', 'breathe', 'sparkle'] },
  gold: { shape: 'fringe', palette: [0xffc23a, 0xffe08a], programs: ['wave', 'sparkle', 'fill'] },
  icy: {
    shape: 'fringe',
    palette: [0x9fd8ff, 0xffffff, 0x6fb8ff],
    programs: ['drip', 'twinkle', 'wave'],
  },
  candy: {
    shape: 'fringe',
    palette: [0xff2d45, 0xffffff],
    programs: ['blink', 'chase', 'breathe'],
  },
  flakes: {
    shape: 'flakes',
    palette: [0xdff3ff, 0x8fd0ff],
    flake: 0xf2fbff,
    programs: ['sparkle', 'drip', 'wave'],
  },
  rainbow: {
    shape: 'rainbow',
    palette: RAINBOW,
    programs: ['lines', 'cascade', 'roll', 'breathe'],
  },
  stars: {
    shape: 'fringe',
    bulb: 5,
    palette: [0xffd34a, 0xff4b5c, 0x45e08f, 0x4d9bff, 0xffffff],
    programs: ['twinkle', 'chase', 'fill', 'breathe'],
  },
  sparks: {
    shape: 'fringe',
    bulb: 4,
    palette: [0xffffff, 0xbfe6ff, 0xffe9a8],
    programs: ['sparkle', 'drip', 'wave'],
  },
  starbow: {
    shape: 'rainbow',
    bulb: 5,
    palette: RAINBOW,
    programs: ['cascade', 'lines', 'roll', 'breathe'],
  },
  starfall: {
    shape: 'meteor',
    bulb: 4,
    palette: [0xffffff, 0xbfe6ff],
    programs: ['meteorWave', 'meteor'],
  },
  meteor: {
    shape: 'meteor',
    palette: [0xe8f6ff, 0x9fd4ff],
    programs: ['meteor', 'meteorWave'],
  },
};

const STEP = 0.19; // between bulbs along the roof edge
const DROP = 0.13; // between bulbs down a strand
const PATTERN = [1, 3, 2, 4, 2, 3, 1, 2]; // strand lengths, in bulbs
/** Snowflake shape: which strands end with a flake (the rest are plain) */
const FLAKE_PATTERN = [0, 1, 0, 0, 2, 0, 1, 0, 0, 2];
const FLAKE_R = 0.12;
/** Rainbow: lines, the gap between them, scallops */
const LINES = RAINBOW.length;
const LINE_GAP = 0.11;
const SCALLOP = 0.62;
const SAG = 0.12;
/** Meteor tubes: every other anchor, dense bulbs */
const METEOR_DROP = 0.075;
const METEOR_PATTERN = [7, 9, 6, 10, 8, 6, 9, 7];

interface Bulb {
  pos: THREE.Vector3;
  /** Index along the line (for chases) */
  along: number;
  /** 0 on the line, 1.. down a strand */
  depth: number;
  /** Bulbs in its strand (meteors) */
  len: number;
  /** Rainbow line, 0 at the top */
  line: number;
  seed: number;
  /** Away from the wall: stars face this way */
  out: THREE.Vector3;
}

interface Flake {
  pos: THREE.Vector3;
  /** Faces this way (outwards from the wall) */
  quat: THREE.Quaternion;
  scale: number;
  seed: number;
  along: number;
}

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** A flat six-armed snowflake in the XY plane, radius 1 */
function flakeGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const bar = (x0: number, y0: number, x1: number, y1: number, w: number): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy);
    const nx = (-dy / l) * w;
    const ny = (dx / l) * w;
    pos.push(x0 + nx, y0 + ny, 0, x0 - nx, y0 - ny, 0, x1 + nx, y1 + ny, 0);
    pos.push(x1 + nx, y1 + ny, 0, x0 - nx, y0 - ny, 0, x1 - nx, y1 - ny, 0);
  };
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const at = (r: number, side: number): [number, number] => [c * r - s * side, s * r + c * side];
    bar(0, 0, c, s, 0.07);
    for (const [r, l] of [
      [0.42, 0.3],
      [0.7, 0.2],
    ]) {
      for (const side of [-1, 1]) {
        const [x0, y0] = at(r, 0);
        const [x1, y1] = at(r + l * 0.7, side * l);
        bar(x0, y0, x1, y1, 0.055);
      }
    }
  }
  // A little hexagon in the middle
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const a1 = ((k + 1) / 6) * Math.PI * 2 + Math.PI / 6;
    pos.push(0, 0, 0, Math.cos(a0) * 0.2, Math.sin(a0) * 0.2, 0);
    pos.push(Math.cos(a1) * 0.2, Math.sin(a1) * 0.2, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/**
 * A puffy star facing +Z, outer radius 1: rays in the XY plane, the middle
 * pushed out front and back, so it reads as a star from the side too.
 */
function starGeometry(rays: number): THREE.BufferGeometry {
  const inner = rays === 4 ? 0.3 : 0.45;
  const depth = rays === 4 ? 0.28 : 0.35;
  const ring: [number, number][] = [];
  for (let k = 0; k < rays * 2; k++) {
    const a = Math.PI / 2 + (k / (rays * 2)) * Math.PI * 2;
    const r = k % 2 ? inner : 1;
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const pos: number[] = [];
  for (const z of [depth, -depth]) {
    for (let k = 0; k < ring.length; k++) {
      const [x0, y0] = ring[k];
      const [x1, y1] = ring[(k + 1) % ring.length];
      if (z > 0) pos.push(0, 0, z, x0, y0, 0, x1, y1, 0);
      else pos.push(0, 0, z, x1, y1, 0, x0, y0, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Horizontal direction away from the cabin, across the edge */
function outwards(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3(0, 1, 0));
  n.y = 0;
  n.normalize();
  const mid = a.clone().add(b).multiplyScalar(0.5);
  if (n.x * mid.x + n.z * mid.z < 0) n.negate();
  return n;
}

export class CabinLights {
  readonly group = new THREE.Group();
  private bulbs: Bulb[] = [];
  private flakes: Flake[] = [];
  private alongCount = 1;
  private mesh?: THREE.InstancedMesh;
  private flakeMesh?: THREE.InstancedMesh;
  private wire?: THREE.LineSegments;
  private readonly parts = new THREE.Group();
  private glows: THREE.Sprite[] = [];
  private readonly light = new THREE.PointLight(0xffd9a0, 0, 7, FACING_DECAY);
  private skin: LightSkin | null = null;
  private shape: string | null = null;
  /** Star bulbs: rays, size; their turn on the wire (null: round bulbs, no turning) */
  private star: { rays: Bulb4or5; size: number; roll: number[] } | null = null;
  private colors: THREE.Color[] = [];
  private readonly tmp = new THREE.Color();
  private readonly tmp2 = new THREE.Color();
  private readonly tmp3 = new THREE.Color();
  private readonly mat4 = new THREE.Matrix4();
  private readonly spin = new THREE.Quaternion();
  private readonly q = new THREE.Quaternion();
  private readonly z = new THREE.Vector3(0, 0, 1);
  private readonly one = new THREE.Vector3();
  /** Skin chosen at this moment of the clock: programs count from here */
  private since = -1;

  /**
   * @param edges roof edges in cabin space: [from, to] (bulbs hang below them)
   * @param glowTex soft round texture for the halo along the roof
   */
  constructor(
    private readonly edges: [THREE.Vector3, THREE.Vector3][],
    private readonly glowTex: THREE.Texture,
    lightPos: THREE.Vector3,
    /** Brightness of the bulbs for the bloom (1: no bloom, flat halos instead) */
    private readonly bloom = 1,
  ) {
    // Soft halo along the edges: a few big sprites instead of one per bulb
    edges.forEach(([a, b]) => {
      const n = Math.max(1, Math.round(a.distanceTo(b) / 0.9));
      for (let k = 0; k <= n; k++) {
        const g = new THREE.Sprite(
          pushForward(
            new THREE.SpriteMaterial({
              map: glowTex,
              transparent: true,
              opacity: 0,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
            0.6,
          ),
        );
        g.position.copy(a.clone().lerp(b, k / n)).add(new THREE.Vector3(0, -0.2, 0));
        g.scale.setScalar(1.3);
        this.glows.push(g);
      }
    });

    this.light.position.copy(lightPos);
    // With the bloom the bulbs glow by themselves: no flat halos
    if (bloom > 1) this.glows.forEach((g) => g.layers.set(HIDDEN_LAYER));
    this.group.add(this.parts, this.light, ...this.glows);
    this.group.visible = false;
  }

  // ---------- Shapes ----------

  private build(shape: Shape, rays?: Bulb4or5): void {
    const key = shape + (rays ?? '');
    if (this.shape === key) return;
    this.shape = key;
    this.parts.children.forEach((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    });
    this.parts.clear();
    this.mesh?.dispose();
    this.flakeMesh?.dispose();
    this.mesh = this.flakeMesh = undefined;
    this.bulbs = [];
    this.flakes = [];
    const wire: number[] = [];

    if (shape === 'rainbow') this.layoutRainbow(wire);
    else this.layoutStrands(shape, wire);
    this.alongCount = Math.max(1, ...this.bulbs.map((b) => b.along + 1));

    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    this.wire = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x1d2a20 }));

    const r = shape === 'meteor' ? 0.036 : shape === 'rainbow' ? 0.04 : 0.045;
    this.star = rays
      ? {
          rays,
          size: (rays === 4 ? 0.085 : 0.068) * (shape === 'meteor' ? 0.62 : 1),
          roll: this.bulbs.map((b) => (rand(b.seed + 3) - 0.5) * 0.7),
        }
      : null;
    this.mesh = new THREE.InstancedMesh(
      rays ? starGeometry(rays) : new THREE.SphereGeometry(r, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      this.bulbs.length,
    );
    const black = new THREE.Color(0x333333);
    this.bulbs.forEach((b, i) => {
      this.placeBulb(i, 0);
      this.mesh!.setColorAt(i, black);
    });
    this.colors = this.bulbs.map(() => new THREE.Color());
    this.parts.add(this.wire, this.mesh);

    if (this.flakes.length) {
      this.flakeMesh = new THREE.InstancedMesh(
        flakeGeometry(),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
        this.flakes.length,
      );
      this.flakes.forEach((_, i) => this.flakeMesh!.setColorAt(i, black));
      this.parts.add(this.flakeMesh);
    }
  }

  /** Strands hanging from a line of bulbs: fringe, with snowflakes, meteor tubes */
  private layoutStrands(shape: Shape, wire: number[]): void {
    let along = 0;
    this.edges.forEach(([a, b], e) => {
      const out = outwards(a, b);
      const len = a.distanceTo(b);
      const n = Math.max(2, Math.round(len / STEP));
      for (let k = 0; k <= n; k++) {
        const p = a.clone().lerp(b, k / n);
        const strand = k > 0 && k < n;
        let count = 0;
        let drop = DROP;
        let flake = 0;
        if (shape === 'meteor') {
          drop = METEOR_DROP;
          // Tubes on every other anchor; shorter near the corners
          if (strand && k % 2 === 0) {
            const edgeFade = Math.min(k, n - k) / 3;
            count = Math.max(
              3,
              Math.round(METEOR_PATTERN[(k / 2 + e) % 8] * Math.min(1, edgeFade)),
            );
          }
        } else if (strand) {
          count = PATTERN[(along + e) % PATTERN.length];
          if (shape === 'flakes') flake = FLAKE_PATTERN[(along + e * 3) % FLAKE_PATTERN.length];
        }
        // Meteors hang from a plain wire: no bulb on the line
        if (shape !== 'meteor' || count) {
          this.bulbs.push({
            pos: p,
            along,
            depth: 0,
            len: count,
            line: 0,
            seed: along * 1.7 + e,
            out,
          });
        }
        for (let d = 1; d <= count; d++) {
          const q = p.clone().add(new THREE.Vector3(0, -d * drop, 0));
          this.bulbs.push({
            pos: q,
            along,
            depth: d,
            len: count,
            line: 0,
            seed: along * 1.7 + d * 13 + e,
            out,
          });
        }
        let bottom = p.y - count * drop;
        if (flake) {
          const scale = FLAKE_R * (flake === 2 ? 1.25 : 0.9);
          const pos = p.clone().addScaledVector(out, 0.02);
          pos.y = bottom - scale - 0.03;
          this.flakes.push({
            pos,
            quat: new THREE.Quaternion().setFromUnitVectors(this.z, out),
            scale,
            seed: along * 3.1 + e,
            along,
          });
          bottom = pos.y + scale;
        }
        if (count || flake) wire.push(p.x, p.y, p.z, p.x, bottom, p.z);
        along++;
      }
      wire.push(a.x, a.y + 0.02, a.z, b.x, b.y + 0.02, b.z);
    });
  }

  /**
   * Rainbow: nested drooping lines, one colour each, every line a garland of
   * its own. Lower lines are shorter, so they nest under the roof like arcs.
   */
  private layoutRainbow(wire: number[]): void {
    let along = 0;
    this.edges.forEach(([a, b], e) => {
      const out = outwards(a, b);
      const sloped = Math.abs(a.y - b.y) > 0.1;
      const lowAtA = a.y < b.y;
      let edgeAlong = 0;
      for (let line = 0; line < LINES; line++) {
        const down = line * LINE_GAP;
        const trim = line * 0.055;
        // Sloped rakes shrink from the eave end only: the arcs meet at the ridge
        const t0 = sloped ? (lowAtA ? trim : 0) : trim * 0.6;
        const t1 = sloped ? (lowAtA ? 1 : 1 - trim) : 1 - trim * 0.6;
        const p0 = a.clone().lerp(b, t0);
        const p1 = a.clone().lerp(b, t1);
        const len = p0.distanceTo(p1);
        const scallops = Math.max(1, Math.round(len / SCALLOP));
        const at = (s: number): THREE.Vector3 => {
          const sag = SAG * Math.sin(Math.PI * ((s * scallops) % 1));
          return p0
            .clone()
            .lerp(p1, s)
            .add(new THREE.Vector3(0, -down - sag, 0))
            .addScaledVector(out, 0.015 * line);
        };
        // The wire: fine samples of the curve
        const samples = scallops * 10;
        for (let k = 0; k < samples; k++) {
          const u = at(k / samples);
          const v = at((k + 1) / samples);
          wire.push(u.x, u.y, u.z, v.x, v.y, v.z);
        }
        const n = Math.max(2, Math.round(len / (STEP * 0.95)));
        for (let k = 0; k <= n; k++) {
          // Rakes are walked from the ridge down: chases run apex → eaves
          const s = k / n;
          const pos = at(s);
          const idx = along + Math.round((sloped && !lowAtA ? s : sloped ? 1 - s : s) * n);
          this.bulbs.push({
            pos,
            along: idx,
            depth: 0,
            len: 0,
            line,
            seed: idx * 1.7 + line * 31 + e,
            out,
          });
        }
        edgeAlong = Math.max(edgeAlong, n + 1);
      }
      along += edgeAlong;
    });
  }

  // ---------- Skin ----------

  setSkin(skin: LightSkin | null): void {
    if (skin !== this.skin) this.since = -1;
    this.skin = skin;
    this.group.visible = !!skin;
    if (!skin) return;
    const def = SKINS[skin];
    this.build(def.shape, def.bulb);
    const palette = def.palette;
    this.bulbs.forEach((b, i) => {
      let idx: number;
      if (def.shape === 'rainbow') idx = b.line;
      else if (skin === 'candy' || skin === 'icy') idx = (b.along + b.depth) % palette.length;
      else if (def.shape === 'meteor' || def.shape === 'flakes')
        idx = b.depth === 0 ? 0 : (b.along + b.depth) % palette.length;
      else idx = (b.along * 7 + b.depth * 3) % palette.length;
      this.colors[i].set(palette[idx % palette.length]);
    });
    const avg = new THREE.Color(0, 0, 0);
    palette.forEach((c) => avg.add(new THREE.Color(c)));
    avg.multiplyScalar(1 / palette.length);
    const many = skin === 'multi' || skin === 'rainbow';
    this.glows.forEach((g, k) =>
      g.material.color.copy(many ? new THREE.Color(palette[k % palette.length]) : avg),
    );
    this.light.color.copy(many ? new THREE.Color(0xffd9b0) : avg);
  }

  // ---------- Animation ----------

  /** Brightness 0..1 of a bulb in a program */
  private level(p: Program, b: Bulb, t: number): number {
    const r = rand(b.seed);
    switch (p) {
      case 'chase': // a run along the roof
        return 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 4 - b.along * 0.6));
      case 'twinkle': // gentle random twinkle
        return 0.7 + 0.3 * Math.sin(t * (1.5 + r * 2.5) + b.seed * 5);
      case 'wave': // slow wave
        return 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.4 - b.along * 0.25 - b.depth * 0.4));
      case 'drip': // light drips down the strands
        return b.depth === 0
          ? 0.75
          : 0.3 + 0.7 * Math.max(0, Math.sin(t * 3 - b.depth * 1.1 + r * 6)) ** 3;
      case 'blink': // alternate blink
        return (Math.floor(t * 1.5) + b.along + b.depth) % 2 ? 1 : 0.35;
      case 'breathe': // two halves fade in and out in turn
        return (
          0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 1.6 + ((b.along + b.depth + b.line) % 2) * Math.PI))
        );
      case 'sparkle': {
        // Dim, with short random flashes
        const f = (t * (0.45 + r * 0.4) + r * 7.3) % 1;
        return 0.35 + 0.65 * Math.max(0, 1 - f * 6) ** 2;
      }
      case 'fill': {
        // The lights fill the roof from one end and then empty from it
        const ph = ((t / 6) % 1) * 2;
        const pos = (b.along + 0.5) / this.alongCount;
        const lit =
          ph < 1 ? 1 - smooth(ph - 0.04, ph + 0.04, pos) : smooth(ph - 1.04, ph - 0.96, pos);
        return 0.15 + 0.85 * lit;
      }
      case 'lines': // every line runs its own way
        return (
          0.3 +
          0.7 *
            (0.5 +
              0.5 * Math.sin(t * (2.5 + b.line * 0.35) * (b.line % 2 ? 1 : -1) - b.along * 0.55))
        );
      case 'cascade': {
        // Lines light up one after another from the top, then all go out
        const ph = ((t / 4) % 1) * (LINES + 2.5);
        const on =
          smooth(b.line - 0.3, b.line + 0.7, ph) * (1 - smooth(LINES + 0.8, LINES + 2.3, ph));
        return 0.12 + 0.88 * on;
      }
      case 'roll': // colours roll down the lines (see colours): steady, a soft run
        return 0.75 + 0.25 * Math.sin(t * 3 - b.along * 0.3);
      case 'meteor':
      case 'meteorWave': {
        if (b.len === 0) return 0.5;
        // A bright drop runs down the tube leaving a fading tail
        const period = p === 'meteor' ? 1.4 + rand(b.along * 5.3) * 1.3 : 2.2;
        const shift = p === 'meteor' ? rand(b.along * 2.1) : -b.along * 0.035;
        const f = (((t / period + shift) % 1) + 1) % 1;
        const head = f * (b.len + 5) - 1;
        const d = head - b.depth;
        if (d < -0.5) return 0.2;
        return 0.2 + 0.8 * Math.exp(-Math.max(0, d) * 0.5) * (d < 0 ? 1 + d * 2 : 1);
      }
    }
  }

  /** Brightness 0..1 of a snowflake */
  private flakeLevel(p: Program, f: Flake, t: number): number {
    const r = rand(f.seed);
    switch (p) {
      case 'sparkle': {
        const k = (t * (0.3 + r * 0.25) + r * 5.1) % 1;
        return 0.55 + 0.45 * Math.max(0, 1 - k * 4) ** 2;
      }
      case 'wave':
        return 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.4 - f.along * 0.25));
      default:
        return 0.65 + 0.35 * Math.sin(t * 2 + r * 6);
    }
  }

  update(t: number): void {
    if (!this.skin || !this.mesh) return;
    const def = SKINS[this.skin];
    if (this.since < 0) this.since = t;

    // Programs take turns with a soft cross-fade
    const hold = TUNING.lightsProgramS;
    const fade = Math.min(hold * 0.4, 1.5);
    const el = t - this.since;
    const n = def.programs.length;
    const slot = Math.floor(el / hold);
    const cur = def.programs[slot % n];
    const next = def.programs[(slot + 1) % n];
    const w = n > 1 ? smooth(hold - fade, hold, el - slot * hold) : 0;
    // Rainbow colours roll from line to line while the "roll" program plays
    const rollW = (cur === 'roll' ? 1 - w : 0) + (next === 'roll' ? w : 0);
    const roll = t * 1.6;

    this.bulbs.forEach((b, i) => {
      let k = this.level(cur, b, t);
      if (w > 0) k += (this.level(next, b, t) - k) * w;
      let c = this.colors[i];
      if (rollW > 0) {
        const s = b.line + roll - b.along * 0.08;
        const lo = Math.floor(s);
        this.tmp2
          .set(RAINBOW[((lo % LINES) + LINES) % LINES])

          .lerp(this.tmp3.set(RAINBOW[(((lo + 1) % LINES) + LINES) % LINES]), s - lo);
        c = this.tmp2.lerp(c, 1 - rollW);
      }
      this.mesh!.setColorAt(i, this.shade(c, k));
    });
    this.mesh.instanceColor!.needsUpdate = true;
    if (this.star) {
      for (let i = 0; i < this.bulbs.length; i++) this.placeBulb(i, t);
      this.mesh.instanceMatrix.needsUpdate = true;
    }

    if (this.flakeMesh) {
      const fc = new THREE.Color(def.flake ?? 0xffffff);
      this.flakes.forEach((f, i) => {
        let k = this.flakeLevel(cur, f, t);
        if (w > 0) k += (this.flakeLevel(next, f, t) - k) * w;
        // Slowly turning on its thread
        const r = rand(f.seed + 1);
        this.spin.setFromAxisAngle(this.z, t * (0.25 + r * 0.3) * (r > 0.5 ? 1 : -1) + r * 6);
        this.q.copy(f.quat).multiply(this.spin);
        this.mat4.compose(f.pos, this.q, this.one.setScalar(f.scale));
        this.flakeMesh!.setMatrixAt(i, this.mat4);
        this.flakeMesh!.setColorAt(i, this.shade(fc, k));
      });
      this.flakeMesh.instanceMatrix.needsUpdate = true;
      this.flakeMesh.instanceColor!.needsUpdate = true;
    }

    const breathe = 0.85 + 0.15 * Math.sin(t * 1.3);
    const many = this.skin === 'multi' || this.skin === 'rainbow';
    this.glows.forEach(
      (g, k) => (g.material.opacity = (many ? 0.35 + 0.25 * Math.sin(t * 4 - k) : 0.45) * breathe),
    );
    this.light.intensity = 3.5 * breathe;
  }

  /** A bulb in place; stars face away from the wall and swing on the wire a little */
  private placeBulb(i: number, t: number): void {
    const b = this.bulbs[i];
    if (!this.star) {
      this.mat4.makeTranslation(b.pos.x, b.pos.y, b.pos.z);
    } else {
      const r = rand(b.seed + 7);
      const swing =
        Math.sin(t * (1.1 + r * 0.8) + r * 6) * 0.22 * Math.min(1, 0.4 + b.depth * 0.25);
      this.q.setFromUnitVectors(this.z, b.out);
      this.spin.setFromAxisAngle(this.z, this.star.roll[i] + swing);
      this.q.multiply(this.spin);
      this.mat4.compose(b.pos, this.q, this.one.setScalar(this.star.size));
    }
    this.mesh!.setMatrixAt(i, this.mat4);
  }

  private shade(c: THREE.Color, k: number): THREE.Color {
    return this.bloom > 1
      ? this.tmp.copy(emit(c, this.bloom)).multiplyScalar(k * k)
      : this.tmp.copy(c).multiplyScalar(k);
  }
}
