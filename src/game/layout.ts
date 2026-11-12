import type Phaser from 'phaser';
import { GAME_H, GAME_W, RES } from '../config';

/**
 * Aspect-ratio handling. The canvas uses Scale.EXPAND: it is always at least the
 * 1280×720 design size, and grows in width (wide screens) or height (tall screens)
 * to fill the window with no letterboxing.
 *
 * Screens are composed for 1280×720 and then:
 *  - `centerCamera` scrolls the camera so that design area sits in the middle; full-bleed
 *    backgrounds use the returned screen edges (left/top/right/bottom, in world coords).
 *  - HUD elements anchor to `scene.scale.width/height` directly.
 *  - `relayoutOnResize` restarts the scene (debounced) when the window or device rotates.
 */
export interface ScreenBox {
  w: number;
  h: number;
  /** How far the design area is offset from the screen's top-left corner. */
  ox: number;
  oy: number;
  /** Screen edges expressed in design (world) coordinates after centring. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function screenBox(scene: Phaser.Scene): ScreenBox {
  // Logical (design-unit) screen size: the canvas renders at RES× for sharpness.
  const w = scene.scale.width / RES;
  const h = scene.scale.height / RES;
  const ox = Math.round((w - GAME_W) / 2);
  const oy = Math.round((h - GAME_H) / 2);
  return { w, h, ox, oy, left: -ox, top: -oy, right: w - ox, bottom: h - oy };
}

/** Centre the 1280×720 design area on screen by scrolling the main camera. */
export function centerCamera(scene: Phaser.Scene): ScreenBox {
  const box = screenBox(scene);
  scene.cameras.main.setOrigin(0, 0).setZoom(RES).setScroll(-box.ox, -box.oy);
  return box;
}

/**
 * Re-run the scene's layout after the window settles at a new size.
 * `getData` supplies the init data for the restart (e.g. the panel config).
 */
export function relayoutOnResize(scene: Phaser.Scene, getData?: () => object | undefined): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const handler = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (scene.sys.isActive() || scene.sys.isPaused()) scene.scene.restart(getData?.());
    }, 150);
  };
  scene.scale.on('resize', handler);
  scene.events.once('shutdown', () => {
    if (timer) clearTimeout(timer);
    scene.scale.off('resize', handler);
  });
}
