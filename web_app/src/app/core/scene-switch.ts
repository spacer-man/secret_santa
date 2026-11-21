import { Injectable, signal } from '@angular/core';

/** How the tree is drawn: the real 3D scene, the flat 2D tree, or nothing at all */
export type SceneMode = '3d' | '2d' | 'off';

const KEY = 'santa.debug.scene';

function readMode(): SceneMode {
  const url = new URLSearchParams(location.search).get('scene');
  if (url === 'off' || url === '2d' || url === '3d') return url;
  try {
    const v = localStorage.getItem(KEY);
    return v === 'off' || v === '2d' ? v : '3d';
  } catch {
    return '3d';
  }
}

/**
 * Debug only: switch the scene off to see whether the lag comes from it.
 * The debug panel sets it (kept in localStorage, survives a reload), `?scene=off|2d|3d`
 * in the address overrides it for one visit.
 */
@Injectable({ providedIn: 'root' })
export class SceneSwitch {
  readonly mode = signal<SceneMode>(readMode());

  set(mode: SceneMode): void {
    this.mode.set(mode);
    try {
      if (mode === '3d') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch {}
  }
}
