import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Delivery } from '../core/api';
import { I18n } from '../core/i18n';
import { Store } from '../core/store';
import { Telegram } from '../core/telegram';
import { MediaList } from '../components/media';

@Component({
  selector: 'inbox-page',
  imports: [MediaList, FormsModule],
  template: `
    <h1 class="page-title">🎁 {{ i18n.t('inbox') }}</h1>
    @if (gifts(); as list) {
      @for (g of list; track g.id) {
        <article class="card wish gift-card">
          <div class="row between small">
            <span class="badge approved">🎄 {{ g.year }}</span>
            <span class="muted">{{ i18n.t('fromSanta') }}</span>
          </div>
          @if (g.wish; as wish) {
            <media-list [items]="wish.media" />
            <p class="wish-text">{{ wish.text }}</p>

            <p class="small muted">{{ i18n.t('react') }}</p>
            <div class="reactions">
              @for (r of reactions(); track r) {
                <button class="reaction" [class.selected]="g.reaction === r" (click)="react(g, r)">
                  {{ r }}
                </button>
              }
            </div>

            @if (g.reply) {
              <p class="small muted">{{ i18n.t('yourReply') }}</p>
              <blockquote>{{ g.reply }}</blockquote>
            } @else {
              <div class="reply">
                <textarea
                  class="textarea"
                  rows="2"
                  maxlength="1024"
                  [placeholder]="i18n.t('replyPlaceholder')"
                  [(ngModel)]="drafts[g.id]"
                ></textarea>
                <button
                  class="btn btn-secondary"
                  [disabled]="!drafts[g.id]?.trim()"
                  (click)="reply(g)"
                >
                  {{ i18n.t('replySend') }}
                </button>
              </div>
            }
          } @else {
            <p class="wish-text">🎅 {{ i18n.t('emptyGift') }}</p>
          }
        </article>
      } @empty {
        <section class="card center">
          <p class="hero-emoji">🎄</p>
          <p class="muted">{{ i18n.t('noGifts') }}</p>
        </section>
      }
    } @else {
      <p class="muted center">{{ error() || i18n.t('loading') }}</p>
    }
  `,
})
export class InboxPage {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly tg = inject(Telegram);

  protected readonly gifts = signal<Delivery[] | null>(null);
  protected readonly error = signal('');
  protected readonly reactions = () => this.store.config()?.reactions ?? [];
  protected drafts: Record<string, string> = {};

  constructor() {
    this.load();
  }

  async load(): Promise<void> {
    try {
      // Opened from the bot ("Reply anonymously") before opening the gift there
      if (this.store.gift()?.status === 'ready') {
        this.store.gift.set(await this.api.openGift());
      }
      this.gifts.set(await this.api.inbox());
    } catch {
      this.error.set(this.i18n.t('error'));
    }
  }

  private update(id: string, patch: Partial<Delivery>): void {
    this.gifts.update((list) => list?.map((g) => (g.id === id ? { ...g, ...patch } : g)) ?? null);
  }

  async react(g: Delivery, reaction: string): Promise<void> {
    this.tg.haptic('light');
    const previous = g.reaction;
    this.update(g.id, { reaction });
    try {
      await this.api.react(g.id, { reaction });
      if (!previous) this.store.showToast(this.i18n.t('thanks'));
    } catch {
      this.update(g.id, { reaction: previous });
      this.store.showToast(this.i18n.t('error'));
    }
  }

  async reply(g: Delivery): Promise<void> {
    const text = this.drafts[g.id]?.trim();
    if (!text) return;
    try {
      const result = await this.api.react(g.id, { reply: text });
      this.update(g.id, { reply: result.reply });
      this.tg.haptic('success');
      this.store.showToast(this.i18n.t('thanks'));
    } catch {
      this.store.showToast(this.i18n.t('error'));
    }
  }
}
