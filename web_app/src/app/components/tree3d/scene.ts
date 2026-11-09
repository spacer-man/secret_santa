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
import { instancedOutline, withOutline } from './outline';
import { terrainGeometry, terrainHeight, terrainOutline } from './terrain';
import { ModelName, Models } from './models';
import { Body, Circle, FREE, circlesOf, displacement, makeBody, resolve, shape } from './layout';
import { TIERS, TREE_TOP, buildFirTree, treeRadius } from './tree-model';

/** A ball place: where the thread is tied and where the ball centre hangs */
interface BallSlot {
  top: THREE.Vector3;
  ball: THREE.Vector3;
}

export interface SceneCallbacks {
  ball(ball: TreeBall): void;
  star(): void;
  addBall(): void;
  /** A courtyard place was tapped in decorate mode (item: what stands there, if anything) */
  pad(pad: number, corner: string, item: string | null): void;
  /** The camera left the focused corner (the user started rotating) */
  focusLost(): void;
  /** The camera flies to a corner */
  focused?(corner: number): void;
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



/**
 * Courtyard corners for figures from the shop, near the fence (background).
 * In the middle of each corner lies a heap of presents; figures stand in a
 * half-circle in front of it, facing away from the heap, towards the tree.
 * Angles are measured as in Math.atan2(z, x); the cabin is at ~4.28 rad.
 */
export const CORNERS: { key: string; angle: number; radius: number; pads: number }[] = [
  { key: 'porch', angle: 4.95, radius: 6.9, pads: 3 },
  { key: 'lantern', angle: 0.4, radius: 7.0, pads: 3 },
  { key: 'hill', angle: 1.75, radius: 6.9, pads: 4 },
  { key: 'rocks', angle: 3.15, radius: 7.0, pads: 3 },
  { key: 'path', angle: 5.85, radius: 6.9, pads: 2 },
];

// Angles (rad) around the heap, 0 = straight towards the tree; nobody stands
// right in front of the heap, so it stays visible
const PAD_SPREAD: Record<number, number[]> = {
  2: [-0.85, 0.85],
  3: [-1.45, -0.5, 0.95],
  4: [-1.85, -0.7, 0.55, 1.6],
};

/**
 * Figures that can be bought for the courtyard, with their placement rules:
 * `yaws` are the allowed turns relative to "facing the tree", tried in order;
 * the one that moves the figure least from its place wins.
 */
interface DecorKind {
  model: ModelName;
  scale: number;
  yaws: number[];
}
const CHARACTER = [0, -0.45, 0.45]; // looks at the tree, may turn a little
const SIDEWAYS = [Math.PI / 2, -Math.PI / 2, 0]; // long things: best along the fence
const ANY = [0, Math.PI / 2, Math.PI, -Math.PI / 2]; // round/symmetric things
const DECOR_KINDS: Record<string, DecorKind> = {
  snowman: { model: 'snowman-hat', scale: 1.3, yaws: CHARACTER },
  'snowman-classic': { model: 'snowman', scale: 1.3, yaws: CHARACTER },
  reindeer: { model: 'reindeer', scale: 1.25, yaws: CHARACTER },
  nutcracker: { model: 'nutcracker', scale: 1.5, yaws: CHARACTER },
  gingerbread: { model: 'gingerbread-man', scale: 2.4, yaws: CHARACTER },
  sled: { model: 'sled', scale: 1.6, yaws: SIDEWAYS },
  'sled-long': { model: 'sled-long', scale: 1.5, yaws: SIDEWAYS },
  'candy-cane': { model: 'candy-cane-red', scale: 2.2, yaws: ANY },
  'candy-cane-green': { model: 'candy-cane-green', scale: 2.2, yaws: ANY },
  lantern: { model: 'lantern', scale: 1.8, yaws: ANY },
};

/** Figures stand between the train track and the fence */
const COURTYARD_RING = { min: 4.3, max: 8.25 };

const CABIN_ANGLE = (14 / 20) * Math.PI * 2 - 0.12;

/** Static courtyard objects: model, angle, radius, scale, rotation, footprint (0 = not an obstacle) */
const STATIC_DECOR: [ModelName, number, number, number, number, number][] = [
  ['snow-pile', 1.08, 7.6, 1.6, 0.2, 0.75],
  ['snow-pile', 2.45, 7.5, 1.3, 1.1, 0.6],
  ['snow-pile', 3.75, 7.7, 1.5, 2.2, 0.7],
  ['snow-pile', 5.4, 7.6, 1.4, 0.7, 0.65],
  ['snow-flat-large', 2.6, 10.5, 1.4, 0.4, 0],
  ['snow-flat-large', 5.8, 11, 1.6, 1.4, 0],
  ['snow-bunker', 0.9, 10.5, 1.3, 2.0, 0],
  ['rocks-large', 1.3, 12, 1.0, 0.3, 0],
  ['rocks-medium', 3.1, 11, 1.2, 1.5, 0],
  ['rocks-small', 4.6, 10.2, 1.4, 2.6, 0],
  ['rocks-medium', 5.6, 12.5, 1.0, 0.9, 0],
  ['bench', CABIN_ANGLE + 0.35, 7.0, 1.4, 0, 0.85],
];

/** Obstacles for figures: snow piles, the bench and the present heaps */
const STATIC_COLLIDERS: Circle[] = [
  ...STATIC_DECOR.filter((d) => d[5] > 0).map(([, a, r, , , fr]) => ({ x: Math.cos(a) * r, z: Math.sin(a) * r, r: fr })),
  ...CORNERS.map((c) => ({ x: Math.cos(c.angle) * c.radius, z: Math.sin(c.angle) * c.radius, r: 0.8 })),
];

/**
 * Where a figure looks (rotation around Y; models face +Z), from its real
 * position: away from the heap of its corner, but mostly towards the tree,
 * so figures on the sides don't stare into nowhere.
 */
function facing(x: number, z: number, corner: number, seed: number): number {
  const heap = cornerCentre(corner);
  const away = new THREE.Vector2(x - heap.x, z - heap.z).normalize();
  const toTree = new THREE.Vector2(-x, -z).normalize();
  const dir = away.add(toTree.multiplyScalar(1.6));
  return Math.atan2(dir.x, dir.y) + (rand(seed) - 0.5) * 0.2;
}

function cornerCentre(i: number): THREE.Vector3 {
  const c = CORNERS[i];
  return new THREE.Vector3(Math.cos(c.angle) * c.radius, 0, Math.sin(c.angle) * c.radius);
}

/** All places, corner by corner; `dir` is where the figure looks (away from the heap) */
const DECOR_PADS = CORNERS.flatMap((c, ci) => {
  const centre = cornerCentre(ci);
  const inward = centre.clone().negate().normalize();
  const tangent = new THREE.Vector3(-inward.z, 0, inward.x);
  return PAD_SPREAD[c.pads].map((phi, k) => {
    const dir = inward.clone().multiplyScalar(Math.cos(phi)).addScaledVector(tangent, Math.sin(phi));
    const dist = 0.95 + ((k * 37) % 10) / 60;
    return { corner: ci, pos: centre.clone().addScaledVector(dir, dist), dir };
  });
});

/** Normal map from a greyscale height canvas (Sobel filter) */
function normalFromHeight(height: HTMLCanvasElement, strength: number): THREE.CanvasTexture {
  const w = height.width;
  const h = height.height;
  const src = height.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  const at = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(out);
}

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
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
  private readonly models = new Models(this.gradient);
  private version = 0;
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

