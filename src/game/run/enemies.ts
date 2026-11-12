import Phaser from 'phaser';
import { Pool, type Poolable } from '../../core/pool';
import { SpatialHash } from '../../core/spatialHash';
import type { SpawnRequest } from '../../core/waveDirector';
import { ENEMIES, type EnemyDef } from '../../data';
import { CAPS, DEPTH, hex, PLAYER_RADIUS, SPAWN_MARGIN, recycleDist, viewport } from '../../config';
import type { RunContext } from './context';
import { TEX } from '../textures';

export interface Enemy extends Poolable {
  readonly id: number;
  def: EnemyDef;
  alive: boolean;
  elite: boolean;
  boss: boolean;
  role: 'mid' | 'final' | null;
  x: number;
  y: number;
  kvx: number; // knockback / pull velocity
  kvy: number;
  hp: number;
  maxHp: number;
  radius: number;
  damage: number;
  stun: number;
  flash: number;
  timer: number; // dash / fire cadence
  dashT: number;
  dvx: number;
  dvy: number;
  slowT: number;
  slowMul: number;
  burnT: number;
  burnDps: number;
  burnTick: number;
  fearT: number;
  touched: boolean; // has taken a hit (Coating first-hit bonus)
  /** Bosses drive their own movement while this is true. */
  controlled: boolean;
  sprite: Phaser.GameObjects.Image;
  aura: Phaser.GameObjects.Image;
}

export interface EnemyShot extends Poolable {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  radius: number;
  sprite: Phaser.GameObjects.Image;
}

export interface EnemyCallbacks {
  onKill(e: Enemy): void;
  onContact(e: Enemy): void;
  onShotHit(damage: number): void;
}

/** Enemy pool, AI, status effects, separation, spatial hash and enemy projectiles. */
export class EnemySystem {
  readonly pool: Pool<Enemy>;
  readonly byId: Enemy[] = [];
  readonly hash = new SpatialHash(32, CAPS.enemies);
  readonly shots: Pool<EnemyShot>;
  /** Shared scratch buffer for hash queries (consume before the next query). */
  readonly scratch = new Int32Array(CAPS.enemies);
  private readonly sepScratch = new Int32Array(64);
  private readonly ctx: RunContext;
  private readonly cb: EnemyCallbacks;

  constructor(ctx: RunContext, cb: EnemyCallbacks) {
    this.ctx = ctx;
    this.cb = cb;
    const scene = ctx.world;
    const anyDef = ENEMIES.values().next().value as EnemyDef;
    this.pool = new Pool<Enemy>(CAPS.enemies, (id) => {
      const e: Enemy = {
        id, poolSlot: -1, def: anyDef, alive: false, elite: false, boss: false, role: null, x: 0, y: 0, kvx: 0, kvy: 0,
        hp: 0, maxHp: 0, radius: 6, damage: 0, stun: 0, flash: 0, timer: 0, dashT: 0, dvx: 0, dvy: 0, slowT: 0, slowMul: 0,
        burnT: 0, burnDps: 0, burnTick: 0, fearT: 0, touched: false, controlled: false,
        aura: scene.add.image(0, 0, 'disc').setDepth(DEPTH.enemy - 1).setVisible(false).setBlendMode(Phaser.BlendModes.ADD),
        sprite: scene.add.image(0, 0, 'enemy').setDepth(DEPTH.enemy).setVisible(false),
      };
      this.byId[id] = e;
      return e;
    });
    this.shots = new Pool<EnemyShot>(CAPS.enemyShots, () => ({
      poolSlot: -1, x: 0, y: 0, vx: 0, vy: 0, life: 0, damage: 0, radius: 3,
      sprite: scene.add.image(0, 0, 'shot').setDepth(DEPTH.enemyShot).setVisible(false),
    }));
  }

  get count(): number {
    return this.pool.count;
  }

