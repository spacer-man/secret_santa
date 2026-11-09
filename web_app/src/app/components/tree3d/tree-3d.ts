import { Component, ElementRef, OnDestroy, afterNextRender, effect, input, output, signal, viewChild } from '@angular/core';
import type { TreeBall, TreeData } from '../../core/api';
import { TreeScene } from '../tree/tree-scene';
import type { TreeWorld } from './scene';

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
    }
  `,
  styles: `
    :host { display: block; }
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
      });
      this.world.setTree(this.tree(), this.newHung(), this.newLit());
      this.ready.set(true);
    } catch (err) {
      console.warn('3D tree is unavailable, using 2D', err);
      this.fallback.set(true);
    }
  }

  ngOnDestroy(): void {
    this.world?.dispose();
  }
}
