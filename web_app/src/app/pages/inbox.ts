import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Delivery, Letter } from '../core/api';
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
          @for (l of g.letters; track l.id; let i = $index) {
            <section
              class="letter"
              [class.idea]="!!l.creators"
              [class.creators-letter]="!!l.creators"
            >
              @if (l.creators; as c) {
                <h2 class="letter-title">✉️ {{ i18n.t('creatorsLetter') }}</h2>
                <p class="wish-text letter-text">{{ c.text }}</p>
                <p class="letter-sign">
                  <!-- A rubber stamp with the seal of the site: a wish is plain text, it can't have one -->
                  <span class="letter-stamp">
                    <span class="seal letter-seal" aria-hidden="true"><i>❄</i></span>
                    <span class="letter-sign-name">{{ c.signature }}</span>
                  </span>
                </p>
              } @else if (l.wish; as wish) {
                @if (wishCount(g) > 1) {
                  <p class="small muted">{{ letterLabel(g, l) }}</p>
                }
                <media-list [items]="wish.media" />
                <p class="wish-text">{{ wish.text }}</p>
              } @else {
                <p class="wish-text">🎅 {{ i18n.t(l.erased ? 'erasedGift' : 'emptyGift') }}</p>
              }

              @if (l.creators || l.wish) {
                <p class="small muted">{{ i18n.t(l.creators ? 'reactCreators' : 'react') }}</p>
                <div class="reactions">
                  @for (r of reactions(); track r) {
                    <button
                      class="reaction"
                      [class.selected]="l.reaction === r"
                      (click)="react(l, r)"
                    >
                      {{ r }}
                    </button>
                  }
                </div>

                @if (l.reply) {
                  <p class="small muted">{{ i18n.t('yourReply') }}</p>
                  <blockquote>{{ l.reply }}</blockquote>
                } @else {
                  <div class="reply">
                    <textarea
                      class="textarea"
                      rows="2"
                      maxlength="1024"
                      [placeholder]="
                        i18n.t(l.creators ? 'creatorsReplyPlaceholder' : 'replyPlaceholder')
                      "
                      [(ngModel)]="drafts[l.id]"
                    ></textarea>
                    <button
                      class="btn btn-secondary"
                      [disabled]="!drafts[l.id]?.trim()"
                      (click)="reply(l)"
                    >
                      {{ i18n.t('replySend') }}
                    </button>
                  </div>
                }
              }
            </section>
          } @empty {
            <p class="wish-text">🎅 {{ i18n.t('emptyGift') }}</p>
          }
          @if (onlyCreators(g)) {
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

  protected wishCount(g: Delivery): number {
    return g.letters.filter((l) => l.wish || (!l.creators && l.erased)).length;
  }

  /** Only the creators' letter, no wishes: the "not enough greetings" text goes beside it */
  protected onlyCreators(g: Delivery): boolean {
    return g.letters.length > 0 && g.letters.every((l) => l.creators);
  }

  protected letterLabel(g: Delivery, l: Letter): string {
    const wishes = g.letters.filter((x) => !x.creators);
    return this.i18n
      .t('letterN')
      .replace('%s', String(wishes.indexOf(l) + 1))
      .replace('%s', String(wishes.length));
  }

  private update(id: string, patch: Partial<Letter>): void {
    this.gifts.update(
      (list) =>
        list?.map((g) => ({
          ...g,
          letters: g.letters.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        })) ?? null,
    );
  }

  async react(l: Letter, reaction: string): Promise<void> {
    this.tg.haptic('light');
    const previous = l.reaction;
    this.update(l.id, { reaction });
    try {
      await this.api.react(l.id, { reaction });
      if (!previous) this.store.showToast(this.i18n.t('thanks'));
    } catch {
      this.update(l.id, { reaction: previous });
      this.store.showToast(this.i18n.t('error'));
    }
  }

  async reply(l: Letter): Promise<void> {
    const text = this.drafts[l.id]?.trim();
    if (!text) return;
    try {
      const result = await this.api.react(l.id, { reply: text });
      this.update(l.id, { reply: result.reply });
      this.tg.haptic('success');
      this.store.showToast(this.i18n.t('thanks'));
    } catch {
      this.store.showToast(this.i18n.t('error'));
    }
  }
}
