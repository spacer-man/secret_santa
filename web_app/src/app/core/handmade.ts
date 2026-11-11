import { Injectable } from '@angular/core';

/**
 * Hand-made look of the "paper sheet" interface: frames, rules, stamps and
 * washes are not CSS boxes but strokes drawn the way a hand draws them —
 * every point trembles a little, the pressure changes along the line, the
 * ends taper, corners overshoot, fills are laid in several uneven layers.
 *
 * The service finds the elements by the selectors in `RULES` and puts an SVG
 * layer into each one (text is never touched and stays sharp). The randomness
 * is seeded per element, so a redraw after a resize gives the same drawing.
 */

type Kind =
  | 'stamp'
  | 'ink-block'
  | 'card'
  | 'sheet-frame'
  | 'title'
  | 'underline'
  | 'top-rule'
  | 'picture'
  | 'seal'
  | 'wash'
  | 'tag'
  | 'tag-round';

/** What is drawn where. Colours come from CSS (`--hm`, see styles.scss) */
const RULES: [selector: string, kind: Kind][] = [
  ['.festive, .gift-card', 'stamp'],
  ['.btn-primary, .card-btn.price, .card-btn.primary', 'ink-block'],
  ['.btn-secondary, .shop-card', 'card'],
  ['.page', 'sheet-frame'],
  ['.card > h2, .label, .page-title', 'title'],
  ['.number, .stats b', 'underline'],
  ['.tabs, .sheet', 'top-rule'],
  ['.tree-card', 'picture'],
  ['.seal', 'seal'],
  ['.sheet-emoji, .card-icon', 'wash'],
  // Buttons over the scene: paper tags stuck onto the illustration
  ['.mandarin-chip, .decor-btn', 'tag'],
  ['.snow-btn, .zoom button', 'tag-round'],
];
const SELECTOR = RULES.map(([s]) => s).join(', ');

/** What "boils": a few variants of the drawing are shown in turn, as in drawn animation */
const BOILING = '.seal, .btn-primary';
const BOIL_VARIANTS = 4;
const BOIL_FPS = 6;

// ====== Seeded randomness ====== //
const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Smooth 1D noise in -1..1 */
const noise1 = (x: number): number => {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1;
};

type Pt = [number, number];
const r1 = (v: number): string => v.toFixed(1);

/** Catmull-Rom through the points: the trembling of the hand becomes a smooth wave */
function smooth(points: Pt[], steps = 4): Pt[] {
  const out: Pt[] = [];
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

interface Pen {
  /** Line width, px */
  w: number;
  seed: number;
  /** Trembling of the points, px */
  jit?: number;
  /** How much the ends thin out: 0 (a marker) .. 1 (a brush) */
  taper?: number;
}

/**
 * A pencil line along the points. The pencil goes over the line three times
 * (the main pass and two lighter ones beside it); in every pass the pressure
 * changes along the way — the line is now dark, now barely seen, and where
 * the hand lifts it breaks.
 */
function ribbon(raw: Pt[], pen: Pen): string {
  let out = '';
  for (let pass = 0; pass < 3; pass++) {
    const side = pass === 0 ? 0 : pass === 1 ? 1 : -1;
    out += pencilPass(
      raw,
      { ...pen, w: pen.w * (pass ? 0.55 : 1), seed: pen.seed + pass * 37.3 },
      side * pen.w * 0.42,
      pass ? 0.5 : 1,
    );
  }
  return out;
}

/** Points of the line in one piece of even pressure */
const PIECE = 4;

function pencilPass(raw: Pt[], pen: Pen, offset: number, alpha: number): string {
  const { w, seed, jit = 1.2, taper = 0.7 } = pen;
  const pts = smooth(
    raw.map(([x, y], i) => [
      x + (hash(seed * 91.7 + i * 7.13) - 0.5) * 2 * jit,
      y + (hash(seed * 53.3 + i * 11.9) - 0.5) * 2 * jit,
    ]),
  );
  const n = pts.length;
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    const s = i / (n - 1);
    // The pencil comes down over the first 14% of the line and lifts over the last 16%
    const env = Math.min(1, s / 0.14, (1 - s) / 0.16);
    const press = noise1(i * 0.21 + seed * 1.9);
    const half = (w / 2) * (1 - taper + taper * env) * (0.85 + 0.3 * press);
    const cx = pts[i][0] + nx * offset;
    const cy = pts[i][1] + ny * offset;
    left.push(`${r1(cx + nx * half)} ${r1(cy + ny * half)}`);
    right.push(`${r1(cx - nx * half)} ${r1(cy - ny * half)}`);
  }
  let out = '';
  for (let i0 = 0; i0 < n - 1; i0 += PIECE) {
    const i1 = Math.min(n - 1, i0 + PIECE);
    // Pressure of this piece: light pieces fade, the lightest are gaps
    const press = 0.7 * noise1(i0 * 0.085 + seed * 2.7) + 0.3 * noise1(i0 * 0.45 + seed * 6.1);
    if (press < -0.5) continue;
    const opacity = alpha * Math.max(0.16, Math.min(1, 0.62 + 0.75 * press));
    const l = left.slice(i0, i1 + 1);
    const r = right.slice(i0, i1 + 1).reverse();
    out += `<path class="hm-fill" opacity="${opacity.toFixed(2)}" d="M${l.join('L')}L${r.join('L')}Z"/>`;
  }
  return out;
}

