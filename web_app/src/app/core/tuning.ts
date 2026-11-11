/**
 * Feel of the interface: durations and strengths that are easy to tune by eye.
 * Change a number, rebuild, look. Everything else reads them from here.
 */
export const TUNING = {
  // ====== Pencil drawings (core/handmade.ts) ====== //
  /** How long the pencil outline around a button is being drawn (and wiped), ms */
  scribbleMs: 200,
  /** Hatching of a button drawn anew under the mouse, ms */
  hoverRedrawMs: 420,
  /** Hatching drawn anew when a button is pressed and released, ms */
  pressRedrawMs: 200,

  // ====== Scene (components/tree3d) ====== //
  /** Change of the weather (clear sky ↔ snow ↔ blizzard), ms */
  weatherMs: 2500,
  /** Tappable objects of the scene grow under the mouse: strength (1 = as designed, 0 = off) */
  sceneHover: 1,
  /** …and give under the finger / mouse button, bouncing back on release: strength */
  scenePress: 1,

  // ====== Shop (components/tree/shop-sheet.ts) ====== //
  /** A page of the shop turns over when the tab changes, ms */
  shopPageMs: 380,
  /** The hatched mark of the active tab crawls to the new one, ms */
  shopTabMs: 420,
} as const;
