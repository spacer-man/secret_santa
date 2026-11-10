import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Api, Config, Gift, Me, Stats } from './api';
import { Telegram } from './telegram';

const REF_KEY = 'santa.ref';

/** App-wide state */
@Injectable({ providedIn: 'root' })
export class Store {
  private readonly api = inject(Api);
  private readonly tg = inject(Telegram);

  readonly config = signal<Config | null>(null);
  readonly me = signal<Me | null>(null);
  readonly stats = signal<Stats | null>(null);
  readonly gift = signal<Gift | null>(null);
  readonly toast = signal<string | null>(null);

  /** Ticks every second: drives countdowns */
  readonly now = signal(Date.now());

  readonly registered = computed(() => !!this.me()?.registered);

  private loading?: Promise<void>;

  constructor() {
    setInterval(() => this.now.set(Date.now()), 1000);
    // Website referral links: https://site/?ref=r_xxx
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref) this.ref = ref;
  }

  get ref(): string | null {
    if (this.tg.startParam?.startsWith('r_')) return this.tg.startParam;
    try {
      return localStorage.getItem(REF_KEY);
    } catch {
      return null;
    }
  }
  set ref(value: string | null) {
    try {
      if (value) localStorage.setItem(REF_KEY, value);
    } catch {}
  }

  /** Loads everything once; safe to call many times */
  load(force = false): Promise<void> {
    if (!this.loading || force) {
      this.loading = this.doLoad().catch((err) => {
        this.loading = undefined;
        throw err;
      });
    }
    return this.loading;
  }

  private async doLoad(): Promise<void> {
    const [config] = await Promise.all([this.api.config(), this.refreshStats()]);
    this.config.set(config);
    if (this.api.canAuth) {
      try {
        this.me.set(await this.api.me());
      } catch {
        this.me.set(null);
      }
      if (this.registered()) await this.refreshGift();
    }
  }

  async refreshStats(): Promise<void> {
    try {
      this.stats.set(await this.api.stats());
    } catch {}
  }

  async refreshGift(): Promise<void> {
    try {
      this.gift.set(await this.api.gift());
    } catch {}
  }

  showToast(text: string): void {
    this.toast.set(text);
    setTimeout(() => this.toast() === text && this.toast.set(null), 2500);
  }
}

/** Route guards: login → registration → app */
export const needsUser: CanActivateFn = async () => {
  const store = inject(Store);
  const router = inject(Router);
  const api = inject(Api);
  try {
    await store.load();
  } catch {
    return true; // Offline / server error: show the page with its own error state
  }
  if (!api.canAuth || !store.me()) return router.parseUrl('/login');
  if (!store.registered()) return router.parseUrl('/register');
  return true;
};

export const needsLogin: CanActivateFn = async () => {
  const store = inject(Store);
  const router = inject(Router);
  const api = inject(Api);
  await store.load().catch(() => {});
  if (api.canAuth && store.me()) {
    return router.parseUrl(store.registered() ? '/' : '/register');
  }
  return true;
};
