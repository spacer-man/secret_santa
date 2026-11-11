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
  ['.btn-ghost, .card-btn.quiet', 'light'],
  // Framed things: buttons, options to choose from, cards
  [
    '.btn-secondary, .shop-card, .card-btn, .snow-mode, .reaction, .pattern-btn, .shop-set, .theme-toggle',
    'card',
  ],
  ['.page', 'sheet-frame'],
  ['.card > h2, .label, .page-title', 'title'],
  ['.number, .stats b, .tabs a.active', 'underline'],
  ['.sheet h3, .earn li, .card.row', 'rule'],
  ['.tabs, .sheet', 'top-rule'],
  ['.tree-card', 'picture'],
  ['.seal', 'seal'],
  ['.sheet-emoji, .card-icon, .hero-emoji', 'wash'],
  // Progress: a pencil line and a hatched part of it
  ['.level-bar, .wave .bar, .friends-bar, .load-bar', 'bar-track'],
  ['.level-bar > span, .wave .bar > span, .friends-bar > span, .load-bar > span', 'bar-fill'],
  // Little pictures drawn in pencil (the loading screen): data-doodle = snowflake | star | fir
  ['.doodle', 'doodle'],
  // Bigger tinted areas: a watercolour wash (quotes, hints, the row of the user)
  ['.quote, blockquote, .idea, .designer, .wave li.mine, .shop-tabs', 'note'],
  ['.badge, .chip', 'chip'],
  // Form fields cannot hold a drawing inside: it is laid over them
  ['.select, .textarea', 'field'],
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
const BOILING = '.seal, .btn-primary, .doodle';
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
  let d = '';
  const p = (pt: Pt) => `${r1(pt[0])} ${r1(pt[1])}`;
  const ends = (i: number): [Pt, Pt] => {
    const [from, , to] = strokes[i];
    return i % 2 ? [to, from] : [from, to];
  };
  strokes.forEach(([, bend], i) => {
    const [a0, a1] = ends(i);
    if (!d) d = `M${p(a0)}`;
    d += `Q${p(bend)} ${p(a1)}`;
    const last = i === strokes.length - 1;
    let next = a1;
    if (!last) {
      // A round turn beyond the edge into the next stroke: no sharp corner, no crease
      [next] = ends(i + 1);
      const len = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
      const reach = Math.min(o.gap * 0.9, 7);
      const [ux, uy] = [((a1[0] - a0[0]) / len) * reach, ((a1[1] - a0[1]) / len) * reach];
      d += `C${p([a1[0] + ux, a1[1] + uy])} ${p([next[0] + ux, next[1] + uy])} ${p(next)}`;
    }
    if ((i + 1) % HATCH_PIECE && !last) return;
    const piece = Math.floor(i / HATCH_PIECE);
    // The pressure changes from piece to piece only slightly and never for long:
    // a big difference reads as a pass of the pencil that stopped halfway
    const press = noise1(piece * 2.3 + o.seed * 1.3);
    const opacity = o.alpha * Math.max(0.78, Math.min(1, 0.9 + 0.14 * press));
    const width = o.lw * (0.8 + 0.4 * hash(o.seed * 4.1 + piece * 5.9));
    out +=
      `<path class="hm-stroke hm-seq" pathLength="1" style="--i:${seq++}" ` +
      `opacity="${opacity.toFixed(2)}" stroke-width="${r1(width)}" d="${d}"/>`;
    // The next piece starts where this one ended: at the beginning of a stroke, heading along it
    d = `M${p(next)}`;
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
  /** The pencil outline scribbled around a boiling button while the mouse is over it */
  outline?: SVGSVGElement;
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

/** Room around the element for strokes that overshoot it, px */
const PAD = 18;

/**
 * A tile of pencil grain as a CSS mask: `holes` of the pixels are faint (`hole` of the
 * colour is left), the rest keep `min`..1
 */
function grainTile(holes: number, min: number, hole = 0): string {
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'none';
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = hash(i * 0.731 + holes * 97);
    image.data[i * 4 + 3] = Math.round(255 * (v < holes ? hole : min + (1 - min) * hash(i * 1.37)));
  }
  ctx.putImageData(image, 0, 0);
  return `url(${canvas.toDataURL()})`;
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
    // Grain of the pencil lead: masks made once and tiled (much cheaper than an SVG filter per drawing)
    const root = document.documentElement.style;
    root.setProperty('--hm-grain', grainTile(0.3, 0.55));
    root.setProperty('--hm-grain-soft', grainTile(0.05, 0.86, 0.62));
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
    for (let v = 0; v < variants; v++) {
      seq = 0;
      const markup = draw(d.kind, el, w, h, seed + v * 101, d.press);
      pieces = Math.max(pieces, seq);
      html += `<g class="hm-v"${v ? ' style="display:none"' : ''}>${markup}</g>`;
    }
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

  /** Scribbles the pencil outline around a hovered or pressed button, wipes it afterwards */
  private outline(el: HTMLElement, d: Drawing): void {
    // Only where the button is not drawn anew: a boiling button that stops under the mouse.
    // A redraw (hover over a still button, any press) is the answer by itself, without an outline
    const wanted = d.boils && d.hover && !d.press && !d.spent;
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
   * once, a boiling one stops and gets a pencil outline; both get brighter.
   * Press: the drawing spreads (drawn anew, no outline).
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
      if (!d.boils || d.hover || d.press || d.svg.classList.contains('hm-anim')) return;
      const groups = d.svg.querySelectorAll<SVGElement>(':scope > g.hm-v');
      for (let i = 0; i < groups.length; i++)
        groups[i].style.display = i === this.boilFrame % groups.length ? '' : 'none';
    });
  }
}
