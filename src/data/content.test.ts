import { describe, expect, it } from 'vitest';
import { AWAKEN, LIMITS, MAIN_ATTACKS, validateContent, WEAPONS } from './index';

describe('content data', () => {
  it('has no broken references or wrong level counts', () => {
    expect(validateContent()).toEqual([]);
  });

  it('awakens every main attack and weapon at level 7', () => {
    const attacks = [...MAIN_ATTACKS.values(), ...[...WEAPONS.values()].filter((w) => !w.recipe)];
    for (const w of attacks) {
      expect(w.levels).toHaveLength(LIMITS.weaponMaxLevel);
      const [l6, l7] = w.levels.slice(-2);
      if (!w.awakenName) expect(l7.desc, w.id).toContain('Awakens');
      expect(l7.cooldown, w.id).toBeLessThan(l6.cooldown);
      if (l6.action.dmg) expect(l7.action.dmg!, w.id).toBeGreaterThanOrEqual(l6.action.dmg * AWAKEN.dmg - 0.2);
    }
  });

  it("gives Luffy's Gear Fourth giant bouncing fists", () => {
    const l7 = MAIN_ATTACKS.get('gomu_pistol')!.levels[6];
    expect(MAIN_ATTACKS.get('gomu_pistol')!.awakenName).toBe('Gear Fourth');
    expect(l7.action).toMatchObject({ type: 'punch', size: 15, range: 150, bounce: 10, count: 2 }); // two hands
  });
});
