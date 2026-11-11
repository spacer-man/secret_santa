import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
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
 */
@Component({
  selector: 'mascot-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': '"mascot-art " + hero() + " " + mood() + (act() ? " act-" + act() : "")',
    '[class.talking]': 'talking()',
  },
  template: `
    <svg viewBox="-10 -14 140 164" aria-hidden="true">
      <g class="m-all">
        <g class="m-breath">
          <!-- Coat: it goes on below the picture and dissolves in hatching -->
          <path class="m-coat" d="M22 156C23 116 38 95 60 94S97 116 98 156Z" />
          <path class="m-hatch" [attr.d]="hatch" />
          <path class="m-fur m-band" d="M55 104h10v52H55Z" />

          <!-- Arms hang at the sides: round shoulders, sleeves fading out with the coat -->
          <g class="m-arm-l">
            <path
              class="m-coat"
              d="M44 100C34 97 24 101 20 112C16 123 13 134 12 144L28 146C29 136 32 126 36 118C38 112 42 106 44 100Z"
            />
          </g>
          <!-- The right one rises from the shoulder to wave; its mitten is below the picture until then -->
          <g class="m-arm">
            <path
              class="m-coat"
              d="M76 100C86 97 96 101 100 112C104 123 107 134 108 144L92 146C91 136 88 126 84 118C82 112 78 106 76 100Z"
            />
            <g class="m-hand">
              <ellipse
                class="m-fur"
                cx="100"
                cy="145"
                rx="9"
                ry="3.8"
                transform="rotate(-6 100 145)"
              />
              <!-- The mitten and its thumb are one outline: no line crosses the thumb -->
              <path
                class="m-mitt"
                d="M93 147.5C93 149 93.2 150.2 93.4 151.2C90 152 88.4 155.4 90.2 157.4C92 159 94 157.4 94.2 155.2C94.6 159.6 96.4 163.2 100.6 163.6C105.2 164 108.4 159.4 108 153.4L107.4 147.5Z"
              />
            </g>
          </g>

          <path
            class="m-fur"
            d="M34 103C42 97 50 95 60 95S78 97 86 103L83 109C76 104.5 68 103 60 103S44 104.5 37 109Z"
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
                  <path class="m-brow" d="M44 50L57 54M76 50L63 54" />
                }
                @case ('jolly') {
                  <path class="m-brow" d="M44 51Q50 45 57 49M63 49Q70 45 76 51" />
                }
                @default {
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
  protected readonly act = signal<Act | null>(null);
  private timers: ReturnType<typeof setTimeout>[] = [];
  private calm = false;

  constructor() {
    afterNextRender(() => {
      this.calm = !!matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (this.calm) return;
      if (this.hello()) this.later(() => this.play('wave'), 500);
      this.idle();
    });
    // Another hero or character: he hops, as if just put on
    let first = true;
    effect(() => {
      this.hero();
      this.mood();
      if (!first) this.play('hop');
      first = false;
    });
    inject(DestroyRef).onDestroy(() => this.timers.forEach(clearTimeout));
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
