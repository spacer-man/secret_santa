/** One-shot confetti burst on a temporary full-screen canvas */
export function confetti(count = 160): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1000';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const w = (canvas.width = innerWidth);
  const h = (canvas.height = innerHeight);
  const colors = ['#ff0060', '#ffd166', '#06d6a0', '#4cc9f0', '#ffffff', '#f72585'];
  const parts = Array.from({ length: count }, () => ({
    x: w / 2,
    y: h * 0.45,
    vx: (Math.random() - 0.5) * 16,
    vy: Math.random() * -16 - 4,
    size: Math.random() * 8 + 4,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const started = performance.now();
  const tick = (t: number) => {
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (t - started < 3500) requestAnimationFrame(tick);
    else canvas.remove();
  };
  requestAnimationFrame(tick);
}
