import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { steppedMotion } from '../../core/stepped-motion';
import type { Hero, Mood } from '../../core/mascot';

/** What each character does now and then, on his own */
const ACTS: Record<Mood, Act[]> = {
  classic: ['wave', 'nod', 'look'],
  jolly: ['hop', 'wave', 'glint', 'hop'],
  fairy: ['sway', 'wave', 'look'],
  grumpy: ['sigh', 'shake', 'look'],
};
type Act = 'wave' | 'hop' | 'nod' | 'look' | 'glint' | 'sway' | 'sigh' | 'shake';
/** How long every action plays, ms (the same as its animation in styles.scss) */
const ACT_MS: Record<Act, number> = {
  wave: 2600,
  hop: 750,
  nod: 900,
  look: 2400,
  glint: 1100,
  sway: 2600,
  sigh: 2300,
  shake: 900,
};

/** Hatching of the bottom of the coat: slanted pencil strokes that fade out with it */
const HATCH = Array.from({ length: 14 }, (_, i) => {
  const x = 26 + i * 4.2;
  const len = 12 + ((i * 7) % 5) * 3;
  return `M${x} ${150 - (i % 3) * 2}l${(len * 0.64).toFixed(1)} ${(-len * 0.77).toFixed(1)}`;
}).join('');

// ====== Pencil look: the drawing "boils" slowly, as the hand-drawn interface does ====== //

/** Variants of the drawing shown in turn, and how long each one stays (slow: he must not flicker) */
const BOIL_VARIANTS = 4;
const BOIL_MS = 460;
/** How far the points of a line wander between the variants, in units of the drawing */
const BOIL_AMP = 0.55;
/** Small details of the face wander less, the eyes and the mouth do not at all */
const FINE = '.m-curl, .m-specs, .m-line, .m-shine, .m-flake, .m-brow, .m-brow-out, .m-nose';
const STILL = '.m-eye, .m-mouth, .m-hatch-line, .m-base, .m-pass';
/** Shapes with an outline: the pencil goes over it three times (the fill-only copies have none) */
const OUTLINED = ':is(.m-coat, .m-fur, .m-skin, .m-nose, .m-mitt, .m-shades):not(.m-fill-only)';
/** Direction of the hatching, degrees; every variant leans a little differently */
const HATCH_ANGLE = -42;

/**
 * Strokes of a hatching tile (48 x 27, repeats seamlessly): y, width, pressure, wave and
 * where the pencil lifts (dashes sum up to the width of the tile)
 */
const STROKES = (
  [
    [2.1, 3.4, 1, -1.2, null],
    [6.9, 2.3, 0.7, 0.9, '29 3 13 3'],
    [10.6, 3.1, 0.95, -0.6, '17 2.5 26.5 2'],
    [15.8, 3.7, 1, 1.3, null],
    [20.3, 2.1, 0.6, -1, '9 3 34 2'],
    [24.4, 2.9, 0.9, 0.7, '38 3.5 4.5 2'],
  ] as const
).flatMap(([y, w, o, wave, dash]) =>
  // As in the interface, a stroke has a soft and uneven edge: under its body lie two wider and
  // fainter copies, each with its own wave, so the soft rim is wider here and narrower there
  (
    [
      [w + 0.5, 0.2, wave * 1.9 + 0.5, 0.25],
      [w - 0.3, 0.42, wave * 0.3 - 0.5, -0.2],
      [w - 1.1, 1, wave, 0],
    ] as const
  ).map(([width, tone, sway, shift]) => ({
    w: Math.max(0.8, width).toFixed(1),
    o: (o * tone).toFixed(2),
    dash,
    d: `M0 ${(y + shift).toFixed(2)}q12 ${sway.toFixed(2)} 24 0t24 0`,
  })),
);

/** Numbers of every path command; an arc keeps its radii, rotation and flags */
const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Seeded random in -1..1 */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2147483648 - 1;
  };
}

/**
 * The same path drawn by hand once more: every point is a bit off. The result depends only
 * on the path and the seed, so two copies of a shape (outline and fill) stay identical.
 */
function redraw(d: string, seed: number, amp: number): string {
  const rnd = random(hashText(d) + seed * 7919);
  let command = '';
  let i = 0;
  return d.replace(/([a-zA-Z])|(-?\d*\.?\d+)/g, (text, letter?: string) => {
    if (letter) {
      command = letter.toUpperCase();
      i = 0;
      return letter;
    }
    const k = i++ % (ARITY[command] ?? 1);
    if (command === 'A' && k < 5) return ' ' + text;
    return ' ' + (Number(text) + rnd() * amp).toFixed(2);
  });
}

