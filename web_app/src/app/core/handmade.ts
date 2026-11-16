import { Injectable } from '@angular/core';
import { TUNING } from './tuning';

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
  | 'tag-round'
  | 'light'
  | 'bar-track'
  | 'bar-fill'
  | 'note'
  | 'chip'
  | 'rule'
  | 'field'
  | 'doodle';

/** What is drawn where. Colours come from CSS (`--hm`, see styles.scss) */
const RULES: [selector: string, kind: Kind][] = [
  ['.festive, .gift-card', 'stamp'],
  // Filled buttons and marks: pencil hatching
  ['.btn-primary, .card-btn.price, .card-btn.primary, .shop-tab-mark, .toast', 'ink-block'],
  // Dashed-looking secondary actions: one light line
  ['.btn-ghost', 'light'],
  // Quiet buttons of the shop (cancel, remove): a pale hatching, softer than the price
  ['.card-btn.quiet', 'chip'],
  // Framed things: buttons, options to choose from, cards
  [
    '.btn-secondary, .shop-card, .card-btn, .snow-mode, .reaction, .pattern-btn, .shop-set, .theme-toggle, .mascot-opt, .choice',
    'card',
  ],
  ['.page', 'sheet-frame'],
  ['.card > h2, .label, .page-title', 'title'],
  ['.number, .stats b, .tabs a.active, .step-no', 'underline'],
  ['.sheet h3, .earn li, .card.row, .steps li, .facts li', 'rule'],
  ['.tabs, .sheet', 'top-rule'],
  ['.tree-card', 'picture'],
  ['.seal', 'seal'],
  ['.sheet-emoji, .card-icon, .hero-emoji, .rule-icon', 'wash'],
  // Progress: a pencil line and a hatched part of it
  ['.level-bar, .wave .bar, .friends-bar, .load-bar', 'bar-track'],
  ['.level-bar > span, .wave .bar > span, .friends-bar > span, .load-bar > span', 'bar-fill'],
  // Little pictures drawn in pencil (the loading screen): data-doodle = snowflake | star | fir
  ['.doodle', 'doodle'],
  // Bigger tinted areas: a watercolour wash (quotes, hints, the row of the user)
  [
    '.quote, blockquote, .idea, .designer, .wave li.mine, .shop-tabs, .mascot-bubble, .merge, .ios-push, .place-ask',
    'note',
  ],
  ['.badge, .chip', 'chip'],
  // Form fields cannot hold a drawing inside: it is laid over them
  ['.select, .textarea, .input', 'field'],
  // Buttons over the scene: paper tags stuck onto the illustration
  ['.mandarin-chip, .decor-btn', 'tag'],
  ['.snow-btn, .zoom button', 'tag-round'],
];
const SELECTOR = RULES.map(([s]) => s).join(', ');
const kindOf = (el: Element): Kind | undefined => RULES.find(([s]) => el.matches(s))?.[1];

/** Kinds whose drawing replaces the CSS box of the element (its background and border are switched off) */
const BARE: Kind[] = ['ink-block', 'card', 'light', 'bar-track', 'bar-fill', 'note', 'chip'];

/** Classes that change how an element is drawn */
const STATES = ['selected', 'active', 'done', 'mine', 'locked'];

/** What "boils": a few variants of the drawing are shown in turn, as in drawn animation */
const BOILING = '.seal, .btn-primary, .doodle, .load-bar, .load-bar > span';
/**
 * Boiling that must not stop while the page is busy (the loading screen of the scene):
 * every variant is its own layer and CSS switches them (the compositor does it, not a timer)
 */
const FREE_BOIL = '.doodle, .load-bar, .load-bar > span';
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

/**
 * Points of the drawn line per point of the hand: dense enough for an uneven edge
 * (about one every 2.5 px); the noise along the line is counted in the old, sparser points
 */
const DENSE = 6;
const SPARSE = 4 / DENSE;
/** Points of the line in one piece of even pressure */
const PIECE = 6;
/**
 * How much the edge of a line wanders (a share of its half-width, and a bit in px on top) and
 * how slowly: the edge is a gentle wave, not teeth — a pencil line is soft, not torn
 */
const EDGE = 0.3;
const EDGE_PX = 0.42;
const EDGE_WAVE = 0.4;

