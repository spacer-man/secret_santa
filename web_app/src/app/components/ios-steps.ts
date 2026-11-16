import { Component, inject } from '@angular/core';
import { I18n } from '../core/i18n';

/** iPhone / iPad Safari: how to put the site on the Home Screen (there is no install dialog) */
@Component({
  selector: 'ios-steps',
  template: `
    <ol class="install-steps">
      <li>
        {{ i18n.t('iosStep1') }}
        <svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H4.5v10h15V11H18" />
        </svg>
      </li>
      <li>{{ i18n.t('iosStep2') }}</li>
    </ol>
  `,
})
export class IosSteps {
  protected readonly i18n = inject(I18n);
}
