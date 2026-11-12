import { describe, expect, it } from 'vitest';
import { SpatialHash } from './spatialHash';
import { Rng } from './rng';

describe('SpatialHash', () => {
  it('returns every entity within the query radius, without duplicates', () => {
    const rng = new Rng(42);
    const hash = new SpatialHash(32, 1000);
    const xs: number[] = [];
    const ys: number[] = [];
    hash.clear();
    for (let i = 0; i < 1000; i++) {
      xs.push(rng.range(-500, 500));
      ys.push(rng.range(-500, 500));
      hash.insert(i, xs[i], ys[i]);
    }
    hash.finalize();
    const out = new Int32Array(1000);
    for (let q = 0; q < 50; q++) {
      const qx = rng.range(-500, 500);
      const qy = rng.range(-500, 500);
      const r = rng.range(5, 120);
      const n = hash.queryCircle(qx, qy, r, out);
      const found = new Set(Array.from(out.subarray(0, n)));
      expect(found.size).toBe(n);
      for (let i = 0; i < 1000; i++) {
        if (Math.hypot(xs[i] - qx, ys[i] - qy) <= r) expect(found.has(i)).toBe(true);
      }
    }
  });

  it('clears between frames', () => {
    const hash = new SpatialHash(32, 10);
    hash.clear();
    hash.insert(0, 0, 0);
    hash.finalize();
    hash.clear();
    hash.finalize();
    expect(hash.queryCircle(0, 0, 50, new Int32Array(10))).toBe(0);
  });
});
