import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Hero, Mood } from '../../core/mascot';

/**
 * The mascot drawn as a bust: Ded Moroz (blue coat, a round fur hat, a long
 * beard) or Santa (red coat, a floppy hat with a pompom). The character shows
 * in the face: sunglasses for the jolly one, spectacles for the storyteller,
 * frowning brows for the grumpy one. He blinks, and his mouth moves while he talks.
 */
@Component({
  selector: 'mascot-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': '"mascot-art " + hero() + " " + mood()', '[class.talking]': 'talking()' },
  template: `
    <svg viewBox="0 0 120 132" aria-hidden="true">
      <g class="m-body">
        <!-- Coat and the fur collar -->
        <path class="m-coat" d="M8 132C10 106 28 93 60 93S110 106 112 132Z" />
        <path
          class="m-fur"
          d="M26 103C36 96 48 94 60 94S84 96 94 103L90 110C80 104 70 102 60 102S40 104 30 110Z"
        />

        <!-- Face -->
        <ellipse class="m-skin" cx="60" cy="60" rx="21" ry="20" />

        <!-- Hat -->
        @if (hero() === 'santa') {
          <path
            class="m-coat"
            d="M35 45C36 27 50 14 66 13C82 12 96 19 104 32C97 29 89 29 85 34C87 38 87 42 86 45Z"
          />
          <circle class="m-fur" cx="104" cy="34" r="7.5" />
          <rect class="m-fur" x="30" y="38" width="60" height="13" rx="6.5" />
        } @else {
          <path class="m-coat" d="M33 45C32 22 45 9 60 9S88 22 87 45Z" />
          <path class="m-flake" d="M60 18V34M53 22L67 30M53 30L67 22" />
          <rect class="m-fur" x="28" y="38" width="64" height="14" rx="7" />
        }

        <!-- Brows -->
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

        <!-- Eyes -->
        <ellipse class="m-eye" cx="52" cy="58" rx="2.3" ry="3" />
        <ellipse class="m-eye" cx="68" cy="58" rx="2.3" ry="3" />
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
    </svg>
  `,
})
export class MascotArt {
  readonly hero = input<Hero>('moroz');
  readonly mood = input<Mood>('classic');
  readonly talking = input(false);
}
