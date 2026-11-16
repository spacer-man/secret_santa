import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Api, LinkProof } from '../core/api';
import { I18n } from '../core/i18n';
import { Store } from '../core/store';
import { SignIn } from '../components/sign-in';

/** Website / PWA login: Google, Telegram Login Widget or a code sent to an e-mail */
@Component({
  selector: 'login-page',
  imports: [SignIn],
  template: `
    <section class="hero">
      <div class="hero-emoji">🎅</div>
      <h1>{{ i18n.t('loginTitle') }}</h1>
      <p>{{ i18n.t('loginText') }}</p>
    </section>
    <section class="card center">
      <p class="muted">{{ i18n.t('loginHint') }}</p>
      <sign-in mode="login" [handle]="signIn" />
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

  protected readonly botLink = computed(() => {
    const bot = this.store.config()?.bot_username;
    if (!bot) return '';
    const ref = this.store.ref;
    return `https://t.me/${bot}` + (ref ? `?start=${ref}` : '');
  });

  protected readonly signIn = async (proof: LinkProof): Promise<void> => {
    if ('telegram' in proof) await this.api.login(proof.telegram);
    else if ('google' in proof) await this.api.loginGoogle(proof.google.credential);
    else await this.api.loginEmail(proof.email.email, proof.email.code);
    await this.store.load(true);
    this.router.navigateByUrl(this.store.registered() ? '/' : '/register');
  };
}