/** A straight line drawn by hand: points every ~16 px, a slight slope */
function line(x0: number, y0: number, x1: number, y1: number, pen: Pen): string {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.round(len / 16));
  const tilt = (hash(pen.seed * 3.7) - 0.5) * Math.min(3, len * 0.012);
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + tilt * (t - 0.5)]);
  }
  return ribbon(pts, pen);
}

/** A frame of four separate strokes: each one overshoots the corners, as a ruler-less hand does */
function frame(w: number, h: number, inset: number, over: number, pen: Pen): string {
  const o = (k: number) => over * (0.35 + hash(pen.seed * 17.3 + k * 5.7));
  const [l, t, r, b] = [inset, inset, w - inset, h - inset];
  return [
    line(l - o(1), t, r + o(2), t, { ...pen, seed: pen.seed + 1 }),
    line(r, t - o(3), r, b + o(4), { ...pen, seed: pen.seed + 2 }),
    line(r + o(5), b, l - o(6), b, { ...pen, seed: pen.seed + 3 }),
    line(l, b + o(7), l, t - o(8), { ...pen, seed: pen.seed + 4 }),
  ].join('');
}

/** A closed uneven shape through the points (for fills) */
function blob(points: Pt[]): string {
  const n = points.length;
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(points[n - 1], points[0]);
  let d = `M${r1(start[0])} ${r1(start[1])}`;
  for (let i = 0; i < n; i++) {
    const m = mid(points[i], points[(i + 1) % n]);
    d += `Q${r1(points[i][0])} ${r1(points[i][1])} ${r1(m[0])} ${r1(m[1])}`;
  }
  return d + 'Z';
}

/** A rectangle filled by a brush: its edge wanders by `amp` px */
function inkRect(w: number, h: number, amp: number, seed: number, grow = 0): string {
  const pts: Pt[] = [];
  const step = 11;
  const edge = (x0: number, y0: number, x1: number, y1: number, k: number) => {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const j = noise1(i * 0.9 + seed * 7.7 + k * 31) * amp;
      // Push along the normal of the edge (k: 0 top, 1 right, 2 bottom, 3 left)
      const nx = k === 1 ? 1 : k === 3 ? -1 : 0;
      const ny = k === 0 ? -1 : k === 2 ? 1 : 0;
      pts.push([x0 + (x1 - x0) * t + nx * (j + grow), y0 + (y1 - y0) * t + ny * (j + grow)]);
    }
  };
  edge(0, 0, w, 0, 0);
  edge(w, 0, w, h, 1);
  edge(w, h, 0, h, 2);
  edge(0, h, 0, 0, 3);
  return blob(pts);
}

/** A watercolour blot: an ellipse with an uneven radius */
function blot(cx: number, cy: number, rx: number, ry: number, seed: number): string {
  const n = 14;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const k = 1 + 0.17 * noise1(i * 0.8 + seed * 5.3);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return blob(pts);
}

/** A ring drawn in one go: it starts anywhere and closes with an overlap */
function ring(cx: number, cy: number, r: number, pen: Pen): string {
  const start = -2.3 + hash(pen.seed * 2.9) * 0.8;
  const turns = Math.PI * 2 * 1.07;
  const n = Math.max(12, Math.round(r / 1.4));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = start + (i / n) * turns;
    const k = 1 + 0.03 * Math.sin(3 * a + pen.seed);
    pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
  }
  return ribbon(pts, { ...pen, jit: 0.5 });
}

const path = (d: string, cls: string, extra = ''): string =>
  `<path class="${cls}" d="${d}"${extra}/>`;