function pencilPass(raw: Pt[], pen: Pen, offset: number, alpha: number): string {
  const { w, seed, jit = 1.2, taper = 0.7 } = pen;
  const pts = smooth(
    raw.map(([x, y], i) => [
      x + (hash(seed * 91.7 + i * 7.13) - 0.5) * 2 * jit,
      y + (hash(seed * 53.3 + i * 11.9) - 0.5) * 2 * jit,
    ]),
    DENSE,
  );
  const n = pts.length;
  const left: string[] = [];
  const right: string[] = [];
  /** Half the width of the line at every point (the radius of a round end there) */
  const radius: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    const s = i / (n - 1);
    // The pencil comes down over the first 14% of the line and lifts over the last 16%
    const env = Math.min(1, s / 0.14, (1 - s) / 0.16);
    const press = noise1(i * SPARSE * 0.21 + seed * 1.9);
    const half = (w / 2) * (1 - taper + taper * env) * (0.85 + 0.3 * press);
    // The edge of a pencil line is never even: each side wanders on its own, smoothly
    const edge = (side: number): number => {
      const v = noise1(i * EDGE_WAVE + seed * 13.7 + side * 57.7);
      return Math.max(0.12, half * (1 + EDGE * v) + EDGE_PX * v);
    };
    const [hl, hr] = [edge(0), edge(1)];
    const cx = pts[i][0] + nx * offset;
    const cy = pts[i][1] + ny * offset;
    left.push(`${r1(cx + nx * hl)} ${r1(cy + ny * hl)}`);
    right.push(`${r1(cx - nx * hr)} ${r1(cy - ny * hr)}`);
    radius.push((hl + hr) / 2);
  }
  // Pressure of a piece: light pieces fade, the lightest are gaps
  const pressAt = (i0: number): number =>
    0.7 * noise1(i0 * SPARSE * 0.085 + seed * 2.7) + 0.3 * noise1(i0 * SPARSE * 0.45 + seed * 6.1);
  const drawn = (i0: number): boolean => i0 >= 0 && i0 < n - 1 && pressAt(i0) >= -0.5;
  let out = '';
  for (let i0 = 0; i0 < n - 1; i0 += PIECE) {
    if (!drawn(i0)) continue;
    const i1 = Math.min(n - 1, i0 + PIECE);
    const opacity = alpha * Math.max(0.16, Math.min(1, 0.62 + 0.75 * pressAt(i0)));
    const l = left.slice(i0, i1 + 1);
    const r = right.slice(i0, i1 + 1).reverse();
    // Where the pencil came down or lifted the end is round (a lead has no corners);
    // between two pieces it stays flat, or they would overlap into a darker spot
    const arc = (i: number): string => `A${r1(radius[i])} ${r1(radius[i])} 0 0 0 `;
    const end = drawn(i0 + PIECE) ? 'L' : arc(i1);
    const start = drawn(i0 - PIECE) ? '' : arc(i0) + l[0];
    out +=
      `<path class="hm-fill hm-pencil" opacity="${opacity.toFixed(2)}" ` +
      `d="M${l.join('L')}${end}${r.join('L')}${start}Z"/>`;
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

interface Hatch {
  /** Direction of the strokes, degrees */
  angle: number;
  /** Distance between the strokes, px */
  gap: number;
  /** Width of a stroke, px */
  lw: number;
  alpha: number;
  seed: number;
  /** How much every stroke may turn away from the common direction, degrees (default 2.5) */
  wobble?: number;
  /** The hatched area is this much bigger than the element on every side, px */
  grow?: number;
}

/**
 * Pencil hatching of a rectangle or of an ellipse inscribed into it: parallel
 * strokes of uneven pressure; each one starts and ends a little off the edge,
 * bends slightly, and now and then the hand skips a stroke
 */
function hatch(w0: number, h0: number, round: boolean, o: Hatch): string {
  const grow = o.grow ?? 0;
  const [w, h] = [w0 + grow * 2, h0 + grow * 2];
  const wobble = ((o.wobble ?? 2.5) * Math.PI) / 180;
  const a = (o.angle * Math.PI) / 180;
  const [dx, dy] = [Math.cos(a), Math.sin(a)];
  const [nx, ny] = [-dy, dx];
  const [cx, cy] = [w / 2, h / 2];
  const reach = Math.abs(nx) * cx + Math.abs(ny) * cy;
  // Strokes as [from, bend, to]
  const strokes: [Pt, Pt, Pt][] = [];
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
    // The hand keeps one direction, but never exactly: the stroke turns a little about its middle
    const turn = (hash(o.seed * 7.7 + k * 3.1) - 0.5) * 2 * wobble;
    const [tx, ty] = [Math.cos(a + turn), Math.sin(a + turn)];
    const [sm, half] = [(s0 + s1) / 2, (s1 - s0) / 2];
    const [qx, qy] = [px + dx * sm, py + dy * sm];
    const [x0, y0] = [qx - tx * half, qy - ty * half];
    const [x1, y1] = [qx + tx * half, qy + ty * half];
    const [mx, my] = [qx + nx * bend, qy + ny * bend];
    strokes.push([
      [x0, y0],
      [mx, my],
      [x1, y1],
    ]);
  }
  // The pencil is not lifted: it goes there and back, stroke after stroke, as one zigzag line.
  // The line is cut into pieces of a few strokes, each with its own pressure (tone and width);
  // they are also what the drawing animation shows one after another.
  let out = '';
  // A piece is drawn as three copies of the line: two wide faint ones and the body over them
  // (see below). Each copy goes its own slightly wavy way, so the soft edge of a stroke is
  // uneven too: wider here, narrower there, as the hand and the paper make it.
  const ds = ['', '', ''];
  const sway = [1.05, 0.8, 0.4];
  const p = (pt: Pt) => `${r1(pt[0])} ${r1(pt[1])}`;
  /** A stroke from `a0` to `a1` bent through `bend`, as points every ~13 px that sway aside */
  const wavy = (a0: Pt, bend: Pt, a1: Pt, copy: number, i: number): string => {
    const len = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
    const [nx, ny] = [-(a1[1] - a0[1]) / len, (a1[0] - a0[0]) / len];
    const n = Math.max(2, Math.round(len / 13));
    let path = '';
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      // No sway at the ends: there the copies meet in the turn to the next stroke
      const off =
        noise1(k * 0.8 + i * 7.3 + copy * 31.7 + o.seed * 2.9) *
        sway[copy] *
        Math.min(1, t * 4, u * 4);
      path += `L${p([
        u * u * a0[0] + 2 * u * t * bend[0] + t * t * a1[0] + nx * off,
        u * u * a0[1] + 2 * u * t * bend[1] + t * t * a1[1] + ny * off,
      ])}`;
    }
    return path;
  };
  const ends = (i: number): [Pt, Pt] => {
    const [from, , to] = strokes[i];
    return i % 2 ? [to, from] : [from, to];
  };
  strokes.forEach(([, bend], i) => {
    const [a0, a1] = ends(i);
    ds.forEach((d, copy) => {
      ds[copy] = (d || `M${p(a0)}`) + wavy(a0, bend, a1, copy, i);
    });
    const last = i === strokes.length - 1;
    let next = a1;
    if (!last) {
      // A round turn beyond the edge into the next stroke: no sharp corner, no crease
      [next] = ends(i + 1);
      const len = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
      const reach = Math.min(o.gap * 0.9, 7);
      const [ux, uy] = [((a1[0] - a0[0]) / len) * reach, ((a1[1] - a0[1]) / len) * reach];
      const turn = `C${p([a1[0] + ux, a1[1] + uy])} ${p([next[0] + ux, next[1] + uy])} ${p(next)}`;
      ds.forEach((_, copy) => (ds[copy] += turn));
    }
    if ((i + 1) % HATCH_PIECE && !last) return;
    const piece = Math.floor(i / HATCH_PIECE);
    // The pressure changes from piece to piece only slightly and never for long:
    // a big difference reads as a pass of the pencil that stopped halfway
    const press = noise1(piece * 2.3 + o.seed * 1.3);
    const opacity = o.alpha * Math.max(0.78, Math.min(1, 0.9 + 0.14 * press));
    const width = o.lw * (0.8 + 0.4 * hash(o.seed * 4.1 + piece * 5.9));
    // The two free ends of the whole line are round (the pieces in between join flat)
    const body = Math.max(1, width - 1.4);
    let caps = '';
    const cap = (at: Pt, toward: Pt, sweep: number): void => {
      const len = Math.hypot(toward[0] - at[0], toward[1] - at[1]) || 1;
      const [ex, ey] = [
        (-(toward[1] - at[1]) / len) * (body / 2),
        ((toward[0] - at[0]) / len) * (body / 2),
      ];
      caps +=
        `<path class="hm-fill hm-cap" style="--i:${seq}" ` +
        `d="M${p([at[0] + ex, at[1] + ey])}A${r1(body / 2)} ${r1(body / 2)} 0 0 ${sweep} ` +
        `${p([at[0] - ex, at[1] - ey])}Z"/>`;
    };
    if (piece === 0) cap(ends(0)[0], strokes[0][1], 1);
    if (last) cap(a1, [2 * a1[0] - bend[0], 2 * a1[1] - bend[1]], 0);
    // The tone of a pencil stroke weakens towards its edge: around the body lie two wider
    // and fainter copies of the line. One group, so that pieces do not darken each other.
    const layer = (copy: number, w: number, tone: number): string =>
      `<path class="hm-stroke hm-seq" pathLength="1" style="--i:${seq}" ` +
      `opacity="${tone}" stroke-width="${r1(w)}" d="${ds[copy]}"/>`;
    out +=
      `<g opacity="${opacity.toFixed(2)}">` +
      layer(0, width + 0.4, 0.2) +
      layer(1, width - 0.5, 0.42) +
      layer(2, body, 1) +
      caps +
      `</g>`;
    seq++;
    // The next piece starts where this one ended: at the beginning of a stroke, heading along it
    ds.fill(`M${p(next)}`);
  });
  return grow ? `<g transform="translate(${-grow} ${-grow})">${out}</g>` : out;
}

