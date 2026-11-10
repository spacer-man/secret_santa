import { Injectable } from '@angular/core';

/** The part of Telegram.WebApp we use: https://core.telegram.org/bots/webapps */
interface TgWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { language_code?: string; first_name?: string } };
  platform: string;
  ready(): void;
  expand(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  disableVerticalSwipes?(): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

/** Works both inside Telegram (Mini App) and in a regular browser */
@Injectable({ providedIn: 'root' })
export class Telegram {
  private readonly app = window.Telegram?.WebApp;

  /** Opened as a Telegram Mini App */
  readonly isMiniApp = !!this.app?.initData;

  get initData(): string {
    return this.app?.initData ?? '';
  }

  get startParam(): string | undefined {
    return this.app?.initDataUnsafe.start_param;
  }

  get language(): string {
    return this.app?.initDataUnsafe.user?.language_code ?? navigator.language ?? 'en';
  }

  init(): void {
    if (!this.isMiniApp || !this.app) return;
    this.app.ready();
    this.app.expand();
    this.app.disableVerticalSwipes?.();
    this.app.setHeaderColor('#0a0a11');
    this.app.setBackgroundColor('#0a0a11');
  }

  haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'error' = 'light'): void {
    const h = this.app?.HapticFeedback;
    if (!h) {
      navigator.vibrate?.(kind === 'heavy' ? 40 : 10);
      return;
    }
    if (kind === 'success' || kind === 'error') h.notificationOccurred(kind);
    else h.impactOccurred(kind);
  }

  /** Telegram BackButton in the Mini App; returns a cleanup function */
  backButton(onClick: () => void): () => void {
    const button = this.app?.BackButton;
    if (!this.isMiniApp || !button) return () => {};
    button.onClick(onClick);
    button.show();
    return () => {
      button.offClick(onClick);
      button.hide();
    };
  }

  openLink(url: string): void {
    if (this.isMiniApp && url.startsWith('https://t.me/')) this.app!.openTelegramLink(url);
    else if (this.isMiniApp) this.app!.openLink(url);
    else window.open(url, '_blank', 'noopener');
  }
}
