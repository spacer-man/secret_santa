import { Component, inject, signal } from '@angular/core';
import { I18n } from '../core/i18n';
import { Install } from '../core/install';
import { IosSteps } from './ios-steps';
import { MascotSays } from './mascot/mascot-says';

/** "Put Santa on your home screen": an offer to install the app as a PWA (or a Telegram shortcut) */
@Component({
  selector: 'install-card',
  imports: [MascotSays, IosSteps],
  template: `
    @if (install.way()) {
      <section class="card install-card">
        <h2>📲 {{ i18n.t('installTitle') }}</h2>
        <mascot-says topic="install" [more]="null" [compact]="true" />
        @if (install.way() === 'ios') {
          <!-- iPhone: notifications come only to the app from the Home Screen -->
          <p class="small">🔔 {{ i18n.t('iosPushWhy') }}</p>
        }
        @if (steps()) {
          <ios-steps />
        }
        <div class="row">
          @if (!steps()) {
            <button class="btn btn-primary" (click)="go()">{{ i18n.t('installBtn') }}</button>
          }
          <button class="btn btn-ghost" (click)="install.dismiss()">
            {{ i18n.t(steps() ? 'installDone' : 'notNow') }}
          </button>
        </div>
      </section>
    }
  `,
})
export class InstallCard {
  protected readonly i18n = inject(I18n);
  protected readonly install = inject(Install);
  /** iOS: the steps are shown instead of a dialog */
  protected readonly steps = signal(false);

  go(): void {
    if (this.install.way() === 'ios') this.steps.set(true);
    else this.install.install();
  }
}