interface Pass {
  el: SVGElement;
  list: string[];
}

/**
 * The variants of a shape: a path is redrawn point by point, a round shape or a box is
 * just put a bit aside. `salt` gives another hand to the extra passes of the same shape.
 */
function variantsOf(el: Element, salt: number, amp: number): string[] {
  const d = el.tagName === 'path' ? (el.getAttribute('d') ?? '') : null;
  const seed = hashText(el.outerHTML);
  return Array.from({ length: BOIL_VARIANTS }, (_, i) => {
    if (d !== null) return redraw(d, i + salt, amp);
    const rnd = random(seed + (i + salt) * 7919);
    return `${(rnd() * amp * 0.7).toFixed(2)}px ${(rnd() * amp * 0.7).toFixed(2)}px`;
  });
}

function show(el: SVGElement, variant: string): void {
  if (el.tagName === 'path') el.setAttribute('d', variant);
  else el.style.translate = variant;
}

/** All the drawings on the page boil in step, on one slow timer */
const drawings = new Set<() => void>();
let boilFrame = 0;
let boilTimer: ReturnType<typeof setInterval> | undefined;
let uid = 0;

function boil(draw: () => void): () => void {
  drawings.add(draw);
  boilTimer ??= setInterval(() => {
    boilFrame = (boilFrame + 1) % BOIL_VARIANTS;
    drawings.forEach((fn) => fn());
  }, BOIL_MS);
  return () => {
    drawings.delete(draw);
    if (!drawings.size) {
      clearInterval(boilTimer);
      boilTimer = undefined;
    }
  };
}

/**
 * The mascot drawn as a bust: Ded Moroz (blue coat, a round fur hat, a long
 * beard) or Santa (red coat, a floppy hat with a pompom). The character shows
 * in the face: sunglasses for the jolly one, spectacles for the storyteller,
 * frowning brows for the grumpy one.
 *
 * He is alive: breathes, sways his head, looks around and blinks; while he
 * talks he nods and looks at the bubble. Now and then he does something of his
 * character (waves, hops, sighs, shakes his head…); a new hero or character
 * makes him hop. The bottom of the coat dissolves in pencil hatching instead of a cut.
 *
 * He is drawn like the rest of the interface: coloured pencil on paper. The fills are careless
 * hatching over a pale base (SVG patterns of this drawing), the lines break here and there,
 * and the whole drawing slowly "boils": a few times a second every line is drawn a bit differently.
 */
