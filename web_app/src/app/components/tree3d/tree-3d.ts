import { Component, ElementRef, OnDestroy, afterNextRender, effect, input, output, signal, viewChild } from '@angular/core';
import type { TreeBall, TreeData } from '../../core/api';
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
      @if (ready()) {
        <div class="zoom">
          <button (click)="zoom(-0.25)" aria-label="Zoom in">＋</button>
          <button (click)="zoom(0.25)" aria-label="Zoom out">−</button>
        </div>
      }
    }
  `,
  styles: `
    :host { display: block; position: relative; }
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
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(12, 11, 34, 0.55);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      color: #fff;
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
    .scene3d.ready { opacity: 1; }
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
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private world?: TreeWorld;

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
      this.world?.setDecorMode(on);
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
      const { TreeWorld, webglSupported } = await import('./scene');
      const canvas = this.canvas()?.nativeElement;
      if (!canvas || !webglSupported()) throw new Error('No WebGL');
      this.world = new TreeWorld(canvas, {
        ball: (b) => this.ballClick.emit(b),
        star: () => this.starClick.emit(),
        addBall: () => this.addBall.emit(),
        pad: (pad, corner, item) => this.padClick.emit({ pad, corner, item }),
        focusLost: () => this.focusLost.emit(),
        focused: (corner) => this.focused.emit(corner),
        cabin: () => this.cabinClick.emit(),
      });
      this.world.setDecorMode(this.decorMode());
      this.world.setSnowfall(this.snowfall());
      this.world.setCabinLights(this.cabinLights() as LightSkin | null);
      // For screenshots/tests only: ?debug exposes the scene
      if (new URLSearchParams(location.search).has('debug')) (window as unknown as { santaTree: TreeWorld }).santaTree = this.world;
      this.world.setTree(this.tree(), this.newHung(), this.newLit());
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
    this.world?.dispose();
  }
}
