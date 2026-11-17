import { Component, ElementRef, OnDestroy, afterNextRender, viewChildren } from '@angular/core';

/** Two depths of snow: small and slow far away, bigger and faster near */
const LAYERS = [
  { density: 1 / 16000, r: [0.6, 1.6], speed: 22, sway: 6, swayS: 7, alpha: 0.6 },
  { density: 1 / 26000, r: [1.3, 2.6], speed: 42, sway: 10, swayS: 5, alpha: 0.85 },
];

/**
 * Light falling snow behind the content.
 *
 * Drawn once, moved by the compositor: every layer is a tile of flakes painted
 * on a canvas (twice, one under the other) that slides down by one tile height
 * in an endless CSS animation, swaying a little. Nothing runs on the main
 * thread per frame. (It used to redraw a canvas 60 times a second: every frame
 * the page had to commit all its layers — most of the work on a phone.)
 */
@Component({
  selector: 'snow',
  template: `
    <div class="snow" aria-hidden="true">
      @for (layer of layers; track $index) {
        <div class="sway" [style.--sway.px]="layer.sway" [style.--sway-s.s]="layer.swayS">
          <canvas #tile></canvas>
        </div>
      }
    </div>
  `,
  styles: `
    .snow {
      position: fixed;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      z-index: 0;
    }
    .sway {
      position: absolute;
      inset: 0;
      animation: snow-sway var(--sway-s) ease-in-out infinite alternate;
      will-change: transform;
    }
    canvas {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      /* Two tiles: the animation slides by one, and the picture repeats seamlessly */
      height: 200%;
      animation: snow-fall var(--fall-s, 30s) linear infinite;
      will-change: transform;
    }
    @keyframes snow-fall {
      from {
        transform: translateY(-50%);
      }
      to {
        transform: translateY(0);
      }
    }
    @keyframes snow-sway {
      from {
        transform: translateX(calc(var(--sway) * -1));
      }
      to {
        transform: translateX(var(--sway));
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .snow {
        display: none;
      }
    }
  `,
})
export class Snow implements OnDestroy {
  protected readonly layers = LAYERS;
  private readonly tiles = viewChildren<ElementRef<HTMLCanvasElement>>('tile');
  private size = '';
  private timer?: ReturnType<typeof setTimeout>;
  private readonly onResize = () => {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.paint(), 250);
  };

  constructor() {
    afterNextRender(() => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      this.paint();
      addEventListener('resize', this.onResize);
    });
  }

  /** Paints the tiles for the current screen size (once, and again after a resize) */
  private paint(): void {
    const w = innerWidth;
    // Keyboard and browser bars change the height a little: only real changes repaint
    const h = Math.round(innerHeight / 40) * 40;
    const size = `${w}x${h}`;
    if (size === this.size) return;
    this.size = size;
    // Soft dots: no need for the full retina resolution
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.tiles().forEach(({ nativeElement: canvas }, i) => {
      const layer = LAYERS[i];
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr) * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = `rgba(255,255,255,${layer.alpha})`;
      ctx.beginPath();
      const count = Math.round(w * h * layer.density);
      for (let k = 0; k < count; k++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const r = layer.r[0] + Math.random() * (layer.r[1] - layer.r[0]);
        // The same flake in both tiles, and over the seam where it is cut
        for (const dy of [-h, 0, h, 2 * h]) {
          if (y + dy < -r || y + dy > 2 * h + r) continue;
          ctx.moveTo(x + r, y + dy);
          ctx.arc(x, y + dy, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      canvas.style.setProperty('--fall-s', `${(h / layer.speed).toFixed(1)}s`);
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    removeEventListener('resize', this.onResize);
  }
}
