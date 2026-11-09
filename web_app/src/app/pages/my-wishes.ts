import { Component, inject, signal } from '@angular/core';
import { DatePipe, KeyValuePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api, MyWish } from '../core/api';
import { I18n, Key } from '../core/i18n';
import { MediaList } from '../components/media';

@Component({
  selector: 'my-wishes-page',
  imports: [MediaList, DatePipe, KeyValuePipe, RouterLink],
  template: `
    <h1 class="page-title">❤️ {{ i18n.t('myWishes') }}</h1>
    @if (wishes(); as list) {
      @for (w of list; track w.id) {
        <article class="card wish">
          <div class="row between small">
            <span class="badge" [class]="w.status">{{ i18n.t(statusKey(w)) }}</span>
            <span class="muted">{{ w.timestamp | date: 'd MMM y' }}</span>
          </div>
          <media-list [items]="w.media" />
          <p class="wish-text">{{ w.text }}</p>
          @if (w.feedback.recipients) {
            <div class="feedback">
              <span>🎁 {{ i18n.t('recipients') }}: <b>{{ w.feedback.recipients }}</b></span>
              @for (r of w.feedback.reactions | keyvalue; track r.key) {
                <span class="chip">{{ r.key }} {{ r.value }}</span>
              }
            </div>
            @if (w.feedback.replies.length) {
              <p class="small muted">💌 {{ i18n.t('replies') }}</p>
              @for (reply of w.feedback.replies; track $index) {
                <blockquote>{{ reply }}</blockquote>
              }
            }
          } @else {
            <button class="link danger small" (click)="remove(w)">{{ i18n.t('delete') }}</button>
          }
        </article>
      } @empty {
        <section class="card center">
          <p class="muted">{{ i18n.t('noWishes') }}</p>
          <a class="btn btn-primary" routerLink="/new">{{ i18n.t('writeWish') }}</a>
        </section>
      }
    } @else {
      <p class="muted center">{{ error() || i18n.t('loading') }}</p>
    }
  `,
})
export class MyWishesPage {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(Api);
  protected readonly wishes = signal<MyWish[] | null>(null);
  protected readonly error = signal('');

  constructor() {
    this.load();
  }

  async load(): Promise<void> {
    try {
      this.wishes.set(await this.api.wishes());
    } catch {
      this.error.set(this.i18n.t('error'));
    }
  }

  statusKey(w: MyWish): Key {
    return `status_${w.status}` as Key;
  }

  async remove(w: MyWish): Promise<void> {
    if (!confirm(this.i18n.t('confirmDelete'))) return;
    try {
      await this.api.deleteWish(w.id);
      this.wishes.update((list) => list?.filter((x) => x.id !== w.id) ?? null);
    } catch {
      this.error.set(this.i18n.t('error'));
    }
  }
}
