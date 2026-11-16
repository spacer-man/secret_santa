import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { Daytime } from '../core/daytime';
import { I18n } from '../core/i18n';
import { Store } from '../core/store';
import { Telegram } from '../core/telegram';
import { detectTimezone, localTime } from '../core/time';

@Component({
  selector: 'register-page',
  imports: [FormsModule],
  template: `
    <section class="hero">
      <div class="hero-emoji">🌍</div>
      <h1>{{ title() }}</h1>
      <p>{{ i18n.t('registerText') }}</p>
    </section>
    <section class="card center">
      <label class="muted" for="tz">{{ i18n.t('timezone') }}</label>
      <select id="tz" class="select" [ngModel]="timezone()" (ngModelChange)="timezone.set($event)">
        @for (tz of timezones(); track tz) {
          <option [value]="tz">{{ tz }}</option>
        }
      </select>
      <p class="clock">
        {{ i18n.t('yourTime') }}: <b>{{ time() }}</b>
      </p>
      @if (cities().length) {
        <p class="muted small">📍 {{ i18n.t('tzCities') }} {{ cities().join(', ') }}</p>
      }
      <button class="btn btn-primary" [disabled]="saving()" (click)="save()">
        {{ i18n.t('join') }}
      </button>
      @if (error()) {
        <p class="error">{{ error() }}</p>
      }
    </section>
  `,
})
export class RegisterPage {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly tg = inject(Telegram);
  private readonly router = inject(Router);

  protected readonly timezones = computed(() => this.store.config()?.timezones ?? []);
  protected readonly timezone = signal(
    this.store.me()?.timezone ?? detectTimezone(this.store.config()?.timezones ?? ['UTC+0']),
  );
  protected readonly time = computed(() => localTime(this.timezone(), this.store.now()));
  protected readonly title = computed(() => this.i18n.t('registerTitle'));
  protected readonly saving = signal(false);
  /** Cities of the chosen timezone: what it is, and the sun of the scene will be counted there */
  protected readonly cities = signal<string[]>([]);
  private readonly daytime = inject(Daytime);

  constructor() {
    effect(async () => {
      const tz = this.timezone();
      const found = await this.daytime.citiesOf(tz);
      if (tz === this.timezone()) {
        this.cities.set(found.map((c) => (this.i18n.lang() === 'ru' ? c.ru : c.en)));
      }
    });
  }
  protected readonly error = signal('');

  async save(): Promise<void> {
    this.saving.set(true);
    this.error.set('');
    try {
      this.store.me.set(
        await this.api.saveProfile(this.timezone(), this.store.ref, this.i18n.lang()),
      );
      await this.store.refreshGift();
      this.tg.haptic('success');
      this.router.navigateByUrl('/');
    } catch {
      this.error.set(this.i18n.t('error'));
    } finally {
      this.saving.set(false);
    }
  }
}