/** Strokes of the hatching in one piece of even pressure */
const HATCH_PIECE = 3;

/** Counter of the pieces of a drawing, in the order the pencil makes them (for the drawing animation) */
let seq = 0;

const faint = (markup: string, opacity: number): string => `<g opacity="${opacity}">${markup}</g>`;

/**
 * @param press the element is being pressed: the drawing "spreads" — it is a bit
 * bigger and bolder, as if the paint ran under the finger
 */
function draw(
  kind: Kind,
  el: HTMLElement,
  w: number,
  h: number,
  seed: number,
  press = false,
): string {
  const bold = press ? 1.4 : 1;
  switch (kind) {
    case 'stamp':
      // A big area: a faint watercolour wash, a thick outer frame and a thin inner one
      return (
        paint((s) => inkRect(w, h, 1.6, s), seed, 0.035) +
        frame(w, h, 0, 6, { w: 2.8, seed, taper: 0.45 }) +
        faint(frame(w, h, 6, 4, { w: 1.3, seed: seed + 40, taper: 0.6 }), 0.7)
      );
    case 'ink-block': {
      // Coloured pencil: a pale base, wide hatching in one direction (twice), an outline
      const grow = press ? 3 : 0;
      const angle = -42 + (hash(seed * 1.7) - 0.5) * 6;
      return (
        path(inkRect(w, h, 1.2, seed, grow), 'hm-fill', ` opacity="${press ? 0.6 : 0.42}"`) +
        hatch(w, h, false, { angle, gap: 5.2, lw: 6 * bold, alpha: 0.85, seed, grow }) +
        hatch(w, h, false, {
          angle: angle + 1.5,
          gap: 12,
          lw: 4.5 * bold,
          alpha: 0.38,
          seed: seed + 50,
          grow,
        }) +
        `<g class="hm-dark">${frame(w, h, -grow, 4, { w: 1.6 * bold, seed: seed + 9, taper: 0.5 })}</g>`
      );
    }
    case 'card':
      return (
        (press ? hatch(w, h, false, { angle: -42, gap: 9, lw: 5, alpha: 0.14, seed }) : '') +
        frame(w, h, 0, 5, { w: 1.9 * bold, seed, taper: 0.55 }) +
        faint(frame(w, h, 4, 3, { w: 1.1 * bold, seed: seed + 40, taper: 0.7 }), 0.45) +
        // The chosen option is circled, as one circles an answer with a pencil
        (el.matches('.selected')
          ? scribble(w, h, false, seed + 5)
              .map(
                (piece) =>
                  `<path class="hm-ring" stroke-width="${r1(Math.min(6, Math.max(3.5, h * 0.09)))}" d="${piece}"/>`,
              )
              .join('')
          : '')
      );
    case 'light':
      return faint(frame(w, h, 0, 3, { w: 1.4 * bold, seed, taper: 0.6 }), 0.8);
    case 'bar-track':
      return faint(
        line(0, h / 2, w, h / 2, { w: Math.max(1.6, h * 0.3), seed, taper: 0.3, jit: 0.6 }),
        0.55,
      );
    case 'bar-fill':
      return hatch(w, h, false, { angle: -58, gap: 3.4, lw: 3.6, alpha: 0.95, seed });
    case 'note':
      return (
        paint((sd) => inkRect(w, h, 1.4, sd), seed, 0.045) +
        (el.matches('blockquote, .idea, .mine')
          ? line(1, -2, 1, h + 2, { w: 3, seed: seed + 4, taper: 0.5, jit: 0.7 })
          : '')
      );
    case 'chip':
      return hatch(w, h, false, { angle: -42, gap: 4.6, lw: 4.8, alpha: 0.3, seed });
    case 'rule':
      return line(0, h - 0.5, w, h - 0.5, { w: 1.4, seed, taper: 0.6, jit: 0.7 });
    case 'field':
      return frame(w, h, 0, 4, { w: 1.7, seed, taper: 0.5 });
    case 'doodle':
      return doodle(el.dataset['doodle'] ?? 'star', w, h, seed);
    case 'sheet-frame':
      return (
        `<g class="hm-frost">${frost(w, h, seed)}</g>` +
        frame(w, h, 5, 3, { w: 1.2, seed, taper: 0.5, jit: 0.8 })
      );
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
    case 'wash': {
      // Behind the figures of the shop the hatching goes round (two directions), elsewhere one
      const cross = el.matches('.card-icon');
      return (
        hatch(w, h, true, { angle: -40, gap: 6.5, lw: 4.4, alpha: 0.42, seed }) +
        hatch(w, h, true, {
          angle: cross ? 24 : -38.5,
          gap: 13,
          lw: 3.4,
          alpha: 0.2,
          seed: seed + 50,
        })
      );
    }
    case 'tag': {
      // A slip of paper stuck onto the picture
      const grow = press ? 2 : 0;
      return (
        path(inkRect(w, h, 1.1, seed, grow), 'hm-paper') +
        frame(w, h, 1 - grow, 3, { w: 1.5 * bold, seed: seed + 3, taper: 0.5, jit: 0.8 })
      );
    }
    case 'tag-round': {
      const c = w / 2;
      const grow = press ? 2 : 0;
      return (
        path(blot(c, h / 2, c + grow, h / 2 + grow, seed), 'hm-paper') +
        ring(c, h / 2, c - 1.5 + grow, { w: 1.5 * bold, seed: seed + 3, taper: 0.5 })
      );
    }
  }
}