  spawn(req: SpawnRequest, hpScale: number, eliteChance: number): Enemy | null {
    const def = ENEMIES.get(req.enemyId);
    if (!def) return null;
    const { x, y } = this.spawnPosition(req);
    const elite = def.archetype !== 'boss' && req.pattern === 'edge' && this.ctx.rng.chance(eliteChance);
    return this.spawnAt(def, x, y, hpScale, elite, req.role ?? null);
  }

  spawnAt(def: EnemyDef, x: number, y: number, hpScale: number, elite = false, role: 'mid' | 'final' | null = null): Enemy | null {
    const e = this.pool.acquire();
    if (!e) return null;
    const boss = def.archetype === 'boss';
    e.def = def;
    e.alive = true;
    e.elite = elite;
    e.boss = boss;
    e.role = role;
    e.x = x;
    e.y = y;
    e.kvx = e.kvy = 0;
    e.maxHp = e.hp = def.hp * hpScale * (elite ? 10 : 1);
    e.radius = def.radius * (elite ? 1.6 : 1);
    e.damage = def.damage * (elite ? 1.5 : 1);
    e.stun = e.flash = e.dashT = e.dvx = e.dvy = 0;
    e.slowT = e.slowMul = e.burnT = e.burnDps = e.burnTick = e.fearT = 0;
    e.touched = false;
    e.controlled = false;
    e.timer = this.ctx.rng.range(0, def.dashEvery ?? def.fireEvery ?? 1);
    e.sprite
      .setTexture(boss ? 'boss' : 'enemy')
      .setVisible(true)
      .setActive(true)
      .setPosition(x, y)
      .setScale((boss ? e.radius / 16 : e.radius / 8) / TEX)
      .setTint(hex(def.color))
      .setTintMode(Phaser.TintModes.MULTIPLY);
    e.aura.setVisible(elite || boss).setTint(boss ? 0xff5252 : 0xffd54f).setDisplaySize(e.radius * 3.4, e.radius * 3.4).setAlpha(0.35);
    return e;
  }

