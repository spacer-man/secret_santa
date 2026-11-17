import { Component, ElementRef, OnDestroy, afterNextRender, viewChild } from '@angular/core';

/** Light falling snow on a fixed canvas behind the content */
@Component({
  selector: 'snow',
  template: `<canvas #canvas aria-hidden="true"></canvas>`,
  styles: `canvas { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }`,
})
export class Snow implements OnDestroy {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private frame = 0;

  constructor() {
    afterNextRender(() => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      this.start(this.canvas().nativeElement);
    });
  }

  private start(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')!;
    // Soft dots: no need for the full retina resolution
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    let w = 0;
    let h = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
    };
    resize();
    addEventListener('resize', resize);
    this.cleanup = () => removeEventListener('resize', resize);

    const flakes = Array.from({ length: Math.min(70, Math.round((w * h) / 11000)) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 2 + 0.6,
      vy: Math.random() * 0.6 + 0.3,
      phase: Math.random() * Math.PI * 2,
    }));

    // Slow drift: 30 fps is plenty, the other frames are left to the 3D scene and the UI
    const STEP = 1000 / 30;
    let last = 0;
    const tick = (t: number) => {
      this.frame = requestAnimationFrame(tick);
      if (t - last < STEP - 2) return;
      // Speeds were tuned per 60 fps frame
      const k = last ? Math.min((t - last) / (1000 / 60), 4) : 1;
      last = t;
      ctx.clearRect(0, 0, w, h);
      // All flakes in one path: one fill per frame instead of one per flake
      ctx.beginPath();
      for (const f of flakes) {
        f.y += f.vy * k;
        f.x += Math.sin(t / 1500 + f.phase) * 0.3 * k;
        if (f.y > h + 5) {
          f.y = -5;
          f.x = Math.random() * w;
        }
        ctx.moveTo(f.x + f.r, f.y);
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      }
      ctx.fill();
    };
    this.frame = requestAnimationFrame(tick);
  }

  private cleanup = () => {};

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.cleanup();
  }
}