// ====== Frost on the sheet ====== //

/**
 * Ice lines collected by thickness: thousands of fine needles go into a few
 * `<path>` elements (one per thickness), so the frost costs almost nothing to draw.
 */
class Ice {
  private readonly d: string[] = ['', '', ''];
  constructor(private readonly seed: number) {}

  /** A needle from (x, y) in direction `a`; `size` 0 (finest) .. 2 (a stem) */
  needle(x: number, y: number, a: number, len: number, size: 0 | 1 | 2, seed: number): void {
    // A long needle bends very slightly, as a hand-drawn line does
    const bend = len > 14 ? (hash(seed * 5.1 + this.seed) - 0.5) * len * 0.08 : 0;
    const mx = x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend;
    const my = y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    this.d[size] +=
      `M${r1(x)} ${r1(y)}Q${r1(2 * mx - (x + ex) / 2)} ${r1(2 * my - (y + ey) / 2)} ${r1(ex)} ${r1(ey)}`;
  }

  toString(): string {
    const widths = [0.7, 1.05, 1.5];
    const alphas = [0.55, 0.75, 0.9];
    return this.d
      .map((d, i) =>
        d
          ? `<path class="hm-stroke" stroke-width="${widths[i]}" opacity="${alphas[i]}" d="${d}"/>`
          : '',
      )
      .join('');
  }
}

/**
 * A frost feather, as on a window pane: a stem with dense needles on both
 * sides at ~60°, shorter towards the tip; the big needles have needles of their own.
 */
function feather(
  ice: Ice,
  x: number,
  y: number,
  a: number,
  len: number,
  depth: number,
  seed: number,
) {
  ice.needle(x, y, a, len, depth >= 2 ? 2 : depth === 1 ? 1 : 0, seed);
  if (depth === 0 || len < 8) return;
  const gap = depth >= 2 ? 7 : 4.5;
  const spread = 1.0 + (hash(seed * 1.9) - 0.5) * 0.2;
  for (let t = gap / len + 0.06; t < 0.94; t += gap / len) {
    const px = x + Math.cos(a) * len * t;
    const py = y + Math.sin(a) * len * t;
    // Needles get shorter towards the tip; a little randomness keeps it alive
    const sub = len * (depth >= 2 ? 0.36 : 0.3) * (1 - t) * (0.7 + hash(seed * 3.7 + t * 91) * 0.6);
    for (const side of [1, -1]) {
      const turn = side * (spread + (hash(seed * 5.3 + t * 57 + side) - 0.5) * 0.2);
      if (sub >= 3) feather(ice, px, py, a + turn, sub, depth - 1, seed + t * 31 + side * 7);
    }
  }
}

/** Frost creeping in from a corner of the sheet; `a` is the direction into the sheet */
function cornerFrost(ice: Ice, x: number, y: number, a: number, size: number, seed: number) {
  const stems = 3;
  for (let i = 0; i < stems; i++) {
    // A fan of feathers; the middle one is the longest
    const k = i / (stems - 1) - 0.5;
    const dir = a + k * 1.25 + (hash(seed + i * 4.1) - 0.5) * 0.2;
    const len = size * (1 - Math.abs(k) * 0.55) * (0.85 + hash(seed * 2.2 + i) * 0.3);
    feather(ice, x, y, dir, len, 2, seed + i * 31.7);
  }
  // A few loose crystals in front of the feathers
  for (let i = 0; i < 3; i++) {
    const d = size * (0.9 + hash(seed * 6.1 + i) * 0.35);
    const b = a + (hash(seed * 8.3 + i) - 0.5) * 1.3;
    snowflake(
      ice,
      x + Math.cos(b) * d,
      y + Math.sin(b) * d,
      4 + hash(seed + i) * 3,
      seed + i * 9.9,
    );
  }
}

