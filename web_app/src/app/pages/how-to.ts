import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n } from '../core/i18n';
import { Store } from '../core/store';
import { PICTURES } from '../core/shop';
import { markRulesSeen } from '../core/onboarding';
import { MascotSays } from '../components/mascot/mascot-says';

/** Gifts for invited friends (see services/shop.py, `friends_required`) */
const FRIEND_GIFTS: [friends: number, item: string][] = [
  [1, 'candy-cane-green'],
  [3, 'sled-long'],
  [5, 'gingerbread'],
  [10, 'nutcracker'],
];

/** "How to play": the rules of the game on one printed sheet */
@Component({
  selector: 'how-to-page',
  imports: [RouterLink, MascotSays],
  template: `
    @let h = i18n.dict.howTo;
    <h1 class="page-title">{{ i18n.t('howToPlay') }}</h1>
    <mascot-says topic="rules" />

    <section class="card">
      <h2>{{ h.mainTitle }}</h2>
      <ol class="steps">
        <li>
          <span class="step-no">1</span><span class="rule-icon">✍️</span>
          <div>
            <b>{{ h.step1 }}</b>
            <p class="muted">{{ h.step1Text }}</p>
          </div>
        </li>
        <li>
          <span class="step-no">2</span><span class="rule-icon">🕛</span>
          <div>
            <b>{{ h.step2 }}</b>
            <p class="muted">{{ h.step2Text }}</p>
          </div>
        </li>
        <li>
          <span class="step-no">3</span><span class="rule-icon">❤️</span>
          <div>
            <b>{{ h.step3 }}</b>
            <p class="muted">{{ h.step3Text }}</p>
          </div>
        </li>
      </ol>
    </section>

    <section class="card">
      <h2>🎄 {{ h.treeTitle }}</h2>
      <p>{{ h.treeText }}</p>
      <div class="ball-path">
        <div>
          <span class="rule-icon">🎁</span><b>{{ h.ballBox }}</b
          ><small>{{ h.ballBoxHint }}</small>
        </div>
        <i aria-hidden="true">→</i>
        <div>
          <span class="rule-icon">🔴</span><b>{{ h.ballHung }}</b
          ><small>{{ h.ballHungHint }}</small>
        </div>
        <i aria-hidden="true">→</i>
        <div>
          <span class="rule-icon">✨</span><b>{{ h.ballLit }}</b
          ><small>{{ h.ballLitHint }}</small>
        </div>
      </div>
      <ul class="facts">
        <li><span>⭐</span>{{ h.star }}</li>
        <li><span>💡</span>{{ h.garland }}</li>
        <li><span>📈</span>{{ h.level }}</li>
      </ul>
    </section>

    <section class="card">
      <h2>{{ h.mandarinsTitle }}</h2>
      <p>{{ h.mandarinsText }}</p>
      <ul class="earn">
        @for (r of rewards(); track r.reason) {
          <li>
            <span>{{ reason(r.reason) }}</span
            ><b>+{{ r.amount }} 🍊</b>
          </li>
        }
      </ul>
      <p class="muted">🛍 {{ h.mandarinsSpend }}</p>
    </section>

    <section class="card">
      <h2>👫 {{ h.friendsTitle }}</h2>
      <p>{{ h.friendsText }}</p>
      <div class="friend-gifts">
        @for (g of gifts; track g.item) {
          <div>
            @if (g.picture; as src) {
              <img class="rule-icon" [src]="src" alt="" />
            } @else {
              <span class="rule-icon">🎁</span>
            }
            <small>{{ g.name }}</small>
            <b>{{ fmt(h.friendsFor, g.friends) }}</b>
          </div>
        }
      </div>
    </section>

    <section class="card">
      <h2>🤫 {{ h.fairTitle }}</h2>
      <ul class="facts">
        <li><span>🎲</span>{{ h.fair1 }}</li>
        <li><span>🎁</span>{{ h.fair2 }}</li>
        <li><span>🎭</span>{{ h.fair3 }}</li>
        <li><span>✍️</span>{{ h.fair4 }}</li>
      </ul>
    </section>

    <a class="btn btn-primary wide" routerLink="/new">✍️ {{ h.go }}</a>
  `,
})
export class HowToPage {
  protected readonly i18n = inject(I18n);
  private readonly store = inject(Store);

  protected readonly rewards = computed(() =>
    Object.entries(this.store.config()?.rewards ?? {}).map(([reason, amount]) => ({
      reason,
      amount,
    })),
  );

  protected readonly gifts = FRIEND_GIFTS.map(([friends, item]) => ({
    friends,
    item,
    name: this.i18n.dict.items[item] ?? item,
    picture: PICTURES.has(item) ? `/shop/${item}.webp` : null,
  }));

  constructor() {
    markRulesSeen();
    // The page is open without signing in too: the rewards come from the config
    this.store.load().catch(() => {});
  }

  reason(key: string): string {
    return this.i18n.dict.reasons[key] ?? key;
  }

  fmt(template: string, n: number): string {
    return template.replace('%s', String(n));
  }
}
