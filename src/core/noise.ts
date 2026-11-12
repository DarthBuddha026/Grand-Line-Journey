/**
 * Deterministic 2D value noise for terrain (seawater, quicksand, Impel Down floors).
 * Same (x, y, seed) always gives the same value, so terrain needs no storage and
 * can be sampled anywhere in the endless world.
 */

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1). `scale` is the feature size in world units. */
export function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Two octaves: blobby shapes with ragged edges. */
export function terrainNoise(x: number, y: number, scale: number, seed: number): number {
  return valueNoise(x, y, scale, seed) * 0.7 + valueNoise(x, y, scale / 3, seed + 101) * 0.3;
}
