import type Phaser from 'phaser';

/** Anime cel-sea palette (main menu, ship). */
export const SEA = { base: 0x2a9fd6, dark: 0x1477b8, light: 0x5cc8ec, foam: 0xeefbff } as const;

/** Stable 0..1 noise from an integer, so each swell keeps its shape as it drifts. */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Cel-shaded open sea in a band from `top` (the horizon) down `height` units: rows of
 * swells in perspective (small and packed at the horizon, big near the viewer). Each swell
 * is a dark-blue lozenge with a light-cyan patch on its upper slope and a jagged white foam
 * crest. Swells drift and bob with `t` (seconds); `pan` slides the rows for camera parallax.
 * Clears `g` first; call every frame.
 */
export function drawCelSea(g: Phaser.GameObjects.Graphics, left: number, width: number, top: number, height: number, t: number, pan = 0): void {
  const right = left + width;
  g.clear();
  g.fillStyle(SEA.base).fillRect(left, top, width, height);
  const ROWS = 9;
  for (let r = 0; r < ROWS; r++) {
    const d0 = r / ROWS;
    const d1 = (r + 1) / ROWS;
    const y0 = top + height * d0 ** 1.7;
    const y1 = top + height * d1 ** 1.7;
    const h = y1 - y0;
    const cw = 46 + 300 * d1 ** 1.4; // swell width grows toward the viewer
    const scroll = t * (6 + 26 * d1) + r * 173 + pan * (0.3 + 0.7 * d1); // pan: parallax, near rows slide more
    const first = Math.floor((scroll + left) / cw) - 1;
    const foamW = 2 + 6 * d1;
    for (let id = first; id * cw - scroll < right + cw; id++) {
      const rnd = (k: number) => hash(r * 7919 + id * 104729 + k * 31);
      const cx = id * cw - scroll + (r % 2) * cw * 0.5 + (rnd(1) - 0.5) * cw * 0.3;
      const w = cw * (0.85 + rnd(2) * 0.4) * (1 + 0.05 * Math.sin(t * 1.3 + id));
      const hh = h * (1.1 + rnd(3) * 0.5);
      const cy = y0 + h * 0.65 + Math.sin(t * 1.6 + id * 1.9 + r) * h * 0.1;
      // Dark swell body: sharp horizontal tips, ragged top edge
      const crestPts = [
        { x: cx - w / 2, y: cy },
        { x: cx - w * 0.3, y: cy - hh * (0.32 + rnd(4) * 0.15) },
        { x: cx - w * 0.08, y: cy - hh * (0.45 + rnd(5) * 0.1) },
        { x: cx + w * 0.12, y: cy - hh * (0.38 + rnd(6) * 0.15) },
        { x: cx + w * 0.32, y: cy - hh * (0.3 + rnd(7) * 0.1) },
        { x: cx + w / 2, y: cy + hh * 0.05 },
      ];
      g.fillStyle(SEA.dark).fillPoints([...crestPts, { x: cx + w * 0.25, y: cy + hh * 0.3 }, { x: cx - w * 0.2, y: cy + hh * 0.28 }], true);
      // Light patch on the upper slope
      g.fillStyle(SEA.light).fillPoints([
        { x: cx - w * 0.28, y: cy - hh * 0.12 },
        { x: cx - w * 0.06, y: cy - hh * 0.36 },
        { x: cx + w * 0.22, y: cy - hh * 0.22 },
        { x: cx + w * 0.05, y: cy - hh * 0.05 },
      ], true);
      // Foam crest: a white band on the ridge, thick in the middle and tapering to sharp
      // tips that overshoot the swell, so neighbouring crests read as one foam net.
      const crest = [{ x: cx - w * 0.66, y: cy + hh * 0.1 }, ...crestPts, { x: cx + w * 0.66, y: cy + hh * 0.14 }];
      const n = crest.length - 1;
      const upper = crest.map((p, k) => ({ x: p.x, y: p.y - foamW * Math.sin((Math.PI * k) / n) * (0.7 + rnd(20 + k) * 0.6) }));
      g.fillStyle(SEA.foam, 0.97).fillPoints([...upper, ...crest.slice(1, -1).reverse()], true);
      // A few spray dots near the bigger crests
      if (d1 > 0.4 && rnd(8) > 0.6) {
        g.fillStyle(SEA.foam, 0.9);
        for (let k = 0; k < 3; k++) g.fillCircle(cx + (rnd(9 + k) - 0.5) * w * 0.4, cy - hh * (0.6 + rnd(12 + k) * 0.4), 1 + d1 * 1.5);
      }
    }
  }
  // Bright horizon line
  g.fillStyle(SEA.foam, 0.85).fillRect(left, top, width, 2);
}
