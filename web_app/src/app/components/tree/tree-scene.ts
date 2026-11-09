import { Component, computed, input, output } from '@angular/core';
import { TreeBall, TreeData } from '../../core/api';
import { BallArt, BallDefs } from './ball-art';

interface Slot {
  x: number;
  y: number;
}

const CX = 180;
// Tree tiers, bottom first: [top y, bottom y, half width at the bottom]
const TIERS: [number, number, number][] = [
  [205, 352, 150],
  [150, 280, 118],
  [102, 210, 86],
  [62, 140, 56],
];

/** Pseudo-random but stable numbers */
function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function tierPath([top, bottom, hw]: [number, number, number], i: number): string {
  // Apex → right corner → scalloped bottom edge → left corner
  const scallops = 5 + i;
  let d = `M${CX} ${top - 6} L${CX + hw} ${bottom}`;
  for (let k = 1; k <= scallops; k++) {
    const x = CX + hw - (2 * hw * k) / scallops;
    const mid = x + hw / scallops;
    d += ` Q${mid} ${bottom + 10} ${x} ${bottom}`;
  }
  return d + ' Z';
}

function snowPath([top, bottom, hw]: [number, number, number], i: number): string {
  // Snow lying on the lower edge of the tier
  const y = bottom - 4;
  const w = hw * 0.96;
  const scallops = 5 + i;
  let d = `M${CX - w} ${y}`;
  for (let k = 1; k <= scallops; k++) {
    const x = CX - w + (2 * w * k) / scallops;
    d += ` Q${x - w / scallops} ${y - 7 - (k % 2) * 3} ${x} ${y}`;
  }
  for (let k = scallops; k >= 0; k--) {
    const x = CX - w + (2 * w * k) / scallops;
    d += ` L${x} ${y + 4 + (k % 2) * 3}`;
  }
  return d + ' Z';
}

/** Right side of a tier is in the shadow */
function shadePath([top, bottom, hw]: [number, number, number]): string {
  return `M${CX} ${top - 6} L${CX + hw} ${bottom} Q${CX + hw * 0.5} ${bottom + 8} ${CX + 4} ${bottom} Z`;
}

/** Short light strokes: needles texture */
function needlePath([top, bottom, hw]: [number, number, number], i: number): string {
  let d = '';
  for (let k = 0; k < 18; k++) {
    const f = 0.25 + rand(i * 50 + k) * 0.7;
    const y = top + (bottom - top) * f;
    const w = hw * f * 0.9;
    const x = CX - w + rand(i * 50 + k + 0.3) * w * 1.6;
    const dir = x < CX ? -1 : 1;
    d += `M${x.toFixed(1)} ${y.toFixed(1)} l${(dir * 6).toFixed(1)} 5 `;
  }
  return d;
}