/** A six-armed snowflake: a dendrite with twigs, a star with a hexagon, or a star with short rays */
function snowflake(ice: Ice, cx: number, cy: number, r: number, seed: number): void {
  const kind = Math.floor(hash(seed * 6.6) * 3);
  const rot = hash(seed * 8.8) * Math.PI;
  const big = r > 9;
  for (let k = 0; k < 6; k++) {
    const a = rot + (k * Math.PI) / 3;
    const s = seed + k * 3.3;
    ice.needle(cx, cy, a, r, big ? 2 : 1, s);
    const at = (t: number): Pt => [cx + Math.cos(a) * r * t, cy + Math.sin(a) * r * t];
    if (kind === 0) {
      // Pairs of twigs along every arm
      for (const [t, l] of [
        [0.38, 0.36],
        [0.62, 0.28],
        [0.82, 0.18],
      ]) {
        const [x, y] = at(t);
        ice.needle(x, y, a + 1.05, r * l, big ? 1 : 0, s + t * 7);
        ice.needle(x, y, a - 1.05, r * l, big ? 1 : 0, s + t * 9);
      }
    } else if (kind === 1) {
      // A hexagon around the centre and a "V" at the tip
      const [x0, y0] = at(0.42);
      const b = a + Math.PI / 3;
      const x1 = cx + Math.cos(b) * r * 0.42;
      const y1 = cy + Math.sin(b) * r * 0.42;
      ice.needle(x0, y0, Math.atan2(y1 - y0, x1 - x0), Math.hypot(x1 - x0, y1 - y0), 1, s + 1);
      const [x, y] = at(0.72);
      ice.needle(x, y, a + 0.75, r * 0.3, big ? 1 : 0, s + 2);
      ice.needle(x, y, a - 0.75, r * 0.3, big ? 1 : 0, s + 3);
    } else {
      // Short rays between the arms and a cross bar on every arm
      ice.needle(cx, cy, a + Math.PI / 6, r * 0.42, 0, s + 4);
      const [x, y] = at(0.55);
      ice.needle(x, y, a + Math.PI / 2, r * 0.16, 0, s + 5);
      ice.needle(x, y, a - Math.PI / 2, r * 0.16, 0, s + 6);
    }
  }
}

/**
 * Frost on the paper: ice feathers creeping in from the corners and pencil
 * snowflakes along the edges of the sheet, half hidden under the content.
 */
function frost(w: number, h: number, seed: number): string {
  const ice = new Ice(seed);
  const size = Math.min(110, w * 0.28);
  cornerFrost(ice, 3, 3, Math.PI / 4, size, seed);
  cornerFrost(ice, w - 3, 3, (Math.PI * 3) / 4, size * 0.8, seed + 1);
  cornerFrost(ice, w - 3, h - 3, (-Math.PI * 3) / 4, size * 0.75, seed + 2);
  cornerFrost(ice, 3, h - 3, -Math.PI / 4, size * 0.9, seed + 3);
  // Snowflakes in the margins: about one per 200 px of the sheet, on alternating sides
  for (let y = size * 1.6, i = 0; y < h - size * 1.4; i++) {
    const left = (i + Math.round(hash(seed * 4.4))) % 2 === 0;
    const r = 9 + hash(seed * 3.1 + i) * 9;
    const x = left ? 8 + r * 0.25 : w - 8 - r * 0.25;
    snowflake(ice, x, y, r, seed + i * 17.9);
    y += 200 * (0.7 + hash(seed + i * 2.9) * 0.6);
  }
  // Inside the sheet only: the frost must not hang over its edge
  const clip = `hm-frost-${Math.round(seed * 1000)}`;
  return (
    `<clipPath id="${clip}"><rect x="2" y="2" width="${r1(w - 4)}" height="${r1(h - 4)}"/></clipPath>` +
    `<g clip-path="url(#${clip})">${ice}</g>`
  );
}

/** A broken line through the corners, with points every few px: corners stay corners after smoothing */
function poly(corners: Pt[], pen: Pen): string {
  const pts: Pt[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const [a, b] = [corners[i], corners[i + 1]];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 7));
    for (let k = 0; k < n; k++)
      pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  pts.push(corners[corners.length - 1]);
  return ribbon(pts, pen);
}

/** Pencil pictures: a snowflake, a star, a little fir tree (each fits the element's box) */
function doodle(kind: string, w: number, h: number, seed: number): string {
  const [cx, cy] = [w / 2, h / 2];
  const r = Math.min(w, h) / 2 - 2;
  const pen: Pen = { w: Math.max(1.6, r * 0.11), seed, taper: 0.55, jit: 0.9 };
  if (kind === 'snowflake') {
    // Six arms, each with a pair of twigs, every stroke on its own
    let out = '';
    const tilt = hash(seed * 1.3) * 0.4;
    for (let k = 0; k < 6; k++) {
      const a = tilt + (k * Math.PI) / 3;
      const at = (d: number, da = 0): Pt => [cx + Math.cos(a + da) * d, cy + Math.sin(a + da) * d];
      const s = { ...pen, seed: seed + k * 7 };
      out += poly([at(r * 0.08), at(r)], s);
      const [bx, by] = at(r * 0.58);
      for (const side of [-1, 1]) {
        const b = a + side * 0.8;
        out += poly(
          [
            [bx, by],
            [bx + Math.cos(b) * r * 0.32, by + Math.sin(b) * r * 0.32],
          ],
          { ...s, w: pen.w * 0.8, seed: s.seed + side * 3 },
        );
      }
    }
    return out;
  }
  if (kind === 'fir') {
    // Three tiers drawn as one outline, a trunk and a star on the top
    const P = (x: number, y: number): Pt => [x * w, y * h];
    return (
      poly(
        [
          P(0.5, 0.08),
          P(0.7, 0.34),
          P(0.6, 0.34),
          P(0.8, 0.6),
          P(0.67, 0.6),
          P(0.9, 0.86),
          P(0.1, 0.86),
          P(0.33, 0.6),
          P(0.2, 0.6),
          P(0.4, 0.34),
          P(0.3, 0.34),
          P(0.5, 0.08),
        ],
        pen,
      ) +
      poly([P(0.5, 0.87), P(0.5, 0.99)], { ...pen, w: pen.w * 1.8, seed: seed + 5 }) +
      // A little shading inside
      `<g transform="translate(${r1(w * 0.25)} ${r1(h * 0.33)})">` +
      hatch(w * 0.5, h * 0.5, true, { angle: -40, gap: 5, lw: 3, alpha: 0.25, seed }) +
      '</g>'
    );
  }
  // A five-pointed star, closed with a little overshoot
  const pts: Pt[] = [];
  const turn = -Math.PI / 2 + (hash(seed * 2.1) - 0.5) * 0.3;
  for (let i = 0; i <= 10; i++) {
    const a = turn + (i * Math.PI) / 5;
    const d = i % 2 ? r * 0.45 : r;
    pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]);
  }
  pts.push([cx + Math.cos(turn + 0.2) * r * 0.8, cy + Math.sin(turn + 0.2) * r * 0.8]);
  return poly(pts, pen);
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
  /** The pointer is over the element / the element is pressed (buttons only) */
  hover: boolean;
  press: boolean;
  /** Grows with every redraw on hover: the same button, drawn anew */
  nonce: number;
  /** The pencil outline scribbled around the button while it is hovered or pressed */
  outline?: SVGSVGElement;
  /** Boils by CSS layers (see FREE_BOIL), `layers` hold the variants after the first */
  free: boolean;
  layers?: SVGSVGElement[];
  /** No outline for this button (in the shop): only the redraw answers to the pointer */
  quiet: boolean;
  /** The button has been released: the outline is gone until the pointer comes again */
  spent: boolean;
  /** Timer that ends the redraw animation */
  settle?: number;
}

