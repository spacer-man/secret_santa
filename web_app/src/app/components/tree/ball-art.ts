import { Component, input } from '@angular/core';

export const BALL_COLORS: Record<string, [string, string]> = {
  // [main, dark]
  red: ['#ff2d55', '#8a0022'],
  gold: ['#ffd36b', '#a8670a'],
  silver: ['#eef3fb', '#7d8aa3'],
  blue: ['#4d9bff', '#0b2f8a'],
  green: ['#2fe08a', '#06603a'],
  purple: ['#b07cff', '#43158f'],
  pink: ['#ff8ac4', '#a3165c'],
  orange: ['#ffa040', '#a54200'],
};

/** Shared gradients/patterns: put once into every <svg> that draws balls */
@Component({
  selector: 'svg:defs[ballDefs]',
  template: `
    @for (c of colors; track c[0]) {
      <svg:radialGradient [attr.id]="'ball-' + c[0]" cx="35%" cy="30%" r="75%">
        <svg:stop offset="0%" stop-color="#fff" stop-opacity="0.95" />
        <svg:stop offset="18%" [attr.stop-color]="c[1][0]" />
        <svg:stop offset="100%" [attr.stop-color]="c[1][1]" />
      </svg:radialGradient>
      <svg:radialGradient [attr.id]="'halo-' + c[0]">
        <svg:stop offset="0%" stop-color="#fff" stop-opacity="0.9" />
        <svg:stop offset="22%" [attr.stop-color]="c[1][0]" stop-opacity="0.85" />
        <svg:stop offset="50%" [attr.stop-color]="c[1][0]" stop-opacity="0.3" />
        <svg:stop offset="100%" [attr.stop-color]="c[1][0]" stop-opacity="0" />
      </svg:radialGradient>
    }
    <svg:pattern id="pat-stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <svg:rect width="2.4" height="6" fill="#fff" />
    </svg:pattern>
    <svg:pattern id="pat-dots" width="6" height="6" patternUnits="userSpaceOnUse">
      <svg:circle cx="3" cy="3" r="1.3" fill="#fff" />
    </svg:pattern>
    <svg:pattern id="pat-zigzag" width="8" height="6" patternUnits="userSpaceOnUse">
      <svg:polyline points="0,4 2,1.5 4,4 6,1.5 8,4" fill="none" stroke="#fff" stroke-width="1.1" />
    </svg:pattern>
    <svg:pattern id="pat-stars" width="9" height="9" patternUnits="userSpaceOnUse">
      <svg:path d="M4.5 1.2l.9 2.1 2.3.2-1.7 1.5.5 2.2-2-1.2-2 1.2.5-2.2L1.3 3.5l2.3-.2z" fill="#fff" />
    </svg:pattern>
    <svg:radialGradient id="inner-light" cx="50%" cy="55%">
      <svg:stop offset="0%" stop-color="#fff" stop-opacity="0.55" />
      <svg:stop offset="70%" stop-color="#fff" stop-opacity="0" />
    </svg:radialGradient>
    <svg:radialGradient id="glow-warm">
      <svg:stop offset="0%" stop-color="#ffd27a" stop-opacity="0.9" />
      <svg:stop offset="100%" stop-color="#ffb347" stop-opacity="0" />
    </svg:radialGradient>
  `,
})
export class BallDefs {
  protected readonly colors = Object.entries(BALL_COLORS);
}

/** One ball, centered at 0,0 with radius 10 (scale with transform) */
@Component({
  selector: 'svg:g[ballArt]',
  host: { '[class]': '"ball " + state()' },
  template: `
    @if (state() === 'lit') {
      <svg:circle class="halo" r="32" [attr.fill]="'url(#halo-' + color() + ')'" />
    }
    <svg:line x1="0" y1="-17" x2="0" y2="-11" stroke="#d9c38a" stroke-width="0.8" />
    <svg:rect x="-3" y="-12.5" width="6" height="3.6" rx="1" fill="#d9b25a" />
    <svg:circle r="10" [attr.fill]="'url(#ball-' + color() + ')'" />
    @switch (pattern()) {
      @case ('snowflake') {
        <svg:g stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity="0.75">
          <svg:path d="M0-6V6M-5.2-3L5.2 3M-5.2 3L5.2-3M0-6l-1.5-1.5M0-6l1.5-1.5M0 6l-1.5 1.5M0 6l1.5 1.5" />
        </svg:g>
      }
      @case ('plain') {}
      @default {
        <svg:circle r="10" [attr.fill]="'url(#pat-' + pattern() + ')'" opacity="0.45" />
      }
    }
    @if (state() === 'lit') {
      <svg:circle r="10" fill="url(#inner-light)" />
    } @else {
      <svg:circle r="10" fill="#0a0a1e" opacity="0.32" />
    }
    <svg:ellipse cx="-3.6" cy="-4.2" rx="3" ry="1.8" fill="#fff" opacity="0.55" transform="rotate(-35 -3.6 -4.2)" />
    @if (sparkles()) {
      <svg:path class="sparkle" d="M12-12l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z" fill="#fff6c9" />
    }
  `,
})
export class BallArt {
  readonly color = input('red');
  readonly pattern = input('plain');
  readonly state = input<'box' | 'hung' | 'lit'>('hung');
  readonly sparkles = input(false);
}
