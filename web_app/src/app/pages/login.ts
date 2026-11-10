import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { I18n } from '../core/i18n';
import { Store } from '../core/store';

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

/** Website login with the Telegram Login Widget (https://core.telegram.org/widgets/login) */
@Component({
  selector: 'login-page',
  template: `
    <section class="hero">
      <div class="hero-emoji">🎅</div>
      <h1>{{ i18n.t('loginTitle') }}</h1>
      <p>{{ i18n.t('loginText') }}</p>
    </section>
    <section class="card center">
      <p class="muted">{{ i18n.t('loginHint') }}</p>
      <div #widget class="widget"></div>
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
      @if (botLink()) {
        <a class="link" [href]="botLink()" target="_blank" rel="noopener"
          >{{ i18n.t('loginOrBot') }} →</a
        >
      }
    </section>
  `,
})
export class LoginPage {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly widget = viewChild.required<ElementRef<HTMLElement>>('widget');

  protected readonly error = signal('');
  protected readonly botLink = computed(() => {
    const bot = this.store.config()?.bot_username;
    if (!bot) return '';
    const ref = this.store.ref;
    return `https://t.me/${bot}` + (ref ? `?start=${ref}` : '');
  });

  constructor() {
    afterNextRender(() => this.mountWidget());
  }

  private async mountWidget(): Promise<void> {
    await this.store.load().catch(() => {});
    const bot = this.store.config()?.bot_username;
    if (!bot) return;

    window.onTelegramAuth = async (user) => {
      try {
        await this.api.login(user);
        await this.store.load(true);
        this.router.navigateByUrl(this.store.registered() ? '/' : '/register');
      } catch {
        this.error.set(this.i18n.t('error'));
      }
    };
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.dataset['telegramLogin'] = bot;
    script.dataset['size'] = 'large';
    script.dataset['radius'] = '14';
    script.dataset['onauth'] = 'onTelegramAuth(user)';
    script.dataset['requestAccess'] = 'write';
    this.widget().nativeElement.appendChild(script);
  }
}