/**
 * A careless pencil outline around a button, drawn in one go without lifting
 * the pencil: the line follows the shape of the button (a rounded box, or a
 * ring around a round one) and goes round more than once, never along the same
 * way twice. Returned in pieces: each is drawn half-transparent, so where the
 * pencil passes a second time the line gets darker, as on paper.
 */
function scribble(w: number, h: number, round: boolean, seed: number): string[] {
  const turns = 1.55 + hash(seed * 3.9) * 0.2;
  const margin = 4;
  // A rounded box as a superellipse: the longer the button, the squarer its corners
  const power = round ? 2 : 3 + (Math.max(w, h) / Math.min(w, h)) * 0.9;
  const steps = Math.max(24, Math.round(((w + h) * 2 * turns) / 11));
  const start = -2.4 + hash(seed * 1.3) * 1.2;
  const turn = (hash(seed * 6.1) - 0.5) * (round ? 0 : 0.03);
  const tilt = [Math.cos(turn), Math.sin(turn)];
  const raw: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = start + (i / steps) * turns * Math.PI * 2;
    const [c, sn] = [Math.cos(a), Math.sin(a)];
    const lap = (i / steps) * turns;
    // Every lap drifts: a bit wider, a bit shifted
    const out = margin + lap * 3.8 + noise1(i * 0.21 + seed) * 2.8;
    const x = Math.sign(c) * Math.abs(c) ** (2 / power) * (w / 2 + out);
    const y = Math.sign(sn) * Math.abs(sn) ** (2 / power) * (h / 2 + out);
    const [sx, sy] = [noise1(lap * 3.1 + seed * 2) * 3.6, noise1(lap * 2.3 + seed * 5) * 3];
    raw.push([w / 2 + x * tilt[0] - y * tilt[1] + sx, h / 2 + x * tilt[1] + y * tilt[0] + sy]);
  }
  const pts = smooth(raw, 3);
  // About three pieces per lap; neighbours share their end point, so the line has no seams
  const pieces = Math.ceil(turns * 3);
  const per = Math.ceil((pts.length - 1) / pieces);
  const out: string[] = [];
  for (let i0 = 0; i0 < pts.length - 1; i0 += per)
    out.push(
      `M${pts
        .slice(i0, i0 + per + 1)
        .map(([x, y]) => `${r1(x)} ${r1(y)}`)
        .join('L')}`,
    );
  return out;
}

/** The user asked the system for less motion: no drawing animations, no boiling */
const CALM = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Elements that answer to the pointer */
const BUTTONS =
  '.btn-primary, .btn-secondary, .btn-ghost, .card-btn, .snow-mode, .reaction, .pattern-btn, .theme-toggle, .mandarin-chip, .decor-btn, .snow-btn, .zoom button';

/** Buttons inside these answer with the redraw only, without the pencil outline */
const QUIET = 'shop-sheet';

/** Room around the element for strokes that overshoot it, px */
const PAD = 18;

/**
 * The tooth of the paper: several layers of smooth noise of different scale (fractal noise,
 * as Perlin's) and a little fine grain. A pencil leaves colour on the bumps of the paper and
 * skips the pits, and bumps come in patches, not as separate points — that is what makes a
 * line look like pencil and not like sand. The field repeats seamlessly (every layer is a
 * lattice that wraps around). Values: 0 in the pits .. 1 on the bumps, `size` x `size` of them.
 */
function toothField(size: number): Float32Array {
  // Cells of each layer across the tile (bumps of 1.5, 2, 3 and 4.5 px) and its share.
  // Bigger patches read as dirt on light fills (the beard of the mascot).
  const layers: [cells: number, weight: number][] = [
    [107, 0.38],
    [80, 0.3],
    [53, 0.2],
    [36, 0.12],
  ];
  const lattices = layers.map(([cells], k) =>
    Float32Array.from({ length: cells * cells }, (_, i) => hash(i * 0.917 + k * 53.3)),
  );
  const ease = (t: number): number => t * t * (3 - 2 * t);
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0;
      for (let k = 0; k < layers.length; k++) {
        const [cells, weight] = layers[k];
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = (x0 + 1) % cells;
        const y1 = (y0 + 1) % cells;
        const tx = ease(fx - x0);
        const ty = ease(fy - y0);
        const g = lattices[k];
        const top = g[y0 * cells + x0] * (1 - tx) + g[y0 * cells + x1] * tx;
        const bottom = g[y1 * cells + x0] * (1 - tx) + g[y1 * cells + x1] * tx;
        n += weight * (top * (1 - ty) + bottom * ty);
      }
      const i = y * size + x;
      n = n * 0.82 + hash(i * 1.37) * 0.18;
      // A soft edge between the pits (low noise) and the bumps
      field[i] = ease(Math.min(1, Math.max(0, (n - 0.36) / 0.22)));
    }
  }
  return field;
}

