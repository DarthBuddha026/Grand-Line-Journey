import { describe, expect, it } from 'vitest';
import { StatBlock } from './stats';

describe('StatBlock', () => {
  it('applies (base + flat) * (1 + pct)', () => {
    const s = new StatBlock({ maxHp: 100 });
    s.set('wood', [{ stat: 'maxHp', pct: 0.2 }]);
    s.set('meta', [{ stat: 'maxHp', flat: 10, pct: 0.1 }]);
    expect(s.get('maxHp')).toBeCloseTo(110 * 1.3);
  });

  it('replacing a source replaces its modifiers (level-ups)', () => {
    const s = new StatBlock({ spd: 1 });
    s.set('cola', [{ stat: 'spd', pct: 0.08 }]);
    s.set('cola', [{ stat: 'spd', pct: 0.16 }]);
    expect(s.get('spd')).toBeCloseTo(1.16);
    s.remove('cola');
    expect(s.get('spd')).toBe(1);
  });
});
