import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, ApiError } from '../core/api';
import { I18n } from '../core/i18n';
import { Store } from '../core/store';
import { Telegram } from '../core/telegram';
import { BALL_COLORS, BallArt, BallDefs } from '../components/tree/ball-art';

const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg';

interface Picked {
  file: File;
  url: string;
  kind: 'image' | 'video' | 'audio';
}

@Component({
  selector: 'new-wish-page',
  imports: [FormsModule, BallArt, BallDefs],
  template: `
    <section class="card">
      <h1>✍️ {{ i18n.t('newWishTitle') }}</h1>
      <p class="muted">{{ i18n.t('newWishText') }}</p>

      <div class="designer">
        <svg viewBox="-40 -40 80 80" class="designer-ball" aria-hidden="true">
          <defs ballDefs></defs>
          <g ballArt [color]="color()" [pattern]="pattern()" state="lit"></g>
        </svg>
        <div class="designer-controls">
          <p class="small muted">{{ i18n.t('ballLook') }}</p>
          <div class="swatches">
            @for (c of colors(); track c) {
              <button class="swatch" [class.selected]="c === color()" [style.background]="swatch(c)" (click)="color.set(c)" [attr.aria-label]="c"></button>
            }
          </div>
          <div class="patterns">
            @for (p of patterns(); track p) {
              <button class="pattern-btn" [class.selected]="p === pattern()" (click)="pattern.set(p)" [attr.aria-label]="p">
                <svg viewBox="-12 -14 24 26"><defs ballDefs></defs><g ballArt [color]="color()" [pattern]="p"></g></svg>
              </button>
            }
          </div>
        </div>
      </div>

      <textarea
        class="textarea"
        rows="7"
        maxlength="4096"
        [placeholder]="i18n.t('placeholder')"
        [ngModel]="text()"
        (ngModelChange)="text.set($event)"
      ></textarea>
      <div class="row between small muted">
        <button class="link" type="button" (click)="nextIdea()">💡 {{ i18n.t('ideas') }}</button>
        <span>{{ text().length }} / 4096</span>
      </div>
      @if (idea()) {
        <p class="idea">{{ idea() }}</p>
      }

      @if (files().length) {
        <div class="previews">
          @for (p of files(); track p.url; let i = $index) {
            <div class="preview">
              @switch (p.kind) {
                @case ('image') {
                  <img [src]="p.url" alt="" />
                }
                @case ('video') {
                  <video [src]="p.url" muted playsinline></video>
                }
                @default {
                  <span class="audio">🎵 {{ p.file.name }}</span>
                }
              }
              <button class="remove" type="button" (click)="remove(i)" aria-label="Remove">✕</button>
            </div>
          }
        </div>
      }

      @if (files().length < maxFiles) {
        <label class="btn btn-ghost wide">
          📎 {{ i18n.t('addMedia') }}
          <input type="file" [accept]="accept" multiple hidden (change)="pick($event)" />
        </label>
      }

      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
      <button class="btn btn-primary wide" [disabled]="!canSend()" (click)="send()">
        {{ sending() ? i18n.t('sending') : i18n.t('send') }}
      </button>
    </section>
  `,
})
export class NewWishPage {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly tg = inject(Telegram);
  private readonly router = inject(Router);

  protected readonly accept = ACCEPT;
  protected readonly maxFiles = MAX_FILES;
  protected readonly text = signal('');
  protected readonly files = signal<Picked[]>([]);
  protected readonly sending = signal(false);
  protected readonly error = signal('');
  protected readonly idea = signal('');
  protected readonly colors = computed(() => this.store.config()?.ball_colors ?? Object.keys(BALL_COLORS));
  protected readonly patterns = computed(
    () => this.store.config()?.ball_patterns ?? ['plain', 'stripes', 'dots', 'snowflake', 'zigzag', 'stars'],
  );
  protected readonly color = signal(Object.keys(BALL_COLORS)[Math.floor(Math.random() * 8)]);
  protected readonly pattern = signal('snowflake');
  protected readonly canSend = computed(() => this.text().trim().length >= 8 && !this.sending());

  private ideaIndex = Math.floor(Math.random() * 5);

  swatch(color: string): string {
    const [main, dark] = BALL_COLORS[color] ?? ['#888', '#444'];
    return `radial-gradient(circle at 35% 30%, #fff 0, ${main} 25%, ${dark} 100%)`;
  }

  nextIdea(): void {
    const ideas = this.i18n.dict.ideaList;
    this.idea.set(ideas[this.ideaIndex++ % ideas.length]);
  }

  pick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    input.value = '';
    this.error.set('');
    for (const file of picked) {
      if (this.files().length >= MAX_FILES) {
        this.error.set(this.i18n.t('tooMany'));
        break;
      }
      if (file.size > MAX_SIZE) {
        this.error.set(this.i18n.t('tooLarge'));
        continue;
      }
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'audio';
      this.files.update((list) => [...list, { file, kind, url: URL.createObjectURL(file) }]);
    }
  }

  remove(index: number): void {
    URL.revokeObjectURL(this.files()[index].url);
    this.files.update((list) => list.filter((_, i) => i !== index));
  }

  async send(): Promise<void> {
    if (this.text().trim().length < 8) {
      this.error.set(this.i18n.t('tooShort'));
      return;
    }
    this.sending.set(true);
    this.error.set('');
    try {
      await this.api.newWish(
        this.text().trim(),
        this.files().map((p) => p.file),
        { color: this.color(), pattern: this.pattern() },
      );
      this.files().forEach((p) => URL.revokeObjectURL(p.url));
      this.tg.haptic('success');
      this.store.showToast(this.i18n.t('sent'));
      this.router.navigateByUrl('/');
    } catch (err) {
      this.tg.haptic('error');
      const detail = err instanceof ApiError && err.status !== 500 ? ` (${err.message})` : '';
      this.error.set(this.i18n.t('error') + detail);
    } finally {
      this.sending.set(false);
    }
  }
}
