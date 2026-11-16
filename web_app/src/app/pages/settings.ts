import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AccountSummary,
  Api,
  ApiError,
  Channel,
  IdentityKind,
  LinkProof,
  Me,
  MergeChoices,
  MergePreview,
  MergeSide,
} from '../core/api';
import { I18n, Key } from '../core/i18n';
import { Push } from '../core/push';
import { Store } from '../core/store';
import { Telegram } from '../core/telegram';
import { IosSteps } from '../components/ios-steps';
import { SignIn } from '../components/sign-in';

interface PendingMerge {
  token: string;
  mine: AccountSummary;
  other: AccountSummary;
  preview: MergePreview;
  /** Whose to keep where both have their own (every conflict of the preview) */
  choices: MergeChoices;
  /** Choices that can't be "other" here */
  locked: string[];
}

type Counted = 'wishes' | 'mandarins' | 'figures' | 'gifts' | 'friends';

const KINDS: IdentityKind[] = ['telegram', 'email', 'google'];
const KIND_LABEL: Record<IdentityKind, Key> = {
  telegram: 'idTelegram',
  email: 'idEmail',
  google: 'idGoogle',
};
const PUSH_HINT: Partial<Record<string, Key>> = {
  unsupported: 'pushUnsupported',
  'ios-install': 'pushIos',
  'server-off': 'pushServerOff',
  denied: 'pushDenied',
  off: 'pushThisDevice',
};

