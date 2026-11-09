import { Component, computed, effect, inject, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { Store } from '../core/store';
import { Telegram } from '../core/telegram';
import { newYearMoment } from '../core/time';
import { Countdown } from '../components/countdown';
import { GiftBox } from '../components/gift-box';
import { Wave } from '../components/wave';
import { confetti } from '../components/fx/confetti';

@Component({
  selector: 'home-page',
  imports: [Countdown, GiftBox, Wave, RouterLink],
  template: `
    @let gift = store.gift();
    <section class="card center festive">
      @if (gift?.status === 'ready') {
        <h2>🎁 {{ i18n.t('giftReady') }}</h2>
        <gift-box (opened)="open()" />
        <p class="muted">{{ i18n.t('giftTap') }}</p>
      } @else if (gift?.status === 'opened') {
        <countdown [target]="target()" />
        <a class="btn btn-primary" routerLink="/inbox">🎁 {{ i18n.t('giftShow') }}</a>
      } @else {
        <countdown [target]="target()" />
        <p class="muted small">{{ i18n.t('giftWaiting') }}</p>
      }
    </section>

    @if (store.stats(); as stats) {
      <section class="stats">
        <div><b>{{ stats.participants }}</b><span>{{ i18n.t('participants') }}</span></div>
        <div><b>{{ stats.wishes }}</b><span>{{ i18n.t('wishesCount') }}</span></div>
        <div><b>{{ zones() }}</b><span>{{ i18n.t('timezonesCount') }}</span></div>
      </section>
    }

    <section class="card">
      <h2>✍️ {{ i18n.t('writeWish') }}</h2>
      <p class="muted">{{ i18n.t('writeWishHint') }}</p>
      <a class="btn btn-primary wide" routerLink="/new">{{ i18n.t('writeWish') }}</a>
    </section>

    @if (store.me()?.invite_link) {
      <section class="card">
        <h2>🔗 {{ i18n.t('invite') }}</h2>
        <p class="muted">{{ i18n.t('inviteHint') }}</p>
        <div class="row">
          <button class="btn btn-secondary" (click)="share()">{{ i18n.t('invite') }}</button>
          <button class="btn btn-ghost" (click)="copy()" aria-label="Copy">📋</button>
        </div>
        @if (store.me()?.invited) {
          <p class="small">{{ i18n.t('invited') }}: <b>{{ store.me()?.invited }}</b> 🎉</p>
        }
      </section>
    }

    <wave />

    <section class="card row between">
      <span>{{ i18n.t('timezone') }}: <b>{{ store.me()?.timezone }}</b></span>
      <a class="link" routerLink="/register">{{ i18n.t('change') }}</a>
    </section>
  `,
})
export class HomePage {
  protected readonly i18n = inject(I18n);
  protected readonly store = inject(Store);
  private readonly api = inject(Api);
  private readonly tg = inject(Telegram);
  private readonly router = inject(Router);

  protected readonly target = computed(() =>
    newYearMoment(this.store.me()?.timezone ?? 'UTC+0', this.store.now()),
  );
  protected readonly zones = computed(() => Object.keys(this.store.stats()?.timezones ?? {}).length);

  private celebrated = false;

  constructor() {
    // Midnight: fireworks, and the gift appears without reloading
    effect(() => {
      const midnight = this.store.gift()?.status === 'waiting' && this.target() <= this.store.now();
      if (!midnight || this.celebrated) return;
      this.celebrated = true;
      untracked(() => {
        confetti();
        // The bot needs a moment to send gifts
        setTimeout(() => this.store.refreshGift(), 5000);
        this.store.refreshStats();
      });
    });
  }

  async open(): Promise<void> {
    this.tg.haptic('heavy');
    try {
      this.store.gift.set(await this.api.openGift());
      confetti();
      this.tg.haptic('success');
      this.router.navigateByUrl('/inbox');
    } catch {
      this.store.showToast(this.i18n.t('error'));
    }
  }

  share(): void {
    const link = this.store.me()?.invite_link;
    if (!link) return;
    const text = this.i18n.t('inviteText');
    if (!this.tg.isMiniApp && navigator.share) {
      navigator.share({ text, url: link }).catch(() => {});
      return;
    }
    this.tg.openLink(
      `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
    );
  }

  async copy(): Promise<void> {
    const link = this.store.me()?.invite_link;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.store.showToast(this.i18n.t('copied'));
      this.tg.haptic('light');
    } catch {
      this.store.showToast(link);
    }
  }
}