    this.scene.fog = new THREE.Fog(0x0b0c22, 22, 70);
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

  /** Anime-style outline of constant width on screen (fence, cabin, gifts...) */
  private outline(mesh: THREE.Mesh, _scale = 1.04): THREE.Mesh {
    return withOutline(mesh);
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
          vec3 top = vec3(0.005, 0.008, 0.05); vec3 mid = vec3(0.035, 0.03, 0.12); vec3 low = vec3(0.085, 0.065, 0.19);
          vec3 c = mix(low, mid, smoothstep(-0.05, 0.25, h)); c = mix(c, top, smoothstep(0.25, 0.9, h));
          gl_FragColor = vec4(c, 1.0); }`,
      }),
    );
    this.scene.add(sky);

    this.buildStars();

    const moon = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }));
    moon.position.set(-40, 42, -60);
    moon.lookAt(0, 0, 0);
    const moonGlow = this.glow(0xbfc8ff, 26, 0.5);
    moonGlow.position.copy(moon.position);
    this.scene.add(moon, moonGlow);
  }

  private starMat!: THREE.ShaderMaterial;

  /**
   * Twinkling starry sky with a Milky Way band. Most stars are low over the
   * horizon: that's the part of the sky the camera sees. Bright on a clear
   * night, dimmed by clouds when it snows.
   */
  private buildStars(): void {
    const n = 2600;
    const pos: number[] = [];
    const size: number[] = [];
    const phase: number[] = [];
    // Milky Way: a tilted great circle
    const band = new THREE.Vector3(0.25, 1, 0.35).normalize();
    for (let i = 0; i < n; i++) {
      const theta = rand(i * 1.31) * Math.PI * 2;
      // More stars near the horizon
      const phi = 0.02 + Math.pow(rand(i * 2.17 + 0.5), 2.6) * 1.3;
      let dir = new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(phi), Math.sin(theta) * Math.cos(phi));
      const inBand = i % 3 === 0;
      if (inBand) {
        // Pull a third of the stars towards the band (thick in the middle)
        const d = dir.dot(band);
        dir = dir.sub(band.clone().multiplyScalar(d * (0.9 + rand(i) * 0.1))).normalize();
        if (dir.y < 0.01) dir.y = Math.abs(dir.y) + 0.01;
      }
      pos.push(dir.x * 92, dir.y * 92, dir.z * 92);
      const bright = rand(i * 7.7);
      size.push(inBand ? 1.8 + bright * 1.6 : 2.2 + Math.pow(bright, 3) * 5);
      phase.push(rand(i * 3.3) * Math.PI * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
    geo.setAttribute('phase', new THREE.Float32BufferAttribute(phase, 1));
    this.starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { time: { value: 0 }, opacity: { value: 1 }, pixel: { value: Math.min(devicePixelRatio || 1, 1.75) } },
      vertexShader: `
        attribute float size; attribute float phase;
        uniform float time; uniform float pixel;
        varying float vTwinkle;
        void main() {
          vTwinkle = 0.55 + 0.45 * sin(time * (1.2 + fract(phase) * 2.0) + phase * 7.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * pixel * (0.8 + 0.4 * vTwinkle);
        }`,
      fragmentShader: `
        uniform float opacity; varying float vTwinkle;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(0.9, 0.94, 1.0) * 1.6, a * vTwinkle * opacity);
        }`,
    });
    const stars = new THREE.Points(geo, this.starMat);
    stars.frustumCulled = false;
    this.scene.add(stars);
    this.staticAnimated.push({ update: (t) => (this.starMat.uniforms['time'].value = t) });
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x5464be, 0x0d0a22, 0.48));
    const moon = new THREE.DirectionalLight(0x93a6ff, 0.75);
    moon.position.set(-8, 14, -6);
    this.scene.add(moon);
    const warm = new THREE.DirectionalLight(0xffb070, 0.18);
    warm.position.set(6, 4, 8);
    this.scene.add(warm);
    this.treeLight.position.set(0, 2.6, 0);
    this.scene.add(this.treeLight);
  }

  private buildGround(): void {
    // Uneven snowy ground with drifts, outlined like the models
    const ground = new THREE.Mesh(terrainGeometry(), this.toon(0xdfe5f8));
    ground.add(new THREE.Mesh(ground.geometry, terrainOutline()));
    this.scene.add(ground);

    // Cobblestone ring around the podium: colour + height (bevelled stones,
    // deep joints, snow in the joints) -> normal map for real relief
    const size = 1024;
    const color = document.createElement('canvas');
    const height = document.createElement('canvas');
    color.width = color.height = height.width = height.height = size;
    const cc = color.getContext('2d')!;
    const hc = height.getContext('2d')!;
    cc.fillStyle = '#b9bedb';
    cc.fillRect(0, 0, size, size);
    hc.fillStyle = '#000';
    hc.fillRect(0, 0, size, size);
    const half = size / 2;
    for (let r = 280; r < 512; r += 36) {
      const n = Math.round((2 * Math.PI * r) / 44);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (Math.round(r / 36) % 2 ? 0.5 / n * Math.PI * 2 : 0);
        const seed = k * 13 + r;
        for (const [ctx, isHeight] of [
          [cc, false],
          [hc, true],
        ] as [CanvasRenderingContext2D, boolean][]) {
          ctx.save();
          ctx.translate(half + Math.cos(a) * r, half + Math.sin(a) * r);
          ctx.rotate(a);
          const w = 30;
          const h = 38;
          if (isHeight) {
            // Rounded top: bright in the middle, darker to the edges
            const g = ctx.createRadialGradient(0, 0, 2, 0, 0, h * 0.62);
            g.addColorStop(0, '#fff');
            g.addColorStop(0.7, '#9a9a9a');
            g.addColorStop(1, '#3a3a3a');
            ctx.fillStyle = g;
          } else {
            const v = rand(seed);
            ctx.fillStyle = `rgb(${142 + v * 28},${147 + v * 28},${172 + v * 26})`;
          }
          ctx.beginPath();
          ctx.roundRect(-w / 2, -h / 2, w, h, 8);
          ctx.fill();
          ctx.restore();
        }
      }
    }
    // Snow: lies in the joints and on some stones (lighter and flatter)
    for (let i = 0; i < 1400; i++) {
      const x = rand(i + 1) * size;
      const y = rand(i + 2) * size;
      const rr = 3 + rand(i + 3) * 12;
      cc.fillStyle = `rgba(240,244,255,${0.3 + rand(i) * 0.5})`;
      cc.beginPath();
      cc.arc(x, y, rr, 0, Math.PI * 2);
      cc.fill();
      hc.fillStyle = 'rgba(150,150,150,0.45)';
      hc.beginPath();
      hc.arc(x, y, rr, 0, Math.PI * 2);
      hc.fill();
    }
    const map = new THREE.CanvasTexture(color);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(7.2, 64),
      this.toon(0xffffff, { map, normalMap: normalFromHeight(height, 5), normalScale: new THREE.Vector2(1.2, 1.2) }),
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.01;
    this.scene.add(plaza);
  }

  private buildPodium(): void {
    // Stone blocks on the sides of the podium steps (with relief)
    const blocks = (repeat: number) => {
      const w = 512;
      const h = 64;
      const color = document.createElement('canvas');
      const height = document.createElement('canvas');
      color.width = height.width = w;
      color.height = height.height = h;
      const cc = color.getContext('2d')!;
      const hc = height.getContext('2d')!;
      cc.fillStyle = '#6f7398';
      cc.fillRect(0, 0, w, h);
      hc.fillStyle = '#000';
      hc.fillRect(0, 0, w, h);
      for (let row = 0; row < 2; row++) {
        for (let x = row ? -32 : 0; x < w; x += 64) {
          const v = rand(x + row * 7);
          cc.fillStyle = `rgb(${132 + v * 25},${136 + v * 25},${168 + v * 22})`;
          cc.beginPath();
          cc.roundRect(x + 3, row * 32 + 3, 58, 26, 5);
          cc.fill();
          const g = hc.createLinearGradient(0, row * 32, 0, row * 32 + 32);
          g.addColorStop(0, '#888');
          g.addColorStop(0.3, '#fff');
          g.addColorStop(1, '#666');
          hc.fillStyle = g;
          hc.beginPath();
          hc.roundRect(x + 3, row * 32 + 3, 58, 26, 5);
          hc.fill();
        }
      }
      const map = new THREE.CanvasTexture(color);
      map.colorSpace = THREE.SRGBColorSpace;
      const normalMap = normalFromHeight(height, 4);
      for (const t of [map, normalMap]) {
        t.wrapS = THREE.RepeatWrapping;
        t.repeat.set(repeat, 1);
      }
      return this.toon(0xffffff, { map, normalMap });
    };
    const top = this.toon(0x8f93b8);
    const low = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.1, 0.28, 64), [blocks(5), top, top]);
    low.position.y = 0.14;
    const high = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.55, 0.28, 64), [blocks(4), top, top]);
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
      if (i === gapAt) continue; // entrance: no lonely post in front of the cabin
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
      hull: (m) => withOutline(m),
      outline: (m, sc) => this.outline(m, sc),
      glow: (c, sz, o) => this.glow(c, sz, o),
      glowTex: this.glowTex,
    });
    this.windows = cabin.windows;
    this.cabinLights = cabin.lights;
    this.staticAnimated.push(cabin);

    // Outside the fence, next to the entrance, facing the tree
    const a = (14 / 20) * Math.PI * 2 - 0.12;
    cabin.group.position.set(Math.cos(a) * 12.5, terrainHeight(Math.cos(a) * 12.5, Math.sin(a) * 12.5), Math.sin(a) * 12.5);
    cabin.group.lookAt(0, 0, 0);
    this.scene.add(cabin.group);
  }

  private buildForest(): void {
    this.buildMountains();
    this.buildKenneyWorld().catch(() => {
      this.buildConeForest();
      this.heapsDone();
    });
  }

  /** Forest of snowy fir trees, snow piles and rocks (Kenney models, instanced) */
  private async buildKenneyWorld(): Promise<void> {
    const kinds: ModelName[] = ['tree-snow-a', 'tree-snow-b', 'tree-snow-c'];
    const meshes = await Promise.all(kinds.map((k) => this.models.mesh(k)));
    const n = 90;
    const ca = (14 / 20) * Math.PI * 2 - 0.12; // cabin direction
    const placed: THREE.Matrix4[][] = kinds.map(() => []);
    for (let i = 0; i < n; i++) {
      const a = rand(i * 3) * Math.PI * 2;
      const r = 15 + rand(i * 5) * 26;
      if (r < 20 && Math.abs(Math.atan2(Math.sin(a - ca), Math.cos(a - ca))) < 0.4) continue;
      const s = 1.8 + rand(i * 7) * 1.8;
      placed[i % kinds.length].push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(Math.cos(a) * r, terrainHeight(Math.cos(a) * r, Math.sin(a) * r) - 0.1, Math.sin(a) * r),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(i) * 6.28),
          new THREE.Vector3(s, s * (0.9 + rand(i + 2) * 0.3), s),
        ),
      );
    }
    meshes.forEach(({ geometry, material }, k) => {
      const inst = new THREE.InstancedMesh(geometry, material, placed[k].length);
      placed[k].forEach((m, j) => inst.setMatrixAt(j, m));
      // Thinner lines for the background forest
      this.scene.add(inst, instancedOutline(inst, 0.0024));
    });

    // Snow piles, rocks and the bench around the courtyard
    const decor = STATIC_DECOR;
    // Everything loads in parallel; a failed model doesn't stop the others
    const place = async (name: ModelName, pos: THREE.Vector3, scale: number, rotY: number) => {
      try {
        const obj = await this.models.get(name);
        obj.position.copy(pos);
        obj.scale.setScalar(scale);
        obj.rotation.y = rotY;
        this.scene.add(obj);
        this.renderOnce();
      } catch (err) {
        console.warn('Model failed', name, err);
      }
    };
    const jobs: Promise<void>[] = decor.map(([name, a, r, sc, rot]) =>
      place(name, new THREE.Vector3(Math.cos(a) * r, terrainHeight(Math.cos(a) * r, Math.sin(a) * r) - 0.05, Math.sin(a) * r), sc, name === 'bench' ? -a - Math.PI / 2 : rot),
    );
    // A heap of presents in the middle of every corner
    const heaps = CORNERS.map((_, ci) => this.buildHeap(ci));
    Promise.all(heaps).then(() => this.heapsDone());
    await Promise.all([...jobs, ...heaps]);
  }

  /**
   * A heap of presents: a tight bottom row that doesn't intersect, and one
   * smaller present standing on top of the biggest flat one.
   */
  /** Real footprints of the present heaps (known once they are built) */
  private readonly heapColliders: Circle[] = [];
  private heapsDone!: () => void;
  private readonly heapsReady = new Promise<void>((resolve) => (this.heapsDone = resolve));

  private async buildHeap(ci: number): Promise<void> {
    const kinds: ModelName[] = ['present-a-cube', 'present-b-rectangle', 'present-a-round', 'present-b-cube', 'present-a-rectangle', 'present-b-round'];
    const pick = (k: number) => kinds[(ci * 2 + k) % kinds.length];
    const bottom: [number, number, number][] = [
      // home offset x, z and scale
      [0, 0, 2.0],
      [0.45, 0.25, 1.6],
      [-0.45, 0.2, 1.7],
      [0.05, -0.45, 1.5],
    ];
    try {
      const objs = await Promise.all([...bottom.map((_, k) => this.models.get(pick(k))), this.models.get(pick(4))]);
      const c = cornerCentre(ci);
      const bodies = bottom.map(([x, z, sc], k) => {
        const o = objs[k];
        o.scale.setScalar(sc);
        o.rotation.y = rand(ci * 10 + k) * Math.PI;
        return makeBody(c.x + x, c.z + z, shape(o, o.rotation.y));
      });
      // Pull them tightly together around the centre, but without overlaps
      bodies.forEach((b) => {
        b.homeX = c.x;
        b.homeZ = c.z;
      });
      resolve(bodies, [], FREE, 120);
      bodies.forEach((b, k) => {
        objs[k].position.set(b.x, 0, b.z);
        this.scene.add(objs[k]);
        this.heapColliders.push(...circlesOf(b));
      });

      // The top one on the biggest (first) present, smaller than it
      const base = objs[0];
      const top = objs[4];
      const baseBox = new THREE.Box3().setFromObject(base);
      top.scale.setScalar(1.15);
      top.rotation.y = rand(ci + 0.5) * Math.PI;
      top.position.set(base.position.x, baseBox.max.y - 0.02, base.position.z);
      this.scene.add(top);
      this.heapColliders.push(...circlesOf(makeBody(top.position.x, top.position.z, shape(top, top.rotation.y))));
      this.renderOnce();
    } catch (err) {
      console.warn('Heap failed', err);
    }
  }

  private buildConeForest(): void {
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
  }

  private buildMountains(): void {
    // Mountains far away
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rand(i) * 0.3;
      // Low enough to leave the starry sky visible between the peaks
      const h = 6 + rand(i + 9) * 7;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(h * 0.9, h, 6), this.toon(0x2a2f6a));
      mountain.position.set(Math.cos(a) * 62, h / 2 - 1, Math.sin(a) * 62);
      const top = new THREE.Mesh(new THREE.ConeGeometry(h * 0.3, h / 3, 6), this.toon(0xdfe6ff));
      top.position.set(mountain.position.x, h - 1 - h / 6, mountain.position.z);
      this.scene.add(mountain, top);
    }
  }

  private treeGroup?: THREE.Group;

  private buildTree(): void {
    this.treeGroup = buildFirTree({
      toon: (c, e) => this.toon(c, e),
      hull: (m, t, smooth) => this.hull(m, t, smooth),
    });
    this.scene.add(this.treeGroup);
  }

  /** Snowfall strength: light (free), snowfall, blizzard (unlocked for mandarins) */
  static readonly SNOWFALL = [
    { count: 0, size: 0.16, speed: 1, wind: 0.05, stars: 1 }, // clear night: the starry sky
    { count: 700, size: 0.16, speed: 1, wind: 0.08, stars: 0.4 },
    { count: 1800, size: 0.2, speed: 1.25, wind: 0.25, stars: 0.15 },
    { count: 3600, size: 0.24, speed: 1.7, wind: 0.9, stars: 0.04 },
  ];
  private snowLevel = 1;
  /** 1 = clear sky, 0 = overcast: fades stars and northern lights */
  private skyClear = 0.4;

  setSnowfall(level: number): void {
    this.snowLevel = THREE.MathUtils.clamp(level, 0, TreeWorld.SNOWFALL.length - 1);
    const cfg = TreeWorld.SNOWFALL[this.snowLevel];
    this.snow.geometry.setDrawRange(0, cfg.count);
    (this.snow.material as THREE.PointsMaterial).size = cfg.size;
    // Clouds come with the snow: fewer stars
    if (this.starMat) this.starMat.uniforms['opacity'].value = cfg.stars;
    // Northern lights need a clear sky too
    this.skyClear = cfg.stars;
    this.renderOnce();
  }

  private buildSnowfall(): void {
    const n = TreeWorld.SNOWFALL[TreeWorld.SNOWFALL.length - 1].count;
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
    geo.setDrawRange(0, TreeWorld.SNOWFALL[1].count);
    this.scene.add(this.snow);
  }

  // ====== Dynamic content ====== //
  /**
   * Places for balls: a thread from a branch tip at the lower rim of a tier,
   * the ball hangs below it resting on the branches of the tier below
   * (pushed out of them, the thread leans a little). All around, every tier;
   * filled tier by tier in turn, so any number of balls covers all heights.
   */
  private ballSlots(): BallSlot[] {
    const BALL_R = 0.25;
    const perTier: BallSlot[][] = [];
    TIERS.forEach(([bottom, , radius], t) => {
      // Not under the lowest tier (the podium is right below) and not the tiny top one
      if (t === 0 || radius < 0.6) return;
      const count = Math.max(3, Math.floor((Math.PI * 2 * radius) / 0.85));
      const list: BallSlot[] = [];
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2 + t * 1.13;
        const tip = this.branchTip(bottom, a);
        if (!tip) continue;
        const top = new THREE.Vector3(Math.cos(tip.a) * (tip.r - 0.06), tip.y - 0.03, Math.sin(tip.a) * (tip.r - 0.06));
        const ballY = top.y - 0.42;
        const surface = this.surfaceRadius(ballY, tip.a);
        const r = Math.max(tip.r - 0.06, surface + BALL_R * 0.85);
        const ball = new THREE.Vector3(Math.cos(tip.a) * r, ballY, Math.sin(tip.a) * r);
        list.push({ top, ball });
      }
      perTier.push(list);
    });
    const total = perTier.reduce((n, l) => n + l.length, 0);
    const slots: BallSlot[] = [];
    for (let k = 0; slots.length < total; k++) {
      for (const list of perTier) if (k < list.length) slots.push(list[k]);
    }
    return slots;
  }

  /** Radius of the tree surface at height y towards angle a (ray from outside) */
  private surfaceRadius(y: number, a: number): number {
    if (!this.treeGroup) return treeRadius(y);
    const ray = new THREE.Raycaster();
    ray.set(new THREE.Vector3(Math.cos(a) * 6, y, Math.sin(a) * 6), new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)));
    const hit = ray
      .intersectObject(this.treeGroup, true)
      .find((h) => !((h.object as THREE.Mesh).material instanceof THREE.ShaderMaterial));
    return hit ? Math.hypot(hit.point.x, hit.point.z) : treeRadius(y);
  }

  /** The most sticking-out branch tip near angle a at the rim of a tier (y = tier bottom) */
  private branchTip(bottom: number, a: number): { r: number; a: number; y: number } | null {
    if (!this.treeGroup) {
      const r = treeRadius(bottom + 0.05);
      return r < 0.3 ? null : { r, a, y: bottom };
    }
    this.treeGroup.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    let best: { r: number; a: number; y: number } | null = null;
    for (const da of [-0.12, -0.06, 0, 0.06, 0.12]) {
      for (const dy of [0.02, 0.1, 0.18]) {
        const aa = a + da;
        const y = bottom + dy;
        ray.set(new THREE.Vector3(Math.cos(aa) * 6, y, Math.sin(aa) * 6), new THREE.Vector3(-Math.cos(aa), 0, -Math.sin(aa)));
        const hit = ray
          .intersectObject(this.treeGroup, true)
          .find((h) => !((h.object as THREE.Mesh).material instanceof THREE.ShaderMaterial));
        if (!hit) continue;
        const r = Math.hypot(hit.point.x, hit.point.z);
        if (!best || r > best.r) best = { r, a: aa, y };
      }
    }
    return best && best.r > 0.3 ? best : null;
  }

  private slotsCache?: BallSlot[];
  private get slots(): BallSlot[] {
    return (this.slotsCache ??= this.ballSlots());
  }
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
    this.slots.slice(onTree.length, onTree.length + 2).forEach((p, i) => this.addGhost(p.ball, i));

    this.addGarland(tree.garland);
    this.addStar(tree.star);
    const version = ++this.version;
    tree.balls.filter((b) => b.state === 'box').slice(0, 6).forEach((b, i) => this.addGift(b, i, version));
    if (tree.level >= 6) this.addTrain(version);
    this.lastDecor = tree.decor ?? [];
    this.placeCourtyard(this.lastDecor, version);
    this.applyLevel(tree.level);
    this.renderOnce();
  }

  private clear(): void {
    this.dynamic.clear();
    this.clickables.length = 0;
    this.animated.length = 0;
  }

  private addBall(ball: TreeBall, slot: BallSlot, i: number, isNewHung: boolean, isNewLit: boolean): void {
    const color = BALL_COLORS[ball.color] ?? BALL_COLORS['red'];
    const isLit = ball.state === 'lit';
    // pivot: at the knot on the branch, sways; hang: turned along the thread
    const pivot = new THREE.Group();
    pivot.position.copy(slot.top);
    const toBall = slot.ball.clone().sub(slot.top);
    const L = toBall.length();
    const hang = new THREE.Group();
    hang.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), toBall.normalize());
    pivot.add(hang);

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 20, 14),
      this.toon(0xffffff, {
        map: ball.pattern === 'plain' ? null : this.patternMap(ball.pattern, color),
        color: ball.pattern === 'plain' ? color : 0xffffff,
        emissive: isLit ? color : 0x000000,
        emissiveIntensity: isLit ? 0.55 : 0,
      }),
    );
    sphere.position.y = -L;
    this.hull(sphere, 0.018);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.07, 8), this.toon(0xd9b25a));
    cap.position.y = -L + 0.27;
    const threadLen = Math.max(0.02, L - 0.3);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, threadLen, 4), new THREE.MeshBasicMaterial({ color: 0xd9c38a }));
    string.position.y = -threadLen / 2;
    hang.add(sphere, cap, string);

    let glow: THREE.Sprite | undefined;
    if (isLit) {
      glow = this.glow(color, 1.4, 0.9);
      glow.position.y = -L;
      hang.add(glow);
    }
    if (Object.keys(ball.reactions).length || ball.replies) {
      const sparkle = this.glow(0xfff6c9, 0.35, 1);
      sparkle.position.set(0.2, -L + 0.24, 0);
      hang.add(sparkle);
      this.animated.push({ update: (t) => sparkle.material.opacity = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i)) });
    }

    // Bigger invisible target: easy to tap with a finger
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = -L;
    hit.userData = { kind: 'ball', ball };
    hang.add(hit);
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
          pivot.position.y = slot.top.y + (1 - bounce) * 2.2;
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
    ghost.scale.setScalar(0.55);
    // Slightly in front of the branches, with a warm glow behind
    const out = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(0.12);
    ghost.position.copy(p).add(out);
    const halo = this.glow(0xfff0b0, 1.3, 0.8);
    halo.position.copy(ghost.position);
    this.dynamic.add(halo);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData = { kind: 'add' };
    ghost.add(hit);
    this.clickables.push(hit);
    this.dynamic.add(ghost);
    this.animated.push({
      update: (t) => {
        // Slow breathing: ~3 s per beat
        const k = 0.5 + 0.5 * Math.sin(t * 2.1 + i * 1.3);
        ghost.scale.setScalar(0.5 + 0.18 * k);
        ghost.material.opacity = 0.6 + 0.4 * k;
        halo.material.opacity = 0.3 + 0.6 * k;
        halo.scale.setScalar(1.0 + 0.7 * k);
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
      const r = treeRadius(y) * 0.96 + 0.06;
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
      new THREE.Mesh(
        geo,
        this.toon(on ? 0xffd36b : 0xc9d2ec, {
          emissive: on ? 0xffb020 : 0x5a6ab0,
          emissiveIntensity: on ? 0.8 : 0.35,
        }),
      ),
      1.06,
    );
    star.position.y = TREE_TOP + 0.35;
    star.userData = { kind: 'star' };
    this.clickables.push(star);
    this.dynamic.add(star);
    // Lit: warm big glow. Not lit yet: a faint cold shimmer, so the star is still noticeable
    const glow = on ? this.glow(0xffe08a, 2.6, 0.9) : this.glow(0x9fb4ff, 1.5, 0.35);
    glow.position.copy(star.position);
    this.dynamic.add(glow);
    this.animated.push({
      update: (t) => {
        star.quaternion.copy(this.camera.quaternion);
        star.rotateZ(Math.sin(t * 1.2) * 0.08);
        if (on) glow.scale.setScalar(2.4 + Math.sin(t * 2) * 0.3);
        else glow.material.opacity = 0.2 + 0.2 * Math.abs(Math.sin(t * 0.9));
      },
    });
  }

  private async addGift(ball: TreeBall, i: number, version: number): Promise<void> {
    const kinds: ModelName[] = ['present-a-cube', 'present-b-rectangle', 'present-a-round', 'present-b-cube', 'present-a-rectangle', 'present-b-round'];
    const gift = await this.models.get(kinds[i % kinds.length]);
    if (version !== this.version) return;
    const size = 1.45 + rand(i + 4) * 0.35;
    gift.scale.setScalar(size);

    // On the podium, half under the branches: as if the tree covers them
    const a = 0.5 + i * 1.05;
    const holder = new THREE.Group();
    holder.position.set(Math.cos(a) * 1.95, 0.6, Math.sin(a) * 1.95);
    holder.rotation.y = rand(i) * Math.PI;
    holder.add(gift);

    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.35;
    hit.userData = { kind: 'ball', ball };
    holder.add(hit);
    this.clickables.push(hit);
    this.dynamic.add(holder);
    this.animated.push({
      update: (t) => {
        const hop = Math.max(0, Math.sin(t * 2.2 + i * 1.7));
        holder.position.y = 0.6 + Math.pow(hop, 8) * 0.12;
      },
    });
    this.renderOnce();
  }

  /** Toy train running around the podium (festive level 6+) */
  private async addTrain(version: number): Promise<void> {
    const R = 3.75;
    // Track: two rails and sleepers
    const metal = this.toon(0x4a4f6a);
    for (const r of [R - 0.17, R + 0.17]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 4, 96), metal);
      rail.rotation.x = Math.PI / 2;
      rail.position.y = 0.07;
      this.dynamic.add(rail);
    }
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.05, 0.12), this.toon(0x6b4a3a), 64);
    const m = new THREE.Matrix4();
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      m.compose(
        new THREE.Vector3(Math.cos(a) * R, 0.03, Math.sin(a) * R),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a),
        new THREE.Vector3(1, 1, 1),
      );
      sleepers.setMatrixAt(k, m);
    }
    this.dynamic.add(sleepers);

    const kinds: ModelName[] = ['train-locomotive', 'train-tender', 'train-wagon', 'train-wagon-logs', 'train-wagon-short'];
    const cars = await Promise.all(kinds.map((k) => this.models.get(k)));
    if (version !== this.version) return;
    const lengths = [0.67, 0.34, 0.72, 0.72, 0.5].map((l) => l * 1.7 + 0.08);
    const holders = cars.map((car) => {
      car.scale.setScalar(1.7);
      const h = new THREE.Group();
      h.add(car);
      this.dynamic.add(h);
      return h;
    });
    const smoke = this.glow(0xd8def5, 0.6, 0);
    this.dynamic.add(smoke);

    this.animated.push({
      update: (t) => {
        let angle = t * 0.22;
        holders.forEach((h, k) => {
          if (k > 0) angle -= (lengths[k - 1] / 2 + lengths[k] / 2) / R;
          h.position.set(Math.cos(angle) * R, 0.08 + Math.abs(Math.sin(t * 9 + k)) * 0.01, Math.sin(angle) * R);
          // Cars look along the track (models face +X)
          h.rotation.y = -angle - Math.PI / 2;
        });
        const loco = holders[0].position;
        const puff = (t * 1.5) % 1;
        smoke.position.set(loco.x, 0.95 + puff * 0.8, loco.z);
        smoke.scale.setScalar(0.3 + puff * 0.7);
        smoke.material.opacity = Math.sin(puff * Math.PI) * 0.6;
      },
    });
    this.renderOnce();
  }

  // ====== Courtyard figures & decorate mode ====== //
  private decorMode = false;
  /** Figure shown on free places; null = nothing chosen yet: arrows */
  private previewItem: string | null = null;
  private lastDecor: { item: string; pad: number }[] = [];
  private previews: THREE.Object3D[] = [];
  private readonly ghostMats = new Map<string, THREE.Material>();

  /**
   * Figures from the shop on their places, and (in decorate mode) translucent
   * previews on free places. Positions are corrected so nothing intersects.
   */
  private async placeCourtyard(decor: { item: string; pad: number }[], version: number): Promise<void> {
    const items = decor.filter((d) => DECOR_KINDS[d.item]);
    const objects = await Promise.all(
      items.map((d) => this.models.get(DECOR_KINDS[d.item].model).catch(() => null)),
    );
    const previewKind = this.previewItem ? DECOR_KINDS[this.previewItem] : null;
    const previewProto = previewKind ? await this.models.get(previewKind.model, false).catch(() => null) : null;
    // The heaps' real size matters: wait until they are built
    await Promise.race([this.heapsReady, new Promise((r) => setTimeout(r, 5000))]);
    if (version !== this.version) return;

    // Figures are placed one by one; each tries its allowed poses and keeps
    // the one that moves it least, the placed ones become obstacles
    const obstacles: Circle[] = [...STATIC_COLLIDERS, ...this.heapColliders];
    const placedPads = new Set<number>();
    items.forEach((d, k) => {
      const obj = objects[k];
      if (!obj) return;
      const pad = d.pad % DECOR_PADS.length;
      const kind = DECOR_KINDS[d.item];
      obj.scale.setScalar(kind.scale);
      const { b, yaw } = this.fit(obj, kind, pad, obstacles);
      obj.position.set(b.x, terrainHeight(b.x, b.z), b.z);
      obj.rotation.y = yaw;
      obstacles.push(...circlesOf(b));
      placedPads.add(pad);
      for (const c of circlesOf(b)) {
        const hit = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, 1.4, 8), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.set(c.x, 0.7, c.z);
        hit.userData = { kind: 'pad', pad, item: d.item };
        this.clickables.push(hit);
        this.dynamic.add(hit);
      }
      this.dynamic.add(obj);
    });

    // Previews on free places, by the same rules, between the placed figures
    this.previews = [];
    if (!previewKind || !previewProto) {
      const small: THREE.Object3D[][] = CORNERS.map(() => []);
      // Nothing chosen yet: a floating arrow over every free place
      DECOR_PADS.forEach((home, i) => {
        if (placedPads.has(i)) return;
        const b = makeBody(home.pos.x, home.pos.z, [{ dx: 0, dz: 0, r: 0.45 }]);
        resolve([b], obstacles, COURTYARD_RING);
        const marker = this.arrowMarker(i);
        marker.position.set(b.x, terrainHeight(b.x, b.z), b.z);
        const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 2.2, 8), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.y = 1.1;
        hit.userData = { kind: 'pad', pad: i, item: null };
        this.clickables.push(hit);
        marker.add(hit);
        marker.visible = this.decorMode;
        this.previews.push(marker);
        this.dynamic.add(marker);
        small[home.corner].push(marker);
      });

      // From far away: one big arrow over the heap of every corner with free places
      CORNERS.forEach((_, ci) => {
        if (!small[ci].length) return;
        const c = cornerCentre(ci);
        // Tip right above the heap
        const big = this.arrowMarker(ci + 0.5, 1.8);
        big.position.set(c.x, 0.35, c.z);
        const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.5, 8), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.y = 1.8;
        hit.userData = { kind: 'corner', corner: ci };
        this.clickables.push(hit);
        big.add(hit);
        big.visible = this.decorMode;
        this.previews.push(big);
        this.dynamic.add(big);

        // Crossfade by the distance of the camera to the corner
        const group = small[ci];
        this.animated.push({
          update: () => {
            const d = this.camera.position.distanceTo(c);
            const near = THREE.MathUtils.smoothstep(d, 7, 9.5); // 0 near, 1 far
            const k = this.decorMode ? near : 0;
            big.scale.setScalar(Math.max(k, 0.001));
            big.visible = this.decorMode && k > 0.02;
            for (const m of group) {
              const ks = this.decorMode ? 1 - near : 0;
              m.scale.setScalar(Math.max(ks, 0.001));
              m.visible = this.decorMode && ks > 0.02;
            }
          },
        });
      });
    } else {
      DECOR_PADS.forEach((_, i) => {
        if (placedPads.has(i)) return;
        const ghost = this.ghost(previewProto);
        ghost.scale.setScalar(previewKind.scale);
        const { b, yaw } = this.fit(ghost, previewKind, i, obstacles);
        ghost.position.set(b.x, terrainHeight(b.x, b.z), b.z);
        ghost.rotation.y = yaw;
        const marker = new THREE.Group();
        marker.add(ghost);
        for (const c of circlesOf(b)) {
          const hit = new THREE.Mesh(new THREE.CylinderGeometry(c.r + 0.1, c.r + 0.1, 1.4, 8), new THREE.MeshBasicMaterial({ visible: false }));
          hit.position.set(c.x, 0.7, c.z);
          hit.userData = { kind: 'pad', pad: i, item: null };
          this.clickables.push(hit);
          marker.add(hit);
        }
        marker.visible = this.decorMode;
        this.previews.push(marker);
        this.dynamic.add(marker);
      });
      // All previews breathe together: clearly "not real yet"
      this.animated.push({
        update: (t) => {
          const o = 0.7 + 0.08 * Math.sin(t * 2.2);
          this.ghostMats.forEach((m) => (m.opacity = o));
        },
      });
    }
    this.renderOnce();
  }

  private arrowGeo?: THREE.BufferGeometry;
  private arrowMat?: THREE.MeshToonMaterial;

  /** Golden arrow pointing down at a free place: bobs and turns slowly */
  private arrowMarker(i: number, size = 1): THREE.Group {
    if (!this.arrowGeo) {
      // Shaft + head as one lathe profile: a round arrow, readable from any side
      const profile = [
        new THREE.Vector2(0, -0.42),
        new THREE.Vector2(0.24, -0.08),
        new THREE.Vector2(0.1, -0.08),
        new THREE.Vector2(0.1, 0.32),
        new THREE.Vector2(0, 0.32),
      ];
      this.arrowGeo = new THREE.LatheGeometry(profile, 16);
      // Same look as figure previews: light blue, 70% opaque, breathing
      this.arrowMat = new THREE.MeshToonMaterial({
        color: 0x8ec0ff,
        gradientMap: this.gradient,
        // Glowing from inside: bright even in the shadow
        emissive: 0x3d8bff,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        depthFunc: THREE.LessEqualDepth,
      });
      this.ghostMats.set('arrow', this.arrowMat);
    }
    const group = new THREE.Group();
    const arrow = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    arrow.scale.setScalar(size);
    arrow.renderOrder = 11;
    // Depth pre-pass: no back faces showing through
    const depth = new THREE.Mesh(this.arrowGeo, this.depthOnly);
    depth.renderOrder = 10;
    arrow.add(depth);
    const glow = this.glow(0x5a9bff, 1.2 * size, 0.8);
    glow.material.blending = THREE.NormalBlending;
    glow.position.y = 0.05;
    glow.scale.set(1.2 * size, 0.4 * size, 1);
    // A halo around the arrow itself, bobbing with it: normal blending, so the
    // blue stays saturated on the white snow (additive glow would wash out)
    const halo = this.glow(0x4d8dff, 1.5, 0.75);
    halo.material.blending = THREE.NormalBlending;
    group.add(arrow, glow, halo);
    this.animated.push({
      update: (t) => {
        const bob = Math.abs(Math.sin(t * 2.4 + i));
        arrow.position.y = (1.0 + bob * 0.35) * size;
        arrow.rotation.y = t * 0.8 + i;
        halo.position.y = arrow.position.y - 0.05;
        halo.material.opacity = 0.4 + 0.2 * Math.sin(t * 2.2 + i);
        halo.scale.setScalar((1.35 + 0.2 * Math.sin(t * 2.2 + i)) * size);
        glow.material.opacity = 0.3 + 0.3 * (1 - bob);
        this.arrowMat!.opacity = 0.78 + 0.08 * Math.sin(t * 2.2);
      },
    });
    return group;
  }

  /** Best allowed pose of an object on a place, not intersecting the obstacles */
  private fit(obj: THREE.Object3D, kind: DecorKind, pad: number, obstacles: Circle[]): { b: Body; yaw: number } {
    const home = DECOR_PADS[pad];
    const base = facing(home.pos.x, home.pos.z, home.corner, pad);
    let best: { b: Body; yaw: number; cost: number } | null = null;
    kind.yaws.forEach((turn, k) => {
      const yaw = base + turn;
      const b = makeBody(home.pos.x, home.pos.z, shape(obj, yaw));
      resolve([b], obstacles, COURTYARD_RING);
      // Prefer earlier poses a little: the rule's order is its taste
      const cost = displacement(b) + k * 0.08;
      if (!best || cost < best.cost) best = { b, yaw, cost };
    });
    return best!;
  }

  /** A translucent copy of a model (shared ghost materials) */
  private readonly depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });

  private ghost(proto: THREE.Object3D): THREE.Object3D {
    const copy = proto.clone(true);
    const meshes: THREE.Mesh[] = [];
    copy.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
    for (const mesh of meshes) {
      // 1st pass writes only depth, 2nd draws colour where it's the nearest
      // surface: back and inner faces of the translucent figure stay hidden
      const depth = new THREE.Mesh(mesh.geometry, this.depthOnly);
      depth.renderOrder = 10;
      mesh.add(depth);
      mesh.renderOrder = 11;
      const src = mesh.material as THREE.MeshToonMaterial;
      let m = this.ghostMats.get(src.uuid);
      if (!m) {
        m = new THREE.MeshToonMaterial({
          map: src.map,
          color: src.color,
          gradientMap: this.gradient,
          emissive: 0x7f9cff,
          emissiveIntensity: 0.55,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          depthFunc: THREE.LessEqualDepth,
        });
        this.ghostMats.set(src.uuid, m);
      }
      mesh.material = m;
    }
    return copy;
  }

  /** Decorate mode; `previewItem` is the figure to place (null: arrows on free places) */
  setDecorMode(on: boolean, previewItem: string | null = null): void {
    this.decorMode = on;
    if (previewItem && !DECOR_KINDS[previewItem]) previewItem = null;
    if (previewItem !== this.previewItem) {
      this.previewItem = previewItem;
      this.previews.forEach((p) => this.dynamic.remove(p));
      this.placeCourtyard(this.lastDecor, this.version);
    }
    this.previews.forEach((m) => (m.visible = on));
    if (!on) this.clearFocus();
    this.start();
    this.renderOnce();
  }

  // Camera flight to a corner
  private focusTarget = new THREE.Vector3();
  private focusAzimuth = 0;
  private focusTo = 0;
  private focusBlend = 0;

  focusCorner(corner: number): void {
    this.callbacks.focused?.(corner);
    const c = cornerCentre(corner);
    this.focusTarget.set(c.x * 0.97, 0.55, c.z * 0.97);
    // Look from the tree side (figures face the camera, the fence and the forest
    // are behind them), a bit diagonally so the camera passes beside the tree
    this.focusAzimuth = Math.atan2(c.x, c.z) + Math.PI + 0.55;
    this.focusTo = 1;
    this.velocity = 0;
    this.start();
  }

  clearFocus(): void {
    if (this.focusTo === 1) this.callbacks.focusLost();
    this.focusTo = 0;
    this.start();
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
    if (level >= 9) this.addAurora();
  }

  /**
   * Northern lights: wavy curtains with vertical rays all around the sky,
   * low enough to be seen behind the forest from the usual camera angle.
   */
  private addAurora(): void {
    const tex = canvasTexture(512, (ctx, w) => {
      // Vertical rays of different brightness
      for (let x = 0; x < w; x++) {
        const ray = 0.35 + 0.65 * Math.pow(Math.abs(Math.sin(x * 0.11) * Math.sin(x * 0.031 + 1)), 0.7);
        const g = ctx.createLinearGradient(0, 0, 0, w);
        g.addColorStop(0, `rgba(170,110,255,0)`);
        g.addColorStop(0.35, `rgba(120,140,255,${0.35 * ray})`);
        g.addColorStop(0.7, `rgba(70,255,180,${0.9 * ray})`);
        g.addColorStop(0.92, `rgba(120,255,200,${0.5 * ray})`);
        g.addColorStop(1, `rgba(120,255,200,0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, 1, w);
      }
    });
    tex.wrapS = THREE.RepeatWrapping;

    // Separate ribbons of different length, height and tilt
    // The sky strip above the forest is narrow (~3-8 deg above the horizon):
    // the lower edge stays just above the treetops, the upper part may leave the frame
    const ribbons = [
      { start: 0.3, length: 2.2, radius: 52, base: 11.2, height: 10, tilt: 0.015, speed: 1 },
      { start: 2.9, length: 1.6, radius: 56, base: 12.2, height: 8, tilt: -0.015, speed: -0.8 },
      { start: 4.4, length: 2.0, radius: 50, base: 11.6, height: 9, tilt: 0.01, speed: 1.2 },
      { start: 1.6, length: 1.3, radius: 58, base: 13, height: 6, tilt: -0.01, speed: -1.1 },
      { start: 5.6, length: 1.7, radius: 55, base: 11.8, height: 8, tilt: -0.015, speed: 0.9 },
      { start: 3.6, length: 1.1, radius: 49, base: 11, height: 7, tilt: 0.015, speed: -1.3 },
    ];
    const SEG = 140;
    const ROWS = 4;

    ribbons.forEach((rb, i) => {
      const geo = new THREE.PlaneGeometry(1, 1, SEG, ROWS);
      const pos = geo.attributes['position'] as THREE.BufferAttribute;
      // u along the ribbon (0..1), v from the bottom (0) to the top (1)
      const uv = new Float32Array(pos.count * 2);
      const colors = new Float32Array(pos.count * 3);
      for (let k = 0; k < pos.count; k++) {
        const u = pos.getX(k) + 0.5;
        const v = pos.getY(k) + 0.5;
        uv[k * 2] = u * rb.length * 1.6;
        uv[k * 2 + 1] = v;
        // The ends fade out softly; brightness varies along the ribbon
        const ends = Math.sin(Math.PI * u) ** 0.8;
        const along = 0.55 + 0.45 * Math.sin(u * 9 + i * 2) * Math.sin(u * 3.7 + i);
        const b = Math.min(1, 1.25 * ends * Math.max(0.2, along));
        colors.set([b, b, b], k * 3);
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const base = Float32Array.from(pos.array as Float32Array);

      const map = tex.clone();
      map.needsUpdate = true;
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          map,
          vertexColors: true,
          transparent: true,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false,
        }),
      );
      mesh.rotation.z = rb.tilt;
      mesh.frustumCulled = false;
      this.levelGroup.add(mesh);

      // Shape: arc around the courtyard with folds, a wavy bottom and a ragged
      // top of varying height; everything sways slowly
      const shape = (t: number) => {
        for (let k = 0; k < pos.count; k++) {
          const u = base[k * 3] + 0.5;
          const v = base[k * 3 + 1] + 0.5;
          const a = rb.start + u * rb.length;
          const fold =
            1 + 0.07 * Math.sin(a * 7 + t * 0.25 * rb.speed + i) + 0.035 * Math.sin(a * 19 - t * 0.4 * rb.speed);
          const r = rb.radius * fold;
          // Gentle waves of the lower edge: never dips behind the trees
          const bottom = rb.base + 0.7 * Math.sin(a * 4 + t * 0.2 + i) + 0.3 * Math.sin(a * 11 - t * 0.3);
          const top = rb.height * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(a * 6 + t * 0.15 + i * 3)) * (0.6 + 0.4 * Math.sin(a * 17 + i)));
          pos.setXYZ(k, Math.cos(a) * r, bottom + v * top, Math.sin(a) * r);
        }
        pos.needsUpdate = true;
      };
      shape(0);

      let last = -1;
      this.animated.push({
        update: (t) => {
          map.offset.x = t * 0.006 * rb.speed;
          (mesh.material as THREE.MeshBasicMaterial).opacity = (0.85 + 0.15 * Math.sin(t * 0.45 + i * 1.7)) * Math.min(1, this.skyClear * 1.4);
          mesh.visible = this.skyClear > 0.1;
          // Reshape ~15 times a second: smooth enough for slow waves, cheap
          if (t - last > 0.066) {
            last = t;
            shape(t);
          }
        },
      });
    });
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
      if (moved && this.focusTo === 1) {
        this.focusTo = 0;
        this.callbacks.focusLost();
      }
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
    const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && shown(o.parent));
    const hit = ray.intersectObjects(this.clickables, false).find((h) => shown(h.object.parent))
      ?? null;
    if (!hit) return;
    const data = hit.object.userData;
    if (data['kind'] === 'ball') this.callbacks.ball(data['ball']);
    else if (data['kind'] === 'star') this.callbacks.star();
    else if (data['kind'] === 'add') this.callbacks.addBall();
    else if (data['kind'] === 'corner') this.focusCorner(data['corner']);
    else if (data['kind'] === 'pad' && (this.decorMode || data['item'])) {
      const pad = data['pad'] as number;
      const corner = DECOR_PADS[pad].corner;
      this.focusCorner(corner);
      this.callbacks.pad(pad, CORNERS[corner].key, data['item'] ?? null);
    }
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
    const b = THREE.MathUtils.smoothstep(this.focusBlend, 0, 1);
    // Normal view around the tree, blended with the close view of a corner
    // Close to the corner, from the tree side and a bit above
    const d = lerp(lerp(ZOOM_NEAR.distance, ZOOM_FAR.distance, z), 6.0, b);
    const e = lerp(lerp(ZOOM_NEAR.elevation, ZOOM_FAR.elevation, z), 0.42, b);
    const ty = lerp(ZOOM_NEAR.target, ZOOM_FAR.target, z);
    const target = new THREE.Vector3(0, ty, 0).lerp(this.focusTarget, b);
    this.camera.position.set(
      target.x + Math.sin(this.azimuth) * Math.cos(e) * d,
      target.y + Math.sin(e) * d,
      target.z + Math.cos(this.azimuth) * Math.cos(e) * d,
    );
    // Never inside the tree: push the camera out of its silhouette
    const cam = this.camera.position;
    const minR = treeRadius(cam.y) + 0.9;
    const r = Math.hypot(cam.x, cam.z);
    if (cam.y < TREE_TOP + 0.5 && r < minR) {
      const k = minR / Math.max(r, 1e-3);
      cam.x *= k;
      cam.z *= k;
    }
    this.camera.lookAt(target);
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
    this.focusBlend += (this.focusTo - this.focusBlend) * Math.min(1, dt * 2.5);
    if (this.focusTo === 1 && !this.dragging) {
      // Fly around to the corner along the shortest way
      const diff = Math.atan2(Math.sin(this.focusAzimuth - this.azimuth), Math.cos(this.focusAzimuth - this.azimuth));
      this.azimuth += diff * Math.min(1, dt * 2.5);
      this.lastInteraction = t;
    } else if (!this.dragging) {
      // Inertia, then a slow auto-rotation when nobody touches the scene
      this.azimuth += this.velocity * dt * 1000;
      this.velocity *= Math.pow(0.04, dt);
      if (t - this.lastInteraction > 3) this.azimuth += dt * 0.12;
    }

    const pos = this.snow.geometry.attributes['position'] as THREE.BufferAttribute;
    const fall = TreeWorld.SNOWFALL[this.snowLevel];
    // Gusts: in a blizzard the wind comes in waves
    const gust = fall.wind * (0.6 + 0.4 * Math.sin(t * 0.7));
    for (let i = 0; i < fall.count; i++) {
      let y = pos.getY(i) - dt * (0.5 + (i % 5) * 0.08) * fall.speed;
      let x = pos.getX(i) + Math.sin(t + i) * dt * 0.08 + gust * dt * (0.7 + (i % 3) * 0.3);
      if (y < 0) y += 14;
      if (x > 13) x -= 26;
      pos.setX(i, x);
      pos.setY(i, y);
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
    this.version++;
    this.models.dispose();
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