/** Three uneven layers of paint, shifted against each other, and a darker pooled edge */
function paint(shape: (seed: number, k: number) => string, seed: number, alpha: number): string {
  let out = '';
  for (let k = 0; k < 3; k++) {
    const dx = (hash(seed * 3.3 + k * 9.1) - 0.5) * 5;
    const dy = (hash(seed * 4.7 + k * 6.3) - 0.5) * 4;
    out += path(
      shape(seed + k * 13, k),
      'hm-fill',
      ` opacity="${alpha}" transform="translate(${r1(dx)} ${r1(dy)})"`,
    );
  }
  return out + path(shape(seed, 0), 'hm-edge', ` opacity="${Math.min(1, alpha * 0.9)}"`);
}

/**
 * How coloured areas are filled: 'hatch' — pencil hatching, 'wash' — layers of watercolour.
 * `?fill=wash` in the URL switches to the watercolour for comparison.
 */
const FILL: 'hatch' | 'wash' =
  new URLSearchParams(location.search).get('fill') === 'wash' ? 'wash' : 'hatch';

interface Hatch {
  /** Direction of the strokes, degrees */
  angle: number;
  /** Distance between the strokes, px */
  gap: number;
  /** Width of a stroke, px */
  lw: number;
  alpha: number;
  seed: number;
}

/**
 * Pencil hatching of a rectangle or of an ellipse inscribed into it: parallel
 * strokes of uneven pressure; each one starts and ends a little off the edge,
 * bends slightly, and now and then the hand skips a stroke
 */
function hatch(w: number, h: number, round: boolean, o: Hatch): string {
  const a = (o.angle * Math.PI) / 180;
  const [dx, dy] = [Math.cos(a), Math.sin(a)];
  const [nx, ny] = [-dy, dx];
  const [cx, cy] = [w / 2, h / 2];
  const reach = Math.abs(nx) * cx + Math.abs(ny) * cy;
  let out = '';
  let k = 0;
  for (let t = -reach; t <= reach; k++) {
    const step = o.gap * (0.7 + 0.6 * hash(o.seed * 5.1 + k * 3.7));
    const [px, py] = [cx + nx * t, cy + ny * t];
    t += step;
    // The part of the line inside the shape: s0..s1 along the direction
    let s0: number;
    let s1: number;
    if (round) {
      const [ex, ey] = [(px - cx) / cx, (py - cy) / cy];
      const [fx, fy] = [dx / cx, dy / cy];
      const A = fx * fx + fy * fy;
      const B = 2 * (ex * fx + ey * fy);
      const D = B * B - 4 * A * (ex * ex + ey * ey - 1);
      if (D <= 0) continue;
      s0 = (-B - Math.sqrt(D)) / (2 * A);
      s1 = (-B + Math.sqrt(D)) / (2 * A);
    } else {
      s0 = -Infinity;
      s1 = Infinity;
      for (const [p, d, max] of [
        [px, dx, w],
        [py, dy, h],
      ]) {
        if (Math.abs(d) < 1e-6) {
          if (p < 0 || p > max) s0 = Infinity;
          continue;
        }
        const [u, v] = [(0 - p) / d, (max - p) / d];
        s0 = Math.max(s0, Math.min(u, v));
        s1 = Math.min(s1, Math.max(u, v));
      }
      if (!(s1 > s0)) continue;
    }
    if (hash(o.seed * 9.3 + k * 1.9) < 0.035) continue; // a skipped stroke
    // Uneven ends: the hand does not stop exactly at the edge
    s0 += (hash(o.seed * 2.3 + k * 7.1) - 0.6) * 5;
    s1 += (hash(o.seed * 6.7 + k * 4.3) - 0.4) * 5;
    if (s1 - s0 < 3) continue;
    const bend = (hash(o.seed * 8.9 + k * 2.3) - 0.5) * Math.min(4, (s1 - s0) * 0.04);
    const [x0, y0] = [px + dx * s0, py + dy * s0];
    const [x1, y1] = [px + dx * s1, py + dy * s1];
    const [mx, my] = [(x0 + x1) / 2 + nx * bend, (y0 + y1) / 2 + ny * bend];
    const press = noise1(k * 0.37 + o.seed * 1.3);
    const opacity = o.alpha * Math.max(0.25, Math.min(1, 0.7 + 0.5 * press));
    const width = o.lw * (0.75 + 0.5 * hash(o.seed * 4.1 + k * 5.9));
    out +=
      `<path class="hm-stroke" opacity="${opacity.toFixed(2)}" stroke-width="${r1(width)}" ` +
      `d="M${r1(x0)} ${r1(y0)}Q${r1(mx)} ${r1(my)} ${r1(x1)} ${r1(y1)}"/>`;
  }
  return out;
}

