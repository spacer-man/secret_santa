import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ShopCategory, ShopItem } from '../../core/api';
import { I18n, Key } from '../../core/i18n';
import { ShopState } from '../../core/shop';
import { Store } from '../../core/store';
import { Telegram } from '../../core/telegram';

const TABS: { key: ShopCategory; label: Key }[] = [
  { key: 'figure', label: 'tabFigure' },
  { key: 'lights', label: 'tabLights' },
  { key: 'weather', label: 'tabWeather' },
];

/** Buyable items first, milestone gifts after them in order of friends needed */
const rank = (it: ShopItem): number => (it.friends ? 1e6 + it.friends : 0);

/** Content of the shop sheet: tabs, item cards and collections */
@Component({
  selector: 'shop-sheet',
  template: `
    <div class="sheet-emoji shop-emoji">🛍</div>
    <h2>{{ i18n.t('shopTitle') }}</h2>
    <p class="shop-balance">{{ f('shopBalance', shop.data()?.balance ?? 0) }}</p>

    <div class="shop-tabs" role="tablist">
      @for (tab of tabs; track tab.key) {
        <button
          role="tab"
          class="shop-tab"
          [class.active]="category() === tab.key"
          [attr.aria-selected]="category() === tab.key"
          (click)="selectTab(tab.key)"
        >
          {{ i18n.t(tab.label) }}
        </button>
      }
    </div>

    @if (shop.data()) {
      @if (category() === 'figure' && !canPlace()) {
        <p class="small muted">{{ i18n.t('no3dPlace') }}</p>
      }
      <div class="shop-grid">
        @for (it of list(); track it.key) {
          <div class="shop-card" [attr.data-rarity]="it.rarity" [class.owned]="it.owned">
            <div class="card-icon">
              @if (shop.image(it.key); as src) {
                <img [src]="src" alt="" loading="lazy" />
              } @else {
                {{ shop.icon(it.key) }}
              }
            </div>
            <b class="card-name">{{ shop.name(it.key) }}</b>
            <span class="rarity">{{ rarityText(it.rarity) }}</span>
            <div class="card-action">
              @if (it.owned) {
                <span class="mark">{{ i18n.t(it.friends ? 'receivedMark' : 'ownedMark') }}</span>
                @if (it.category === 'figure' && canPlace()) {
                  @if (it.pad !== null) {
                    <span class="small muted">{{ i18n.t('inYard') }}</span>
                  }
                  <button class="card-btn" (click)="placeFigure.emit(it.key)">
                    {{ i18n.t(it.pad === null ? 'placeFigure' : 'moveFigure') }}
                  </button>
                  @if (it.pad !== null) {
                    <button class="card-btn quiet" [disabled]="shop.busy()" (click)="remove(it)">
                      {{ i18n.t('removeFigure') }}
                    </button>
                  }
                }
              } @else if (it.friends > 0) {
                <span class="gift">{{ giftText(it.friends) }}</span>
                <div class="friends-bar">
                  <span [style.width.%]="friendsPercent(it)"></span>
                </div>
                <span class="small muted">👥 {{ friends() }}/{{ it.friends }}</span>
              } @else if (confirming() === it.key) {
                <span class="confirm-q">{{ f('buyConfirm', it.price) }}</span>
                <div class="confirm-row">
                  <button class="card-btn primary" [disabled]="shop.busy()" (click)="buy(it)">
                    {{ i18n.t('buyYes') }}
                  </button>
                  <button class="card-btn quiet" (click)="confirming.set(null)">
                    {{ i18n.t('buyNo') }}
                  </button>
                </div>
              } @else {
                <button class="card-btn price" [disabled]="lack(it) > 0" (click)="ask(it)">
                  {{ f('buyBtn', it.price) }}
                </button>
                @if (lack(it) > 0) {
                  <span class="small lack">{{ f('notEnough', lack(it)) }}</span>
                }
              }
            </div>
          </div>
        }
      </div>

      @for (set of sets(); track set.key) {
        <div class="shop-set" [class.done]="set.done">
          <div class="set-head">
            <b>{{ setName(set.key) }}</b>
            <span class="set-count">{{ ownedInSet(set.items) }}/{{ set.items.length }}</span>
          </div>
          <div class="set-icons">
            @for (key of set.items; track key) {
              <span [class.have]="shop.item(key)?.owned" [title]="shop.name(key)">
                @if (shop.image(key); as src) {
                  <img [src]="src" alt="" loading="lazy" />
                } @else {
                  {{ shop.icon(key) }}
                }
              </span>
            }
          </div>
          <span class="set-bonus">{{
            set.done ? i18n.t('setDone') : f('setBonus', set.bonus)
          }}</span>
        </div>
      }
      <p class="small muted">{{ i18n.t('shopHint') }}</p>
    } @else {
      <p class="muted">{{ i18n.t('loading') }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    h2 {
      margin: 0;
    }
    .shop-emoji {
      font-size: 2.4rem;
      line-height: 1;
    }
    .shop-balance {
      margin: 0;
      font-weight: 800;
      color: var(--orange);
    }
    .shop-tabs {
      display: flex;
      gap: 0.4rem;
      background: var(--paper-3);
      border-radius: 2px;
      padding: 0.25rem;
    }
    .shop-tab {
      flex: 1;
      min-height: 2.5rem;
      font: inherit;
      font-weight: 700;
      font-size: 0.9rem;
      color: var(--second-text-color);
      background: transparent;
      border: 0;
      border-radius: 2px;
      font-family: var(--slab);
      cursor: pointer;
    }
    .shop-tab.active {
      color: var(--paper);
      background: var(--ink);
    }
    .shop-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.6rem;
    }
    .shop-card {
      --accent: var(--rarity-common);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      padding: 0.8rem 0.5rem 0.6rem;
      /* The frame (in the colour of the rarity) is drawn by hand: core/handmade.ts */
      min-width: 0;
    }
    .shop-card[data-rarity='rare'] {
      --accent: var(--rarity-rare);
    }
    .shop-card[data-rarity='epic'] {
      --accent: var(--rarity-epic);
    }
    .shop-card[data-rarity='legendary'] {
      --accent: var(--rarity-legendary);
    }
    .card-icon {
      font-size: 2.3rem;
      line-height: 1.1;
    }
    .card-icon {
      position: relative;
    }
    .card-icon img {
      position: relative;
      display: block;
      width: 5.2rem;
      height: 5.2rem;
      margin: -0.3rem auto -0.2rem;
      filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.3));
    }
    .set-icons img {
      display: block;
      width: 2rem;
      height: 2rem;
    }
    .card-name {
      font-size: 0.92rem;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }
    .rarity {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.03em;
      color: var(--accent);
    }
    .card-action {
      width: 100%;
      margin-top: auto;
      padding-top: 0.35rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.3rem;
    }
    .card-btn {
      width: 100%;
      min-height: 2.5rem;
      font: inherit;
      font-weight: 700;
      font-size: 0.88rem;
      font-family: var(--slab);
      color: var(--ink);
      background: transparent;
      border: 1.5px solid var(--rule);
      border-radius: 2px;
      padding: 0.4rem 0.3rem;
      cursor: pointer;
    }
    .card-btn.price,
    .card-btn.primary {
      /* The block of ink is drawn by hand */
      color: var(--on-stamp);
      border-color: transparent;
    }
    .card-btn.quiet {
      color: var(--second-text-color);
      border: 1px dashed var(--rule-soft);
    }
    .card-btn:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .confirm-q {
      font-weight: 700;
      font-size: 0.85rem;
      color: var(--orange);
    }
    .confirm-row {
      width: 100%;
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 0.3rem;
    }
    .lack {
      color: var(--stamp);
    }
    .mark {
      color: var(--green-color);
      font-weight: 700;
      font-size: 0.88rem;
    }
    .gift {
      font-weight: 700;
      font-size: 0.85rem;
      color: var(--gold-color);
    }
    .friends-bar {
      width: 100%;
      height: 0.4rem;
      background: var(--paper-3);
      border-radius: 1rem;
      overflow: hidden;
    }
    .friends-bar span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--primary-color), var(--gold-color));
    }
    .shop-set {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 0.3rem 0.6rem;
      text-align: left;
      padding: 0.7rem 0.8rem;
      background: rgba(255, 209, 102, 0.06);
      border: 1px dashed rgba(255, 209, 102, 0.4);
      border-radius: 1rem;
    }
    .shop-set.done {
      border-style: solid;
      border-color: var(--green-color);
      background: rgba(6, 214, 160, 0.08);
    }
    .set-head {
      display: flex;
      gap: 0.6rem;
      align-items: baseline;
    }
    .set-count {
      color: var(--second-text-color);
      font-size: 0.85rem;
    }
    .set-icons {
      grid-column: 1;
      display: flex;
      gap: 0.35rem;
      font-size: 1.3rem;
    }
    .set-icons span {
      opacity: 0.3;
      filter: grayscale(1);
    }
    .set-icons span.have {
      opacity: 1;
      filter: none;
    }
    .set-bonus {
      grid-column: 2;
      grid-row: 1 / span 2;
      font-weight: 800;
      color: var(--orange);
      white-space: nowrap;
    }
    .done .set-bonus {
      color: var(--green-color);
    }
  `,
})
export class ShopSheet {
  protected readonly i18n = inject(I18n);
  protected readonly shop = inject(ShopState);
  private readonly tg = inject(Telegram);
  private readonly store = inject(Store);