@Component({
  selector: 'mascot-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"mascot-art " + hero() + " " + mood() + (act() ? " act-" + act() : "")',
    '[class.talking]': 'talking()',
    '[style.--m-fill-coat]': 'fill("coat")',
    '[style.--m-fill-fur]': 'fill("fur")',
    '[style.--m-fill-skin]': 'fill("skin")',
  },
  template: `
    <svg viewBox="-10 -14 140 164" aria-hidden="true">
      <!-- Hatched fills: a pale base and uneven pencil strokes with gaps, one pattern per colour -->
      <defs>
        @for (c of colours; track c) {
          <pattern
            [attr.id]="id + '-' + c"
            [attr.class]="'m-pattern m-' + c + '-hatch'"
            patternUnits="userSpaceOnUse"
            width="48"
            height="27"
          >
            <rect class="m-base" width="48" height="27" />
            <!-- Strokes of one direction, but uneven: other gaps, widths, pressure and waves -->
            @for (l of strokes; track $index) {
              <path
                class="m-hatch-line"
                [attr.stroke-width]="l.w"
                [attr.opacity]="l.o"
                [attr.stroke-dasharray]="l.dash"
                [attr.d]="l.d"
              />
            }
          </pattern>
        }
      </defs>
      <g class="m-all">
        <g class="m-breath">
          <!--
            Coat and arms are one figure without inner seams (at the shoulders and the elbows):
            first every part with its outline, then all the fills again without outlines over them,
            so only the outer contour stays. Arms (upper arm + forearm, the left one mirrors the
            right) hang at the sides; the right one has an elbow to wave: the upper arm goes out to
            the side, the forearm bends up and swings. The copies of a moving part share its
            class, so they move together. The coat goes on below the picture and fades out.
          -->
          <path class="m-coat" d="M22 156C23 116 38 95 60 94S97 116 98 156Z" />
          <g class="m-arm-l">
            <path class="m-coat" d="M31.2 129.1A6.5 6.5 0 0 0 18.8 124.9L14.3 143.4L23.7 146.6Z" />
            <path
              class="m-coat"
              d="M43.1 109.9A9 9 0 0 0 26.9 102.1L19.1 124.2A6.5 6.5 0 0 0 30.9 129.8Z"
            />
          </g>
          <g class="m-arm">
            <g class="m-fore">
              <path
                class="m-coat"
                d="M88.8 129.1A6.5 6.5 0 0 1 101.2 124.9L105.7 143.4L96.3 146.6Z"
              />
            </g>
            <path
              class="m-coat"
              d="M76.9 109.9A9 9 0 0 1 93.1 102.1L100.9 124.2A6.5 6.5 0 0 1 89.1 129.8Z"
            />
          </g>

          <path class="m-coat m-fill-only" d="M22 156C23 116 38 95 60 94S97 116 98 156Z" />
          <path class="m-hatch" [attr.d]="hatch" />
          <g class="m-arm-l">
            <path
              class="m-coat m-fill-only"
              d="M31.2 129.1A6.5 6.5 0 0 0 18.8 124.9L14.3 143.4L23.7 146.6Z"
            />
            <path
              class="m-coat m-fill-only"
              d="M43.1 109.9A9 9 0 0 0 26.9 102.1L19.1 124.2A6.5 6.5 0 0 0 30.9 129.8Z"
            />
          </g>
          <g class="m-arm">
            <g class="m-fore">
              <path
                class="m-coat m-fill-only"
                d="M88.8 129.1A6.5 6.5 0 0 1 101.2 124.9L105.7 143.4L96.3 146.6Z"
              />
            </g>
            <path
              class="m-coat m-fill-only"
              d="M76.9 109.9A9 9 0 0 1 93.1 102.1L100.9 124.2A6.5 6.5 0 0 1 89.1 129.8Z"
            />
            <!-- Cuff and mitten: hidden below while the arm hangs -->
            <g class="m-fore">
              <g class="m-hand">
                <ellipse
                  class="m-fur"
                  cx="101"
                  cy="145"
                  rx="7"
                  ry="3.2"
                  transform="rotate(-18.4 101 145)"
                />
                <!-- One outline with the thumb; raised, the thumb is up and towards the head -->
                <path
                  class="m-mitt"
                  transform="rotate(-18.4 101 145) translate(1 0)"
                  d="M107 147.5C107 149 106.8 150.2 106.6 151.2C110 152 111.6 155.4 109.8 157.4C108 159 106 157.4 105.8 155.2C105.4 159.6 103.6 163.2 99.4 163.6C94.8 164 91.6 159.4 92 153.4L92.6 147.5Z"
                />
              </g>
            </g>
          </g>

          <!--
            Fur trim, on top of the arms: two triangular lapels from the shoulders narrow down in a
            "V" and go on as the fur band down the middle of the coat — one shape, no seam.
            Their ends on the shoulders are round, as the shoulders are.
          -->
          <path
            class="m-fur"
            d="M36.5 99.6C43 96.6 51 95.5 60 95.5S77 96.6 83.5 99.6C86.8 101.2 87.2 104.6 85 107C78 114.5 69 122 65 131V156H55V131C51 122 42 114.5 35 107C32.8 104.6 33.2 101.2 36.5 99.6Z"
          />
          <path
            class="m-curl"
            d="M44 105q2 3 1 6M51 115q2 3 1 6M76 105q-2 3 -1 6M69 115q-2 3 -1 6"
          />
        </g>

        <g class="m-head-act">
          <g class="m-head">
            <!-- Face -->
            <ellipse class="m-skin" cx="60" cy="60" rx="21" ry="20" />

            <!-- Hat -->
            @if (hero() === 'santa') {
              <g class="m-tip">
                <path
                  class="m-coat"
                  d="M35 45C36 27 50 14 66 13C82 12 96 19 104 32C97 29 89 29 85 34C87 38 87 42 86 45Z"
                />
                <circle class="m-fur" cx="104" cy="34" r="7.5" />
              </g>
              <rect class="m-fur" x="30" y="38" width="60" height="13" rx="6.5" />
            } @else {
              <path class="m-coat" d="M33 45C32 22 45 9 60 9S88 22 87 45Z" />
              <path class="m-flake" d="M60 18V34M53 22L67 30M53 30L67 22" />
              <rect class="m-fur" x="28" y="38" width="64" height="14" rx="7" />
            }

            <!-- Brows (go up while he talks) -->
            <g class="m-brows">
              @switch (mood()) {
                @case ('grumpy') {
                  <path class="m-brow-out" d="M44 50L57 54M76 50L63 54" />
                  <path class="m-brow" d="M44 50L57 54M76 50L63 54" />
                }
                @case ('jolly') {
                  <path class="m-brow-out" d="M44 51Q50 45 57 49M63 49Q70 45 76 51" />
                  <path class="m-brow" d="M44 51Q50 45 57 49M63 49Q70 45 76 51" />
                }
                @default {
                  <path class="m-brow-out" d="M45 53Q51 49 57 52M63 52Q69 49 75 53" />
                  <path class="m-brow" d="M45 53Q51 49 57 52M63 52Q69 49 75 53" />
                }
              }
            </g>

            <!-- Eyes: they look around, and at the bubble while he talks -->
            <g class="m-look">
              <ellipse class="m-eye" cx="52" cy="58" rx="2.3" ry="3" />
              <ellipse class="m-eye" cx="68" cy="58" rx="2.3" ry="3" />
            </g>
            <circle class="m-cheek" cx="45" cy="65" r="4.5" />
            <circle class="m-cheek" cx="75" cy="65" r="4.5" />

            <!-- Beard: Moroz's one is long -->
            @if (hero() === 'moroz') {
              <path
                class="m-fur"
                d="M38 58C32 74 33 92 40 106C45 116 52 122 60 124C68 122 75 116 80 106C87 92 88 74 82 58C79 69 71 75 60 75S41 69 38 58Z"
              />
              <path
                class="m-curl"
                d="M48 88q4 5 0 10M60 96q4 5 0 10M72 88q-4 5 0 10M54 108q3 4 0 8M66 108q-3 4 0 8"
              />
            } @else {
              <path
                class="m-fur"
                d="M38 58C33 71 35 84 42 94C45 100 50 104 55 104C57 108 63 108 65 104C70 104 75 100 78 94C85 84 87 71 82 58C79 68 71 74 60 74S41 68 38 58Z"
              />
              <path class="m-curl" d="M48 84q3 4 0 8M60 89q3 4 0 8M72 84q-3 4 0 8" />
            }

            <!-- Mouth (moves while talking), moustache, nose -->
            <ellipse
              class="m-mouth"
              cx="60"
              cy="75"
              rx="4"
              [attr.ry]="mood() === 'grumpy' ? 1.6 : 2.8"
            />
            <path
              class="m-fur"
              d="M60 69C55 64 46 64 41 71C46 75 54 76 60 72C66 76 74 75 79 71C74 64 65 64 60 69Z"
            />
            <circle class="m-nose" cx="60" cy="65" r="4.8" />

            <!-- What the character wears -->
            @if (mood() === 'jolly') {
              <path
                class="m-shades"
                d="M43 54h14v6.5a3.5 3.5 0 0 1-3.5 3.5h-7a3.5 3.5 0 0 1-3.5-3.5ZM63 54h14v6.5a3.5 3.5 0 0 1-3.5 3.5h-7a3.5 3.5 0 0 1-3.5-3.5Z"
              />
              <path class="m-line" d="M57 56h6M43 55l-4-2M77 55l4-2" />
              <path class="m-shine" d="M46 56l3 0M66 56l3 0" />
            }
            @if (mood() === 'fairy') {
              <circle class="m-specs" cx="52" cy="59" r="6" />
              <circle class="m-specs" cx="68" cy="59" r="6" />
              <path class="m-specs" d="M58 58q2-2 4 0" />
            }
          </g>
        </g>
      </g>
    </svg>
  `,
})
export class MascotArt {
  readonly hero = input<Hero>('moroz');
  readonly mood = input<Mood>('classic');
  readonly talking = input(false);
  /** Wave when he appears */
  readonly hello = input(false);

