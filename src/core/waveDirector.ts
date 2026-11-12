import type { SpawnSegment, StageDef, StageEvent } from '../data/types';
import type { Rng } from './rng';

export interface SpawnRequest {
  enemyId: string;
  /** 'edge' = random point just off-screen; 'ring' = evenly around the player; 'stampede' = a column from one side. */
  pattern: 'edge' | 'ring' | 'stampede' | 'boss';
  /** Bosses: 'mid' drops an anvil and a Haki fragment, 'final' clears the stage. */
  role?: 'mid' | 'final';
  /** For ring/stampede: index within the group and group size, so positions can be laid out. */
  groupIndex: number;
  groupSize: number;
  /** Shared random value per group (e.g. stampede side). */
  groupSeed: number;
}

/**
 * Reads a stage timeline and decides what to spawn. Pure logic: it never touches
 * Phaser, so the RunScene turns SpawnRequests into enemies at real positions.
 */
export class WaveDirector {
  private readonly stage: StageDef;
  private readonly rng: Rng;
  private spawnBudget = 0;
  private nextEvent = 0;

  constructor(stage: StageDef, rng: Rng) {
    this.stage = stage;
    this.rng = rng;
    this.nextEvent = 0;
  }

  /** Skip events scheduled before t (used when a run starts mid-timeline for testing). */
  skipTo(t: number): void {
    while (this.nextEvent < this.stage.events.length && this.stage.events[this.nextEvent].at < t) this.nextEvent++;
  }

  segmentAt(t: number): SpawnSegment {
    const segs = this.stage.segments;
    for (const s of segs) if (t >= s.from && t < s.to) return s;
    return segs[segs.length - 1]; // endless: keep the last segment
  }

  /** HP multiplier for enemies spawned at time t (seconds). */
  hpScale(t: number): number {
    const base = 1 + (t / 60) * this.stage.hpScalePerMin;
    // Past the stage duration (endless), scale harder.
    const over = Math.max(0, t - this.stage.durationSec) / 60;
    return base * (1 + over * 0.25);
  }

  /**
   * Advance the director by dt seconds at run time t with `alive` enemies on field.
   * Pushes spawn requests into `out` (cleared first) and returns the count.
   */
  update(t: number, dt: number, alive: number, out: SpawnRequest[], rateMul = 1): number {
    out.length = 0;
    const seg = this.segmentAt(t);
    const endlessBoost = t > this.stage.durationSec ? 1 + (t - this.stage.durationSec) / 120 : 1;

    this.spawnBudget += seg.rate * endlessBoost * rateMul * dt;
    const cap = Math.floor(seg.maxAlive * Math.min(endlessBoost, 1.5));
    while (this.spawnBudget >= 1) {
      this.spawnBudget -= 1;
      if (alive + out.length >= cap) {
        this.spawnBudget = Math.min(this.spawnBudget, 1); // don't bank a huge burst while capped
        break;
      }
      const pick = this.rng.pickWeighted(seg.enemies, (e) => e.weight);
      if (!pick) break;
      out.push({ enemyId: pick.id, pattern: 'edge', groupIndex: 0, groupSize: 1, groupSeed: 0 });
    }

    const events = this.stage.events;
    while (this.nextEvent < events.length && events[this.nextEvent].at <= t) {
      this.pushEvent(events[this.nextEvent], out);
      this.nextEvent++;
    }
    return out.length;
  }

  private pushEvent(ev: StageEvent, out: SpawnRequest[]): void {
    const seed = this.rng.next();
    for (let i = 0; i < ev.count; i++) {
      out.push({ enemyId: ev.enemy, pattern: ev.type, role: ev.role, groupIndex: i, groupSize: ev.count, groupSeed: seed });
    }
  }
}
