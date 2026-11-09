import { Component, computed, inject } from '@angular/core';
import { I18n } from '../core/i18n';
import { Store } from '../core/store';
import { newYearMoment, offsetMinutes, split } from '../core/time';

/** Where the New Year has already come and where it's coming next */
@Component({
  selector: 'wave',
  template: `
    @if (rows().length) {
      <section class="card">
        <h2>🌍 {{ i18n.t('wave') }}</h2>
        <p class="muted">{{ i18n.t('waveHint') }}</p>
        <ul class="wave">
          @for (row of rows(); track row.tz) {
            <li [class.done]="row.done" [class.mine]="row.mine">
              <span class="tz">{{ row.tz }}</span>
              <span class="bar"><span [style.width.%]="row.share"></span></span>
              <span class="count">{{ row.count }}</span>
              <span class="when">
                @if (row.done) {
                  {{ i18n.t('celebrating') }}
                } @else {
                  {{ i18n.t('inTime') }} {{ row.left }}
                }
                @if (row.mine) {
                  · {{ i18n.t('yourZone') }}
                }
              </span>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class Wave {
  protected readonly i18n = inject(I18n);
  private readonly store = inject(Store);

  protected readonly rows = computed(() => {
    const zones = this.store.stats()?.timezones ?? {};
    const now = this.store.now();
    const mine = this.store.me()?.timezone;
    const max = Math.max(1, ...Object.values(zones));
    return Object.entries(zones)
      .sort(([a], [b]) => offsetMinutes(b) - offsetMinutes(a))
      .map(([tz, count]) => {
        const target = newYearMoment(tz, now);
        const p = split(target - now);
        const left = p.days > 0 ? `${p.days}d ${p.hours}h` : `${p.hours}h ${String(p.minutes).padStart(2, '0')}m`;
        return { tz, count, share: (count / max) * 100, done: target <= now, left, mine: tz === mine };
      });
  });
}
