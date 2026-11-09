import { Component, computed, inject, signal } from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import { Router } from '@angular/router';
import { Api, MandarinTx, MyWish, TreeBall, TreeData } from '../../core/api';
import { I18n } from '../../core/i18n';
import { Store } from '../../core/store';
import { Telegram } from '../../core/telegram';
import { confetti } from '../fx/confetti';
import { BallArt, BallDefs } from './ball-art';
import { Tree3d } from '../tree3d/tree-3d';

const SEEN_KEY = 'santa.tree.seen';

type Sheet =
  | { kind: 'ball'; ball: TreeBall; wish?: MyWish }
  | { kind: 'star' }
  | { kind: 'wallet'; history?: MandarinTx[] }
  | null;

function readSeen(): Record<string, string> | null {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null');
  } catch {
    return null;
  }
}

/** The tree with its HUD: mandarins, festive level, ball/star/wallet sheets */
@Component({
  selector: 'tree-panel',
  imports: [Tree3d, BallArt, BallDefs, KeyValuePipe],
  template: `
    @if (tree(); as t) {
      <section class="tree-card">
        <div class="hud">
          <span class="hud-title">🎄 {{ i18n.t('myTree') }}</span>
          <button class="mandarin-chip" (click)="openWallet()">🍊 {{ t.mandarins }}</button>
        </div>
        <tree-3d
          [tree]="t"
          [newHung]="newHung()"
          [newLit]="newLit()"
          (ballClick)="openBall($event)"
          (addBall)="router.navigateByUrl('/new')"
          (starClick)="sheet.set({ kind: 'star' })"
        />
        <p class="drag-hint">↔ {{ i18n.t('dragHint') }}</p>
        <div class="level">
          <div class="row between small">
            <b>✨ {{ i18n.t('festiveLevel') }}: {{ t.level }}/10</b>
            <span class="muted">{{ t.points }}{{ t.level_to ? ' / ' + t.level_to : '' }}</span>
          </div>
          <div class="level-bar"><span [style.width.%]="progress()"></span></div>
          @if (!t.balls.length) {
            <p class="small">{{ i18n.t('emptyTree') }}</p>
          } @else if (!t.level_to) {
            <p class="small">{{ i18n.t('levelMax') }}</p>
          } @else {
            <p class="small muted">{{ i18n.t('levelHint') }}</p>
          }
        </div>
      </section>
    } @else {
      <section class="tree-card tree-skeleton"></section>
    }

    @if (sheet(); as s) {
      <div class="sheet-backdrop" (click)="sheet.set(null)"></div>
      <div class="sheet" role="dialog">
        @switch (s.kind) {
          @case ('ball') {
            @if (s.kind === 'ball') {
              <svg viewBox="-40 -40 80 80" class="sheet-ball">
                <defs ballDefs></defs>
                <g ballArt [color]="s.ball.color" [pattern]="s.ball.pattern" [state]="s.ball.state"></g>
              </svg>
              <p>{{ stateText(s.ball) }}</p>
              @if (s.wish) {
                <p class="wish-text quote">{{ s.wish.text }}</p>
                @if (s.wish.feedback.recipients) {
                  <div class="feedback">
                    @for (r of s.wish.feedback.reactions | keyvalue; track r.key) {
                      <span class="chip">{{ r.key }} {{ r.value }}</span>
                    }
                  </div>
                  @for (reply of s.wish.feedback.replies; track $index) {
                    <blockquote>💌 {{ reply }}</blockquote>
                  }
                }
              }
            }
          }
          @case ('star') {
            <div class="sheet-emoji">{{ tree()?.star ? '🌟' : '⭐' }}</div>
            <p>{{ tree()?.star ? i18n.t('starOn') : i18n.t('starOff') }}</p>
          }
          @case ('wallet') {
            <div class="sheet-emoji">🍊</div>
            <h2>{{ i18n.t('mandarins') }}: {{ tree()?.mandarins }}</h2>
            <p class="muted small">{{ i18n.t('shopSoon') }}</p>
            <h3>{{ i18n.t('howToEarn') }}</h3>
            <ul class="earn">
              @for (r of rewards(); track r.reason) {
                <li><span>{{ reasonText(r.reason) }}</span><b>+{{ r.amount }} 🍊</b></li>
              }
            </ul>
            @if (s.kind === 'wallet' && s.history?.length) {
              <h3>{{ i18n.t('history') }}</h3>
              <ul class="earn">
                @for (tx of s.history; track $index) {
                  <li><span>{{ reasonText(tx.reason) }}</span><b>+{{ tx.amount }}</b></li>
                }
              </ul>
            }
          }
        }
        <button class="btn btn-secondary wide" (click)="sheet.set(null)">{{ i18n.t('close') }}</button>
      </div>
    }
  `,
})
export class TreePanel {
  protected readonly i18n = inject(I18n);
  protected readonly router = inject(Router);
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly tg = inject(Telegram);

