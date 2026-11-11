import {
  Component,
  ElementRef,
  inject,
  OnDestroy,
  afterNextRender,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { TreeBall, TreeData } from '../../core/api';
import { I18n } from '../../core/i18n';
import { TreeScene } from '../tree/tree-scene';
import type { TreeWorld } from './scene';
import type { LightSkin } from './cabin-lights';

/** 3D tree (three.js is loaded lazily); falls back to the 2D tree without WebGL */
@Component({
  selector: 'tree-3d',
  imports: [TreeScene],
  template: `
    @if (fallback()) {
      <tree-scene
        [tree]="tree()"
        [newHung]="newHung()"
        [newLit]="newLit()"
        (ballClick)="ballClick.emit($event)"
        (addBall)="addBall.emit()"
        (starClick)="starClick.emit()"
      />
    } @else {
      <canvas #canvas class="scene3d" [class.ready]="ready()"></canvas>
      @if (!ready()) {
        <!-- Loading: pencil doodles boil on the night paper, the bar fills up -->
        <div
          class="loading"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          [attr.aria-valuenow]="percent()"
        >
          @for (d of doodles; track $index) {
            <span
              class="doodle"
              [attr.data-doodle]="d.kind"
              [style.left.%]="d.x"
              [style.top.%]="d.y"
              [style.width.rem]="d.size"
              [style.height.rem]="d.kind === 'fir' ? d.size * 1.25 : d.size"
              [style.animation-delay.s]="-$index * 0.7"
            ></span>
          }
          <div class="loading-foot">
            <div class="load-bar"><span [style.width.%]="percent()"></span></div>
            <span class="loading-text">{{ i18n.t('sceneLoading') }}</span>
          </div>
        </div>
      }
      @if (ready()) {
        <div class="zoom">
          <button (click)="zoom(-0.25)" aria-label="Zoom in">＋</button>
          <button (click)="zoom(0.25)" aria-label="Zoom out">−</button>
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }
    .zoom {
      position: absolute;
      right: 0.7rem;
      bottom: 2.6rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .zoom button {
      width: 2.4rem;
      height: 2.4rem;
      border-radius: 50%;
      /* Looks like a round paper tag: drawn by core/handmade.ts, colours in styles.scss */
      border: none;
      background: none;
      color: var(--ink);
      font-size: 1.3rem;
      line-height: 1;
      cursor: pointer;
    }
    .scene3d {
      display: block;
      width: 100%;
      aspect-ratio: 360 / 470;
      touch-action: pan-y;
      background: #0b0a24;
      opacity: 0;
      transition: opacity 0.6s ease;
    }
    .scene3d.ready {
      opacity: 1;
    }
    .loading {
      position: absolute;
      inset: 0;
      overflow: hidden;
      background: #0b0a24;
    }
    .doodle {
      position: absolute;
      transform: translate(-50%, -50%);
      /* Floats a little: the compositor moves it even while the scene is being built */
      animation: doodle-float 3.2s ease-in-out infinite alternate;
    }
    /* Colours of the chalk: the drawings take --chalk (styles.scss) */
    .doodle[data-doodle='snowflake'] {
      --chalk: #dfe9ff;
    }
    .doodle[data-doodle='star'] {
      --chalk: #ffd36b;
    }
    .doodle[data-doodle='fir'] {
      --chalk: #8fdc9a;
    }
    @keyframes doodle-float {
      to {
        transform: translate(-50%, calc(-50% + 0.5rem)) rotate(8deg);
      }
    }
    .loading-foot {
      position: absolute;
      left: 18%;
      right: 18%;
      bottom: 24%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }
    .load-bar {
      width: 100%;
      height: 0.55rem;
      --chalk: #dfe9ff;
    }
    .load-bar > span {
      display: block;
      height: 100%;
      transition: width 0.3s ease;
      --chalk: #ffd36b;
    }
    .loading-text {
      color: #dfe9ff;
      font-family: var(--slab);
      font-size: 0.95rem;
      opacity: 0.85;
    }
    @media (prefers-reduced-motion: reduce) {
      .doodle {
        animation: none;
      }
    }
  `,
})
export class Tree3d implements OnDestroy {
  readonly tree = input.required<TreeData>();
  readonly newHung = input<string[]>([]);
  readonly newLit = input<string[]>([]);
  readonly ballClick = output<TreeBall>();
  readonly addBall = output<void>();
  readonly starClick = output<void>();
  /** Decorate mode: free courtyard places glow and can be chosen */
  readonly decorMode = input(false);
  /** Figure being placed: free places show its translucent preview */
  readonly previewItem = input<string | null>(null);
  /** 0 clear (starry sky), 1 light, 2 snowfall, 3 blizzard */
  readonly snowfall = input(1);
  /** Fringe lights under the cabin roof */
  readonly cabinLights = input<string | null>(null);
  readonly cabinClick = output<void>();
  readonly padClick = output<{ pad: number; corner: string; item: string | null }>();
  readonly focusLost = output<void>();
  readonly focused = output<number>();

  protected readonly fallback = signal(new URLSearchParams(location.search).get('scene') === '2d');
  protected readonly ready = signal(false);
  protected readonly i18n = inject(I18n);
  /** Loading progress, % */
  protected readonly percent = signal(0);
  protected readonly doodles = [
    { kind: 'fir', x: 50, y: 40, size: 5.5 },
    { kind: 'star', x: 50, y: 13, size: 2.2 },
    { kind: 'snowflake', x: 20, y: 22, size: 2.6 },
    { kind: 'snowflake', x: 80, y: 30, size: 2 },
    { kind: 'star', x: 18, y: 58, size: 1.5 },
    { kind: 'snowflake', x: 82, y: 62, size: 2.8 },
    { kind: 'star', x: 70, y: 12, size: 1.3 },
    { kind: 'snowflake', x: 33, y: 76, size: 1.6 },
  ];
  /** The flat 2D tree is shown (no WebGL or ?scene=2d): no courtyard there */
  readonly is2d = this.fallback.asReadonly();
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private world?: TreeWorld;
  /** The world being built (not yet given the inputs) */
  private pending?: TreeWorld;
  private destroyed = false;

  constructor() {
    afterNextRender(() => this.init());
    effect(() => {
      const tree = this.tree();
      const hung = this.newHung();
      const lit = this.newLit();
      this.world?.setTree(tree, hung, lit);
    });
    effect(() => {
      const on = this.decorMode();
      const item = this.previewItem();
      this.world?.setDecorMode(on, item);
    });
    effect(() => {
      const level = this.snowfall();
      this.world?.setSnowfall(level);
    });
    effect(() => {
      const skin = this.cabinLights() as LightSkin | null;
      this.world?.setCabinLights(skin);
    });
  }

  private async init(): Promise<void> {
    if (this.fallback()) return;
    try {
      this.percent.set(3);
      const { TreeWorld, webglSupported } = await import('./scene');
      const canvas = this.canvas()?.nativeElement;
      if (!canvas || !webglSupported()) throw new Error('No WebGL');
      this.percent.set(10);
      const progress = (k: number) => this.percent.set(Math.round(10 + k * 90));
      const world = new TreeWorld(canvas, {
        ball: (b) => this.ballClick.emit(b),
        star: () => this.starClick.emit(),
        addBall: () => this.addBall.emit(),
        pad: (pad, corner, item) => this.padClick.emit({ pad, corner, item }),
        focusLost: () => this.focusLost.emit(),
        focused: (corner) => this.focused.emit(corner),
        cabin: () => this.cabinClick.emit(),
      });
      this.pending = world;
      // Step by step: the page stays alive, the loading screen moves
      await world.build(progress);
      if (this.destroyed) return;
      // Built: from now on the inputs go straight to the world
      this.world = world;
      world.setDecorMode(this.decorMode(), this.previewItem());
      world.setSnowfall(this.snowfall(), true);
      world.setCabinLights(this.cabinLights() as LightSkin | null);
      // For screenshots/tests only: ?debug exposes the scene
      if (new URLSearchParams(location.search).has('debug'))
        (window as unknown as { santaTree: TreeWorld }).santaTree = world;
      world.setTree(this.tree(), this.newHung(), this.newLit());
      await world.finish(progress);
      if (this.destroyed) return;
      this.ready.set(true);
    } catch (err) {
      console.warn('3D tree is unavailable, using 2D', err);
      this.fallback.set(true);
    }
  }

  focusCabin(): void {
    this.world?.focusCabin();
  }

  /** Back from a corner to the whole tree */
  clearFocus(): void {
    this.world?.clearFocus();
  }

  protected zoom(delta: number): void {
    this.world?.zoomBy(delta);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    (this.world ?? this.pending)?.dispose();
  }
}
