import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import { Router } from '@angular/router';
import { Api, MandarinTx, MyWish, TreeBall, TreeData } from '../../core/api';
import { I18n } from '../../core/i18n';
import { Store } from '../../core/store';
import { Telegram } from '../../core/telegram';
import { confetti } from '../fx/confetti';
import { BallArt, BallDefs } from './ball-art';
import { ShopState } from '../../core/shop';
import { Tree3d } from '../tree3d/tree-3d';
import { LIGHT_SKINS } from '../tree3d/skins';
import { ShopSheet } from './shop-sheet';
import { DebugPanel } from './debug-panel';
import { City, DAYTIME_MODES, Daytime, DaytimeMode, PHASE_ICONS } from '../../core/daytime';

const SEEN_KEY = 'santa.tree.seen';
const SNOW_KEY = 'santa.snowfall.v2';
const LIGHTS_KEY = 'santa.cabinLights';
/** Shop items that unlock the dense snowfall modes (by mode index) */
const SNOW_ITEMS: Record<number, string> = { 2: 'snow-snowfall', 3: 'snow-blizzard' };

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readSnow(): number {
  try {
    const v = localStorage.getItem(SNOW_KEY);
    return v === null ? 1 : Math.min(3, Math.max(0, Number(v) || 0));
  } catch {
    return 1;
  }
}