  private spawnPosition(req: SpawnRequest): { x: number; y: number } {
    const p = this.ctx.player;
    const rng = this.ctx.rng;
    const hw = viewport.w / 2 + SPAWN_MARGIN;
    const hh = viewport.h / 2 + SPAWN_MARGIN;
    if (req.pattern === 'boss') {
      const a = rng.range(0, Math.PI * 2);
      return { x: p.x + Math.cos(a) * 200, y: p.y + Math.sin(a) * 150 };
    }
    if (req.pattern === 'ring') {
      const a = (req.groupIndex / req.groupSize) * Math.PI * 2;
      const r = Math.hypot(hw, hh) * 0.9;
      return { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
    }
    if (req.pattern === 'stampede') {
      const side = Math.floor(req.groupSeed * 4);
      const t = (req.groupIndex / Math.max(1, req.groupSize - 1) - 0.5) * 2;
      const jitter = rng.range(-12, 12);
      if (side === 0) return { x: p.x - hw - jitter, y: p.y + t * hh };
      if (side === 1) return { x: p.x + hw + jitter, y: p.y + t * hh };
      if (side === 2) return { x: p.x + t * hw, y: p.y - hh - jitter };
      return { x: p.x + t * hw, y: p.y + hh + jitter };
    }
    const perim = 4 * (hw + hh);
    let d = rng.next() * perim;
    if (d < 2 * hw) return { x: p.x - hw + d, y: p.y - hh };
    d -= 2 * hw;
    if (d < 2 * hw) return { x: p.x - hw + d, y: p.y + hh };
    d -= 2 * hw;
    if (d < 2 * hh) return { x: p.x - hw, y: p.y - hh + d };
    d -= 2 * hh;
    return { x: p.x + hw, y: p.y - hh + d };
  }

  rebuildHash(): void {
    const h = this.hash;
    h.clear();
    const list = this.pool.active;
    for (let i = 0; i < list.length; i++) h.insert(list[i].id, list[i].x, list[i].y);
    h.finalize();
  }

  nearest(x: number, y: number, maxDist = 400): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxDist * maxDist;
    const list = this.pool.active;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  toughest(x: number, y: number, maxDist = 320): Enemy | null {
    let best: Enemy | null = null;
    const r2 = maxDist * maxDist;
    for (const e of this.pool.active) {
      if ((e.x - x) ** 2 + (e.y - y) ** 2 > r2) continue;
      if (!best || e.hp > best.hp) best = e;
    }
    return best;
  }

  /** A random living enemy inside the visible area around (x, y), optionally filtered. */
  randomOnScreen(x: number, y: number, filter?: (e: Enemy) => boolean): Enemy | null {
    const list = this.pool.active;
    if (!list.length) return null;
    const hw = viewport.w / 2;
    const hh = viewport.h / 2;
    const start = Math.floor(this.ctx.rng.next() * list.length);
    for (let k = 0; k < list.length; k++) {
      const e = list[(start + k) % list.length];
      if (Math.abs(e.x - x) <= hw && Math.abs(e.y - y) <= hh && (!filter || filter(e))) return e;
    }
    return null;
  }

  /** Low-level damage used by ctx.hitEnemy (which computes multipliers). Returns true if it died. */
  applyDamage(e: Enemy, amount: number, crit: boolean, kx: number, ky: number, force: number): boolean {
    if (!e.alive) return false;
    e.touched = true;
    e.hp -= amount;
    if (amount > 0) {
      e.flash = 0.08;
      this.ctx.fx.damageNumber(e.x, e.y - e.radius, amount, crit);
    }
    const resist = 1 - (e.def.knockbackResist ?? 0);
    e.kvx += kx * force * resist;
    e.kvy += ky * force * resist;
    if (e.hp <= 0) {
      this.kill(e);
      return true;
    }
    return false;
  }

  kill(e: Enemy): void {
    if (!e.alive) return;
    e.alive = false;
    this.cb.onKill(e);
    e.sprite.setVisible(false).setActive(false);
    e.aura.setVisible(false);
    this.pool.release(e);
  }

  update(dt: number): void {
    const p = this.ctx.player;
    const list = this.pool.active;
    const decay = Math.exp(-9 * dt);
    const contactR = PLAYER_RADIUS * p.scale;
    const t = this.ctx.runTime;
    const recycle = recycleDist();

    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const def = e.def;
      let dx = p.x - e.x;
      let dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      dx /= dist;
      dy /= dist;

      if (dist > recycle && !e.boss) {
        e.x = p.x + dx * (recycle - 140);
        e.y = p.y + dy * (recycle - 140);
        continue;
      }

      // Burn / poison ticks
      if (e.burnT > 0) {
        e.burnT -= dt;
        e.burnTick -= dt;
        if (e.burnTick <= 0) {
          e.burnTick = 0.5;
          const dmg = e.burnDps * 0.5;
          e.hp -= dmg;
          this.ctx.fx.damageNumber(e.x, e.y - e.radius, dmg, false, '#ffab40');
          if (e.hp <= 0) {
            this.kill(e);
            continue;
          }
        }
      }
      if (e.slowT > 0) e.slowT -= dt;
      const speedMul = e.slowT > 0 ? 1 - e.slowMul : 1;

      let vx = 0;
      let vy = 0;
      if (e.stun > 0) {
        e.stun -= dt;
      } else if (e.controlled) {
        // boss AI moves it
      } else if (e.fearT > 0) {
        e.fearT -= dt;
        vx = -dx * def.speed * 1.2;
        vy = -dy * def.speed * 1.2;
      } else {
        switch (def.archetype) {
          case 'fast': {
            e.timer += dt;
            if (e.dashT > 0) {
              e.dashT -= dt;
              vx = e.dvx;
              vy = e.dvy;
            } else {
              vx = dx * def.speed;
              vy = dy * def.speed;
              if (e.timer >= (def.dashEvery ?? 2.5) && dist < 220) {
                e.timer = 0;
                e.dashT = def.dashTime ?? 0.4;
                e.dvx = dx * (def.dashSpeed ?? 140);
                e.dvy = dy * (def.dashSpeed ?? 140);
              }
            }
            break;
          }
          case 'ranged': {
            const range = def.range ?? 120;
            if (dist > range * 0.85) {
              vx = dx * def.speed;
              vy = dy * def.speed;
            } else if (dist < range * 0.5) {
              vx = -dx * def.speed * 0.7;
              vy = -dy * def.speed * 0.7;
            }
            e.timer += dt;
            if (e.timer >= (def.fireEvery ?? 2.5) && dist < range + 30) {
              e.timer = 0;
              this.fireShot(e.x, e.y, dx, dy, def.projSpeed ?? 90, (def.projDamage ?? 5) * (e.elite ? 1.5 : 1));
            }
            break;
          }
          default:
            vx = dx * def.speed;
            vy = dy * def.speed;
        }
      }

      e.x += (vx * speedMul + e.kvx) * dt;
      e.y += (vy * speedMul + e.kvy) * dt;
      e.kvx *= decay;
      e.kvy *= decay;

      // Soft separation so crowds spread out instead of stacking.
      if (!e.boss) {
        const n = this.hash.queryCircle(e.x, e.y, e.radius * 2, this.sepScratch);
        for (let k = 0; k < n; k++) {
          const o = this.byId[this.sepScratch[k]];
          if (o === e || !o.alive) continue;
          const ox = e.x - o.x;
          const oy = e.y - o.y;
          const minD = e.radius + o.radius;
          const d2 = ox * ox + oy * oy;
          if (d2 > 0.0001 && d2 < minD * minD) {
            const d = Math.sqrt(d2);
            const push = ((minD - d) / d) * 0.5 * Math.min(1, dt * 20);
            e.x += ox * push;
            e.y += oy * push;
          }
        }
      }

      if (dist < e.radius + contactR) {
        this.cb.onContact(e);
        if (!e.alive) continue;
      }

      if (e.flash > 0) {
        e.flash -= dt;
        e.sprite.setTint(0xffffff).setTintMode(e.flash > 0 ? Phaser.TintModes.FILL : Phaser.TintModes.MULTIPLY);
        if (e.flash <= 0) e.sprite.setTint(hex(def.color));
      } else if (e.stun > 0.25 && !e.boss) {
        e.sprite.setTint(0xb3e5fc);
      } else if (e.burnT > 0) {
        e.sprite.setTint(t % 0.4 < 0.2 ? 0xffab91 : hex(def.color));
      } else {
        e.sprite.setTint(hex(def.color));
      }
      e.sprite.setPosition(e.x, e.y).setFlipX(dx < 0);
      if (e.elite || e.boss) e.aura.setPosition(e.x, e.y).setAlpha(0.25 + 0.15 * Math.sin(t * 6));
    }

    this.updateShots(dt);
  }

  fireShot(x: number, y: number, dx: number, dy: number, speed: number, damage: number, radius = 3, tint = 0xffffff): void {
    const s = this.shots.acquire();
    if (!s) return;
    s.x = x;
    s.y = y;
    s.vx = dx * speed;
    s.vy = dy * speed;
    s.life = 5;
    s.damage = damage;
    s.radius = radius;
    s.sprite.setVisible(true).setPosition(x, y).setScale(radius / 3 / TEX).setTint(tint);
  }

  private updateShots(dt: number): void {
    const p = this.ctx.player;
    const list = this.shots.active;
    const pr = PLAYER_RADIUS * p.scale;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const hit = Math.hypot(s.x - p.x, s.y - p.y) < pr + s.radius;
      if (hit) this.cb.onShotHit(s.damage);
      if (hit || s.life <= 0) {
        s.sprite.setVisible(false);
        this.shots.release(s);
      } else {
        s.sprite.setPosition(s.x, s.y);
      }
    }
  }

  clearShots(): void {
    for (const s of this.shots.active) s.sprite.setVisible(false);
    this.shots.releaseAll();
  }
}
