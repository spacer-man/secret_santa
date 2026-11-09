/**
 * 3D New Year courtyard (three.js, toon / cel shading).
 *
 * Static world: podium, cobblestones, fence with lanterns, cabin, forest, mountains, sky.
 * Dynamic: balls (hung / lit), gifts (wishes on moderation), garland, star, level effects.
 * Horizontal drag rotates the camera 360°, vertical swipes keep scrolling the page.
 */
import * as THREE from 'three';
import type { TreeBall, TreeData } from '../../core/api';
import { buildCabin } from './cabin';

export interface SceneCallbacks {
  ball(ball: TreeBall): void;
  star(): void;
  addBall(): void;
}

const BALL_COLORS: Record<string, number> = {
  red: 0xff2d55,
  gold: 0xffc94a,
  silver: 0xdfe7f5,
  blue: 0x3d8bff,
  green: 0x22d17c,
  purple: 0xa06bff,
  pink: 0xff7ab8,
  orange: 0xff9330,
};

// Zoom: 0 = close to the tree, 1 = whole courtyard
const ZOOM_NEAR = { distance: 8.5, elevation: 0.2, target: 2.9 };
const ZOOM_FAR = { distance: 17, elevation: 0.34, target: 3.4 };
const ZOOM_DEFAULT = 0.25;

// Tree tiers: [bottom y, height, radius]
const TIERS: [number, number, number][] = [
  [0.75, 1.45, 2.1],
  [1.4, 1.35, 1.85],
  [2.0, 1.3, 1.58],
  [2.6, 1.2, 1.3],
  [3.15, 1.1, 1.02],
  [3.7, 1.0, 0.76],
  [4.2, 0.95, 0.5],
];
const TREE_TOP = 5.15;

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Radius of the tree silhouette at height y */
function treeRadius(y: number): number {
  let r = 0;
  for (const [bottom, h, radius] of TIERS) {
    if (y >= bottom && y <= bottom + h) r = Math.max(r, radius * (1 - (y - bottom) / h));
  }
  return r;
}

function toonGradient(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const glowTexture = () =>
  canvasTexture(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });

/** Ball pattern painted on an equirectangular texture */
function patternTexture(pattern: string, color: number): THREE.CanvasTexture {
  const base = '#' + color.toString(16).padStart(6, '0');
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 5;
    switch (pattern) {
      case 'stripes':
        for (let x = -s; x < s * 2; x += 22) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x + s * 0.6, s);
          ctx.stroke();
        }
        break;
      case 'dots':
        for (let y = 14; y < s; y += 22)
          for (let x = (y / 22) % 2 ? 6 : 17; x < s; x += 22) {
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        break;
      case 'zigzag':
        for (const y of [s * 0.38, s * 0.62]) {
          ctx.beginPath();
          for (let i = 0; i <= s / 10; i++) ctx.lineTo(i * 10, y + (i % 2 ? 7 : -7));
          ctx.stroke();
        }
        break;
      case 'stars':
        ctx.font = '18px sans-serif';
        for (let i = 0; i < 9; i++) ctx.fillText('★', (i * 41) % s, 22 + ((i * 37) % (s - 26)));
        break;
      case 'snowflake':
        ctx.font = 'bold 34px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const x of [s * 0.25, s * 0.75]) ctx.fillText('❄', x, s / 2);
        break;
    }
    // Glass shine band
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(255,255,255,0.25)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

interface Animated {
  update(t: number, dt: number): void;
}

export class TreeWorld {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(44, 1, 0.1, 200);
  private readonly gradient = toonGradient();
  private readonly glowTex = glowTexture();
  private readonly outlineMat = new THREE.MeshBasicMaterial({ color: 0x0b0a1e, side: THREE.BackSide });
  private readonly dynamic = new THREE.Group();
  private readonly levelGroup = new THREE.Group();
  private readonly clickables: THREE.Object3D[] = [];
  private readonly animated: Animated[] = [];
  private readonly staticAnimated: Animated[] = [];
  private readonly patternCache = new Map<string, THREE.CanvasTexture>();
  private readonly treeLight = new THREE.PointLight(0xffb45a, 0, 9, 1.5);
  private snow!: THREE.Points;

  private azimuth = 0.6;
  private velocity = 0;
  private dragging = false;
  private lastInteraction = -10;
  private frame = 0;
  private running = false;
  private visible = true;
  private clock = new THREE.Clock();
  private observer?: IntersectionObserver;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: SceneCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.fog = new THREE.Fog(0x1a1c45, 22, 70);
    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildPodium();
    this.buildFence();
    this.buildCabin();
    this.buildForest();
    this.buildTree();
    this.buildSnowfall();
    this.scene.add(this.dynamic, this.levelGroup);

