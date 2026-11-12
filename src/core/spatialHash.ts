/**
 * Allocation-free uniform-grid spatial hash, rebuilt every frame.
 * Entities are referenced by integer index into the caller's own arrays.
 *
 * Build: clear() → insert(i, x, y) for every live entity → finalize().
 * Query: queryCircle(x, y, r, out) writes candidate indices into `out` and returns
 * the count. Candidates are broad-phase only; callers do the exact distance test.
 */
export class SpatialHash {
  readonly cellSize: number;
  private readonly tableMask: number;
  private readonly cellCount: Int32Array; // entries per bucket
  private readonly cellStart: Int32Array; // prefix sums into `sorted`
  private readonly entryBucket: Int32Array;
  private readonly entryIndex: Int32Array;
  private readonly sorted: Int32Array;
  private n = 0;

  constructor(cellSize: number, maxEntries: number, tableSize = 4096) {
    if ((tableSize & (tableSize - 1)) !== 0) throw new Error('tableSize must be a power of two');
    this.cellSize = cellSize;
    this.tableMask = tableSize - 1;
    this.cellCount = new Int32Array(tableSize);
    this.cellStart = new Int32Array(tableSize + 1);
    this.entryBucket = new Int32Array(maxEntries);
    this.entryIndex = new Int32Array(maxEntries);
    this.sorted = new Int32Array(maxEntries);
  }

  get size(): number {
    return this.n;
  }

  private bucket(cx: number, cy: number): number {
    return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & this.tableMask;
  }

  clear(): void {
    this.n = 0;
    this.cellCount.fill(0);
  }

  insert(index: number, x: number, y: number): void {
    if (this.n >= this.entryIndex.length) return; // over capacity: silently drop
    const b = this.bucket(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
    this.entryBucket[this.n] = b;
    this.entryIndex[this.n] = index;
    this.cellCount[b]++;
    this.n++;
  }

  /** Counting sort entries by bucket so each bucket is a contiguous slice. */
  finalize(): void {
    const start = this.cellStart;
    start[0] = 0;
    for (let b = 0; b <= this.tableMask; b++) start[b + 1] = start[b] + this.cellCount[b];
    const cursor = this.cellCount; // reuse as write cursor
    for (let b = 0; b <= this.tableMask; b++) cursor[b] = start[b];
    for (let i = 0; i < this.n; i++) {
      const b = this.entryBucket[i];
      this.sorted[cursor[b]++] = this.entryIndex[i];
    }
  }

  /** Writes candidate indices (possibly with false positives) into out; returns count. */
  queryCircle(x: number, y: number, r: number, out: Int32Array | number[]): number {
    const cs = this.cellSize;
    const x0 = Math.floor((x - r) / cs);
    const x1 = Math.floor((x + r) / cs);
    const y0 = Math.floor((y - r) / cs);
    const y1 = Math.floor((y + r) / cs);
    const max = out.length;
    let count = 0;
    // Large queries could visit the same bucket twice through hash collisions; track the
    // buckets seen in this query to avoid duplicate candidates.
    let seenCount = 0;
    const seen = SpatialHash.seenScratch;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.bucket(cx, cy);
        let dup = false;
        for (let s = 0; s < seenCount; s++) {
          if (seen[s] === b) {
            dup = true;
            break;
          }
        }
        if (dup) continue;
        if (seenCount < seen.length) seen[seenCount++] = b;
        const end = this.cellStart[b + 1];
        for (let k = this.cellStart[b]; k < end; k++) {
          if (count >= max) return count;
          out[count++] = this.sorted[k];
        }
      }
    }
    return count;
  }

  private static readonly seenScratch = new Int32Array(1024);
}