  protected readonly hatch = HATCH;
  protected readonly colours = ['coat', 'fur', 'skin'];
  protected readonly strokes = STROKES;
  /** Ids of the patterns must differ between the drawings on a page (their colours differ) */
  protected readonly id = `mascot-${++uid}`;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Variants of every line, made once: the element → its attribute in each variant */
  private readonly variants = new WeakMap<Element, string[]>();
  /** Extra pencil passes of the outlined shapes (elements this component adds itself) */
  private readonly passes = new Map<Element, Pass[]>();
  protected readonly act = signal<Act | null>(null);
  private timers: ReturnType<typeof setTimeout>[] = [];
  private calm = false;

  constructor() {
    afterNextRender(() => {
      this.calm = !!matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      this.draw();
      if (this.calm) return;
      destroy.onDestroy(boil(() => this.draw()));
      // Breathing, swaying, blinking: stepped like drawn animation, not 60 repaints a second
      destroy.onDestroy(steppedMotion(this.host.nativeElement));
      if (this.hello()) this.later(() => this.play('wave'), 500);
      this.idle();
    });
    const destroy = inject(DestroyRef);
    // Another hero or character: he hops, as if just put on
    let first = true;
    effect(() => {
      this.hero();
      this.mood();
      if (!first) this.play('hop');
      first = false;
    });
    destroy.onDestroy(() => this.timers.forEach(clearTimeout));
  }

