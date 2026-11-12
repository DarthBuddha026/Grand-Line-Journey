import { describe, expect, it } from 'vitest';
import { Loadout } from './loadout';
import { Rng } from './rng';
import { LIMITS } from '../data';

const pools = { weapons: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'], items: ['i1', 'i2'], skills: ['s1', 's2', 's3'] };

describe('Loadout', () => {
  it('offers distinct choices up to the requested count', () => {
    const l = new Loadout('main', pools.skills);
    const choices = l.rollChoices(pools, new Rng(7), 4);
    expect(choices).toHaveLength(4);
    expect(new Set(choices.map((c) => `${c.kind}:${c.id}`)).size).toBe(4);
  });

  it('stops offering new weapons once all weapon slots are full', () => {
    const l = new Loadout('main', pools.skills);
    for (const id of ['w1', 'w2', 'w3', 'w4', 'w5']) l.apply({ kind: 'weapon', id, level: 1 });
    const offered = l.candidates(pools).filter((c) => c.kind === 'weapon');
    expect(offered.map((c) => c.id)).not.toContain('w6');
    expect(offered.every((c) => c.level === 2)).toBe(true);
  });

  it('falls back to boosts when everything is maxed', () => {
    const l = new Loadout('main', pools.skills);
    l.apply({ kind: 'mainAttack', id: 'main', level: LIMITS.mainAttackMaxLevel });
    for (const id of ['w1', 'w2', 'w3', 'w4', 'w5']) l.apply({ kind: 'weapon', id, level: LIMITS.weaponMaxLevel });
    for (const id of pools.items) l.apply({ kind: 'item', id, level: LIMITS.itemMaxLevel });
    for (const id of pools.skills) l.apply({ kind: 'skill', id, level: LIMITS.skillMaxLevel });
    const choices = l.rollChoices(pools, new Rng(1), 3);
    expect(choices.map((c) => c.kind)).toEqual(['boost', 'boost', 'boost']);
  });
});