type Sheet =
  | { kind: 'ball'; ball: TreeBall; wish?: MyWish }
  | { kind: 'star' }
  | { kind: 'wallet'; history?: MandarinTx[] }
  | { kind: 'pad'; pad: number; corner: string; item: string | null }
  | { kind: 'snow' }
  | { kind: 'daytime' }
  | { kind: 'lights' }
  | { kind: 'shop' }
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
  imports: [Tree3d, BallArt, BallDefs, KeyValuePipe, ShopSheet, DebugPanel],
  template: `
    @if (tree(); as t) {
      <section class="tree-card">
        @if (debugTools()) {
          @defer (on immediate) {
            <debug-panel [tree]="t" (changed)="debugChanged($event)" />
          }
        }
        <div class="hud">
          <span class="hud-title">🎄 {{ i18n.t('myTree') }}</span>
          <div class="hud-actions">
            <button
              class="mandarin-chip"
              (click)="openShop()"
              [attr.aria-label]="i18n.t('shopTitle')"
            >
              🛍
            </button>
            <button class="mandarin-chip" (click)="openWallet()">🍊 {{ t.mandarins }}</button>
          </div>
        </div>
        <div class="scene-wrap">
          <tree-3d
            #scene3d
            [tree]="t"
            [decorMode]="decorMode()"
            [preview]="preview()"
            [snowfall]="shownSnow()"
            [daytime]="daytime.sun()"
            [cabinLights]="shownLights()"
            (cabinClick)="openLights()"
            (padClick)="openPad($event)"
            (focused)="cornerFocused.set(true)"
            (focusLost)="cornerFocused.set(false)"
            [newHung]="newHung()"
            [newLit]="newLit()"
            (ballClick)="openBall($event)"
            (addBall)="router.navigateByUrl('/new')"
            (starClick)="sheet.set({ kind: 'star' })"
          />
          @if (decorMode()) {
            <p class="drag-hint decor-hint">
              ✨
              {{
                i18n.t(
                  preview() ? 'decorHintConfirm' : cornerFocused() ? 'decorHintPlace' : 'decorHint'
                )
              }}
            </p>
            @if (preview()) {
              <!-- The figure is tried on a place: put it there for real -->
              <button class="decor-btn decor-confirm" (click)="confirmPreview()">
                ✓ {{ i18n.t('padPutHere') }}
              </button>
            }
            @if (cornerFocused()) {
              <!-- Back to the whole yard: choose another heap without leaving the mode -->
              <button class="decor-btn decor-back" (click)="backToYard()">
                ← {{ i18n.t('decorBack') }}
              </button>
            }
            <button class="decor-btn active" (click)="toggleDecor()">
              ✓ {{ i18n.t('decorDone') }}
            </button>
          } @else {
            <p class="drag-hint">↔ {{ i18n.t('dragHint') }}</p>
            <button class="decor-btn" (click)="toggleDecor()">⛄ {{ i18n.t('decorate') }}</button>
          }
          <button class="snow-btn" (click)="openSnow()" [attr.aria-label]="i18n.t('snowfall')">
            {{ snowModes[snowfall()].icon }}
          </button>
          <button
            class="snow-btn daytime-btn"
            (click)="sheet.set({ kind: 'daytime' })"
            [attr.aria-label]="i18n.t('daytime')"
          >
            {{ phaseIcons[daytime.phase()] }}
          </button>
        </div>
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
      <div
        class="sheet-backdrop"
        [class.clear]="s.kind === 'lights'"
        tabindex="-1"
        (click)="closeSheet()"
        (keydown.escape)="closeSheet()"
      ></div>
      <div
        class="sheet"
        [class.compact]="s.kind === 'lights'"
        [class.tall]="s.kind === 'shop'"
        role="dialog"
      >
        @switch (s.kind) {
          @case ('ball') {
            @if (s.kind === 'ball') {
              <svg viewBox="-40 -40 80 80" class="sheet-ball">
                <defs ballDefs></defs>
                <g
                  ballArt
                  [color]="s.ball.color"
                  [pattern]="s.ball.pattern"
                  [state]="s.ball.state"
                ></g>
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
            <div class="sheet-emoji">{{ tree()?.level === 10 ? '🌟' : '⭐' }}</div>
            <p>{{ tree()?.level === 10 ? i18n.t('starOn') : i18n.t('starOff') }}</p>
          }
          @case ('pad') {
            @if (s.kind === 'pad') {
              <div class="sheet-emoji">
                @if (s.item && shop.image(s.item); as src) {
                  <img class="sheet-figure" [src]="src" alt="" />
                } @else {
                  {{ s.item ? shop.icon(s.item) : '✨' }}
                }
              </div>
              <h2>{{ cornerName(s.corner) }}</h2>
              @if (s.item && !padReplacing()) {
                <p class="muted">
                  <b>{{ shop.name(s.item) }}.</b> {{ i18n.t('padTaken') }}
                </p>
                <button class="btn btn-primary wide" (click)="padReplacing.set(true)">
                  {{ i18n.t('padReplace') }}
                </button>
                <button
                  class="btn btn-secondary wide"
                  [disabled]="shop.busy()"
                  (click)="padRemove(s.item, s.pad)"
                >
                  {{ i18n.t('padRemove') }}
                </button>
              } @else if (shop.spare().length) {
                <p class="muted">{{ i18n.t('padFree') }}</p>
                @for (f of shop.spare(); track f.key) {
                  <button
                    class="btn btn-secondary wide pad-pick"
                    [disabled]="shop.busy()"
                    (click)="padPick(s.pad, f.key, !!s.item)"
                  >
                    @if (shop.image(f.key); as src) {
                      <img class="pick-figure" [src]="src" alt="" />
                    } @else {
                      {{ shop.icon(f.key) }}
                    }
                    {{ shop.name(f.key) }}
                    @if (shop.spareCount(f) > 1) {
                      ×{{ shop.spareCount(f) }}
                    }
                    — {{ i18n.t(s.item ? 'padPutHere' : 'padTry') }}
                  </button>
                }
                @if (padReplacing()) {
                  <button class="btn btn-ghost wide" (click)="padReplacing.set(false)">
                    {{ i18n.t('padBack') }}
                  </button>
                }
              } @else {
                <p class="muted">{{ i18n.t('padFreeEmpty') }}</p>
                <button class="btn btn-primary wide" (click)="openShop()">
                  🛍 {{ i18n.t('toShop') }}
                </button>
              }
            }
          }
          @case ('snow') {
            <div class="sheet-emoji">🌨</div>
            <h2>{{ i18n.t('snowfall') }}</h2>
            <div class="snow-modes">
              @for (m of snowModes; track m.key; let i = $index) {
                <button
                  class="snow-mode"
                  [class.selected]="shownSnow() === i"
                  [class.locked]="!isUnlocked(i)"
                  (click)="pickSnow(i)"
                >
                  <span class="snow-icon">{{ m.icon }}</span>
                  <span>{{ i18n.dict.snowModes[m.key] }}</span>
                  @if (!isUnlocked(i)) {
                    <small>🔒 {{ snowPriceText(i) }}</small>
                  }
                </button>
              }
            </div>
            @if (lockedSnow(); as locked) {
              <p class="small muted">{{ i18n.t('snowLocked').replace('%s', '' + locked.price) }}</p>
              <button
                class="btn btn-primary wide"
                [disabled]="shop.busy() || locked.lack > 0"
                (click)="buySnow(locked.index)"
              >
                {{ i18n.t('buyBtnFull').replace('%s', '' + locked.price) }}
              </button>
              @if (locked.lack > 0) {
                <p class="small lack">{{ i18n.t('notEnough').replace('%s', '' + locked.lack) }}</p>
              }
            }
          }
          @case ('daytime') {
            <div class="sheet-emoji">{{ phaseIcons[daytime.phase()] }}</div>
            <h2>{{ i18n.t('daytime') }}</h2>
            <div class="snow-modes daytime-modes">
              @for (m of daytimeModes; track m) {
                <button
                  class="snow-mode"
                  [class.selected]="daytime.mode() === m"
                  (click)="daytime.set(m)"
                >
                  <span class="snow-icon">{{ phaseIcons[m] }}</span>
                  <span>{{ i18n.dict.daytimeModes[m] }}</span>
                </button>
              }
            </div>
            <p class="small muted">
              @if (daytime.mode() === 'auto') {
                {{ i18n.t('daytimeNow').replace('%s', daytime.clock()) }}
                {{ sunText() }}
              } @else {
                {{ i18n.t('daytimeFixed') }}
              }
            </p>
            @if (daytime.mode() === 'auto') {
              <!-- Where the sun is counted for: the timezone's city, or a place picked here -->
              <div class="place-row">
                <span>
                  📍 <b>{{ placeName() }}</b>
                  <small class="muted">{{ i18n.dict.placeSources[daytime.place().source] }}</small>
                </span>
                @if (!placeOpen()) {
                  <button class="btn btn-ghost" (click)="placeOpen.set(true)">
                    {{ i18n.t('placeChange') }}
                  </button>
                }
              </div>
              @if (placeOpen()) {
                <div class="place-pick">
                  <input
                    class="textarea place-input"
                    type="search"
                    autocomplete="off"
                    [placeholder]="i18n.t('placeSearch')"
                    (input)="searchCity($any($event.target).value)"
                  />
                  @for (c of cityHits(); track c.en) {
                    <button class="btn btn-secondary wide" (click)="pickCity(c)">
                      {{ lang === 'ru' ? c.ru : c.en }}
                    </button>
                  }
                  @if (cityQuery() && !cityHits().length) {
                    <p class="small muted">{{ i18n.t('placeNotFound') }}</p>
                  }
                  <button
                    class="btn btn-secondary wide"
                    [disabled]="locating()"
                    (click)="geolocate()"
                  >
                    🛰 {{ i18n.t(locating() ? 'placeLocating' : 'placeGeo') }}
                  </button>
                  @if (geoError(); as err) {
                    <p class="small lack">{{ i18n.dict.placeGeoErrors[err] }}</p>
                  }
                  @if (daytime.place().source === 'city' || daytime.place().source === 'geo') {
                    <button class="btn btn-ghost wide" (click)="resetPlace()">
                      {{ i18n.t('placeReset') }}
                    </button>
                  }
                  <p class="small muted">🔒 {{ i18n.t('placePrivate') }}</p>
                </div>
              }
            }
          }
          @case ('lights') {
            <h3 class="compact-title">🏠 {{ i18n.t('cabinLights') }}</h3>
            <div class="skin-strip">
              <button
                class="snow-mode"
                [class.selected]="!shownLights()"
                (click)="pickLights(null)"
              >
                <span class="snow-icon">🌑</span>
                <span>{{ i18n.dict.lightSkins['none'] }}</span>
              </button>
              @for (l of lightSkins; track l) {
                <button
                  class="snow-mode"
                  [class.selected]="shownLights() === l"
                  [class.locked]="!ownsLights(l)"
                  (click)="pickLights(l)"
                >
                  <span class="snow-icon">{{ lightIcons[l] }}</span>
                  <span>{{ i18n.dict.lightSkins[l] }}</span>
                  @if (!ownsLights(l)) {
                    <small>🔒 {{ lightsPrice(l) }}</small>
                  }
                </button>
              }
            </div>
            @if (lockedLights(); as locked) {
              <div class="buy-row">
                <span class="small muted">{{
                  i18n.t('lightsLocked').replace('%s', '' + locked.price)
                }}</span>
                <button
                  class="btn btn-primary"
                  [disabled]="shop.busy() || locked.lack > 0"
                  (click)="buyLights(locked.key)"
                >
                  {{
                    locked.lack > 0
                      ? i18n.t('notEnough').replace('%s', '' + locked.lack)
                      : i18n.t('buyBtnFull').replace('%s', '' + locked.price)
                  }}
                </button>
              </div>
            }
          }
          @case ('shop') {
            <!-- A lazy chunk: the shop is not in the first download -->
            @defer (on immediate) {
              <shop-sheet
                [canPlace]="!scene3d()?.is2d()"
                (changed)="load()"
                (placeFigure)="startPlacing($event)"
              />
            }
          }
          @case ('wallet') {
            <div class="sheet-emoji">🍊</div>
            <h2>{{ i18n.t('mandarins') }}: {{ tree()?.mandarins }}</h2>
            <button class="btn btn-primary wide" (click)="openShop()">
              {{ i18n.t('shopOpen') }}
            </button>
            <h3>{{ i18n.t('howToEarn') }}</h3>
            <ul class="earn">
              @for (r of rewards(); track r.reason) {
                <li>
                  <span>{{ reasonText(r.reason) }}</span
                  ><b>+{{ r.amount }} 🍊</b>
                </li>
              }
            </ul>
            @if (s.kind === 'wallet' && s.history?.length) {
              <h3>{{ i18n.t('history') }}</h3>
              <ul class="earn">
                @for (tx of s.history; track $index) {
                  <li>
                    <span>{{ reasonText(tx.reason) }}</span
                    ><b [class.neg]="tx.amount < 0">{{ signed(tx.amount) }}</b>
                  </li>
                }
              </ul>
            }
          }
        }
        <button class="btn btn-secondary wide" (click)="closeSheet()">{{ i18n.t('close') }}</button>
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
  /** Development only: the server allows the debug panel (admins with DEBUG_TOOLS=1) */
  protected readonly debugTools = computed(() => !!this.store.me()?.debug);
  protected readonly decorMode = signal(false);
  protected readonly cornerFocused = signal(false);

  protected readonly shop = inject(ShopState);
  /** Figure chosen in the shop to be placed: the next free place tapped tries it on at once */
  protected readonly placing = signal<string | null>(null);
  /** A figure tried on a free place: its translucent preview stands there until confirmed */
  protected readonly preview = signal<{ item: string; pad: number } | null>(null);
  private placeSettling = false;
  protected readonly padReplacing = signal(false);

  /** Keys of owned shop items: from the tree, fresher from the shop once it is loaded */
  private readonly owned = computed(
    () => new Set([...(this.tree()?.owned ?? []), ...this.shop.ownedKeys()]),
  );

  // Time of day: as on the user's clock or picked by hand (free)
  protected readonly daytime = inject(Daytime);
  protected readonly daytimeModes: DaytimeMode[] = DAYTIME_MODES;
  protected readonly phaseIcons = PHASE_ICONS;
  // Where the sun is counted for (stays in this browser)
  protected readonly lang = this.i18n.lang();
  protected readonly placeOpen = signal(false);
  protected readonly cityQuery = signal('');
  protected readonly cityHits = signal<City[]>([]);
  protected readonly locating = signal(false);
  protected readonly geoError = signal<'denied' | 'unavailable' | null>(null);
  protected readonly placeName = computed(() => {
    const p = this.daytime.place();
    const name = this.lang === 'ru' ? p.ru : p.en;
    return name ?? `${p.lat.toFixed(1)}°, ${p.lon.toFixed(1)}°`;
  });

  protected async searchCity(query: string): Promise<void> {
    this.cityQuery.set(query);
    const hits = await this.daytime.search(query);
    // An answer to an older query must not replace a newer one
    if (this.cityQuery() === query) this.cityHits.set(hits);
  }

  protected pickCity(city: City): void {
    this.daytime.pickCity(city);
    this.closePlace();
  }

  protected async geolocate(): Promise<void> {
    this.locating.set(true);
    this.geoError.set(null);
    const result = await this.daytime.locate();
    this.locating.set(false);
    if (result === 'ok') this.closePlace();
    else this.geoError.set(result);
  }

  protected resetPlace(): void {
    this.daytime.resetPlace();
    this.closePlace();
  }

  private closePlace(): void {
    this.placeOpen.set(false);
    this.cityQuery.set('');
    this.cityHits.set([]);
    this.geoError.set(null);
  }

  /** Today's sunrise and sunset here, or the polar night / day */
  protected readonly sunText = computed(() => {
    const { rise, set, up } = this.daytime.today();
    if (rise || set)
      return this.i18n
        .t('daytimeSun')
        .replace('%r', rise ?? '—')
        .replace('%s', set ?? '—');
    return this.i18n.t(up ? 'daytimePolarDay' : 'daytimePolarNight');
  });

  // Snowfall strength: dense modes are bought in the shop
  protected readonly snowModes = [
    { key: 'clear', icon: '✨' },
    { key: 'light', icon: '❄️' },
    { key: 'snowfall', icon: '🌨' },
    { key: 'blizzard', icon: '🌬' },
  ];
  private readonly snowChoice = signal(readSnow());
  private readonly unlockedSnow = computed(() =>
    [0, 1, 2, 3].filter((i) => !SNOW_ITEMS[i] || this.owned().has(SNOW_ITEMS[i])),
  );
  /** Chosen mode; a mode that is not owned falls back to light snow */
  protected readonly snowfall = computed(() =>
    this.unlockedSnow().includes(this.snowChoice()) ? this.snowChoice() : 1,
  );
  private readonly previewSnow = signal<number | null>(null);
  protected readonly shownSnow = computed(() => {
    const preview = this.previewSnow();
    return this.sheet()?.kind === 'snow' && preview !== null ? preview : this.snowfall();
  });
  /** A locked mode picked for a try-on */
  protected readonly lockedSnow = computed(() => {
    const index = this.previewSnow();
    if (index === null || this.unlockedSnow().includes(index)) return null;
    const price = this.snowPrice(index) ?? 0;
    return { index, price, lack: this.lack(price) };
  });

  // Fringe lights under the cabin roof: skins from the shop (locked = try-on)
  protected readonly lightSkins = LIGHT_SKINS;
  protected readonly lightIcons: Record<string, string> = {
    multi: '🎨',
    warm: '🤍',
    gold: '✨',
    icy: '🧊',
    candy: '🍭',
    flakes: '❄️',
    rainbow: '🌈',
    stars: '⭐',
    sparks: '💫',
    starbow: '🌠',
    starfall: '🌌',
    meteor: '☄️',
  };
  private readonly storedLights = signal<string | null>(readStored(LIGHTS_KEY));
  private readonly ownLights = computed(() => {
    const key = this.storedLights();
    return key && this.owned().has('lights-' + key) ? key : null;
  });
  private readonly previewLights = signal<string | null | undefined>(undefined);
  protected readonly shownLights = computed(() => {
    const preview = this.previewLights();
    return this.sheet()?.kind === 'lights' && preview !== undefined ? preview : this.ownLights();
  });
  protected readonly lockedLights = computed(() => {
    const key = this.previewLights();
    if (!key || this.ownsLights(key)) return null;
    const price = this.lightsPriceNum(key);
    return { key, price, lack: this.lack(price) };
  });

  protected readonly scene3d = viewChild<Tree3d>('scene3d');

  protected readonly progress = computed(() => {
    const t = this.tree();
    if (!t) return 0;
    if (!t.level_to) return 100;
    // The whole way from level 1 to 10: every new level fills a part of the bar
    const inside = Math.min(
      1,
      Math.max(0, (t.points - t.level_from) / (t.level_to - t.level_from)),
    );
    return ((t.level - 1 + inside) / 9) * 100;
  });

  protected readonly rewards = computed(() =>
    Object.entries(this.store.config()?.rewards ?? {}).map(([reason, amount]) => ({
      reason,
      amount,
    })),
  );

  constructor() {
    this.load();
    this.shop.load();
  }

  async load(): Promise<void> {
    try {
      const tree = await this.api.tree();
      this.animateChanges(tree);
      this.tree.set(tree);
    } catch {}
  }

  /** The debug panel changed the level or the balance: show it, refresh the shop */
  protected debugChanged(tree: TreeData): void {
    this.tree.set(tree);
    this.shop.load();
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

    const hung = tree.balls.filter(
      (b) => b.state !== 'box' && (!seen[b.id] || seen[b.id] === 'box'),
    );
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
      if (current?.kind === 'ball' && current.ball.id === ball.id)
        this.sheet.set({ kind: 'ball', ball, wish });
    } catch {}
  }

  ownsLights(key: string): boolean {
    return this.owned().has('lights-' + key);
  }

  closeSheet(): void {
    if (this.sheet()?.kind === 'lights') this.scene3d()?.clearFocus();
    this.sheet.set(null);
  }

  private lack(price: number): number {
    return Math.max(0, price - (this.shop.data()?.balance ?? this.tree()?.mandarins ?? 0));
  }

  protected lightsPriceNum(key: string): number {
    return this.shop.item('lights-' + key)?.price ?? 0;
  }

  protected lightsPrice(key: string): string {
    const item = this.shop.item('lights-' + key);
    return item ? item.price + ' 🍊' : '';
  }

  protected snowPrice(i: number): number | null {
    return this.shop.item(SNOW_ITEMS[i])?.price ?? null;
  }

  protected snowPriceText(i: number): string {
    const price = this.snowPrice(i);
    return price === null ? '' : price + ' 🍊';
  }

  openLights(): void {
    this.tg.haptic('light');
    this.scene3d()?.focusCabin();
    this.previewLights.set(undefined);
    this.sheet.set({ kind: 'lights' });
  }

  pickLights(key: string | null): void {
    this.tg.haptic('light');
    this.previewLights.set(key);
    if (key && !this.ownsLights(key)) return; // try-on: buy button appears
    this.storedLights.set(key);
    try {
      if (key) localStorage.setItem(LIGHTS_KEY, key);
      else localStorage.removeItem(LIGHTS_KEY);
    } catch {}
  }

  async buyLights(key: string): Promise<void> {
    if ((await this.shop.buy('lights-' + key)) !== 'ok') return;
    this.pickLights(key);
    this.load();
  }

  isUnlocked(i: number): boolean {
    return this.unlockedSnow().includes(i);
  }

  openSnow(): void {
    this.tg.haptic('light');
    this.previewSnow.set(null);
    this.sheet.set({ kind: 'snow' });
  }

  pickSnow(i: number): void {
    this.tg.haptic('light');
    if (!this.isUnlocked(i)) {
      this.previewSnow.set(i); // try-on: buy button appears
      return;
    }
    this.previewSnow.set(null);
    this.snowChoice.set(i);
    try {
      localStorage.setItem(SNOW_KEY, String(i));
    } catch {}
  }

  async buySnow(i: number): Promise<void> {
    if ((await this.shop.buy(SNOW_ITEMS[i])) !== 'ok') return;
    this.pickSnow(i);
    this.load();
  }

  openShop(): void {
    this.tg.haptic('light');
    this.sheet.set({ kind: 'shop' });
  }

  /** From the shop: close it and let the user pick a yard place for the figure */
  startPlacing(item: string): void {
    this.placeSettling = false;
    this.placing.set(item);
    this.preview.set(null);
    this.cornerFocused.set(false);
    this.decorMode.set(true);
    this.sheet.set(null);
  }

  /** From a corner back to the view of the whole yard (the decorate mode stays on) */
  backToYard(): void {
    this.tg.haptic('light');
    this.scene3d()?.clearFocus();
  }

  toggleDecor(): void {
    this.tg.haptic('light');
    this.placing.set(null);
    this.preview.set(null);
    this.decorMode.update((v) => !v);
    if (!this.decorMode()) this.scene3d()?.clearFocus();
  }

  openPad(e: { pad: number; corner: string; item: string | null }): void {
    this.tg.haptic('light');
    if (!e.item) {
      // The previewed figure itself was tapped: put it there
      if (this.preview()?.pad === e.pad) {
        this.confirmPreview();
        return;
      }
      // A figure came from the shop: try it on this place at once, no list
      const figure = this.placing();
      if (figure) {
        this.preview.set({ item: figure, pad: e.pad });
        return;
      }
    }
    this.padReplacing.set(false);
    // Let the camera fly first, then show the sheet
    setTimeout(() => this.sheet.set({ kind: 'pad', ...e }), 650);
  }

  /** The tried-on figure is put on its place for real; the decorate mode goes on */
  protected async confirmPreview(): Promise<void> {
    const p = this.preview();
    if (!p || this.placeSettling) return;
    this.placeSettling = true;
    this.tg.haptic('light');
    try {
      if (await this.shop.place(p.item, p.pad)) {
        await this.load();
        this.store.showToast(this.i18n.t('placedToast'));
        this.preview.set(null);
        this.placing.set(null);
      }
    } finally {
      this.placeSettling = false;
    }
  }

  /** A figure picked from the list: tried on a free place, put at once instead of the figure standing there */
  protected padPick(pad: number, item: string, occupied: boolean): Promise<void> | void {
    if (occupied) return this.padPlace(pad, item);
    this.tg.haptic('light');
    this.preview.set({ item, pad });
    this.sheet.set(null);
  }

  async padPlace(pad: number, item: string): Promise<void> {
    if (!(await this.shop.place(item, pad))) return;
    await this.load();
    this.store.showToast(this.i18n.t('placedToast'));
    this.leavePad();
  }

  /** Takes off the copy of the figure standing on this place */
  async padRemove(item: string, pad: number): Promise<void> {
    if (!(await this.shop.place(item, null, pad))) return;
    await this.load();
    this.store.showToast(this.i18n.t('removedToast'));
    this.leavePad();
  }

  private leavePad(): void {
    this.sheet.set(null);
    if (!this.decorMode()) this.scene3d()?.clearFocus();
  }

  cornerName(key: string): string {
    return this.i18n.dict.corners[key] ?? key;
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
    return this.i18n.t(
      ball.state === 'box' ? 'ballBox' : ball.state === 'lit' ? 'ballLit' : 'ballHung',
    );
  }

  signed(amount: number): string {
    return (amount < 0 ? '−' : '+') + Math.abs(amount);
  }

  reasonText(reason: string): string {
    return this.i18n.dict.reasons[reason] ?? reason;
  }
}
