import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { I18n } from './core/i18n';
import { Store } from './core/store';
import { Telegram } from './core/telegram';
import { Snow } from './components/fx/snow';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Snow],
  template: `
    <snow />
    <main class="page" [class.with-tabs]="showTabs()">
      <router-outlet />
    </main>

    @if (showTabs()) {
      <nav class="tabs">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"><span>🎄</span>{{ i18n.t('navHome') }}</a>
        <a routerLink="/new" routerLinkActive="active"><span>✍️</span>{{ i18n.t('navWrite') }}</a>
        <a routerLink="/wishes" routerLinkActive="active"><span>❤️</span>{{ i18n.t('navMine') }}</a>
        <a routerLink="/inbox" routerLinkActive="active">
          <span>🎁@if (store.gift()?.status === 'ready') {<i class="dot"></i>}</span>{{ i18n.t('navGifts') }}
        </a>
      </nav>
    }

    @if (store.toast(); as toast) {
      <div class="toast" role="status">{{ toast }}</div>
    }
  `,
})
export class App {
  protected readonly i18n = inject(I18n);
  protected readonly store = inject(Store);
  private readonly tg = inject(Telegram);
  private readonly router = inject(Router);

  protected readonly showTabs = signal(false);
  private hideBack = () => {};

  constructor() {
    this.tg.init();
    document.documentElement.lang = this.i18n.lang();
    document.title = this.i18n.t('appName');

    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      const path = (e as NavigationEnd).urlAfterRedirects.split('?')[0];
      this.showTabs.set(!['/login', '/register'].includes(path) || this.store.registered());
      this.hideBack();
      this.hideBack = path === '/' ? () => {} : this.tg.backButton(() => this.router.navigateByUrl('/'));
    });

    // Deep link from the bot: t.me/<bot>/<app>?startapp=inbox
    if (this.tg.startParam === 'inbox') this.router.navigateByUrl('/inbox');
  }
}
