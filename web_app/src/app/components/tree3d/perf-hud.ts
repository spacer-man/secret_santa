/**
 * On-device numbers for the owner (`?perf` in the URL): frame rate, the worst frame,
 * what the quality watcher chose, draw calls, and long main-thread tasks with the time
 * between them (a freeze "with a constant period" shows its period here).
 * Plain DOM over the scene, updated twice a second; nothing of it exists without `?perf`.
 */
export interface PerfSample {
  calls: number;
  triangles: number;
  quality: { pixelRatio: number; halfRate: boolean; bloomScale: number; realLights: boolean };
}

export class PerfHud {
  private readonly el = document.createElement('pre');
  private frames = 0;
  private since = performance.now();
  private worst = 0;
  private last = 0;
  private readonly longs: { at: number; ms: number }[] = [];
  private readonly observer?: PerformanceObserver;

  constructor(host: HTMLElement) {
    this.el.style.cssText =
      'position:absolute;left:6px;top:44px;z-index:5;margin:0;padding:4px 6px;font:11px/1.35 monospace;' +
      'color:#fff;background:rgba(0,0,0,.62);border-radius:4px;pointer-events:none;white-space:pre';
    host.append(this.el);
    try {
      this.observer = new PerformanceObserver((list) =>
        list.getEntries().forEach((e) => {
          this.longs.push({ at: e.startTime, ms: e.duration });
          if (this.longs.length > 12) this.longs.shift();
        }),
      );
      this.observer.observe({ type: 'longtask', buffered: false });
    } catch {
      // Safari has no long task timing
    }
  }

  /** After every drawn frame */
  frame(now: number, sample: () => PerfSample): void {
    if (this.last) this.worst = Math.max(this.worst, now - this.last);
    this.last = now;
    this.frames++;
    const span = now - this.since;
    if (span < 500) return;
    const s = sample();
    const q = s.quality;
    const longs = this.longs;
    const gaps = longs.slice(1).map((l, i) => l.at - longs[i].at);
    const every = gaps.length
      ? (gaps.reduce((a, b) => a + b, 0) / gaps.length / 1000).toFixed(1) + 's'
      : '-';
    const nav = navigator as Navigator & { deviceMemory?: number };
    this.el.textContent =
      `${((this.frames * 1000) / span).toFixed(0)} fps  worst ${this.worst.toFixed(0)} ms\n` +
      `px ${q.pixelRatio}/${devicePixelRatio}  ${q.halfRate ? '30fps' : 'full'}  bloom ${q.realLights ? q.bloomScale : 'off'}\n` +
      `calls ${s.calls}  tris ${(s.triangles / 1000).toFixed(0)}k\n` +
      `long tasks ${longs.length}: ${longs
        .slice(-4)
        .map((l) => l.ms.toFixed(0))
        .join(',')} ms, every ${every}\n` +
      `cpu ${navigator.hardwareConcurrency ?? '?'}  mem ${nav.deviceMemory ?? '?'} GB`;
    this.frames = 0;
    this.worst = 0;
    this.since = now;
  }

  dispose(): void {
    this.observer?.disconnect();
    this.el.remove();
  }
}
