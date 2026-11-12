import { describe, expect, it } from 'vitest';
import { WaveDirector, type SpawnRequest } from './waveDirector';
import { Rng } from './rng';
import type { StageDef } from '../data/types';

const stage: StageDef = {
  id: 't',
  order: 1,
  name: 'T',
  desc: '',
  eliteChance: 0,
  terrain: [],
  hazards: [],
  durationSec: 120,
  hpScalePerMin: 0.5,
  ground: { base: '#000', detail: '#111' },
  segments: [
    { from: 0, to: 60, rate: 2, maxAlive: 10, enemies: [{ id: 'a', weight: 1 }] },
    { from: 60, to: 120, rate: 4, maxAlive: 100, enemies: [{ id: 'b', weight: 1 }] },
  ],
  events: [
    { at: 30, type: 'ring', enemy: 'a', count: 12 },
    { at: 60, type: 'boss', enemy: 'boss', count: 1, role: 'final' },
  ],
};

describe('WaveDirector', () => {
  it('spawns at the segment rate', () => {
    const d = new WaveDirector(stage, new Rng(1));
    const out: SpawnRequest[] = [];
    let total = 0;
    for (let i = 0; i < 50; i++) total += d.update(i * 0.1, 0.1, 0, out);
    expect(total).toBeGreaterThanOrEqual(9);
    expect(total).toBeLessThanOrEqual(10);
  });

  it('respects maxAlive', () => {
    const d = new WaveDirector(stage, new Rng(1));
    expect(d.update(1, 10, 10, [])).toBe(0);
  });

  it('fires timeline events exactly once', () => {
    const d = new WaveDirector(stage, new Rng(1));
    const out: SpawnRequest[] = [];
    d.update(30, 0.0001, 1000, out);
    expect(out.filter((r) => r.pattern === 'ring')).toHaveLength(12);
    d.update(31, 0.0001, 1000, out);
    expect(out.filter((r) => r.pattern === 'ring')).toHaveLength(0);
  });

  it('emits bosses with their role and can skip past events', () => {
    const d = new WaveDirector(stage, new Rng(1));
    const out: SpawnRequest[] = [];
    d.skipTo(45);
    d.update(61, 0.0001, 0, out);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ pattern: 'boss', role: 'final', enemyId: 'boss' });
  });

  it('switches segments and scales HP over time', () => {
    const d = new WaveDirector(stage, new Rng(1));
    expect(d.segmentAt(70).enemies[0].id).toBe('b');
    expect(d.segmentAt(999).enemies[0].id).toBe('b');
    expect(d.hpScale(120)).toBeCloseTo(2);
    expect(d.hpScale(240)).toBeGreaterThan(d.hpScale(120) * 1.5);
  });
});
