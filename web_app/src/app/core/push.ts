import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api';
import { Install } from './install';
import { Telegram } from './telegram';

/**
 * Web Push in this browser: the service worker (public/sw.js) shows what the server sends.
 * - unsupported: no Push API (or the Telegram Mini App: its web view doesn't keep subscriptions);
 * - ios-install: iPhone Safari gets push only for a site added to the Home Screen;
 * - server-off: the server has no VAPID keys;
 * - denied: the person blocked notifications in the browser;
 * - off / on: whether this browser is subscribed.
 */
export type PushState = 'unsupported' | 'ios-install' | 'server-off' | 'denied' | 'off' | 'on';

const SW_WAIT_MS = 4000;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

@Injectable({ providedIn: 'root' })
export class Push {
  private readonly api = inject(Api);
  private readonly tg = inject(Telegram);
  private readonly install = inject(Install);

  readonly state = signal<PushState>('unsupported');

  private get supported(): boolean {
    return (
      !this.tg.isMiniApp &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  /** The service worker, if there is one (none in development) */
  private async registration(): Promise<ServiceWorkerRegistration | null> {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_WAIT_MS));
    return Promise.race([navigator.serviceWorker.ready, timeout]);
  }

  async refresh(vapidKey: string | null | undefined): Promise<PushState> {
    let state: PushState;
    if (this.install.iosBrowser) state = 'ios-install';
    else if (!this.supported) state = 'unsupported';
    else if (!vapidKey) state = 'server-off';
    else if (Notification.permission === 'denied') state = 'denied';
    else {
      const reg = await this.registration();
      const sub = await reg?.pushManager.getSubscription().catch(() => null);
      state = sub ? 'on' : 'off';
    }
    this.state.set(state);
    return state;
  }

  /** Asks the permission and subscribes this browser; false if it didn't work out */
  async enable(vapidKey: string): Promise<boolean> {
    if (!this.supported) return false;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      this.state.set(permission === 'denied' ? 'denied' : 'off');
      return false;
    }
    const reg = await this.registration();
    if (!reg) return false;
    try {
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(vapidKey),
        }));
      await this.api.pushSubscribe(sub.toJSON());
      this.state.set('on');
      return true;
    } catch {
      return false;
    }
  }

  async disable(): Promise<void> {
    const reg = this.supported ? await this.registration() : null;
    const sub = await reg?.pushManager.getSubscription().catch(() => null);
    if (sub) {
      await this.api.pushRemove(sub.endpoint).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    this.state.set('off');
  }
}