/**
 * The tooth as a CSS mask tile (shown 160 px wide), put into the custom property `name`.
 * The image goes through a blob URL: a data URL of this size in a property that hundreds
 * of drawings use would be a heavy string.
 *
 * @param min what is left of the colour in the deepest pits: the lower, the rougher
 */
function toothMask(name: string, field: Float32Array, min: number): void {
  const size = Math.sqrt(field.length);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < field.length; i++) {
    image.data[i * 4 + 3] = Math.round(255 * (min + (1 - min) * field[i]));
  }
  ctx.putImageData(image, 0, 0);
  canvas.toBlob((blob) => {
    if (!blob) return;
    document.documentElement.style.setProperty(name, `url(${URL.createObjectURL(blob)})`);
  });
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
    // Texture of pencil on paper: masks made once from one noise field and tiled (much
    // cheaper than an SVG filter per drawing). A point per screen pixel, at most 3 per CSS pixel.
    const dense = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
    const tooth = toothField(160 * dense);
    // Rough for lines, light for hatching (the text on a button must stay readable)
    toothMask('--hm-grain', tooth, 0.3);
    toothMask('--hm-grain-soft', tooth, 0.72);
    // The mascot; on the dark sheet the dark paper shows through the pits of his white
    // beard as dirt, so there the tooth is shallower
    toothMask('--m-grain', tooth, 0.56);
    toothMask('--m-grain-dark', tooth, 0.76);
    this.listen();
    new MutationObserver(() => this.schedule()).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      // Classes: an option gets selected, a tab becomes active
      attributes: true,
      attributeFilter: ['class'],
    });
    document.fonts?.ready.then(() => this.drawings.forEach((_, el) => this.redraw(el, true)));
    this.schedule();

    if (!CALM) setInterval(() => this.boil(), 1000 / BOIL_FPS);
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
    // Forget what has left the page or is no longer what it was (a tab that stopped being active…)
    this.drawings.forEach((d, el) => {
      if (el.isConnected && kindOf(el) === d.kind) return;
      this.resizes.unobserve(el);
      d.svg.remove();
      d.outline?.remove();
      d.layers?.forEach((layer) => layer.remove());
      el.classList.remove('hm-host', 'hm-bare', 'hm-btn');
      this.drawings.delete(el);
    });
    document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
      if (this.drawings.has(el)) {
        // The text, the size or the state (selected, done…) may have changed
        this.redraw(el);
        return;
      }
      const kind = kindOf(el)!;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', `hm hm-${kind}`);
      svg.setAttribute('aria-hidden', 'true');
      if (kind === 'field') {
        // Laid over the field, as its next sibling
        el.after(svg);
      } else {
        el.classList.add('hm-host');
        if (BARE.includes(kind)) el.classList.add('hm-bare');
        // The drawing is placed against its element (absolute/fixed elements already are a frame)
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        if (kind === 'picture') el.append(svg);
        else el.prepend(svg);
      }
      this.drawings.set(el, {
        kind,
        seed: ++this.counter * 17.7,
        svg,
        size: '',
        boils: el.matches(BOILING),
        hover: false,
        press: false,
        nonce: 0,
        quiet: !!el.closest(QUIET),
        free: el.matches(FREE_BOIL),
        spent: false,
      });
      if (el.matches(BUTTONS)) el.classList.add('hm-btn');
      this.resizes.observe(el);
      this.redraw(el);
    });
  }

  /**
   * @param animate ms: the new drawing is made stroke by stroke over this time,
   * the old one fades away under it (0: just replace)
   */
  private redraw(el: HTMLElement, force = false, animate = 0): void {
    const d = this.drawings.get(el);
    if (!d) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h) return;
    if (d.kind === 'field') {
      // Follows the field: it is not inside it
      d.svg.style.left = `${el.offsetLeft - PAD}px`;
      d.svg.style.top = `${el.offsetTop - PAD}px`;
    }
    const textKey = d.kind === 'title' ? (el.textContent ?? '') : '';
    const state = STATES.filter((c) => el.classList.contains(c)).join('.');
    const size = `${w}x${h}|${textKey}|${state}`;
    if (size === d.size && !force) return;
    d.size = size;
    d.svg.setAttribute('width', String(w + PAD * 2));
    d.svg.setAttribute('height', String(h + PAD * 2));
    d.svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${w + PAD * 2} ${h + PAD * 2}`);
    const seed = d.seed + d.nonce * 7.7;
    let html = '';
    let pieces = 1;
    const variants = d.boils && !d.press ? BOIL_VARIANTS : 1;
    const free = d.free && !CALM;
    const markups: string[] = [];
    for (let v = 0; v < variants; v++) {
      seq = 0;
      markups.push(draw(d.kind, el, w, h, seed + v * 101, d.press));
      pieces = Math.max(pieces, seq);
    }
    if (free) {
      // The first variant stays in the drawing, the others go to their own layers
      html = `<g class="hm-v">${markups[0]}</g>`;
      this.freeLayers(d, markups.slice(1));
    } else
      markups.forEach(
        (markup, v) => (html += `<g class="hm-v"${v ? ' style="display:none"' : ''}>${markup}</g>`),
      );
    window.clearTimeout(d.settle);
    d.svg.querySelector(':scope > .hm-old')?.remove();
    if (animate && !CALM) {
      d.svg.style.setProperty('--dur', `${animate}ms`);
      d.svg.style.setProperty('--each', `${(animate / pieces).toFixed(1)}ms`);
      d.svg.innerHTML = `<g class="hm-old">${d.svg.innerHTML}</g>${html}`;
      d.svg.classList.add('hm-anim');
      d.settle = window.setTimeout(() => {
        d.svg.querySelector(':scope > .hm-old')?.remove();
        d.svg.classList.remove('hm-anim');
      }, animate + 80);
    } else {
      d.svg.classList.remove('hm-anim');
      d.svg.innerHTML = html;
    }
  }

  /** Variants of a free-boiling drawing as sibling layers, shown in turn by CSS (`hm-free` in styles.scss) */
  private freeLayers(d: Drawing, rest: string[]): void {
    const period = (BOIL_VARIANTS * 1000) / BOIL_FPS;
    const all = [d.svg, ...(d.layers ??= [])];
    d.svg.classList.add('hm-free');
    d.svg.style.animationDelay = '0ms';
    rest.forEach((markup, i) => {
      let layer = d.layers![i];
      if (!layer) {
        layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        layer.setAttribute('class', `${d.svg.getAttribute('class')}`);
        layer.setAttribute('aria-hidden', 'true');
        all[i].after(layer);
        d.layers!.push(layer);
        all.push(layer);
      }
      for (const a of ['width', 'height', 'viewBox']) layer.setAttribute(a, d.svg.getAttribute(a)!);
      // Each layer is seen during its own quarter of the cycle
      layer.style.animationDelay = `${(-(i + 1) * period) / BOIL_VARIANTS}ms`;
      layer.innerHTML = markup;
    });
  }

  /** Scribbles the pencil outline around a hovered or pressed button, wipes it afterwards */
  private outline(el: HTMLElement, d: Drawing): void {
    // Not in the shop: there the cards are close together and outline + redraw read as noise,
    // the redraw is the answer by itself
    const wanted = !d.quiet && (d.press || (d.hover && !d.spent));
    if (!wanted) {
      // The line leaves the way it came: its beginning vanishes first
      const gone = d.outline;
      d.outline = undefined;
      gone?.classList.add('hm-leaving');
      if (gone) window.setTimeout(() => gone.remove(), CALM ? 0 : TUNING.scribbleMs + 80);
      return;
    }
    if (d.outline) return;
    const [w, h] = [el.offsetWidth, el.offsetHeight];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'hm-outline');
    svg.setAttribute('aria-hidden', 'true');
    // The ellipse reaches far beyond the button: its own, bigger room
    const pad = Math.round(Math.max(w, h) * 0.12 + h * 0.2 + 26);
    svg.setAttribute('width', String(w + pad * 2));
    svg.setAttribute('height', String(h + pad * 2));
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`);
    svg.style.left = svg.style.top = `${-pad}px`;
    const round = d.kind === 'tag-round';
    // pathLength = 1: the line is "drawn" by moving one dash along it (see styles.scss)
    // A very thick soft pencil; on small buttons a thinner one, or the ring becomes a blot
    const width = Math.min(8, Math.max(4.5, h * 0.13));
    const pieces = scribble(w, h, round, d.seed + d.nonce * 3.3);
    // The pieces are drawn one after another (pathLength = 1: one dash moves along each, see styles.scss)
    const each = TUNING.scribbleMs / pieces.length;
    svg.innerHTML = pieces
      .map(
        (piece, i) =>
          `<path pathLength="1" stroke-width="${r1(width)}" d="${piece}" ` +
          `style="animation-duration:${each.toFixed(0)}ms;animation-delay:${(i * each).toFixed(0)}ms"/>`,
      )
      .join('');
    d.svg.after(svg);
    d.outline = svg;
  }

  /**
   * Buttons answer to the pointer. Hover (mouse): a still button is drawn anew
   * once, a boiling one stops; both get brighter and a pencil outline (not in the shop).
   * Press: the drawing spreads.
   */
  private listen(): void {
    const find = (e: Event): [HTMLElement, Drawing] | null => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('.hm-btn');
      const d = el && this.drawings.get(el);
      return el && d ? [el, d] : null;
    };
    const set = (el: HTMLElement, d: Drawing, state: 'hover' | 'press', on: boolean) => {
      if (d[state] === on) return;
      d[state] = on;
      d.svg.classList.toggle(`hm-${state}`, on);
      if (state === 'hover') d.spent = false;
      else if (!on) d.spent = true;
      // Hovering a still button draws it anew; pressing and releasing always redraws.
      // The hatching is drawn anew before the eyes: slowly on hover, quickly under the finger
      if (state === 'hover' && on && !d.boils) d.nonce++;
      if (state === 'press') this.redraw(el, true, TUNING.pressRedrawMs);
      else if (on && !d.boils) this.redraw(el, true, TUNING.hoverRedrawMs);
      this.outline(el, d);
    };
    document.addEventListener('pointerover', (e) => {
      const hit = find(e);
      if (hit && e.pointerType === 'mouse') set(...hit, 'hover', true);
    });
    document.addEventListener('pointerout', (e) => {
      const hit = find(e);
      if (!hit || hit[0].contains(e.relatedTarget as Node | null)) return;
      set(...hit, 'hover', false);
      set(...hit, 'press', false);
    });
    document.addEventListener('pointerdown', (e) => {
      const hit = find(e);
      if (hit && !(hit[0] as HTMLButtonElement).disabled) set(...hit, 'press', true);
    });
    const release = () =>
      this.drawings.forEach((d, el) => {
        if (d.press) set(el, d, 'press', false);
      });
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
  }

  /** Line boil: the drawings that "live" switch to their next variant */
  private boil(): void {
    if (document.hidden) return;
    this.boilFrame++;
    this.drawings.forEach((d) => {
      // A boiling drawing stands still under the pointer and while it is being redrawn
      if (!d.boils || d.free || d.hover || d.press || d.svg.classList.contains('hm-anim')) return;
      const groups = d.svg.querySelectorAll<SVGElement>(':scope > g.hm-v');
      for (let i = 0; i < groups.length; i++)
        groups[i].style.display = i === this.boilFrame % groups.length ? '' : 'none';
    });
  }
}
