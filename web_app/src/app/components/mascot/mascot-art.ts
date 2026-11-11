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
          <path class="m-fur m-band" d="M55 104h10v52H55Z" />
          <!-- Fur collar: under the arms, its ends tuck in under the shoulders -->
          <path
            class="m-fur"
            d="M34 103C42 97 50 95 60 95S78 97 86 103L83 109C76 104.5 68 103 60 103S44 104.5 37 109Z"
          />

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
