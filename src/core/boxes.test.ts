import { describe, expect, it } from 'vitest';
import { BOX_MARGIN, boxInCell, boxNear, inBox, pushOutOfBox, START_CLEAR, type BoxLayout } from './boxes';

const L: BoxLayout = { cell: 260, chance: 0.6, min: 40, max: 140, seed: 7 };

describe('boxes', () => {
  it('stays inside its cell with the margin, is deterministic, and keeps the start clear', () => {
    let count = 0;
    for (let cx = -20; cx <= 20; cx++) {
      for (let cy = -20; cy <= 20; cy++) {
        const b = boxInCell(cx, cy, L);
        expect(boxInCell(cx, cy, L)).toEqual(b);
        if (!b) continue;
        count++;
        expect(b.x).toBeGreaterThanOrEqual(cx * L.cell + BOX_MARGIN - 1e-6);
        expect(b.y).toBeGreaterThanOrEqual(cy * L.cell + BOX_MARGIN - 1e-6);
        expect(b.x + b.w).toBeLessThanOrEqual((cx + 1) * L.cell - BOX_MARGIN + 1e-6);
        expect(b.y + b.h).toBeLessThanOrEqual((cy + 1) * L.cell - BOX_MARGIN + 1e-6);
        expect(b.w).toBeGreaterThanOrEqual(L.min);
      }
    }
    expect(count).toBeGreaterThan(41 * 41 * 0.4); // roughly `chance` of the cells
    for (let a = 0; a < 64; a++) {
      const r = START_CLEAR - 1;
      expect(inBox(Math.cos(a) * r, Math.sin(a) * r, L)).toBe(false);
    }
  });

  it('pushes circles out to the edge, including from inside', () => {
    const b = boxNear(0, 0, L) ?? boxInCell(3, 3, L) ?? boxInCell(4, 4, L) ?? boxInCell(5, 2, L)!;
    const out = { x: 0, y: 0 };
    // Just left of the box, overlapping by 2 units.
    const n = pushOutOfBox(b.x - 4, b.y + b.h / 2, 6, L, out);
    expect(n).toMatchObject({ nx: -1, ny: 0, cx: b.x + b.w / 2 });
    expect(out.x).toBeCloseTo(b.x - 6);
    // Dead centre: leaves by the nearest side, ending exactly r away.
    expect(pushOutOfBox(b.x + 1, b.y + b.h / 2, 6, L, out)).toMatchObject({ nx: -1, ny: 0 });
    expect(out.x).toBeCloseTo(b.x - 6);
    // Far away: untouched.
    expect(pushOutOfBox(b.x - 30, b.y - 30, 6, L, out)).toBeNull();
  });
});
