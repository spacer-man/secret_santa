import { Injectable, computed, inject, signal } from '@angular/core';
import { confetti } from '../components/fx/confetti';
import { Api, ApiError, ShopData, ShopItem } from './api';
import { I18n } from './i18n';
import { Store } from './store';
import { Telegram } from './telegram';

export type BuyResult = 'ok' | 'poor' | 'error';

/** Emoji of known shop items; unknown ones get a gift */
const ICONS: Record<string, string> = {
  'candy-cane': '🍬',
  'candy-cane-green': '🌿',
  lantern: '🏮',
  'snowman-classic': '☃️',
  snowman: '⛄',
  sled: '🛷',
  'sled-long': '🛷',
  reindeer: '🦌',
  gingerbread: '🍪',
  nutcracker: '💂',
  'lights-multi': '🌈',
  'lights-warm': '🤍',
  'lights-gold': '✨',
  'lights-icy': '🧊',
  'lights-candy': '🍭',
  'snow-snowfall': '🌨',
  'snow-blizzard': '🌬',
};

/**
 * Figures with a picture in `public/shop/` (rendered from the 3D models by
 * `TreeWorld.thumbnail()`, see CLAUDE.md)
 */
export const PICTURES = new Set([
  'candy-cane',
  'candy-cane-green',
  'lantern',
  'snowman-classic',
  'snowman',
  'sled',
  'sled-long',
  'reindeer',
  'gingerbread',
  'nutcracker',
]);

/** Shop catalog of the user (the catalog itself lives on the server) */
@Injectable({ providedIn: 'root' })
export class ShopState {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  private readonly store = inject(Store);
  private readonly tg = inject(Telegram);

  readonly data = signal<ShopData | null>(null);
  readonly busy = signal(false);
  readonly items = computed(() => this.data()?.items ?? []);
  readonly ownedKeys = computed(() =>
    this.items()
      .filter((i) => i.owned)
      .map((i) => i.key),
  );
  /** Owned figures that are not in the courtyard yet */
  readonly spare = computed(() =>
    this.items().filter((i) => i.category === 'figure' && i.owned && i.pad === null),
  );

  async load(): Promise<void> {
    try {
      this.data.set(await this.api.shop());
    } catch {}
  }

  item(key: string): ShopItem | undefined {
    return this.items().find((i) => i.key === key);
  }

  icon(key: string): string {
    return ICONS[key] ?? '🎁';
  }

  /** Rendered picture of the item (figures only), otherwise the emoji `icon()` is shown */
  image(key: string): string | null {
    return PICTURES.has(key) ? `/shop/${key}.webp` : null;
  }

  name(key: string): string {
    return this.i18n.dict.items[key] ?? key;
  }

  /** Buy an item: haptics, confetti and toasts are done here */
  async buy(key: string): Promise<BuyResult> {
    if (this.busy()) return 'error';
    this.busy.set(true);
    try {
      const { bonus, ...data } = await this.api.buy(key);
      this.data.set(data);
      this.tg.haptic('success');
      confetti(bonus > 0 ? 260 : 120);
      this.store.showToast(this.i18n.t('boughtToast').replace('%s', this.name(key)));
      if (bonus > 0) {
        setTimeout(
          () => this.store.showToast(this.i18n.t('setBonusToast').replace('%s', String(bonus))),
          2700,
        );
      }
      return 'ok';
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 402) {
        this.tg.haptic('error');
        this.store.showToast(this.i18n.t('shopPoor'));
        return 'poor';
      }
      if (status === 409) await this.load();
      else this.store.showToast(this.i18n.t('error'));
      return 'error';
    } finally {
      this.busy.set(false);
    }
  }

  /** Put a figure on a courtyard place (null: take it off) */
  async place(key: string, pad: number | null): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    try {
      this.data.set(await this.api.place(key, pad));
      this.tg.haptic('success');
      return true;
    } catch {
      this.store.showToast(this.i18n.t('error'));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