const faint = (markup: string, opacity: number): string => `<g opacity="${opacity}">${markup}</g>`;

function draw(kind: Kind, el: HTMLElement, w: number, h: number, seed: number): string {
  switch (kind) {
    case 'stamp':
      // A faint wash, a thick outer frame and a thin inner one
      return (
        (FILL === 'hatch'
          ? hatch(w, h, false, { angle: -38, gap: 14, lw: 3.4, alpha: 0.12, seed })
          : paint((s) => inkRect(w, h, 1.6, s), seed, 0.035)) +
        frame(w, h, 0, 6, { w: 2.8, seed, taper: 0.45 }) +
        faint(frame(w, h, 6, 4, { w: 1.3, seed: seed + 40, taper: 0.6 }), 0.7)
      );
    case 'ink-block':
      if (FILL === 'hatch')
        // Coloured pencil: a pale base, dense hatching, a lighter second pass across it, an outline
        return (
          path(inkRect(w, h, 1.2, seed), 'hm-fill', ' opacity="0.42"') +
          hatch(w, h, false, { angle: -42, gap: 5.2, lw: 6, alpha: 0.85, seed }) +
          hatch(w, h, false, { angle: -20, gap: 12, lw: 4.5, alpha: 0.38, seed: seed + 50 }) +
          `<g class="hm-dark">${frame(w, h, 0, 4, { w: 1.6, seed: seed + 9, taper: 0.5 })}</g>`
        );
      // The darker "shadow" print below and the block itself in three layers of ink
      return (
        path(inkRect(w, h, 1.4, seed + 70), 'hm-shade', ' transform="translate(1 3)"') +
        paint((s) => inkRect(w, h, 1.5, s), seed, 0.55)
      );
    case 'card':
      return (
        frame(w, h, 0, 5, { w: 1.9, seed, taper: 0.55 }) +
        faint(frame(w, h, 4, 3, { w: 1.1, seed: seed + 40, taper: 0.7 }), 0.45)
      );
    case 'sheet-frame':
      return frame(w, h, 5, 3, { w: 1.2, seed, taper: 0.5, jit: 0.8 });
    case 'title': {
      // Two rules on both sides of the text
      const range = document.createRange();
      range.selectNodeContents(el);
      const svg = el.querySelector(':scope > svg.hm');
      if (svg) range.setStartAfter(svg);
      const text = range.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const gap = 11;
      const y = h / 2 + 1;
      const [a, b] = [text.left - box.left - gap, text.right - box.left + gap];
      let out = '';
      if (a > 14) out += line(0, y, a, y, { w: 1.9, seed, taper: 0.8 });
      if (w - b > 14) out += line(b, y, w, y, { w: 1.9, seed: seed + 9, taper: 0.8 });
      return out;
    }
    case 'underline':
      return line(-3, h - 1, w + 3, h - 1, { w: 2.8, seed, taper: 0.75 });
    case 'top-rule':
      return line(-2, 1.5, w + 2, 1.5, { w: 3, seed, taper: 0.5, jit: 0.9 });
    case 'picture': {
      // The edge of the illustration is painted over with "paper", then framed by hand
      const m = 6;
      const outer = `M${-m} ${-m}H${w + m}V${h + m}H${-m}Z`;
      const inner = shift(inkRect(w - 6, h - 6, 1.8, seed), 3, 3);
      return (
        `<path class="hm-paper" fill-rule="evenodd" d="${outer}${inner}"/>` +
        frame(w, h, 2.5, 6, { w: 2, seed: seed + 5, taper: 0.5 })
      );
    }
    case 'seal': {
      const c = w / 2;
      return (
        ring(c, c, c - 1.5, { w: 2, seed, taper: 0.6 }) +
        ring(c, c, c - 5.5, { w: 1.2, seed: seed + 20, taper: 0.6 })
      );
    }
    case 'wash':
      if (FILL === 'hatch')
        return (
          hatch(w, h, true, { angle: -40, gap: 6.5, lw: 4.4, alpha: 0.42, seed }) +
          hatch(w, h, true, { angle: 24, gap: 13, lw: 3.4, alpha: 0.2, seed: seed + 50 })
        );
      return paint(
        (s, k) => blot(w / 2, h / 2, w * 0.42 * (1 - k * 0.06), h * 0.4 * (1 - k * 0.05), s),
        seed,
        0.14,
      );
    case 'tag':
      // A slip of paper stuck onto the picture
      return (
        path(inkRect(w, h, 1.1, seed), 'hm-paper') +
        frame(w, h, 1, 3, { w: 1.5, seed: seed + 3, taper: 0.5, jit: 0.8 })
      );
    case 'tag-round': {
      const c = w / 2;
      return (
        path(blot(c, h / 2, c, h / 2, seed), 'hm-paper') +
        ring(c, h / 2, c - 1.5, { w: 1.5, seed: seed + 3, taper: 0.5 })
      );
    }
  }
}

