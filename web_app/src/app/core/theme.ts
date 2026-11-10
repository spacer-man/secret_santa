import { Injectable, computed, inject, signal } from '@angular/core';
import { Telegram } from './telegram';

export type ThemeMode = 'auto' | 'light' | 'dark';

const KEY = 'santa.theme';
/** Backdrop behind the paper sheet (for the Telegram header and the browser bar) */
const BACKDROP = { light: '#dcdad4', dark: '#0c0d12' };

/**
 * Paper theme: light (a printed calendar sheet) or dark (the same sheet at night).
 * "auto" follows Telegram, or the system outside of it.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly tg = inject(Telegram);
  private readonly system = signal(this.detect());

  readonly mode = signal<ThemeMode>(this.stored());
  readonly dark = computed(() =>
    this.mode() === 'auto' ? this.system() === 'dark' : this.mode() === 'dark',
  );

  init(): void {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', () => this.system.set(this.detect()));
    this.tg.onThemeChanged(() => this.system.set(this.detect()));
    this.apply();
  }

  /** auto → light → dark → auto */
  cycle(): void {
    const next: ThemeMode =
      this.mode() === 'auto' ? 'light' : this.mode() === 'light' ? 'dark' : 'auto';
    this.mode.set(next);
    try {
      if (next === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {}
    this.apply();
  }

  apply(): void {
    const name = this.dark() ? 'dark' : 'light';
    document.documentElement.dataset['theme'] = name;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BACKDROP[name]);
    this.tg.setColors(BACKDROP[name]);
  }

  private detect(): 'light' | 'dark' {
    const tg = this.tg.colorScheme;
    if (tg) return tg;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  private stored(): ThemeMode {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch {
      return 'auto';
    }
  }
}