    this.bindInput();
    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.cleanup.push(() => ro.disconnect());

    // Pause when not visible: saves battery
    this.observer = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      this.visible ? this.start() : this.stop();
    });
    this.observer.observe(canvas);
    const onVis = () => (document.hidden ? this.stop() : this.visible && this.start());
    document.addEventListener('visibilitychange', onVis);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVis));
    this.start();
  }

  // ====== Materials helpers ====== //
  private toon(color: number, extra: Partial<THREE.MeshToonMaterialParameters> = {}): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({ color, gradientMap: this.gradient, ...extra });
  }

  /** Anime-style outline for boxes: a slightly bigger back-faced copy */
  private outline(mesh: THREE.Mesh, scale = 1.04): THREE.Mesh {
    const o = new THREE.Mesh(mesh.geometry, this.outlineMat);
    o.scale.setScalar(scale);
    mesh.add(o);
    return mesh;
  }

  private readonly hullMats = new Map<number, THREE.ShaderMaterial>();

  /** Outline for smooth shapes: back faces pushed out along normals */
  private hull(mesh: THREE.Mesh, thickness = 0.03, smooth?: THREE.BufferGeometry): THREE.Mesh {
    let mat = this.hullMats.get(thickness);
    if (!mat) {
      mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { thickness: { value: thickness } },
        vertexShader: `uniform float thickness;
          void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * thickness, 1.0); }`,
        fragmentShader: `void main() { gl_FragColor = vec4(0.04, 0.04, 0.12, 1.0); }`,
      });
      this.hullMats.set(thickness, mat);
    }
    mesh.add(new THREE.Mesh(smooth ?? mesh.geometry, mat));
    return mesh;
  }

  private glow(color: number, size: number, opacity = 1): THREE.Sprite {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    s.scale.setScalar(size);
    return s;
  }

  // ====== Static world ====== //
  private buildSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(100, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {},
        vertexShader: `varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying float h; void main(){
          vec3 top = vec3(0.02, 0.03, 0.12); vec3 mid = vec3(0.10, 0.08, 0.26); vec3 low = vec3(0.22, 0.17, 0.40);
          vec3 c = mix(low, mid, smoothstep(-0.05, 0.25, h)); c = mix(c, top, smoothstep(0.25, 0.9, h));
          gl_FragColor = vec4(c, 1.0); }`,
      }),
    );
    this.scene.add(sky);

    const stars = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      const theta = rand(i) * Math.PI * 2;
      const phi = 0.08 + rand(i + 0.5) * 1.3;
      stars.set([90 * Math.cos(theta) * Math.cos(phi), 90 * Math.sin(phi), 90 * Math.sin(theta) * Math.cos(phi)], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    this.scene.add(
      new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.85 }),
      ),
    );

    const moon = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }));
    moon.position.set(-40, 42, -60);
    moon.lookAt(0, 0, 0);
    const moonGlow = this.glow(0xbfc8ff, 26, 0.5);
    moonGlow.position.copy(moon.position);
    this.scene.add(moon, moonGlow);
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x8290e0, 0x1c1638, 1.05));
    const moon = new THREE.DirectionalLight(0xb9c6ff, 1.6);
    moon.position.set(-8, 14, -6);
    this.scene.add(moon);
    const warm = new THREE.DirectionalLight(0xffb070, 0.35);
    warm.position.set(6, 4, 8);
    this.scene.add(warm);
    this.treeLight.position.set(0, 2.6, 0);
    this.scene.add(this.treeLight);
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 48), this.toon(0xd9def2));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Cobblestone ring around the podium
    const stones = canvasTexture(512, (ctx, s) => {
      ctx.fillStyle = '#c9cde6';
      ctx.fillRect(0, 0, s, s);
      for (let r = 140; r < 256; r += 18) {
        const n = Math.round((2 * Math.PI * r) / 22);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + (r % 36 ? 0.05 : 0);
          ctx.save();
          ctx.translate(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
          ctx.rotate(a);
          ctx.fillStyle = `rgb(${150 + rand(k + r) * 25},${154 + rand(k + r) * 25},${178 + rand(k + r) * 25})`;
          ctx.fillRect(-7, -9, 14, 18);
          ctx.restore();
        }
      }
      // Snow dusting
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(240,244,255,${0.25 + rand(i) * 0.5})`;
        ctx.beginPath();
        ctx.arc(rand(i + 1) * s, rand(i + 2) * s, 2 + rand(i + 3) * 7, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(7.2, 64), this.toon(0xffffff, { map: stones }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.01;
    this.scene.add(plaza);
  }

  private buildPodium(): void {
    const stone = this.toon(0x8f93b8);
    const low = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.1, 0.28, 48), stone);
    low.position.y = 0.14;
    const high = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.55, 0.28, 48), stone);
    high.position.y = 0.42;
    const snow = new THREE.Mesh(new THREE.CylinderGeometry(2.38, 2.38, 0.06, 48), this.toon(0xf2f5ff));
    snow.position.y = 0.58;
    const snowLow = new THREE.Mesh(new THREE.CylinderGeometry(2.92, 2.92, 0.04, 48, 1, false), this.toon(0xf2f5ff));
    snowLow.position.y = 0.29;
    this.scene.add(low, high, snow, snowLow);
  }

  private lanterns: THREE.Mesh[] = [];
  private lanternGlows: THREE.Sprite[] = [];
  private fenceBulbs?: THREE.InstancedMesh;

  private buildFence(): void {
    const wood = this.toon(0x6b4a3a);
    const snow = this.toon(0xf2f5ff);
    const R = 8.6;
    const posts = 20;
    const gapAt = 14; // entrance towards the cabin
    const postGeo = new THREE.BoxGeometry(0.32, 1.0, 0.32);
    const capGeo = new THREE.BoxGeometry(0.38, 0.12, 0.38);
    const bulbPositions: THREE.Vector3[] = [];

    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(a) * R, 0.5, Math.sin(a) * R);
      const post = this.outline(new THREE.Mesh(postGeo, wood), 1.08);
      post.position.copy(p);
      const cap = new THREE.Mesh(capGeo, snow);
      cap.position.set(p.x, 1.06, p.z);
      this.scene.add(post, cap);

      if (i % 4 === 1) {
        // Lantern on the post
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.3), this.toon(0x3a3550, { emissive: 0x000000 }));
        lamp.position.set(p.x, 1.35, p.z);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.2, 4), this.toon(0x2a2438));
        roof.position.set(p.x, 1.64, p.z);
        roof.rotation.y = Math.PI / 4;
        const g = this.glow(0xffc070, 2.4, 0);
        g.position.copy(lamp.position);
        this.lanterns.push(lamp);
        this.lanternGlows.push(g);
        this.scene.add(lamp, roof, g);
      }

      if (i === gapAt || i === gapAt - 1) continue;
      const b = (i + 1) / posts;
      const q = new THREE.Vector3(Math.cos(b * Math.PI * 2) * R, 0, Math.sin(b * Math.PI * 2) * R);
      for (const h of [0.35, 0.75]) {
        const len = p.distanceTo(new THREE.Vector3(q.x, 0.5, q.z));
        const rail = this.outline(new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.1), wood), 1.06);
        rail.position.set((p.x + q.x) / 2, h, (p.z + q.z) / 2);
        rail.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
        this.scene.add(rail);
      }
      for (let k = 1; k < 6; k++) {
        const t = k / 6;
        bulbPositions.push(new THREE.Vector3(p.x + (q.x - p.x) * t, 0.92 - Math.sin(t * Math.PI) * 0.12, p.z + (q.z - p.z) * t));
      }
    }

    // Festive garland on the fence (shown from level 5)
    const bulbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      bulbPositions.length,
    );
    const colors = [0xffd36b, 0xff4d6d, 0x4dd2ff, 0x7dff9a];
    const m = new THREE.Matrix4();
    bulbPositions.forEach((p, i) => {
      bulbs.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
      bulbs.setColorAt(i, new THREE.Color(colors[i % colors.length]));
    });
    bulbs.visible = false;
    this.fenceBulbs = bulbs;
    this.scene.add(bulbs);
  }

  private windows: THREE.Mesh[] = [];
  private cabinLights: THREE.Sprite[] = [];

  private buildCabin(): void {
    const cabin = buildCabin({
      toon: (c, e) => this.toon(c, e),
      hull: (m, t) => this.hull(m, t),
      outline: (m, sc) => this.outline(m, sc),
      glow: (c, sz, o) => this.glow(c, sz, o),
      glowTex: this.glowTex,
    });
    this.windows = cabin.windows;
    this.cabinLights = cabin.lights;
    this.staticAnimated.push(cabin);

    // Outside the fence, next to the entrance, facing the tree
    const a = (14 / 20) * Math.PI * 2 - 0.12;
    cabin.group.position.set(Math.cos(a) * 12.5, 0, Math.sin(a) * 12.5);
    cabin.group.lookAt(0, 0, 0);
    this.scene.add(cabin.group);
  }

  private buildForest(): void {
    const n = 70;
    const cone = new THREE.ConeGeometry(1, 2.4, 7);
    const cap = new THREE.ConeGeometry(0.62, 1.0, 7);
    const trees = new THREE.InstancedMesh(cone, this.toon(0x1c5a45), n * 2);
    const caps = new THREE.InstancedMesh(cap, this.toon(0xe9efff), n * 2);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const a = rand(i * 3) * Math.PI * 2;
      const r = 20 + rand(i * 5) * 22;
      // Keep the cabin area free
      const ca = (14 / 20) * Math.PI * 2 - 0.12;
      if (r < 23 && Math.abs(Math.atan2(Math.sin(a - ca), Math.cos(a - ca))) < 0.35) continue;
      const s = 0.9 + rand(i * 7) * 1.4;
      for (const [dy, sy] of [
        [1.2, 1],
        [2.2, 0.75],
      ]) {
        const scale = s * sy;
        m.compose(
          new THREE.Vector3(Math.cos(a) * r, dy * s, Math.sin(a) * r),
          new THREE.Quaternion(),
          new THREE.Vector3(scale, scale, scale),
        );
        trees.setMatrixAt(k, m);
        m.compose(
          new THREE.Vector3(Math.cos(a) * r, dy * s + 0.75 * scale, Math.sin(a) * r),
          new THREE.Quaternion(),
          new THREE.Vector3(scale, scale, scale),
        );
        caps.setMatrixAt(k, m);
        k++;
      }
    }
    trees.count = caps.count = k;
    this.scene.add(trees, caps);

    // Mountains far away
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rand(i) * 0.3;
      const h = 12 + rand(i + 9) * 14;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(h * 0.9, h, 6), this.toon(0x2a2f6a));
      mountain.position.set(Math.cos(a) * 62, h / 2 - 1, Math.sin(a) * 62);
      const top = new THREE.Mesh(new THREE.ConeGeometry(h * 0.3, h / 3, 6), this.toon(0xdfe6ff));
      top.position.set(mountain.position.x, h - 1 - h / 6, mountain.position.z);
      this.scene.add(mountain, top);
    }
  }

  private buildTree(): void {
    // One material: needles and snow are painted per face (crisp toon look)
    const mat = this.toon(0xffffff, { vertexColors: true });
    const green = new THREE.Color(0x1f8a55);
    const greenDark = new THREE.Color(0x17734a);
    const white = new THREE.Color(0xf4f7ff);
    const blueSnow = new THREE.Color(0xd5def7);
    const tree = new THREE.Group();

    const trunk = this.hull(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.6, 10), this.toon(0x5b3a26)), 0.02);
    trunk.position.y = 0.85;
    tree.add(trunk);

    TIERS.forEach(([bottom, h, r], i) => {
      const segments = 28;
      const geo = new THREE.ConeGeometry(r, h, segments, 9);
      const pos = geo.attributes['position'] as THREE.BufferAttribute;
      const segOf = (x: number, z: number) =>
        Math.round(((Math.atan2(z, x) / (Math.PI * 2)) * segments + segments) % segments);
      for (let v = 0; v < pos.count; v++) {
        const y = pos.getY(v);
        const f = (h / 2 - y) / h; // 0 at the apex, 1 at the bottom
        if (f < 0.01) continue;
        // Branch tips: every other segment sticks out and droops
        const tip = segOf(pos.getX(v), pos.getZ(v)) % 2 === 0;
        const k = (tip ? 1.1 : 0.84) + (rand(segOf(pos.getX(v), pos.getZ(v)) + i * 31) - 0.5) * 0.1;
        const kk = 1 + (k - 1) * f * f;
        pos.setX(v, pos.getX(v) * kk);
        pos.setZ(v, pos.getZ(v) * kk);
        if (f > 0.99) pos.setY(v, y - (tip ? 0.18 : 0) - rand(v + i * 17) * 0.05);
        else if (f > 0.7 && tip) pos.setY(v, y - 0.05);
      }
      geo.computeVertexNormals();

      // Faceted copy with per-face colors: snow lies on top of the branches
      const flat = geo.toNonIndexed();
      const fp = flat.attributes['position'] as THREE.BufferAttribute;
      const colors = new Float32Array(fp.count * 3);
      const c = new THREE.Vector3();
      for (let tri = 0; tri < fp.count; tri += 3) {
        c.set(0, 0, 0);
        for (let k = 0; k < 3; k++) c.add(new THREE.Vector3(fp.getX(tri + k), fp.getY(tri + k), fp.getZ(tri + k)));
        c.divideScalar(3);
        const f = (h / 2 - c.y) / h;
        // Segment of the triangle (tips are on even radial lines)
        const seg = Math.floor(((Math.atan2(c.z, c.x) / (Math.PI * 2)) * segments + segments) % segments);
        const noise = rand(seg * 7.13 + i * 13);
        // Snow lies on the visible outer part of the branches; the very edge stays green
        const tipSeg = seg % 2 === 0;
        const isSnow = f < 0.2 || (f > 0.56 && f < (tipSeg ? 0.92 : 0.78) - noise * 0.1);
        const shade = rand(tri * 0.37 + i);
        const color = isSnow ? (shade > 0.85 ? blueSnow : white) : shade > 0.5 ? green : greenDark;
        for (let k = 0; k < 3; k++) colors.set([color.r, color.g, color.b], (tri + k) * 3);
      }
      flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      flat.computeVertexNormals();

      const tier = this.hull(new THREE.Mesh(flat, mat), 0.025, geo);
      tier.position.y = bottom + h / 2;
      tier.rotation.y = i * 0.7;
      tree.add(tier);
    });
    this.scene.add(tree);
  }

  private buildSnowfall(): void {
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([(rand(i) - 0.5) * 26, rand(i + 0.3) * 14, (rand(i + 0.6) - 0.5) * 26], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.snow = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ map: this.glowTex, color: 0xffffff, size: 0.16, transparent: true, depthWrite: false, opacity: 0.9 }),
    );
    this.scene.add(this.snow);
  }

  // ====== Dynamic content ====== //
  private ballSlots(): THREE.Vector3[] {
    // Golden-angle spiral over the tree surface: balls are spread on all sides
    const slots: THREE.Vector3[] = [];
    const n = 44;
    for (let i = 0; i < n; i++) {
      const y = 1.15 + (i / n) * 3.7 + (rand(i) - 0.5) * 0.15;
      const a = i * 2.39996;
      const r = treeRadius(y) * 0.92 + 0.1;
      if (r < 0.25) continue;
      slots.push(new THREE.Vector3(Math.cos(a) * r, y - 0.05, Math.sin(a) * r));
    }
    // Fill from the bottom-middle, mixing sides
    return slots.sort((p, q) => Math.abs(p.y - 2.4) - Math.abs(q.y - 2.4) + (rand(p.x) - 0.5) * 1.2);
  }

  private slots = this.ballSlots();
  private ghostTex?: THREE.CanvasTexture;

  private patternMap(pattern: string, color: number): THREE.CanvasTexture {
    const key = pattern + color;
    if (!this.patternCache.has(key)) this.patternCache.set(key, patternTexture(pattern, color));
    return this.patternCache.get(key)!;
  }

  setTree(tree: TreeData, newHung: string[], newLit: string[]): void {
    this.clear();
    const onTree = tree.balls.filter((b) => b.state !== 'box');
    const lit = onTree.filter((b) => b.state === 'lit').length;

    this.treeLight.intensity = Math.min(lit, 6) * 3 + (tree.star ? 4 : 0);

    onTree.slice(0, this.slots.length).forEach((ball, i) => {
      this.addBall(ball, this.slots[i], i, newHung.includes(ball.id), newLit.includes(ball.id));
    });

    // Next free places pulse softly: tap to write a new greeting
    this.slots.slice(onTree.length, onTree.length + 2).forEach((p, i) => this.addGhost(p, i));

    this.addGarland(tree.garland);
    this.addStar(tree.star);
    tree.balls.filter((b) => b.state === 'box').slice(0, 6).forEach((b, i) => this.addGift(b, i));
    this.applyLevel(tree.level);
    this.renderOnce();
  }

  private clear(): void {
    this.dynamic.clear();
    this.clickables.length = 0;
    this.animated.length = 0;
  }

  private addBall(ball: TreeBall, p: THREE.Vector3, i: number, isNewHung: boolean, isNewLit: boolean): void {
    const color = BALL_COLORS[ball.color] ?? BALL_COLORS['red'];
    const isLit = ball.state === 'lit';
    const pivot = new THREE.Group();
    pivot.position.set(p.x, p.y + 0.32, p.z);

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 20, 14),
      this.toon(0xffffff, {
        map: ball.pattern === 'plain' ? null : this.patternMap(ball.pattern, color),
        color: ball.pattern === 'plain' ? color : 0xffffff,
        emissive: isLit ? color : 0x000000,
        emissiveIntensity: isLit ? 0.55 : 0,
      }),
    );
    sphere.position.y = -0.36;
    this.hull(sphere, 0.018);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.07, 8), this.toon(0xd9b25a));
    cap.position.y = -0.1;
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 4), new THREE.MeshBasicMaterial({ color: 0xd9c38a }));
    string.position.y = -0.03;
    pivot.add(sphere, cap, string);

    let glow: THREE.Sprite | undefined;
    if (isLit) {
      glow = this.glow(color, 1.4, 0.9);
      glow.position.y = -0.36;
      pivot.add(glow);
    }
    if (Object.keys(ball.reactions).length || ball.replies) {
      const sparkle = this.glow(0xfff6c9, 0.35, 1);
      sparkle.position.set(0.2, -0.12, 0);
      pivot.add(sparkle);
      this.animated.push({ update: (t) => sparkle.material.opacity = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i)) });
    }

    // Bigger invisible target: easy to tap with a finger
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = -0.36;
    hit.userData = { kind: 'ball', ball };
    pivot.add(hit);
    this.clickables.push(hit);
    this.dynamic.add(pivot);

    const start = performance.now() / 1000;
    this.animated.push({
      update: (t) => {
        pivot.rotation.z = Math.sin(t * 1.3 + i) * 0.06;
        pivot.rotation.x = Math.cos(t * 1.1 + i) * 0.04;
        const age = t - start;
        if (isNewHung && age < 1.2) {
          // Falls onto the branch and bounces
          const k = Math.min(1, age / 1.0);
          const bounce = 1 - Math.pow(1 - k, 3) * Math.cos(k * 9);
          pivot.position.y = p.y + 0.32 + (1 - bounce) * 2.2;
        }
        if (glow) {
          const pulse = 1.4 + Math.sin(t * 2 + i) * 0.12;
          glow.scale.setScalar(isNewLit && age < 1.6 ? pulse * (1 + 2.5 * Math.sin((age / 1.6) * Math.PI)) : pulse);
        }
      },
    });
  }

  private addGhost(p: THREE.Vector3, i: number): void {
    // Billboard: dashed circle with a plus
    const tex =
      this.ghostTex ??
      (this.ghostTex = canvasTexture(128, (ctx, s) => {
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 7;
        ctx.setLineDash([14, 10]);
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(s / 2 - 20, s / 2);
        ctx.lineTo(s / 2 + 20, s / 2);
        ctx.moveTo(s / 2, s / 2 - 20);
        ctx.lineTo(s / 2, s / 2 + 20);
        ctx.stroke();
      }));
    const ghost = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    ghost.scale.setScalar(0.5);
    ghost.position.copy(p);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData = { kind: 'add' };
    ghost.add(hit);
    this.clickables.push(hit);
    this.dynamic.add(ghost);
    this.animated.push({
      update: (t) => {
        ghost.material.opacity = 0.35 + 0.4 * Math.abs(Math.sin(t * 1.5 + i));
      },
    });
  }

  private addGarland(friends: number): void {
    // Spiral around the tree; every friend lights up a part of it
    const points: THREE.Vector3[] = [];
    const turns = 3.2;
    for (let k = 0; k <= 120; k++) {
      const t = k / 120;
      const y = 1.0 + t * 3.9;
      const a = t * turns * Math.PI * 2;
      const r = treeRadius(y) * 0.86 + 0.08;
      points.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 200, 0.01, 4), new THREE.MeshBasicMaterial({ color: 0x0f3b26 }));
    this.dynamic.add(wire);

    const count = 64;
    const litCount = Math.min(count, friends * 7);
    const colors = [0xffd36b, 0xff4d6d, 0x4dd2ff, 0x7dff9a, 0xff9ef0];
    for (let k = 0; k < count; k++) {
      const p = curve.getPointAt(k / count);
      const lit = k < litCount;
      const color = colors[k % colors.length];
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: lit ? color : 0x1d3a2c }));
      bulb.position.copy(p);
      this.dynamic.add(bulb);
      if (lit) {
        const g = this.glow(color, 0.45, 0.8);
        g.position.copy(p);
        this.dynamic.add(g);
        this.animated.push({ update: (t) => (g.material.opacity = 0.45 + 0.45 * Math.abs(Math.sin(t * 1.8 + k * 0.7))) });
      }
    }
  }

  private addStar(on: boolean): void {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.18 : 0.42;
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      i ? shape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 });
    geo.center();
    const star = this.outline(
      new THREE.Mesh(geo, this.toon(on ? 0xffd36b : 0x5c6380, { emissive: on ? 0xffb020 : 0x000000, emissiveIntensity: on ? 0.8 : 0 })),
      1.06,
    );
    star.position.y = TREE_TOP + 0.35;
    star.userData = { kind: 'star' };
    this.clickables.push(star);
    this.dynamic.add(star);
    let glow: THREE.Sprite | undefined;
    if (on) {
      glow = this.glow(0xffe08a, 2.6, 0.9);
      glow.position.copy(star.position);
      this.dynamic.add(glow);
    }
    this.animated.push({
      update: (t) => {
        star.quaternion.copy(this.camera.quaternion);
        star.rotateZ(Math.sin(t * 1.2) * 0.08);
        if (glow) glow.scale.setScalar(2.4 + Math.sin(t * 2) * 0.3);
      },
    });
  }

  private addGift(ball: TreeBall, i: number): void {
    const palette: [number, number][] = [
      [0xc8102e, 0xffd36b],
      [0x1f6f4a, 0xff4d6d],
      [0x1e5aa8, 0xdfe7f5],
      [0x6b2fa3, 0xffd36b],
    ];
    const [boxColor, ribbonColor] = palette[i % palette.length];
    const size = 0.55 + rand(i + 4) * 0.2;
    const gift = new THREE.Group();
    const box = this.outline(new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.8, size), this.toon(boxColor)), 1.05);
    box.position.y = size * 0.4;
    const ribbon = this.toon(ribbonColor);
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(size * 1.02, size * 0.82, size * 0.16), ribbon);
    const r2 = new THREE.Mesh(new THREE.BoxGeometry(size * 0.16, size * 0.82, size * 1.02), ribbon);
    r1.position.y = r2.position.y = size * 0.4;
    const bowL = new THREE.Mesh(new THREE.TorusGeometry(size * 0.16, size * 0.05, 6, 12), ribbon);
    const bowR = bowL.clone();
    bowL.position.set(-size * 0.12, size * 0.88, 0);
    bowR.position.set(size * 0.12, size * 0.88, 0);
    bowL.rotation.y = 0.5;
    bowR.rotation.y = -0.5;
    gift.add(box, r1, r2, bowL, bowR);

    // On the podium, around the tree
    const a = 0.5 + i * 1.05;
    gift.position.set(Math.cos(a) * 1.95, 0.6, Math.sin(a) * 1.95);
    gift.rotation.y = rand(i) * Math.PI;

    const hit = new THREE.Mesh(new THREE.SphereGeometry(size * 1.1, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = size * 0.45;
    hit.userData = { kind: 'ball', ball };
    gift.add(hit);
    this.clickables.push(hit);
    this.dynamic.add(gift);
    this.animated.push({
      update: (t) => {
        const hop = Math.max(0, Math.sin(t * 2.2 + i * 1.7));
        gift.position.y = 0.6 + Math.pow(hop, 8) * 0.12;
      },
    });
  }

  private applyLevel(level: number): void {
    const lampsOn = level >= 3;
    this.lanterns.forEach((l) => {
      const m = l.material as THREE.MeshToonMaterial;
      m.color.set(lampsOn ? 0xffd27a : 0x3a3550);
      m.emissive.set(lampsOn ? 0xffa040 : 0x000000);
    });
    this.lanternGlows.forEach((g) => (g.material.opacity = lampsOn ? 0.9 : 0));
    this.windows.forEach((w) => {
      const m = w.material as THREE.MeshBasicMaterial | THREE.MeshToonMaterial;
      if (m instanceof THREE.MeshToonMaterial) {
        m.color.set(lampsOn ? 0xffd27a : 0x3a3550);
        m.emissive.set(lampsOn ? 0xffa040 : 0x000000);
      } else m.color.set(lampsOn ? 0xffd27a : 0x1c1a33);
    });
    this.cabinLights.forEach((l) => (l.material.opacity = lampsOn ? 0.7 : 0));
    if (this.fenceBulbs) this.fenceBulbs.visible = level >= 5;

    this.levelGroup.clear();
    if (level >= 9) {
      // Northern lights
      const tex = canvasTexture(256, (ctx, s) => {
        const g = ctx.createLinearGradient(0, 0, 0, s);
        g.addColorStop(0, 'rgba(61,255,176,0)');
        g.addColorStop(0.5, 'rgba(61,255,176,0.6)');
        g.addColorStop(0.8, 'rgba(109,123,255,0.4)');
        g.addColorStop(1, 'rgba(109,123,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      });
      for (let i = 0; i < 3; i++) {
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(70, 70, 22, 48, 1, true, i * 2.1, 1.6),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false, fog: false }),
        );
        band.position.y = 34;
        this.levelGroup.add(band);
        this.animated.push({ update: (t) => ((band.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * Math.sin(t * 0.4 + i)) });
      }
    }
  }

  // ====== Input ====== //
  private bindInput(): void {
    const pointers = new Map<number, { x: number; y: number }>();
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastT = 0;
    let moved = false;
    let pinchDist = 0;

    const pinchDistance = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.lastInteraction = this.clock.getElapsedTime();
      this.start();
      if (pointers.size === 2) {
        // Second finger: pinch zoom instead of rotation
        pinchDist = pinchDistance();
        moved = true;
        return;
      }
      this.dragging = true;
      moved = false;
      startX = lastX = e.clientX;
      startY = e.clientY;
      lastT = performance.now();
      this.velocity = 0;
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.lastInteraction = this.clock.getElapsedTime();
      if (pointers.size === 2) {
        const d = pinchDistance();
        if (pinchDist > 0) this.zoomBy(((pinchDist - d) / this.canvas.clientWidth) * 1.6);
        pinchDist = d;
        return;
      }
      if (!this.dragging) return;
      const dx = e.clientX - lastX;
      if (Math.abs(e.clientX - startX) > 6 || Math.abs(e.clientY - startY) > 6) moved = true;
      const now = performance.now();
      const rot = (dx / this.canvas.clientWidth) * Math.PI * 1.3;
      this.azimuth -= rot;
      this.velocity = -rot / Math.max(1, now - lastT);
      lastX = e.clientX;
      lastT = now;
    };
    const up = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      this.lastInteraction = this.clock.getElapsedTime();
      if (pointers.size > 0) {
        this.dragging = false; // after a pinch, don't rotate with the remaining finger
        return;
      }
      if (this.dragging && !moved) this.tap(e);
      this.dragging = false;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoomBy(e.deltaY * 0.0015);
    };

    this.canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.canvas.addEventListener('wheel', wheel, { passive: false });
    this.cleanup.push(() => {
      this.canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.canvas.removeEventListener('wheel', wheel);
    });
  }

  private tap(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.clickables, false)[0];
    if (!hit) return;
    const data = hit.object.userData;
    if (data['kind'] === 'ball') this.callbacks.ball(data['ball']);
    else if (data['kind'] === 'star') this.callbacks.star();
    else if (data['kind'] === 'add') this.callbacks.addBall();
  }

  // ====== Loop ====== //
  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderOnce();
  }

  private zoom = ZOOM_DEFAULT;
  private zoomTarget = ZOOM_DEFAULT;

  /** Zoom in (negative) or out (positive) */
  zoomBy(delta: number): void {
    this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget + delta, 0, 1);
    this.lastInteraction = this.clock.getElapsedTime();
    this.start();
  }

  private placeCamera(): void {
    const z = this.zoom;
    const lerp = THREE.MathUtils.lerp;
    const d = lerp(ZOOM_NEAR.distance, ZOOM_FAR.distance, z);
    const e = lerp(ZOOM_NEAR.elevation, ZOOM_FAR.elevation, z);
    const ty = lerp(ZOOM_NEAR.target, ZOOM_FAR.target, z);
    this.camera.position.set(Math.sin(this.azimuth) * Math.cos(e) * d, ty + Math.sin(e) * d, Math.cos(this.azimuth) * Math.cos(e) * d);
    this.camera.lookAt(0, ty, 0);
  }

  private start(): void {
    if (this.running || !this.visible || document.hidden) return;
    this.running = true;
    this.clock.getDelta();
    const loop = () => {
      if (!this.running) return;
      this.tick();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  private stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.getElapsedTime();

    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 8);
    if (!this.dragging) {
      // Inertia, then a slow auto-rotation when nobody touches the scene
      this.azimuth += this.velocity * dt * 1000;
      this.velocity *= Math.pow(0.04, dt);
      if (t - this.lastInteraction > 3) this.azimuth += dt * 0.12;
    }

    const pos = this.snow.geometry.attributes['position'] as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - dt * (0.5 + (i % 5) * 0.08);
      if (y < 0) y += 14;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t + i) * dt * 0.08);
    }
    pos.needsUpdate = true;

    for (const a of this.staticAnimated) a.update(t, dt);
    for (const a of this.animated) a.update(t, dt);
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }

  private renderOnce(): void {
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.stop();
    this.observer?.disconnect();
    this.cleanup.forEach((f) => f());
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => x.dispose());
    });
    this.patternCache.forEach((t) => t.dispose());
    this.renderer.dispose();
  }
}

export function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
