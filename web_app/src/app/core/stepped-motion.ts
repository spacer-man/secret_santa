/**
 * Hand-drawn motion "on twos": CSS animations inside a drawing are stepped at a
 * low frame rate instead of 60 fps.
 *
 * Animations of elements inside an SVG (transforms of `<g>`, eyes, arms) are not
 * done by the compositor: every frame the browser recalculates styles and
 * repaints the whole drawing (with its patterns, masks and pencil passes). On a
 * phone that was most of the main thread while the page was doing nothing.
 * Drawn animation shows 8–12 pictures a second anyway, so the motion keeps its
 * character and costs five times less.
 *
 * The animations stay plain CSS (keyframes, classes); here they are only paused
 * and moved to the right time on a timer (Web Animations API). Off the screen or
 * in a hidden tab nothing is moved.
 */
export function steppedMotion(root: Element, fps = 12): () => void {
  const starts = new WeakMap<Animation, number>();
  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(root);

  const tick = () => {
    const now = Number(document.timeline.currentTime ?? performance.now());
    const move = visible && !document.hidden;
    for (const a of root.getAnimations({ subtree: true })) {
      let start = starts.get(a);
      if (start === undefined) {
        // A new animation (a class was just set): take it over from the browser
        start = a.startTime !== null ? Number(a.startTime) : now - Number(a.currentTime ?? 0);
        starts.set(a, start);
        a.pause();
      }
      if (move) a.currentTime = now - start;
    }
  };
  const timer = setInterval(tick, 1000 / fps);
  tick();
  return () => {
    clearInterval(timer);
    io.disconnect();
  };
}
