import { describe, expect, it } from 'vitest';
import { Pool } from './pool';

describe('Pool', () => {
  it('acquires up to capacity and recycles released items', () => {
    let created = 0;
    const pool = new Pool(3, (i) => ({ poolSlot: -1, id: i, n: created++ }));
    const a = pool.acquire()!;
    const b = pool.acquire()!;
    const c = pool.acquire()!;
    expect(pool.acquire()).toBeNull();
    pool.release(b);
    expect(pool.active).toEqual([a, c]);
    expect(c.poolSlot).toBe(1);
    expect(pool.acquire()).toBe(b);
    expect(created).toBe(3);
  });

  it('ignores double release', () => {
    const pool = new Pool(2, () => ({ poolSlot: -1 }));
    const a = pool.acquire()!;
    pool.release(a);
    pool.release(a);
    expect(pool.count).toBe(0);
    expect(pool.acquire()).toBe(a);
    expect(pool.acquire()).not.toBeNull();
  });
});