/** Ball places on the tree, in fill order (spread over the tree) */
function makeSlots(): Slot[] {
  const slots: Slot[] = [];
  TIERS.forEach(([top, bottom, hw], t) => {
    for (const f of [0.5, 0.84]) {
      const y = top + (bottom - top) * f;
      const w = hw * f * 0.78;
      const n = Math.max(1, Math.round(w / 34));
      for (let k = 0; k < n; k++) {
        const x = n === 1 ? CX : CX - w + (2 * w * k) / (n - 1);
        slots.push({ x: x + (rand(t * 10 + k + f) - 0.5) * 8, y: y + (rand(k + t) - 0.5) * 6 });
      }
    }
  });
  return slots
    .map((s, i) => ({ s, key: rand(i * 7.31) }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.s);
}

const SLOTS = makeSlots();

const STARS = Array.from({ length: 34 }, (_, i) => ({
  x: rand(i) * 360,
  y: rand(i + 100) * 190,
  r: rand(i + 200) * 1.1 + 0.3,
  delay: rand(i + 300) * 4,
}));

const GARLAND_COLORS = ['#ffd36b', '#ff4d6d', '#4dd2ff', '#7dff9a', '#ff9ef0'];

/** Garland: zigzag down the tree with bulbs along it */
function makeGarland() {
  const points: [number, number][] = [];
  TIERS.slice()
    .reverse()
    .forEach(([top, bottom, hw], i) => {
      const y1 = top + (bottom - top) * 0.35;
      const y2 = top + (bottom - top) * 0.7;
      const w1 = hw * 0.35 * 0.9;
      const w2 = hw * 0.7 * 0.9;
      points.push(i % 2 ? [CX + w1, y1] : [CX - w1, y1], i % 2 ? [CX - w2, y2] : [CX + w2, y2]);
    });
  let d = `M${points[0][0]} ${points[0][1]}`;
  const bulbs: { x: number; y: number; color: string; delay: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const cx = (x0 + x1) / 2;
    const cy = Math.max(y0, y1) + 12;
    d += ` Q${cx} ${cy} ${x1} ${y1}`;
    for (let k = 1; k <= 4; k++) {
      const t = k / 5;
      // Point on the quadratic curve
      const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1;
      const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y1;
      bulbs.push({ x, y, color: GARLAND_COLORS[bulbs.length % GARLAND_COLORS.length], delay: (bulbs.length % 5) * 0.3 });
    }
  }
  return { d, bulbs };
}

const GARLAND = makeGarland();

@Component({
  selector: 'tree-scene',
  imports: [BallArt, BallDefs],
  template: `
    <svg viewBox="0 0 360 430" class="scene" [class]="'lvl-' + level()" role="img" aria-label="New Year tree">
      <defs ballDefs></defs>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#070a1f" />
          <stop offset="60%" stop-color="#18123a" />
          <stop offset="100%" stop-color="#2b1a4a" />
        </linearGradient>
        <linearGradient id="needles" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1f7a4d" />
          <stop offset="100%" stop-color="#0b3d2a" />
        </linearGradient>
        <linearGradient id="snow-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#eaf1ff" />
          <stop offset="100%" stop-color="#9fb2d9" />
        </linearGradient>
        <linearGradient id="aurora" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#3dffb0" stop-opacity="0" />
          <stop offset="40%" stop-color="#3dffb0" stop-opacity="0.45" />
          <stop offset="70%" stop-color="#6d7bff" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#6d7bff" stop-opacity="0" />
        </linearGradient>
        <radialGradient id="tree-light">
          <stop offset="0%" stop-color="#ffcf6b" stop-opacity="0.55" />
          <stop offset="60%" stop-color="#ff7a3d" stop-opacity="0.15" />
          <stop offset="100%" stop-color="#ff7a3d" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="star-glow">
          <stop offset="0%" stop-color="#fff3b0" stop-opacity="1" />
          <stop offset="100%" stop-color="#ffd36b" stop-opacity="0" />
        </radialGradient>
      </defs>

      <!-- Sky -->
      <rect width="360" height="430" fill="url(#sky)" />
      @if (level() >= 9) {
        <path class="aurora" d="M-20 70 C60 20 120 110 200 50 S320 30 380 80 L380 120 C300 80 240 140 160 100 S40 90 -20 120Z" fill="url(#aurora)" />
      }
      @for (s of stars; track $index) {
        <circle class="twinkle" [attr.cx]="s.x" [attr.cy]="s.y" [attr.r]="s.r" fill="#fff" [style.animation-delay.s]="s.delay" />
      }
      <circle cx="58" cy="58" r="17" fill="#fff6dc" opacity="0.9" />
      <circle cx="51" cy="52" r="15" fill="#18123a" opacity="0.55" />

      <!-- Hills and village -->
      <path d="M0 300 Q70 250 150 285 T300 270 T360 280 V430 H0Z" fill="#1d2550" />
      <path d="M0 300 Q70 250 150 285 T300 270 T360 280 V292 Q300 282 240 290 T120 296 T0 312Z" fill="#c9d6f2" opacity="0.5" />
      @if (level() >= 5) {
        @for (l of villageLights; track $index) {
          <circle class="twinkle warm" [attr.cx]="l[0]" [attr.cy]="l[1]" r="1.6" fill="#ffd27a" [style.animation-delay.s]="l[2]" />
        }
      }

      <!-- Cabin -->
      <g transform="translate(26 296)">
        @if (level() >= 3) {
          <circle cx="22" cy="24" r="26" fill="url(#glow-warm)" opacity="0.6" />
        }
        <rect x="0" y="12" width="44" height="30" fill="#3b2a2a" />
        <path d="M-6 14 L22 -8 L50 14Z" fill="#5a3b33" />
        <path d="M-7 15 L22 -9 L51 15 L46 15 L22 -3 L-2 15Z" fill="#eef4ff" />
        <rect x="8" y="20" width="11" height="10" [attr.fill]="level() >= 3 ? '#ffd27a' : '#1b1730'" />
        <rect x="26" y="22" width="10" height="20" fill="#2a1d1d" />
        <rect x="32" y="-6" width="6" height="12" fill="#4a3330" />
      </g>

      <!-- Ground -->
      <ellipse cx="180" cy="392" rx="230" ry="52" fill="url(#snow-ground)" />

      <!-- Tree -->
      <rect x="168" y="345" width="24" height="30" rx="3" fill="#5b3a26" />
      <!-- Warm light from lit balls -->
      <ellipse cx="180" cy="230" rx="170" ry="190" fill="url(#tree-light)" [attr.opacity]="treeGlow()" />
      @for (t of tiers; track $index) {
        <path [attr.d]="t.tier" fill="url(#needles)" />
        <path [attr.d]="t.shade" fill="#03140d" opacity="0.32" />
        <path [attr.d]="t.needles" fill="none" stroke="#3fae73" stroke-opacity="0.35" stroke-width="1.2" stroke-linecap="round" />
        <path [attr.d]="t.snow" fill="#f4f8ff" opacity="0.92" />
      }

      <!-- Garland: a bulb per friend group -->
      @if (garland() > 0) {
        <path [attr.d]="garlandPath" fill="none" stroke="#173322" stroke-width="1" />
        @for (b of garlandBulbs(); track $index) {
          <circle [attr.cx]="b.x" [attr.cy]="b.y" r="2.6" [attr.fill]="b.lit ? b.color : '#2a3a33'" [class.blink]="b.lit" [style.animation-delay.s]="b.delay" />
        }
      }

      <!-- Empty places invite to write -->
      @for (s of emptySlots(); track $index) {
        <g class="empty-slot" [attr.transform]="'translate(' + s.x + ' ' + s.y + ')'" (click)="addBall.emit()">
          <circle r="10" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-dasharray="3 3" />
          <path d="M-4 0H4M0-4V4" stroke="#fff" stroke-opacity="0.7" stroke-width="1.4" />
        </g>
      }

      <!-- Balls -->
      @for (b of placed(); track b.ball.id) {
        <g class="ball-slot" [attr.transform]="'translate(' + b.x + ' ' + b.y + ') scale(1.3)'" (click)="ballClick.emit(b.ball)">
          <g class="sway" [class.new-hung]="b.isNewHung" [class.new-lit]="b.isNewLit" [style.animation-delay.s]="b.sway">
            <g ballArt [color]="b.ball.color" [pattern]="b.ball.pattern" [state]="b.ball.state" [sparkles]="b.sparkles"></g>
          </g>
        </g>
      }

      <!-- Star -->
      <g transform="translate(180 50)" [class.star-on]="star()" class="star" (click)="starClick.emit()">
        @if (star()) {
          <circle r="34" fill="url(#star-glow)" class="star-glow" />
        }
        <path
          d="M0-20 5.9-6.5 20.5-6.2 8.9 2.8 13.1 17 0 8.7-13.1 17-8.9 2.8-20.5-6.2-5.9-6.5Z"
          [attr.fill]="star() ? '#ffd36b' : '#3a3f55'"
          [attr.stroke]="star() ? '#fff3b0' : '#5c6380'"
          stroke-width="1.2"
        />
      </g>

      <!-- Gifts under the tree: wishes waiting for moderation -->
      @for (g of boxes(); track g.ball.id; let i = $index) {
        <g class="box" [attr.transform]="'translate(' + g.x + ' ' + g.y + ')'" (click)="ballClick.emit(g.ball)">
          <rect x="-12" y="-14" width="24" height="18" rx="2" [attr.fill]="g.fill" />
          <rect x="-13" y="-17" width="26" height="5" rx="1.5" [attr.fill]="g.fill" opacity="0.85" />
          <rect x="-2" y="-17" width="4" height="21" fill="#ffd36b" />
          <path d="M0-17c-6-8-12-2-4 0M0-17c6-8 12-2 4 0" fill="none" stroke="#ffd36b" stroke-width="1.6" />
        </g>
      }
    </svg>
  `,
  styles: `
    :host { display: block; }
    .scene { width: 100%; height: auto; display: block; border-radius: 1.1rem; }
    .twinkle { animation: tw 3.5s ease-in-out infinite; }
    .warm { animation-duration: 2.2s; }
    @keyframes tw { 50% { opacity: 0.25; } }
    .aurora { animation: aur 9s ease-in-out infinite; transform-origin: center; }
    @keyframes aur { 50% { opacity: 0.55; transform: translateY(6px) scaleX(1.05); } }
    .blink { animation: blink 1.6s ease-in-out infinite; }
    @keyframes blink { 50% { opacity: 0.35; } }
    .ball-slot, .box, .empty-slot, .star { cursor: pointer; }
    .empty-slot { animation: tw 2.6s ease-in-out infinite; }
    .sway { transform-box: view-box; animation: sway 5s ease-in-out infinite; transform-origin: 0 -17px; }
    @keyframes sway { 50% { transform: rotate(4deg); } }
    .sway.new-hung { animation: drop 1s cubic-bezier(0.3, 1.5, 0.5, 1) both; }
    @keyframes drop { from { transform: translateY(-90px); opacity: 0; } 60% { opacity: 1; } }
    :host ::ng-deep .halo { transform-box: fill-box; transform-origin: center; animation: glow 2.8s ease-in-out infinite; }
    @keyframes glow { 50% { opacity: 0.6; transform: scale(0.88); } }
    :host ::ng-deep .sparkle { transform-box: fill-box; transform-origin: center; animation: tw 1.8s ease-in-out infinite; }
    .new-lit ::ng-deep .halo { animation: ignite 1.6s ease-out both; }
    @keyframes ignite { 0% { transform: scale(0.2); opacity: 0; } 40% { transform: scale(1.6); opacity: 1; } }
    .star-glow { animation: pulse 2.4s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.55; } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  `,
  host: { '[class.has-lit]': 'hasLit()' },
})
export class TreeScene {
  readonly tree = input.required<TreeData>();
  /** Ball ids that just got hung / lit (animated once) */
  readonly newHung = input<string[]>([]);
  readonly newLit = input<string[]>([]);

  readonly ballClick = output<TreeBall>();
  readonly addBall = output<void>();
  readonly starClick = output<void>();

  protected readonly stars = STARS;
  protected readonly garlandPath = GARLAND.d;
  protected readonly tiers = TIERS.map((t, i) => ({
    tier: tierPath(t, i),
    shade: shadePath(t),
    needles: needlePath(t, i),
    snow: snowPath(t, i),
  }));
  protected readonly villageLights = Array.from({ length: 14 }, (_, i) => [
    240 + rand(i + 50) * 115,
    272 + rand(i + 60) * 18,
    rand(i + 70) * 2,
  ]);

  protected readonly level = computed(() => this.tree().level);
  protected readonly star = computed(() => this.tree().star);
  protected readonly garland = computed(() => this.tree().garland);
  protected readonly treeGlow = computed(() => {
    const balls = this.tree().balls.filter((b) => b.state !== 'box');
    const lit = balls.filter((b) => b.state === 'lit').length;
    return Math.min(1, lit / 6) * 0.9 + (this.star() ? 0.1 : 0);
  });
  protected readonly hasLit = computed(() => this.tree().balls.some((b) => b.state === 'lit'));

  protected readonly garlandBulbs = computed(() => {
    // Every invited friend lights up a few bulbs
    const lit = Math.min(GARLAND.bulbs.length, this.garland() * 2);
    return GARLAND.bulbs.map((b, i) => ({ ...b, lit: i < lit }));
  });

  private readonly onTree = computed(() => this.tree().balls.filter((b) => b.state !== 'box'));

  protected readonly placed = computed(() =>
    this.onTree()
      .slice(0, SLOTS.length)
      .map((ball, i) => ({
        ball,
        ...SLOTS[i],
        sparkles: Object.keys(ball.reactions).length > 0 || ball.replies > 0,
        isNewHung: this.newHung().includes(ball.id),
        isNewLit: this.newLit().includes(ball.id),
        sway: rand(i + 0.5) * 4,
      })),
  );

  protected readonly emptySlots = computed(() => {
    const used = this.onTree().length;
    return SLOTS.slice(used, used + Math.max(1, 3 - Math.floor(used / 4)));
  });

  protected readonly boxes = computed(() => {
    const colors = ['#c8102e', '#1e5aa8', '#6b2fa3', '#0f8a5f'];
    return this.tree()
      .balls.filter((b) => b.state === 'box')
      .slice(0, 6)
      .map((ball, i) => ({
        ball,
        x: [120, 244, 96, 268, 142, 222][i],
        y: [384, 386, 396, 398, 400, 401][i],
        fill: colors[i % colors.length],
      }));
  });
}