/** Moves a path made of absolute "x y" pairs */
function shift(d: string, dx: number, dy: number): string {
  return d.replace(/(-?\d+\.?\d*) (-?\d+\.?\d*)/g, (_, x: string, y: string) => {
    return `${r1(Number(x) + dx)} ${r1(Number(y) + dy)}`;
  });
}

interface Drawing {
  kind: Kind;
  seed: number;
  svg: SVGSVGElement;
  size: string;
  boils: boolean;
}

@Injectable({ providedIn: 'root' })
export class Handmade {
  private readonly drawings = new Map<HTMLElement, Drawing>();
  // Redraw on the next frame: changing the drawing inside the callback makes the observer loop
  private readonly resizes = new ResizeObserver((entries) =>
    requestAnimationFrame(() => entries.forEach((e) => this.redraw(e.target as HTMLElement))),
  );
  private counter = 0;
  private queued = false;
  private boilFrame = 0;

  start(): void {
    document.documentElement.dataset['fill'] = FILL;
    // Grain of the pencil lead and of the ink: tiny bald spots all over the drawing
    document.body.insertAdjacentHTML(
      'beforeend',
      `<svg class="hm-defs" width="0" height="0" aria-hidden="true"><filter id="hm-grain" x="-5%" y="-60%" width="110%" height="220%">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="5" result="n"/>
        <feColorMatrix in="n" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 1.95" result="spots"/>
        <feComposite in="SourceGraphic" in2="spots" operator="in"/>
      </filter><filter id="hm-ink" x="-5%" y="-20%" width="110%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="8" result="n"/>
        <feColorMatrix in="n" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.62" result="spots"/>
        <feComposite in="SourceGraphic" in2="spots" operator="in"/>
      </filter></svg>`,
    );
    new MutationObserver(() => this.schedule()).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    document.fonts?.ready.then(() => this.drawings.forEach((_, el) => this.redraw(el, true)));
    this.schedule();

    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!calm) setInterval(() => this.boil(), 1000 / BOIL_FPS);
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.scan();
    });
  }

  private scan(): void {
    // Forget what has left the page
    this.drawings.forEach((_, el) => {
      if (!el.isConnected) {
        this.resizes.unobserve(el);
        this.drawings.delete(el);
      }
    });
    document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
      const known = this.drawings.get(el);
      if (known) {
        // Titles depend on their text: redraw when it changes
        if (known.kind === 'title') this.redraw(el);
        return;
      }
      const kind = RULES.find(([s]) => el.matches(s))![1];
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', `hm hm-${kind}`);
      svg.setAttribute('aria-hidden', 'true');
      el.classList.add('hm-host');
      // The drawing is placed against its element (absolute/fixed elements already are a frame)
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      if (kind === 'picture') el.append(svg);
      else el.prepend(svg);
      this.drawings.set(el, {
        kind,
        seed: ++this.counter * 17.7,
        svg,
        size: '',
        boils: el.matches(BOILING),
      });
      this.resizes.observe(el);
      this.redraw(el);
    });
  }

  private redraw(el: HTMLElement, force = false): void {
    const d = this.drawings.get(el);
    if (!d) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h) return;
    const textKey = d.kind === 'title' ? (el.textContent ?? '') : '';
    const size = `${w}x${h}|${textKey}`;
    if (size === d.size && !force) return;
    d.size = size;
    d.svg.setAttribute('width', String(w));
    d.svg.setAttribute('height', String(h));
    d.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    if (d.boils) {
      let html = '';
      for (let v = 0; v < BOIL_VARIANTS; v++)
        html += `<g class="hm-v"${v ? ' style="display:none"' : ''}>${draw(d.kind, el, w, h, d.seed + v * 101)}</g>`;
      d.svg.innerHTML = html;
    } else d.svg.innerHTML = draw(d.kind, el, w, h, d.seed);
  }

  /** Line boil: the drawings that "live" switch to their next variant */
  private boil(): void {
    if (document.hidden) return;
    this.boilFrame++;
    this.drawings.forEach((d) => {
      if (!d.boils) return;
      const groups = d.svg.children;
      for (let i = 0; i < groups.length; i++)
        (groups[i] as SVGElement).style.display =
          i === this.boilFrame % groups.length ? '' : 'none';
    });
  }
}
