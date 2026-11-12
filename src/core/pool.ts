/**
 * Fixed-capacity object pool. Everything that spawns mid-run (enemies, hitboxes,
 * pickups, damage numbers) is created up front and recycled — never instantiated
 * during a run, to avoid garbage-collection stutter.
 *
 * `active` is a dense array of live items for fast iteration; release is O(1) via
 * swap-remove, so iterate backwards if you release while iterating.
 */
export interface Poolable {
  poolSlot: number; // index in `active`, -1 when free
}

export class Pool<T extends Poolable> {
  readonly active: T[] = [];
  private readonly free: T[] = [];
  readonly capacity: number;

  constructor(capacity: number, factory: (i: number) => T) {
    this.capacity = capacity;
    for (let i = 0; i < capacity; i++) {
      const item = factory(i);
      item.poolSlot = -1;
      this.free.push(item);
    }
  }

  get count(): number {
    return this.active.length;
  }

  /** Returns a free item, or null when the pool is exhausted. */
  acquire(): T | null {
    const item = this.free.pop();
    if (!item) return null;
    item.poolSlot = this.active.length;
    this.active.push(item);
    return item;
  }

  release(item: T): void {
    const slot = item.poolSlot;
    if (slot < 0) return;
    const last = this.active.pop()!;
    if (last !== item) {
      this.active[slot] = last;
      last.poolSlot = slot;
    }
    item.poolSlot = -1;
    this.free.push(item);
  }

  releaseAll(): void {
    for (let i = this.active.length - 1; i >= 0; i--) this.release(this.active[i]);
  }
}
