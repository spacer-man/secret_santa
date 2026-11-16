import { Component, inject, output, signal } from '@angular/core';
import { I18n } from '../../core/i18n';
import { HEROES, Hero, MOODS, Mascot, Mood } from '../../core/mascot';
import { MascotArt } from './mascot-art';

/** Choice of the mascot: who he is and what character he has, with a sample line */
@Component({
  selector: 'mascot-sheet',
  imports: [MascotArt],
  template: `
    @let d = i18n.dict.mascot;
    <div
      class="sheet-backdrop"
      tabindex="-1"
      (click)="closed.emit()"
      (keydown.escape)="closed.emit()"
    ></div>
    <div class="sheet mascot-sheet" role="dialog" [attr.aria-label]="d.settings">
      <h2>{{ d.settings }}</h2>
      <div class="mascot-preview">
        <mascot-art [hero]="hero()" [mood]="mood()" />
        <p class="quote">{{ mascot.sample('greet', mood(), hero()) }}</p>
      </div>

      <h3>{{ d.who }}</h3>
      <div class="mascot-opts two">
        @for (h of heroes; track h) {
          <button class="mascot-opt" [class.selected]="h === hero()" (click)="hero.set(h)">
            <mascot-art [hero]="h" [mood]="mood()" />
            <b>{{ d.heroes[h] }}</b>
          </button>
        }
      </div>

      <h3>{{ d.character }}</h3>
      <div class="mascot-opts">
        @for (m of moods; track m) {
          <button class="mascot-opt" [class.selected]="m === mood()" (click)="mood.set(m)">
            <b>{{ d.moods[m] }}</b>
            <small>{{ d.moodHints[m] }}</small>
          </button>
        }
      </div>

      <button class="btn btn-primary wide" (click)="save()">{{ d.done }}</button>
    </div>
  `,
})
export class MascotSheet {
  protected readonly i18n = inject(I18n);
  protected readonly mascot = inject(Mascot);
  readonly closed = output();

  protected readonly heroes = HEROES;
  protected readonly moods = MOODS;
  protected readonly hero = signal<Hero>(this.mascot.hero());
  protected readonly mood = signal<Mood>(this.mascot.mood());

  save(): void {
    this.mascot.set(this.hero(), this.mood());
    this.closed.emit();
  }
}
