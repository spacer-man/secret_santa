import { Component, computed, inject, input } from '@angular/core';
import { I18n } from '../core/i18n';
import { Store } from '../core/store';
import { split } from '../core/time';

@Component({
  selector: 'countdown',
  template: `
    @if (left() > 0) {
      <p class="label">🎄 {{ i18n.t('untilNewYear') }} 🎄</p>
      <div class="countdown">
        @for (unit of units(); track unit.label) {
          <div class="unit">
            <div class="number">{{ unit.value }}</div>
            <div class="caption">{{ unit.label }}</div>
          </div>
        }
      </div>
    } @else {
      <p class="happy">🎆 {{ i18n.t('happyNewYear') }} 🎆</p>
    }
  `,
})
export class Countdown {
  protected readonly i18n = inject(I18n);
  private readonly store = inject(Store);

  /** UTC timestamp of the New Year midnight */
  readonly target = input.required<number>();

  protected readonly left = computed(() => this.target() - this.store.now());
  protected readonly units = computed(() => {
    const p = split(this.left());
    const pad = (n: number) => String(n).padStart(2, '0');
    return [
      { value: p.days, label: this.i18n.t('days') },
      { value: pad(p.hours), label: this.i18n.t('hours') },
      { value: pad(p.minutes), label: this.i18n.t('minutes') },
      { value: pad(p.seconds), label: this.i18n.t('seconds') },
    ];
  });
}