  /** Figures can be placed only in the 3D yard */
  readonly canPlace = input(true);
  /** Something was bought or moved: the tree should be reloaded */
  readonly changed = output<void>();
  /** The user wants to choose a courtyard place for this figure */
  readonly placeFigure = output<string>();

  protected readonly tabs = TABS;
  protected readonly category = signal<ShopCategory>('figure');
  protected readonly confirming = signal<string | null>(null);

  protected readonly friends = computed(() => this.shop.data()?.friends ?? 0);
  protected readonly list = computed(() =>
    this.shop
      .items()
      .filter((i) => i.category === this.category())
      // Buyable by price first, milestone gifts at the end
      .sort((a, b) => rank(a) - rank(b) || a.price - b.price),
  );
  protected readonly sets = computed(() => {
    const cat = this.category();
    return (this.shop.data()?.sets ?? []).filter((s) =>
      s.items.some((key) => this.shop.item(key)?.category === cat),
    );
  });

  constructor() {
    this.shop.load();
  }

  protected f(key: Key, value: number): string {
    return this.i18n.t(key).replace('%s', String(value));
  }

  protected setName(key: string): string {
    return this.i18n.dict.sets[key] ?? key;
  }

  protected rarityText(rarity: string): string {
    return this.i18n.dict.rarity[rarity] ?? rarity;
  }

  protected giftText(n: number): string {
    return this.f(n === 1 ? 'giftForOne' : 'giftFor', n);
  }

  protected friendsPercent(it: ShopItem): number {
    return Math.min(100, (this.friends() / it.friends) * 100);
  }

  protected lack(it: ShopItem): number {
    return Math.max(0, it.price - (this.shop.data()?.balance ?? 0));
  }

  protected ownedInSet(keys: string[]): number {
    return keys.filter((k) => this.shop.item(k)?.owned).length;
  }

  protected selectTab(tab: ShopCategory): void {
    this.tg.haptic('light');
    this.category.set(tab);
    this.confirming.set(null);
  }

  protected ask(it: ShopItem): void {
    this.tg.haptic('light');
    this.confirming.set(it.key);
  }

  protected async buy(it: ShopItem): Promise<void> {
    const result = await this.shop.buy(it.key);
    this.confirming.set(null);
    if (result === 'ok') this.changed.emit();
  }

  protected async remove(it: ShopItem): Promise<void> {
    if (await this.shop.place(it.key, null)) {
      this.store.showToast(this.i18n.t('removedToast'));
      this.changed.emit();
    }
  }
}
