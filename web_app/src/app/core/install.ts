import { Injectable, inject, signal } from '@angular/core';
import { Telegram } from './telegram';

/** Chrome / Edge / Samsung: the browser's own install dialog, shown on our button */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * How the app can be put on the home screen here:
 * - `prompt` — the browser can show its install dialog (Android, desktop Chrome);
 * - `ios` — Safari has no dialog: we explain "Share → Add to Home Screen";
 * - `telegram` — a home screen shortcut to the Mini App (Telegram 8.0+).
 */
export type InstallWay = 'prompt' | 'ios' | 'telegram';

/**
 * The browser says "installable" once, early — often before the app has started (it waits
 * for Telegram's script and the texts). Caught right in main.ts, kept here until `init`.
 */
let early: InstallPromptEvent | undefined;
const onEarly = (e: Event) => {
  // Our own button shows the dialog (and the first visit gets no offer at all)
  e.preventDefault();
  early = e as InstallPromptEvent;
};

/** Called by main.ts before the app starts */
export function catchInstallPrompt(): void {
  addEventListener('beforeinstallprompt', onEarly);
}

const DISMISSED = 'santa.install.dismissed';
const VISITS = 'santa.visits';
/** "Not now" hides the offer for this long */
const QUIET_DAYS = 10;
/** The offer is not shown on the very first visit: first the person should look around */
const FROM_VISIT = 2;

@Injectable({ providedIn: 'root' })
export class Install {
  private readonly tg = inject(Telegram);
  private deferred?: InstallPromptEvent;

  /** How to offer the install now (null: nothing to offer) */
  readonly way = signal<InstallWay | null>(null);

  /**
   * Safari on iPhone / iPad, not from the Home Screen: no push notifications here
   * (iOS gives them only to a site added to the Home Screen)
   */
  readonly iosBrowser = !this.tg.isMiniApp && this.ios() && !this.standalone();

  init(): void {
    const visits = this.countVisit();
    // On iPhone right away: without the Home Screen the gift can't be announced by a notification
    const from = this.iosBrowser ? 1 : FROM_VISIT;
    removeEventListener('beforeinstallprompt', onEarly);
    if (this.standalone() || this.dismissedRecently() || visits < from) return;

    if (this.tg.isMiniApp) {
      this.tg.homeScreenStatus().then((status) => {
        if (status === 'missed' || status === 'unknown') this.way.set('telegram');
      });
      return;
    }
    const offer = (e: Event) => {
      e.preventDefault();
      this.deferred = e as InstallPromptEvent;
      this.way.set('prompt');
    };
    // Already came before the app started, or comes later
    if (early) offer(early);
    addEventListener('beforeinstallprompt', offer);
    addEventListener('appinstalled', () => this.way.set(null));
    if (this.ios()) this.way.set('ios');
  }

  /** Shows the install dialog; for iOS the caller shows the steps instead */
  async install(): Promise<void> {
    const way = this.way();
    if (way === 'telegram') {
      this.tg.addToHomeScreen(() => this.way.set(null));
    } else if (way === 'prompt' && this.deferred) {
      await this.deferred.prompt();
      const { outcome } = await this.deferred.userChoice;
      this.deferred = undefined;
      if (outcome === 'accepted') this.way.set(null);
      else this.dismiss();
    }
  }

  dismiss(): void {
    this.way.set(null);
    try {
      localStorage.setItem(DISMISSED, String(Date.now()));
    } catch {}
  }

  private standalone(): boolean {
    const nav = navigator as Navigator & { standalone?: boolean };
    return !!nav.standalone || !!window.matchMedia?.('(display-mode: standalone)').matches;
  }

  private ios(): boolean {
    const ua = navigator.userAgent;
    // iPadOS pretends to be a Mac, but has touch
    const apple =
      /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    return apple && /Safari/.test(ua);
  }

  private dismissedRecently(): boolean {
    try {
      const at = Number(localStorage.getItem(DISMISSED) ?? 0);
      return Date.now() - at < QUIET_DAYS * 86_400_000;
    } catch {
      return false;
    }
  }

  private countVisit(): number {
    try {
      const n = Number(localStorage.getItem(VISITS) ?? 0) + 1;
      localStorage.setItem(VISITS, String(n));
      return n;
    } catch {
      return FROM_VISIT;
    }
  }
}