/** Ways to sign in (link, unlink, merge two accounts) and where to send the New Year gift */
@Component({
  selector: 'settings-page',
  imports: [SignIn, IosSteps],
  template: `
    <h1 class="page-title">⚙️ {{ i18n.t('settings') }}</h1>

    <section class="card">
      <h2>{{ i18n.t('accountsTitle') }}</h2>
      <p class="muted small">{{ i18n.t('accountsHint') }}</p>
      <ul class="identities">
        @for (kind of kinds; track kind) {
          <li class="card row between">
            <span>
              <b>{{ i18n.t(kindLabel[kind]) }}</b>
              <span class="muted small">
                @if (!linked(kind)) {
                  · {{ i18n.t('notLinked') }}
                } @else if (kind === 'email') {
                  · {{ me()?.identities?.email }}
                }
                @if (me()?.signed_in_with === kind) {
                  · {{ i18n.t('signedInHere') }}
                }
              </span>
            </span>
            @if (canUnlink(kind) && fresh()) {
              <button class="link danger" [disabled]="busy()" (click)="unlink(kind)">
                {{ i18n.t('unlink') }}
              </button>
            } @else if (linked(kind)) {
              <span aria-hidden="true">✓</span>
            }
          </li>
        }
      </ul>

      @if (merge(); as m) {
        <div class="merge note">
          <h3>{{ i18n.t('mergeTitle') }}</h3>
          <p class="small">{{ i18n.t('mergeText') }}</p>
          <!-- Preview: both accounts and exactly what the merged one will have -->
          <table class="merge-table small">
            <thead>
              <tr>
                <th></th>
                <th>{{ i18n.t('mergeThis') }}</th>
                <th>{{ i18n.t('mergeOther') }}</th>
                <th class="merge-result">{{ i18n.t('mergeResult') }}</th>
              </tr>
            </thead>
            <tbody>
              @for (row of mergeRows; track row.key) {
                <tr>
                  <th>{{ i18n.t(row.label) }}</th>
                  <td>{{ m.mine[row.key] }}</td>
                  <td>{{ m.other[row.key] }}</td>
                  <td class="merge-result">{{ m.preview.result[row.key] }}</td>
                </tr>
              }
              <tr>
                <th>{{ i18n.t('mergeTzRow') }}</th>
                <td>{{ m.mine.timezone }}</td>
                <td>{{ m.other.timezone }}</td>
                <td class="merge-result">{{ m.preview.result.timezone }}</td>
              </tr>
            </tbody>
          </table>
          @if (m.preview.report.conflicts.length) {
            <!-- Both have their own and only one can stay: the person decides, never chance -->
            <p class="small">
              <b>{{ i18n.t('mergeChoose') }}</b>
            </p>
            @for (key of m.preview.report.conflicts; track key) {
              <div class="merge-choice">
                <span class="small">{{ i18n.dict.mergeConflicts[key] }}</span>
                <div class="row">
                  @for (side of sides; track side) {
                    <button
                      class="choice"
                      [class.selected]="m.choices[key] === side"
                      [class.locked]="side === 'other' && m.locked.includes(key)"
                      [disabled]="busy() || (side === 'other' && m.locked.includes(key))"
                      (click)="choose(m, key, side)"
                    >
                      <span>{{ choiceValue(m, key, side) }}</span>
                      <span class="muted small">{{
                        i18n.t(side === 'mine' ? 'mergeThis' : 'mergeOther')
                      }}</span>
                    </button>
                  }
                </div>
                @if (m.locked.includes(key)) {
                  <span class="muted small">{{ i18n.t('mergeLockedTg') }}</span>
                }
              </div>
            }
          }
          <p class="small">
            <b>{{ i18n.t('mergeRules') }}</b>
          </p>
          <ul class="merge-rules small">
            @for (line of mergeLines(m); track line) {
              <li>{{ line }}</li>
            }
          </ul>
          <div class="row">
            <button class="btn btn-primary" [disabled]="busy()" (click)="doMerge(m)">
              {{ i18n.t('mergeBtn') }}
            </button>
            <button class="btn btn-ghost" (click)="merge.set(null)">{{ i18n.t('cancel') }}</button>
          </div>
        </div>
      } @else if (!fresh()) {
        <!-- Changing the ways in needs a recent sign-in: a session left open somewhere can't -->
        <div class="note reauth">
          <p class="small">
            <b>🔐 {{ i18n.t('reauthTitle') }}</b>
          </p>
          @if (tg.isMiniApp) {
            <p class="small">{{ i18n.t('reauthMiniApp') }}</p>
          } @else {
            <p class="small">{{ i18n.t('reauthText') }}</p>
            <sign-in mode="login" [except]="notLinkedKinds()" [handle]="reauth" />
          }
        </div>
      } @else if (linkable().length) {
        <h3>{{ i18n.t('linkMore') }}</h3>
        <sign-in mode="link" [except]="linkedKinds()" [handle]="link" />
      }
    </section>

    <section class="card">
      <h2>{{ i18n.t('notifyTitle') }}</h2>
      <p class="muted small">{{ i18n.t('notifyHint') }}</p>
      @for (channel of channels; track channel.key) {
        <button
          class="choice wide"
          [class.selected]="chosen(channel.key)"
          [class.locked]="!!blocked(channel.key)"
          [disabled]="busy()"
          (click)="toggle(channel.key)"
        >
          <span>{{ chosen(channel.key) ? '☑' : '☐' }} {{ i18n.t(channel.label) }}</span>
          @if (hint(channel.key); as h) {
            <span class="muted small">{{ h }}</span>
          }
        </button>
      }
      @if (pushState() === 'ios-install') {
        <!-- iPhone: push comes only to the app from the Home Screen; say how to get there -->
        <div class="note ios-push">
          <p class="small">
            <b>🔔 {{ i18n.t('iosPushTitle') }}</b>
          </p>
          <ios-steps />
          <p class="small">{{ i18n.t('iosPushThen') }}</p>
        </div>
      }
    </section>

    <section class="card">
      <h2>{{ i18n.t('accountTitle') }}</h2>
      <button class="btn btn-secondary" [disabled]="busy()" (click)="logoutAll()">
        {{ i18n.t('logoutAll') }}
      </button>
      <p class="muted small">{{ i18n.t('logoutAllHint') }}</p>
      @if (!confirmDelete()) {
        <button class="link danger" (click)="confirmDelete.set(true)">
          {{ i18n.t('deleteAccount') }}
        </button>
      } @else if (!fresh()) {
        <p class="small">{{ i18n.t('deleteNeedsReauth') }}</p>
      } @else {
        <p class="small error">{{ i18n.t('deleteWarn') }}</p>
        <div class="row">
          <button class="btn btn-secondary" [disabled]="busy()" (click)="deleteAccount()">
            {{ i18n.t('deleteConfirm') }}
          </button>
          <button class="btn btn-ghost" (click)="confirmDelete.set(false)">
            {{ i18n.t('cancel') }}
          </button>
        </div>
      }
    </section>

    @if (!tg.isMiniApp) {
      <button class="btn btn-ghost" (click)="logout()">{{ i18n.t('logout') }}</button>
    }
  `,
})
export class SettingsPage {
  protected readonly i18n = inject(I18n);
  protected readonly tg = inject(Telegram);
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly push = inject(Push);

  protected readonly kinds = KINDS;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly sides = ['mine', 'other'] as const;
  protected readonly mergeRows: { key: Counted; label: Key }[] = [
    { key: 'wishes', label: 'mergeWishes' },
    { key: 'mandarins', label: 'mergeMandarins' },
    { key: 'figures', label: 'mergeFigures' },
    { key: 'gifts', label: 'mergeGifts' },
    { key: 'friends', label: 'mergeFriends' },
  ];
  protected readonly channels: { key: Channel; label: Key }[] = [
    { key: 'telegram', label: 'chTelegram' },
    { key: 'push', label: 'chPush' },
    { key: 'email', label: 'chEmail' },
  ];

