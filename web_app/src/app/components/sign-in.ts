import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, ApiError, IdentityKind, LinkProof } from '../core/api';
import { I18n } from '../core/i18n';
import { Store } from '../core/store';
import { Telegram } from '../core/telegram';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            ux_mode?: 'popup' | 'redirect';
          }): void;
          renderButton(el: HTMLElement, options: Record<string, unknown>): void;
        };
      };
    };
    [callback: `onTelegram${string}`]: ((user: Record<string, unknown>) => void) | undefined;
  }
}

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
let googleScript: Promise<void> | undefined;

function loadGoogle(): Promise<void> {
  googleScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GOOGLE_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleScript = undefined;
      reject(new Error('Google script'));
    };
    document.head.appendChild(script);
  });
  return googleScript;
}

let widgets = 0;

/**
 * Ways to sign in: Google, Telegram (Login Widget), a code sent to an e-mail.
 * Each gives a proof of who the person is; the parent decides what to do with it:
 * sign in (login page) or link it to the account (settings).
 */
@Component({
  selector: 'sign-in',
  imports: [FormsModule],
  template: `
    <div class="sign-in">
      @if (showGoogle()) {
        <div #google class="sign-in-google"></div>
      }
      @if (showTelegram()) {
        <div #telegram class="sign-in-telegram"></div>
      }
      @if (showEmail()) {
        @if (showGoogle() || showTelegram()) {
          <p class="sign-in-or muted small">{{ i18n.t('orDivider') }}</p>
        }
        @if (!sentTo()) {
          <form class="sign-in-email" (ngSubmit)="sendCode()">
            <label class="muted small" for="si-email">{{ i18n.t('emailLabel') }}</label>
            <input
              id="si-email"
              class="input"
              type="email"
              name="email"
              autocomplete="email"
              inputmode="email"
              [placeholder]="i18n.t('emailPlaceholder')"
              [ngModel]="email()"
              (ngModelChange)="email.set($event)"
              required
            />
            <button class="btn btn-secondary" type="submit" [disabled]="busy() || !email()">
              {{ i18n.t('getCode') }}
            </button>
          </form>
        } @else {
          <form class="sign-in-email" (ngSubmit)="checkCode()">
            <p class="muted small">
              {{ i18n.t('codeSentTo') }} <b>{{ sentTo() }}</b>
            </p>
            <input
              class="input code"
              name="code"
              autocomplete="one-time-code"
              inputmode="numeric"
              maxlength="6"
              [placeholder]="i18n.t('codePlaceholder')"
              [ngModel]="code()"
              (ngModelChange)="code.set($event)"
              required
            />
            <button class="btn btn-primary" type="submit" [disabled]="busy() || code().length < 6">
              {{ i18n.t(mode() === 'link' ? 'linkBtn' : 'signInBtn') }}
            </button>
            <p class="row between small">
              <button type="button" class="link" (click)="reset()">
                {{ i18n.t('changeEmail') }}
              </button>
              @if (wait() > 0) {
                <span class="muted"
                  >{{ i18n.t('resendIn') }} {{ wait() }} {{ i18n.t('secondsShort') }}</span
                >
              } @else {
                <button type="button" class="link" (click)="sendCode()">
                  {{ i18n.t('resend') }}
                </button>
              }
            </p>
          </form>
        }
      }
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
    </div>
  `,
})
export class SignIn {
  protected readonly i18n = inject(I18n);
  private readonly store = inject(Store);
  private readonly api = inject(Api);
  private readonly tg = inject(Telegram);

  /** login: sign in with the proof; link: hand the proof to the parent */
  readonly mode = input<'login' | 'link'>('login');
  /** Ways not to offer (already linked) */
  readonly except = input<IdentityKind[]>([]);
  /** What to do with a proof of identity (sign in / link); its errors are shown here */
  readonly handle = input.required<(proof: LinkProof) => Promise<void>>();

  private readonly googleEl = viewChild<ElementRef<HTMLElement>>('google');
  private readonly telegramEl = viewChild<ElementRef<HTMLElement>>('telegram');

  protected readonly email = signal('');
  protected readonly code = signal('');
  protected readonly sentTo = signal('');
  protected readonly wait = signal(0);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  private readonly config = this.store.config;
  protected readonly showGoogle = computed(
    // Google doesn't sign in inside app web views (Telegram)
    () =>
      !!this.config()?.google_client_id && !this.tg.isMiniApp && !this.except().includes('google'),
  );
  protected readonly showTelegram = computed(
    () =>
      !!this.config()?.bot_username && !this.tg.isMiniApp && !this.except().includes('telegram'),
  );
  protected readonly showEmail = computed(
    () => !!this.config()?.email_login && !this.except().includes('email'),
  );

  private readonly callback = `onTelegram${++widgets}` as const;
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    effect(() => {
      const el = this.googleEl()?.nativeElement;
      const clientId = this.config()?.google_client_id;
      if (el && clientId) this.mountGoogle(el, clientId);
    });
    effect(() => {
      const el = this.telegramEl()?.nativeElement;
      const bot = this.config()?.bot_username;
      if (el && bot) this.mountTelegram(el, bot);
    });
    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.timer);
      delete window[this.callback];
    });
  }

  private async run(proof: LinkProof, onError?: (err: unknown) => string | null): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.handle()(proof);
    } catch (err) {
      this.error.set(onError?.(err) ?? this.i18n.t('error'));
    } finally {
      this.busy.set(false);
    }
  }

  private async mountGoogle(el: HTMLElement, clientId: string): Promise<void> {
    try {
      await loadGoogle();
    } catch {
      return; // Blocked or offline: the other ways remain
    }
    const google = window.google?.accounts.id;
    if (!google) return;
    google.initialize({
      client_id: clientId,
      ux_mode: 'popup',
      callback: ({ credential }) => this.run({ google: { credential } }),
    });
    el.replaceChildren();
    google.renderButton(el, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      locale: this.i18n.lang(),
      width: Math.min(el.clientWidth || 280, 320),
    });
  }

  private mountTelegram(el: HTMLElement, bot: string): void {
    window[this.callback] = (user) => this.run({ telegram: user });
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.dataset['telegramLogin'] = bot;
    script.dataset['size'] = 'large';
    script.dataset['radius'] = '14';
    script.dataset['onauth'] = `${this.callback}(user)`;
    script.dataset['requestAccess'] = 'write';
    el.replaceChildren(script);
  }

  protected async sendCode(): Promise<void> {
    const address = this.email().trim();
    if (!address) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const { resend_after } = await this.api.emailStart(address, this.i18n.lang());
      this.sentTo.set(address);
      this.code.set('');
      this.countdown(resend_after);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      this.error.set(
        this.i18n.t(
          status === 422
            ? 'badEmail'
            : status === 429
              ? 'tooSoon'
              : status === 502
                ? 'mailFailed'
                : 'error',
        ),
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected checkCode(): Promise<void> {
    return this.run({ email: { email: this.sentTo(), code: this.code().trim() } }, (err) =>
      err instanceof ApiError && err.status === 401 ? this.i18n.t('wrongCode') : null,
    );
  }

  protected reset(): void {
    this.sentTo.set('');
    this.code.set('');
    this.error.set('');
  }

  private countdown(seconds: number): void {
    clearInterval(this.timer);
    this.wait.set(seconds);
    this.timer = setInterval(() => {
      this.wait.update((s) => Math.max(0, s - 1));
      if (!this.wait()) clearInterval(this.timer);
    }, 1000);
  }
}
