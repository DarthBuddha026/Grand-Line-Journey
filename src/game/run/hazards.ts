import type Phaser from 'phaser';
import type { StageHazard } from '../../data';
import { DEPTH, PLAYER_RADIUS } from '../../config';
import type { RunContext } from './context';

/**
 * Things that hurt the PLAYER: telegraphed blasts (boss slams, Buster Call shells),
 * lingering zones (Mr. 3's wax, poison) and stage-wide hazards (sandstorm vision).
 * Telegraphs are drawn in red tones so they read differently from player attacks.
 */
interface Blast {
  x: number;
  y: number;
  r: number;
  t: number;
  delay: number;
  dmg: number;
  enemyDmg: number;
  color: number;
}

interface Zone {
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
  dps: number;
  slow: number;
  color: number;
}

export class HazardSystem {
  /** 0..1 darkness for sandstorms (HUD draws the vignette). */
  vision = 0;
  /** Player slow from standing in hazard zones this frame (0..1). */
  zoneSlow = 0;
  private blasts: Blast[] = [];
  private zones: Zone[] = [];
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly ctx: RunContext;
  private readonly stageHazards: readonly StageHazard[];
  private bombardTimer = 0;

  constructor(ctx: RunContext, stageHazards: readonly StageHazard[]) {
    this.ctx = ctx;
    this.stageHazards = stageHazards;
    this.gfx = ctx.world.add.graphics().setDepth(DEPTH.ground + 3);
  }

  /** Telegraph a circle that explodes after `delay` seconds (+ Observation lead time). */
  blast(x: number, y: number, r: number, delay: number, dmg: number, color = 0xff3d00, enemyDmg = 0): void {
    const lead = this.ctx.mods.get('telegraphLead');
    this.blasts.push({ x, y, r, t: 0, delay: delay + lead, dmg, enemyDmg, color });
  }

  zone(x: number, y: number, r: number, duration: number, dps: number, slow: number, color: number): void {
    this.zones.push({ x, y, r, life: duration, maxLife: duration, dps, slow, color });
  }

  clear(): void {
    this.blasts = [];
    this.zones = [];
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    const g = this.gfx;
    g.clear();
    const pr = PLAYER_RADIUS * p.scale;

    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t += dt;
      const k = Math.min(1, b.t / b.delay);
      g.lineStyle(2, b.color, 0.9).strokeCircle(b.x, b.y, b.r);
      g.fillStyle(b.color, 0.12 + 0.28 * k).fillCircle(b.x, b.y, b.r * k);
      if (b.t >= b.delay) {
        if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (b.r + pr) ** 2) ctx.hurtPlayer(b.dmg);
        if (b.enemyDmg > 0) {
          const r2 = b.r * b.r;
          for (let j = ctx.enemies.pool.active.length - 1; j >= 0; j--) {
            const e = ctx.enemies.pool.active[j];
            if (!e.boss && (e.x - b.x) ** 2 + (e.y - b.y) ** 2 < r2) ctx.enemies.applyDamage(e, b.enemyDmg, false, 0, 0, 0);
          }
        }
        ctx.fx.burst(b.x, b.y, b.r * 0.3, b.r * 1.2, 0.35, b.color, 'disc', false, 0.8);
        this.blasts.splice(i, 1);
      }
    }

    this.zoneSlow = 0;
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.life -= dt;
      if (z.life <= 0) {
        this.zones.splice(i, 1);
        continue;
      }
      const fade = Math.min(1, z.life / 0.5, (z.maxLife - z.life) / 0.3);
      g.fillStyle(z.color, 0.35 * fade).fillCircle(z.x, z.y, z.r);
      g.lineStyle(1.5, 0xff1744, 0.6 * fade).strokeCircle(z.x, z.y, z.r);
      if ((p.x - z.x) ** 2 + (p.y - z.y) ** 2 < (z.r + pr) ** 2) {
        this.zoneSlow = Math.max(this.zoneSlow, z.slow);
        if (z.dps > 0) ctx.hurtPlayer(z.dps); // iframes make this a periodic tick
      }
    }

    this.updateStageHazards(dt);
  }

  private updateStageHazards(dt: number): void {
    const t = this.ctx.runTime;
    let vision = 0;
    for (const h of this.stageHazards) {
      if (t < h.from) continue;
      if (h.type === 'sandstorm') {
        const every = h.every ?? 120;
        const dur = h.duration ?? 20;
        const phase = (t - h.from) % every;
        if (phase < dur) vision = Math.max(vision, Math.min(1, phase / 3, (dur - phase) / 3));
      } else if (h.type === 'bombard') {
        this.bombardTimer -= dt;
        if (this.bombardTimer <= 0) {
          this.bombardTimer = h.every ?? 1.2;
          const p = this.ctx.player;
          const a = this.ctx.rng.range(0, Math.PI * 2);
          const d = this.ctx.rng.range(0, 150);
          this.blast(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, h.radius ?? 30, 1.2, h.dmg ?? 15, 0xff6d00, 80);
        }
      }
    }
    this.vision += (vision - this.vision) * Math.min(1, dt * 2);
  }
}