  protected readonly me = this.store.me;
  protected readonly pushState = this.push.state;
  protected readonly busy = signal(false);
  protected readonly merge = signal<PendingMerge | null>(null);
  protected readonly confirmDelete = signal(false);

  protected readonly linkedKinds = computed(() => KINDS.filter((k) => this.linked(k)));
  protected readonly notLinkedKinds = computed(() => KINDS.filter((k) => !this.linked(k)));
  /** Recent sign-in: the ways in can be changed */
  protected readonly fresh = computed(() => this.me()?.fresh !== false);
  /** Ways that can be linked here (the server offers them, not linked yet) */
  protected readonly linkable = computed(() => {
    const config = this.store.config();
    return KINDS.filter((k) => {
      if (this.linked(k)) return false;
      if (k === 'email') return !!config?.email_login;
      if (this.tg.isMiniApp) return false; // Telegram is already there, Google can't sign in
      return k === 'google' ? !!config?.google_client_id : !!config?.bot_username;
    });
  });

  constructor() {
    this.push.refresh(this.store.config()?.vapid_public_key);
  }

  protected linked(kind: IdentityKind): boolean {
    const ids = this.me()?.identities;
    return kind === 'email' ? !!ids?.email : !!ids?.[kind];
  }

  protected canUnlink(kind: IdentityKind): boolean {
    return this.linked(kind) && this.me()?.signed_in_with !== kind && this.linkedKinds().length > 1;
  }

  protected chosen(channel: Channel): boolean {
    if (this.blocked(channel)) return false;
    const on = this.me()?.notify?.includes(channel) ?? false;
    return channel === 'push' ? on && this.pushHere() : on;
  }

  /** Push is on in this browser, or (in the Mini App) somewhere else */
  private pushHere(): boolean {
    const state = this.push.state();
    return state === 'on' || (state === 'unsupported' && (this.me()?.push_devices ?? 0) > 0);
  }

  /** Why the channel can't be ticked (null: it can) */
  protected blocked(channel: Channel): Key | null {
    if (channel === 'telegram') return this.linked('telegram') ? null : 'needTelegram';
    if (channel === 'email') return this.linked('email') ? null : 'needEmail';
    const state = this.push.state();
    if (state === 'on' || state === 'off') return null;
    return this.pushHere() ? null : (PUSH_HINT[state] ?? null);
  }

  protected hint(channel: Channel): string | null {
    const blocked = this.blocked(channel);
    if (blocked) return this.i18n.t(blocked);
    if (channel !== 'push') return null;
    const devices = this.me()?.push_devices ?? 0;
    if (this.push.state() === 'off') {
      return this.i18n.t('pushThisDevice') + (devices ? ` · ${devices}` : '');
    }
    return devices > 1 ? `${this.i18n.t('pushOtherDevices')} ${devices - 1}` : null;
  }

  /** The session got old while the page was open: ask to confirm (the block shows itself) */
  private stale(err: unknown): boolean {
    const detail = err instanceof ApiError && err.status === 403 ? err.message : '';
    if (detail !== 'reauth_required' && detail !== 'reopen_required') return false;
    const me = this.me();
    if (me) this.me.set({ ...me, fresh: false });
    this.merge.set(null);
    return true;
  }

  protected readonly reauth = async (proof: LinkProof): Promise<void> => {
    this.me.set(await this.api.reauth(proof));
    this.store.showToast(this.i18n.t('reauthDone'));
  };

