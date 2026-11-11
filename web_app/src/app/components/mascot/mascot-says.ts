import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { I18n } from '../../core/i18n';
import { Mascot, Topic } from '../../core/mascot';
import { MascotArt } from './mascot-art';
import { MascotSheet } from './mascot-sheet';

/** Letters per second while the mascot "types" a line */
const TYPE_MS = 22;

/**
 * The mascot with a speech bubble. He starts with `topic`; a tap on the bubble
 * moves on to the next line of `more` (tips by default). A tap on him opens
 * the choice of hero and character. Buttons inside are shown under the line.
 */
@Component({
  selector: 'mascot-says',
  imports: [MascotArt, MascotSheet],
  host: { class: 'mascot', '[class.compact]': 'compact()' },
  template: `
    <button
      class="mascot-figure"
      (click)="sheet.set(true)"
      [attr.aria-label]="i18n.dict.mascot.settings"
    >
      <mascot-art
        [hero]="mascot.hero()"
        [mood]="mascot.mood()"
        [talking]="typing()"
        [hello]="!compact()"
      />
    </button>
    <div class="mascot-bubble">
      <button class="mascot-line" (click)="nextLine()" [disabled]="!more()">
        <span class="mascot-name">{{ mascot.name() }}</span>
        <span class="mascot-text"
          >{{ shown() }}<span class="mascot-rest" aria-hidden="true">{{ rest() }}</span></span
        >
      </button>
      <ng-content />
      @if (more() && !compact()) {
        <span class="mascot-hint">{{
          mascot.chosen() ? i18n.dict.mascot.tapHint : i18n.dict.mascot.chooseHint
        }}</span>
      }
    </div>
    @if (sheet()) {
      <mascot-sheet (closed)="sheet.set(false)" />
    }
  `,
})
export class MascotSays {
  protected readonly i18n = inject(I18n);
  protected readonly mascot = inject(Mascot);

  readonly topic = input<Topic>('greet');
  /** What a tap on the bubble tells next (null: the bubble is not tappable) */
  readonly more = input<Topic | null>('tip');
  readonly compact = input(false);

  protected readonly sheet = signal(false);
  /** The whole line, the typed part and the rest (kept in place, invisible, so the bubble does not jump) */
  private readonly line = signal('');
  protected readonly shown = signal('');
  protected readonly rest = signal('');
  protected readonly typing = signal(false);
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    effect(() => {
      // A new topic, hero or character: start again
      const topic = this.topic();
      this.mascot.hero();
      this.mascot.mood();
      untracked(() => this.show(this.mascot.say(topic)));
    });
    inject(DestroyRef).onDestroy(() => clearInterval(this.timer));
  }

  nextLine(): void {
    const more = this.more();
    if (!more) return;
    // The first tap on an unfinished line just finishes it
    if (this.typing()) return this.finish();
    this.show(this.mascot.say(more));
  }

  private show(text: string): void {
    clearInterval(this.timer);
    this.line.set(text);
    if (matchMedia?.('(prefers-reduced-motion: reduce)').matches) return this.finish();
    let n = 0;
    this.typing.set(true);
    this.timer = setInterval(() => {
      n += 1;
      this.shown.set(text.slice(0, n));
      this.rest.set(text.slice(n));
      if (n >= text.length) this.finish();
    }, TYPE_MS);
  }

  private finish(): void {
    clearInterval(this.timer);
    this.shown.set(this.line());
    this.rest.set('');
    this.typing.set(false);
  }
}