  protected fill(colour: string): string {
    return `url(#${this.id}-${colour})`;
  }

  /** Shows the current variant of the drawing: every line and the hatching are a bit different */
  private draw(): void {
    const frame = boilFrame;
    const svg = this.host.nativeElement.querySelector('svg');
    if (!svg) return;
    // Extra passes of shapes that are gone (another hat, another beard) go too
    for (const [el, extra] of this.passes) {
      if (el.isConnected) continue;
      extra.forEach((pass) => pass.el.remove());
      this.passes.delete(el);
    }
    for (const el of svg.querySelectorAll<SVGElement>('path, ellipse, circle, rect')) {
      if (el.matches(STILL)) continue;
      let list = this.variants.get(el);
      if (!list) {
        const amp = BOIL_AMP * (el.matches(FINE) ? 0.5 : 1);
        list = variantsOf(el, 0, amp);
        this.variants.set(el, list);
        if (el.matches(OUTLINED)) this.passes.set(el, this.morePasses(el, amp));
      }
      show(el, list[frame]);
      this.passes.get(el)?.forEach((pass) => show(pass.el, pass.list[frame]));
    }
    // The hatching is laid anew: another lean and another place of the strokes
    const rnd = random(frame * 31 + 5);
    for (const pattern of svg.querySelectorAll('pattern')) {
      const angle = HATCH_ANGLE + rnd() * 3;
      pattern.setAttribute(
        'patternTransform',
        `rotate(${angle.toFixed(1)}) translate(${(rnd() * 20).toFixed(1)} ${(rnd() * 12).toFixed(1)})`,
      );
    }
    // The pencil lifts in other places of the outline
    svg.style.setProperty('--m-dash', String(frame * 23));
  }

  /**
   * The outline is gone over with the pencil twice more, each time a bit off: a heavier pass
   * in pieces (where the hand pressed) and a thin stray line beside. The copies lie right
   * after the outline, so the fills that hide the inner seams hide them as well.
   */
  private morePasses(el: SVGElement, amp: number): Pass[] {
    // And two wide faint copies of the main line, each a bit off as well: its edge is soft
    // and uneven, as the edge of every pencil line of the interface
    const passes: [name: string, wander: number][] = [
      ['soft1', 1.3],
      ['soft2', 0.9],
      ['pass2', 1.5],
      ['pass3', 2.1],
    ];
    return passes.map(([name, wander], n) => {
      const pass = el.cloneNode(false) as SVGElement;
      pass.setAttribute('class', `m-pass m-${name}`);
      el.after(pass);
      return { el: pass, list: variantsOf(el, (n + 2) * 101, amp * wander) };
    });
  }

  private play(act: Act): void {
    if (this.calm) return;
    // Off and on again: the same action can play twice in a row
    this.act.set(null);
    requestAnimationFrame(() => this.act.set(act));
    this.later(() => this.act() === act && this.act.set(null), ACT_MS[act] + 50);
  }

  /** Something of his character every 8–20 s (not while he talks) */
  private idle(): void {
    this.later(
      () => {
        if (!this.talking() && !this.act()) {
          const acts = ACTS[this.mood()];
          this.play(acts[Math.floor(Math.random() * acts.length)]);
        }
        this.idle();
      },
      8000 + Math.random() * 12000,
    );
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(setTimeout(fn, ms));
  }
}