  private async save(task: () => Promise<Me>): Promise<boolean> {
    this.busy.set(true);
    try {
      this.me.set(await task());
      return true;
    } catch (err) {
      if (!this.stale(err)) this.store.showToast(this.i18n.t('error'));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(channel: Channel): Promise<void> {
    if (this.blocked(channel)) return;
    const now = this.me()?.notify ?? [];
    const on = !this.chosen(channel);
    if (channel === 'push' && this.push.state() !== 'unsupported') {
      const key = this.store.config()?.vapid_public_key;
      if (on && !(key && (await this.push.enable(key)))) {
        this.store.showToast(this.i18n.t(PUSH_HINT[this.push.state()] ?? 'error'));
        return;
      }
      if (!on) await this.push.disable();
    }
    const next = on ? [...new Set([...now, channel])] : now.filter((c) => c !== channel);
    await this.save(() => this.api.setNotify(next));
  }

  protected readonly link = async (proof: LinkProof): Promise<void> => {
    let result;
    try {
      result = await this.api.link(proof);
    } catch (err) {
      if (this.stale(err)) return;
      throw err;
    }
    if (result.status === 'taken') {
      this.merge.set({
        token: result.merge_token,
        mine: result.mine,
        other: result.other,
        preview: result.preview,
        // Every choice is shown chosen ("this account") and can be changed: nothing hidden
        choices: Object.fromEntries(result.preview.report.conflicts.map((k) => [k, 'mine'])),
        locked: result.locked,
      });
      return;
    }
    this.me.set(result.me);
    this.store.showToast(
      this.i18n.t(
        result.status === 'linked'
          ? 'linkedOk'
          : result.status === 'same'
            ? 'alreadyThis'
            : 'replaceFirst',
      ),
    );
  };

  /** What each side has for a choice: shown on its button */
  protected choiceValue(m: PendingMerge, key: string, side: MergeSide): string {
    const acc = m[side];
    switch (key) {
      case 'timezone':
        return acc.timezone;
      case 'language':
        return acc.language === 'ru' ? 'Русский' : 'English';
      case 'notify':
        return acc.notify.length
          ? acc.notify.map((c) => this.i18n.dict.channelShort[c]).join(', ')
          : '—';
      case 'email':
        return acc.email ?? '—';
      default:
        // Telegram, Google, the yard, the gifts: told by whose they are
        return this.i18n.dict.mergeWhose[key];
    }
  }

  protected async choose(m: PendingMerge, key: string, side: MergeSide): Promise<void> {
    const choices = { ...m.choices, [key]: side };
    this.busy.set(true);
    try {
      const preview = await this.api.mergePreview(m.token, choices);
      this.merge.set({ ...m, choices, preview });
    } catch (err) {
      if (!this.stale(err)) this.store.showToast(this.i18n.t('error'));
    } finally {
      this.busy.set(false);
    }
  }

  /** The rules of the merge, as they apply to these two accounts and the choices made */
  protected mergeLines(m: PendingMerge): string[] {
    const t = (key: Key, ...values: (string | number)[]) =>
      values.reduce<string>((text, v) => text.replace('%s', String(v)), this.i18n.t(key));
    const r = m.preview.report;
    const whose = (side: MergeSide) => this.i18n.t(side === 'mine' ? 'mergeOfThis' : 'mergeOfThat');
    const ways = m.preview.result.identities.map((k) => this.i18n.t(KIND_LABEL[k])).join(', ');
    const lines = [t('mergeRuleAll'), t('mergeRuleWays', ways)];
    if (r.rewards_dropped) {
      lines.push(t('mergeRuleRewards', r.rewards_dropped, r.rewards_dropped_mandarins));
    }
    if (r.refunded) lines.push(t('mergeRuleRefund', r.refunded, r.refunded_mandarins));
    if (r.unplaced) {
      lines.push(t('mergeRuleUnplaced', whose(m.choices.yard ?? 'mine'), r.unplaced));
    }
    if (r.gifts_dropped) {
      lines.push(t('mergeRuleGifts', whose(m.choices.gifts ?? 'mine'), r.gifts_dropped));
    }
    for (const gone of r.identities_dropped) {
      lines.push(
        gone.kind === 'email'
          ? t('mergeRuleEmail', gone.email ?? '', m.preview.result.email ?? '')
          : t('mergeRuleWay', this.i18n.t(KIND_LABEL[gone.kind]), whose(gone.side)),
      );
    }
    lines.push(t('mergeRuleFinal'));
    return lines;
  }

  protected async doMerge(m: PendingMerge): Promise<void> {
    this.busy.set(true);
    try {
      const { me, token } = await this.api.merge(m.token, m.choices);
      // The way this session signed in went away: sign in with the one that stayed
      if (token) this.api.session = token;
      this.me.set(me);
    } catch (err) {
      if (!this.stale(err)) this.store.showToast(this.i18n.t('error'));
      return;
    } finally {
      this.busy.set(false);
    }
    this.merge.set(null);
    this.store.showToast(this.i18n.t('mergeDone'));
    await this.store.load(true);
  }

  protected async unlink(kind: IdentityKind): Promise<void> {
    await this.save(() => this.api.unlink(kind));
  }

  protected async logoutAll(): Promise<void> {
    if (await this.save(() => this.api.logoutAll())) {
      this.store.showToast(this.i18n.t('loggedOutAll'));
    }
  }

  protected async deleteAccount(): Promise<void> {
    if (!(await this.save(() => this.api.deleteAccount()))) return;
    await this.push.disable().catch(() => {});
    this.router.navigateByUrl('/deleted');
  }

  protected async logout(): Promise<void> {
    await this.push.disable().catch(() => {});
    this.api.logout();
    this.store.me.set(null);
    this.store.gift.set(null);
    this.router.navigateByUrl('/login');
  }
}