  protected readonly tree = signal<TreeData | null>(null);
  protected readonly newHung = signal<string[]>([]);
  protected readonly newLit = signal<string[]>([]);
  protected readonly sheet = signal<Sheet>(null);

  protected readonly progress = computed(() => {
    const t = this.tree();
    if (!t) return 0;
    if (!t.level_to) return 100;
    return ((t.points - t.level_from) / (t.level_to - t.level_from)) * 100;
  });

  protected readonly rewards = computed(() =>
    Object.entries(this.store.config()?.rewards ?? {}).map(([reason, amount]) => ({ reason, amount })),
  );

  constructor() {
    this.load();
  }

  async load(): Promise<void> {
    try {
      const tree = await this.api.tree();
      this.animateChanges(tree);
      this.tree.set(tree);
    } catch {}
  }

  /** Balls that were hung / lit since the last visit get an animation */
  private animateChanges(tree: TreeData): void {
    const seen = readSeen();
    const now: Record<string, string> = {};
    tree.balls.forEach((b) => (now[b.id] = b.state));
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(now));
    } catch {}
    if (!seen) return; // First visit: nothing is "new"

    const hung = tree.balls.filter((b) => b.state !== 'box' && (!seen[b.id] || seen[b.id] === 'box'));
    const lit = tree.balls.filter((b) => b.state === 'lit' && seen[b.id] !== 'lit');
    this.newHung.set(hung.map((b) => b.id));
    this.newLit.set(lit.map((b) => b.id));
    if (lit.length) {
      setTimeout(() => {
        confetti();
        this.tg.haptic('success');
        this.store.showToast(this.i18n.t('newLit'));
      }, 600);
    } else if (hung.length) {
      setTimeout(() => this.store.showToast(this.i18n.t('newHung')), 900);
    }
  }

  async openBall(ball: TreeBall): Promise<void> {
    this.tg.haptic('light');
    this.sheet.set({ kind: 'ball', ball });
    try {
      const wish = (await this.api.wishes()).find((w) => w.id === ball.id);
      const current = this.sheet();
      if (current?.kind === 'ball' && current.ball.id === ball.id) this.sheet.set({ kind: 'ball', ball, wish });
    } catch {}
  }

  async openWallet(): Promise<void> {
    this.tg.haptic('light');
    this.sheet.set({ kind: 'wallet' });
    try {
      const { history } = await this.api.mandarins();
      if (this.sheet()?.kind === 'wallet') this.sheet.set({ kind: 'wallet', history });
    } catch {}
  }

  stateText(ball: TreeBall): string {
    return this.i18n.t(ball.state === 'box' ? 'ballBox' : ball.state === 'lit' ? 'ballLit' : 'ballHung');
  }

  reasonText(reason: string): string {
    return this.i18n.dict.reasons[reason] ?? reason;
  }
}
