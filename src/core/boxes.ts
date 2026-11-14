import { hash2 } from './noise';

/**
 * Endless, deterministic rectangles for stage blocks and box-shaped water: the world is a
 * grid of `cell`-sized squares and each holds at most one box, kept MARGIN inside its
 * square. So boxes never touch (corridors of at least 2 × MARGIN between them), and a
 * circle of radius ≤ MARGIN can only overlap the box of the square its centre is in.
 * Nothing is generated near the origin, where every run starts.
 */
export interface BoxLayout {
  /** Grid square size in world units. */
  cell: number;
  /** Chance a square holds a box. */
  chance: number;
  /** Box side lengths, in world units. */
  min: number;
  max: number;
  seed: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const BOX_MARGIN = 40;
/** No box comes closer than this to the run's starting point (0, 0). */
export const START_CLEAR = 150;

/** The box in grid square (cx, cy), or null. */
export function boxInCell(cx: number, cy: number, l: BoxLayout): Rect | null {
  if (hash2(cx, cy, l.seed) >= l.chance) return null;
  const room = l.cell - 2 * BOX_MARGIN;
  const size = (salt: number) => Math.min(room, l.min + hash2(cx, cy, l.seed + salt) * (l.max - l.min));
  const w = size(11);
  const h = size(23);
  const x = cx * l.cell + BOX_MARGIN + hash2(cx, cy, l.seed + 37) * (room - w);
  const y = cy * l.cell + BOX_MARGIN + hash2(cx, cy, l.seed + 53) * (room - h);
  // Keep the start clear: drop boxes whose nearest point is within START_CLEAR of (0, 0).
  const nx = Math.max(x, Math.min(0, x + w));
  const ny = Math.max(y, Math.min(0, y + h));
  if (nx * nx + ny * ny < START_CLEAR * START_CLEAR) return null;
  return { x, y, w, h };
}

/** The box of the grid square containing (x, y), or null. */
export function boxNear(x: number, y: number, l: BoxLayout): Rect | null {
  return boxInCell(Math.floor(x / l.cell), Math.floor(y / l.cell), l);
}

export function inBox(x: number, y: number, l: BoxLayout): boolean {
  const b = boxNear(x, y, l);
  return !!b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** Where a circle hit a block: the outward normal and the block's centre. */
export interface BoxHit {
  nx: number;
  ny: number;
  cx: number;
  cy: number;
}

/**
 * Push a circle out of the blocks. Returns the hit (the circle's new x/y go in `out`),
 * or null when it touches nothing.
 * Radii above BOX_MARGIN are treated as BOX_MARGIN (see the layout guarantee above).
 */
export function pushOutOfBox(x: number, y: number, r: number, l: BoxLayout, out: { x: number; y: number }): BoxHit | null {
  const b = boxNear(x, y, l);
  if (!b) return null;
  r = Math.min(r, BOX_MARGIN);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const px = Math.max(b.x, Math.min(x, b.x + b.w));
  const py = Math.max(b.y, Math.min(y, b.y + b.h));
  let dx = x - px;
  let dy = y - py;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    dx /= d;
    dy /= d;
    out.x = px + dx * r;
    out.y = py + dy * r;
    return { nx: dx, ny: dy, cx, cy };
  }
  // Centre inside the box: leave by the nearest side.
  const left = x - b.x;
  const right = b.x + b.w - x;
  const top = y - b.y;
  const bottom = b.y + b.h - y;
  const m = Math.min(left, right, top, bottom);
  out.x = x;
  out.y = y;
  if (m === left) out.x = b.x - r;
  else if (m === right) out.x = b.x + b.w + r;
  else if (m === top) out.y = b.y - r;
  else out.y = b.y + b.h + r;
  const [nx, ny] = m === left ? [-1, 0] : m === right ? [1, 0] : m === top ? [0, -1] : [0, 1];
  return { nx, ny, cx, cy };
}
