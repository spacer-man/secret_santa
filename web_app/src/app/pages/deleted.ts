import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api, LinkProof } from '../core/api';
import { I18n } from '../core/i18n';
import { Store } from '../core/store';
import { Telegram } from '../core/telegram';
import { SignIn } from '../components/sign-in';

/**
 * A deleted account: restore it (30 days) or erase it now. Everything else is closed while
 * it's deleted (the API answers 403 `account_deleted`).
 */
@Component({
  selector: 'deleted-page',
  imports: [SignIn],
  template: `
    <section class="hero">
      <div class="hero-emoji">🗑</div>
      <h1>{{ i18n.t('deletedTitle') }}</h1>
      <p>{{ i18n.t('deletedText').replace('%s', until()) }}</p>
    </section>
    <section class="card center">
      <button class="btn btn-primary" [disabled]="busy()" (click)="restore()">
        {{ i18n.t('restoreBtn') }}
      </button>
      @if (!confirmErase()) {
        <button class="btn btn-ghost" [disabled]="busy()" (click)="confirmErase.set(true)">
          {{ i18n.t('eraseBtn') }}
        </button>
      } @else if (store.me()?.fresh === false) {
        <div class="note reauth">
          <p class="small">
            <b>🔐 {{ i18n.t('reauthTitle') }}</b>
          </p>
          @if (tg.isMiniApp) {
            <p class="small">{{ i18n.t('reauthMiniApp') }}</p>
          } @else {
            <sign-in mode="login" [handle]="reauth" />
          }
        </div>
      } @else {
        <p class="small error">{{ i18n.t('eraseWarn') }}</p>
        <div class="row">
          <button class="btn btn-secondary" [disabled]="busy()" (click)="erase()">
            {{ i18n.t('eraseConfirm') }}
          </button>
          <button class="btn btn-ghost" (click)="confirmErase.set(false)">
            {{ i18n.t('cancel') }}
          </button>
        </div>
      }
      @if (!tg.isMiniApp) {
        <button class="link" (click)="logout()">{{ i18n.t('logout') }}</button>
      }
    </section>
  `,
})
export class DeletedPage {
  protected readonly i18n = inject(I18n);
  protected readonly store = inject(Store);
  protected readonly tg = inject(Telegram);
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly confirmErase = signal(false);
  protected readonly until = computed(() => {
    const at = this.store.me()?.purge_at;
    return at ? new Date(at).toLocaleDateString(this.i18n.lang()) : '';
  });

  protected async restore(): Promise<void> {
    this.busy.set(true);
    try {
      this.store.me.set(await this.api.restoreAccount());
      await this.store.load(true);
      this.store.showToast(this.i18n.t('restored'));
      this.router.navigateByUrl('/');
    } catch {
      this.store.showToast(this.i18n.t('error'));
    } finally {
      this.busy.set(false);
    }
  }

  protected readonly reauth = async (proof: LinkProof): Promise<void> => {
    this.store.me.set(await this.api.reauth(proof));
  };

  protected async erase(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.eraseAccount();
      this.api.logout();
      this.store.me.set(null);
      this.store.gift.set(null);
      this.store.showToast(this.i18n.t('erased'));
      this.router.navigateByUrl('/login');
    } catch {
      this.store.showToast(this.i18n.t('error'));
    } finally {
      this.busy.set(false);
    }
  }

  protected logout(): void {
    this.api.logout();
    this.store.me.set(null);
    this.router.navigateByUrl('/login');
  }
}
