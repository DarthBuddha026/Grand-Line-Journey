import type Phaser from 'phaser';
import { Pool, type Poolable } from '../../core/pool';
import { CAPS, DEPTH, ORB_MERGE_THRESHOLD } from '../../config';
import type { RunContext } from './context';
import { TEX } from '../textures';

export type PickupKind = 'xp' | 'berry' | 'meat' | 'chest' | 'anvil' | 'haki';

export interface Pickup extends Poolable {
  kind: PickupKind;
  x: number;
  y: number;
  value: number;
  /** Haki fragment id for kind 'haki'. */
  ref: string;
  magnet: boolean;
  speed: number;
  sprite: Phaser.GameObjects.Image;
}

export interface PickupCallbacks {
  onCollect(p: Pickup): void;
}

const XP_TINTS = [0x6fe3ff, 0x7cf27c, 0xffd447, 0xff7ad9];
/** Treasure must be walked over: it is never vacuumed up by pickup range. */
const TREASURE: ReadonlySet<PickupKind> = new Set(['chest', 'anvil', 'haki']);

/** XP orbs, Berries, meat and treasure. XP merges into existing orbs past ORB_MERGE_THRESHOLD. */
export class PickupSystem {
  readonly pool: Pool<Pickup>;
  private xpCount = 0;
  private readonly ctx: RunContext;
  private readonly cb: PickupCallbacks;

  constructor(ctx: RunContext, cb: PickupCallbacks) {
    this.ctx = ctx;
    this.cb = cb;
    this.pool = new Pool<Pickup>(CAPS.pickups, () => ({
      poolSlot: -1, kind: 'xp', x: 0, y: 0, value: 0, ref: '', magnet: false, speed: 0,
      sprite: ctx.world.add.image(0, 0, 'orb').setDepth(DEPTH.pickup).setVisible(false),
    }));
  }

  get count(): number {
    return this.pool.count;
  }

  /** Treasure still lying on the field (for HUD arrows). */
  treasure(): Pickup[] {
    return this.pool.active.filter((p) => TREASURE.has(p.kind));
  }

  dropXp(x: number, y: number, value: number): void {
    if (this.xpCount >= ORB_MERGE_THRESHOLD || this.pool.count >= this.pool.capacity - 20) {
      const target = this.nearestXp(x, y);
      if (target) {
        target.value += value;
        this.styleXp(target);
        return;
      }
    }
    if (this.spawn('xp', x, y, value)) this.xpCount++;
  }

  drop(kind: Exclude<PickupKind, 'xp'>, x: number, y: number, value: number, ref = ''): void {
    const p = this.spawn(kind, x, y, value);
    if (p) p.ref = ref;
  }

  /** Pull every non-treasure pickup on the field toward the player. */
  magnetAll(): void {
    for (const p of this.pool.active) if (!TREASURE.has(p.kind)) p.magnet = true;
  }

  private spawn(kind: PickupKind, x: number, y: number, value: number): Pickup | null {
    const p = this.pool.acquire();
    if (!p) return null;
    p.kind = kind;
    p.x = x + this.ctx.rng.range(-3, 3);
    p.y = y + this.ctx.rng.range(-3, 3);
    p.value = value;
    p.ref = '';
    p.magnet = false;
    p.speed = 0;
    p.sprite.setVisible(true).setPosition(p.x, p.y).clearTint().setDepth(TREASURE.has(kind) ? DEPTH.pickup + 1 : DEPTH.pickup);
    if (kind === 'xp') this.styleXp(p);
    else p.sprite.setTexture(kind).setScale(1 / TEX);
    return p;
  }

  private styleXp(p: Pickup): void {
    const tier = p.value >= 40 ? 3 : p.value >= 10 ? 2 : p.value >= 3 ? 1 : 0;
    p.sprite.setTexture('orb').setTint(XP_TINTS[tier]).setScale((1 + tier * 0.35) / TEX);
  }

  private nearestXp(x: number, y: number): Pickup | null {
    let best: Pickup | null = null;
    let bestD = Infinity;
    for (const p of this.pool.active) {
      if (p.kind !== 'xp') continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  update(dt: number): void {
    const pl = this.ctx.player;
    const range = this.ctx.stats.get('pickup');
    const r2 = range * range;
    const list = this.pool.active;
    const bob = Math.sin(this.ctx.runTime * 5) * 1.5;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      const dx = pl.x - p.x;
      const dy = pl.y - p.y;
      const d2 = dx * dx + dy * dy;
      const treasure = TREASURE.has(p.kind);
      if (treasure) {
        p.sprite.setPosition(p.x, p.y + bob);
        if (d2 < (14 + 6 * pl.scale) ** 2) this.collect(p);
        continue;
      }
      if (!p.magnet && d2 < r2) p.magnet = true;
      if (p.magnet) {
        const d = Math.sqrt(d2) || 1;
        if (d < 8) {
          this.collect(p);
          continue;
        }
        p.speed = Math.min(420, p.speed + 600 * dt);
        const step = Math.min(d, p.speed * dt);
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        p.sprite.setPosition(p.x, p.y);
      }
    }
  }

  private collect(p: Pickup): void {
    this.cb.onCollect(p);
    if (p.kind === 'xp') this.xpCount--;
    p.sprite.setVisible(false);
    this.pool.release(p);
  }
}
