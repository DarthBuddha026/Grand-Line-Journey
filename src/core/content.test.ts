import { describe, expect, it } from 'vitest';
import { deepMerge, expandCumulative } from './merge';
import { terrainNoise } from './noise';
import { ModBlock } from './stats';
import { Loadout } from './loadout';
import { Rng } from './rng';
import { ALLIANCES, CHARACTERS, ITEMS, LIMITS, MAIN_ATTACKS, WEAPONS } from '../data';

describe('merge', () => {
  it('deep-merges objects and replaces arrays', () => {
    expect(deepMerge({ a: 1, o: { x: 1, y: 2 }, l: [1, 2] }, { o: { y: 3 }, l: [9] })).toEqual({ a: 1, o: { x: 1, y: 3 }, l: [9] });
  });

  it('expands cumulative levels without sharing references', () => {
    const lv = expandCumulative<{ dmg: number; action: { count: number } }>([{ dmg: 1, action: { count: 1 } }, { action: { count: 2 } }]);
    expect(lv[1]).toEqual({ dmg: 1, action: { count: 2 } });
    expect(lv[0].action.count).toBe(1);
  });
});

describe('noise', () => {
  it('is deterministic and in [0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const v = terrainNoise(i * 37.1, i * -12.7, 300, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(terrainNoise(i * 37.1, i * -12.7, 300, 5)).toBe(v);
    }
  });
});

describe('ModBlock', () => {
  it('sums sources', () => {
    const m = new ModBlock();
    m.set('a', { dodge: 0.1 });
    m.set('b', { dodge: 0.05, regen: 1 });
    expect(m.get('dodge')).toBeCloseTo(0.15);
    m.remove('a');
    expect(m.get('dodge')).toBeCloseTo(0.05);
  });
});

describe('content expansion', () => {
  it('has the launch roster and pools from the design plan', () => {
    expect(CHARACTERS.size).toBe(17);
    expect([...WEAPONS.values()].filter((w) => !w.recipe)).toHaveLength(12);
    expect(ITEMS.size).toBe(14);
    expect(ALLIANCES).toHaveLength(6);
  });

  it('main attacks grow over 7 levels', () => {
    for (const m of MAIN_ATTACKS.values()) {
      expect(m.levels).toHaveLength(LIMITS.mainAttackMaxLevel);
      expect(m.levels[6].action.dmg!).toBeGreaterThan(m.levels[0].action.dmg!);
      expect(m.levels[6].cooldown).toBeLessThan(m.levels[0].cooldown);
    }
  });

  it('item levels scale and describe themselves', () => {
    const wood = ITEMS.get('adam_wood')!;
    expect(wood.levels[2].stats).toEqual([{ stat: 'maxHp', pct: 0.3, flat: undefined }]);
    expect(wood.levels[4].desc).toContain('defense');
  });
});

describe('Loadout fusion, hold and eliminate', () => {
  const pools = { weapons: ['impact_dial', 'tone_dial', 'rankyaku'], items: ['adam_wood'], skills: ['a', 'b', 'c'] };

  it('fuses two max-level weapons into an Alliance', () => {
    const l = new Loadout('m', pools.skills);
    l.apply({ kind: 'weapon', id: 'impact_dial', level: 7 });
    l.apply({ kind: 'weapon', id: 'tone_dial', level: 6 });
    const recipes = ALLIANCES.map((a) => ({ id: a.id, recipe: a.recipe! }));
    expect(l.availableFusions(recipes)).toHaveLength(0);
    l.apply({ kind: 'weapon', id: 'tone_dial', level: 7 });
    const [reject] = l.availableFusions(recipes);
    expect(reject.id).toBe('reject_dial');
    l.fuse(reject);
    expect([...l.weapons.keys()]).toEqual(['reject_dial']);
    expect(l.candidates(pools).some((c) => c.id === 'impact_dial')).toBe(false);
  });

  it('honours hold and eliminate', () => {
    const l = new Loadout('m', pools.skills);
    l.held = { kind: 'item', id: 'adam_wood', level: 1 };
    const first = l.rollChoices(pools, new Rng(3), 4);
    expect(first[0]).toEqual({ kind: 'item', id: 'adam_wood', level: 1 });
    l.banned.add('weapon:rankyaku');
    for (let i = 0; i < 20; i++) expect(l.rollChoices(pools, new Rng(i), 4).some((c) => c.id === 'rankyaku')).toBe(false);
  });

  it('chests apply upgrades directly', () => {
    const l = new Loadout('m', pools.skills);
    const got = l.rollChest(pools, new Rng(1), 3);
    expect(got).toHaveLength(3);
    expect(l.mainAttack.level + l.weapons.size + l.items.size + [...l.skills.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(1);
  });
});
