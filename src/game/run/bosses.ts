import type Phaser from 'phaser';
import { ENEMIES, type BossPattern } from '../../data';
import { DEPTH, hex } from '../../config';
import type { RunContext } from './context';
import type { Enemy } from './enemies';

interface BossRuntime {
  e: Enemy;
  /** Pooled enemies are recycled: remember which def this runtime was created for. */
  def: Enemy['def'];
  cooldowns: number[];
  /** Pattern currently executing, or -1 while walking. */
  active: number;
  t: number;
  dirX: number;
  dirY: number;
  tx: number;
  ty: number;
  wavesLeft: number;
  waveT: number;
}

/**
 * Boss AI. Each boss cycles through its data-defined patterns; anything that can
 * hurt the player is telegraphed first (charge lines, slam circles), and the
 * Observation "telegraphLead" mod adds warning time.
 */
export class BossSystem {
  readonly bosses: BossRuntime[] = [];
  private readonly ctx: RunContext;
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(ctx: RunContext) {
    this.ctx = ctx;
    this.gfx = ctx.world.add.graphics().setDepth(DEPTH.ground + 4);
  }

  add(e: Enemy): void {
    e.controlled = true;
    const n = e.def.patterns?.length ?? 0;
    // Stagger first uses so bosses don't open with everything at once.
    this.bosses.push({
      e, def: e.def, cooldowns: Array.from({ length: n }, (_, i) => 1.5 + i * 1.2), active: -1, t: 0,
      dirX: 0, dirY: 0, tx: 0, ty: 0, wavesLeft: 0, waveT: 0,
    });
  }

  get alive(): Enemy[] {
    return this.bosses.filter((b) => this.valid(b)).map((b) => b.e);
  }

  private valid(b: BossRuntime): boolean {
    return b.e.alive && b.e.boss && b.e.def === b.def;
  }

  update(dt: number): void {
    this.gfx.clear();
    const lead = this.ctx.mods.get('telegraphLead');
    for (let i = this.bosses.length - 1; i >= 0; i--) {
      const b = this.bosses[i];
      if (!this.valid(b)) {
        this.bosses.splice(i, 1);
        continue;
      }
      if (b.e.stun > 0) continue; // stunned bosses lose their turn (frozen by Ice Age etc.)
      const patterns = b.def.patterns ?? [];
      if (b.active < 0) {
        this.walk(b, dt);
        for (let k = 0; k < b.cooldowns.length; k++) b.cooldowns[k] -= dt;
        const ready = b.cooldowns.findIndex((c) => c <= 0);
        if (ready >= 0) this.start(b, ready, patterns[ready]);
      } else {
        this.step(b, patterns[b.active], dt, lead);
      }
      b.e.sprite.setPosition(b.e.x, b.e.y);
    }
  }

  private walk(b: BossRuntime, dt: number): void {
    const p = this.ctx.player;
    const dx = p.x - b.e.x;
    const dy = p.y - b.e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 40) {
      const slow = b.e.slowT > 0 ? 1 - b.e.slowMul * 0.5 : 1; // bosses resist slows
      b.e.x += (dx / d) * b.e.def.speed * slow * dt;
      b.e.y += (dy / d) * b.e.def.speed * slow * dt;
    }
  }

  private start(b: BossRuntime, idx: number, pat: BossPattern): void {
    const p = this.ctx.player;
    b.active = idx;
    b.t = 0;
    const dx = p.x - b.e.x;
    const dy = p.y - b.e.y;
    const d = Math.hypot(dx, dy) || 1;
    b.dirX = dx / d;
    b.dirY = dy / d;
    b.tx = p.x;
    b.ty = p.y;
    b.wavesLeft = pat.waves ?? 1;
    b.waveT = 0;
  }

  private finish(b: BossRuntime, pat: BossPattern): void {
    b.cooldowns[b.active] = pat.cooldown;
    b.active = -1;
  }

  private step(b: BossRuntime, pat: BossPattern, dt: number, lead: number): void {
    const ctx = this.ctx;
    const e = b.e;
    const g = this.gfx;
    const color = hex(pat.color ?? '#ff1744');
    b.t += dt;
    switch (pat.type) {
      case 'charge': {
        const tele = (pat.telegraph ?? 0.8) + lead;
        const dist = 260;
        if (b.t < tele) {
          // Aim tracks the player for the first half of the telegraph, then locks.
          if (b.t < tele * 0.5) this.reaim(b);
          g.lineStyle(e.radius * 1.6, 0xff1744, 0.18 + 0.25 * (b.t / tele));
          g.lineBetween(e.x, e.y, e.x + b.dirX * dist, e.y + b.dirY * dist);
        } else {
          const speed = pat.speed ?? 250;
          const dur = dist / speed;
          e.x += b.dirX * speed * dt;
          e.y += b.dirY * speed * dt;
          const p = ctx.player;
          if (Math.hypot(p.x - e.x, p.y - e.y) < e.radius + 8 * p.scale) ctx.hurtPlayer(pat.dmg ?? e.damage);
          if (b.t >= tele + dur) this.finish(b, pat);
        }
        break;
      }
      case 'slam': {
        ctx.hazards.blast(ctx.player.x, ctx.player.y, pat.radius ?? 50, pat.telegraph ?? 0.9, pat.dmg ?? 20, 0xff1744, 0);
        this.finish(b, pat);
        break;
      }
      case 'teleport': {
        const tele = (pat.telegraph ?? 0.8) + lead;
        if (b.wavesLeft > 0) {
          b.wavesLeft = 0; // telegraph once
          ctx.hazards.blast(b.tx, b.ty, pat.radius ?? 55, pat.telegraph ?? 0.8, pat.dmg ?? 20, 0xff1744, 0);
        }
        e.sprite.setAlpha(Math.max(0.15, 1 - b.t / tele));
        if (b.t >= tele) {
          e.x = b.tx;
          e.y = b.ty - 4;
          e.sprite.setAlpha(1);
          ctx.fx.burst(e.x, e.y, 6, 40, 0.3, 0xffffff, 'ring');
          this.finish(b, pat);
        }
        break;
      }
      case 'radial': {
        b.waveT -= dt;
        if (b.waveT <= 0) {
          const n = pat.count ?? 12;
          const off = (b.wavesLeft % 2) * (Math.PI / n);
          for (let i = 0; i < n; i++) {
            const a = off + (i / n) * Math.PI * 2;
            ctx.enemies.fireShot(e.x, e.y, Math.cos(a), Math.sin(a), pat.speed ?? 110, pat.dmg ?? 10, 4, color);
          }
          b.wavesLeft--;
          b.waveT = 0.4;
          if (b.wavesLeft <= 0) this.finish(b, pat);
        }
        break;
      }
      case 'aimed': {
        this.reaim(b);
        const n = pat.count ?? 3;
        const spread = ((pat.spread ?? 12) * Math.PI) / 180;
        const base = Math.atan2(b.dirY, b.dirX);
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * spread;
          ctx.enemies.fireShot(e.x, e.y, Math.cos(a), Math.sin(a), pat.speed ?? 140, pat.dmg ?? 10, 4, color);
        }
        this.finish(b, pat);
        break;
      }
      case 'summon': {
        const def = pat.minion ? ENEMIES.get(pat.minion) : undefined;
        if (def) {
          const n = pat.count ?? 4;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            ctx.enemies.spawnAt(def, e.x + Math.cos(a) * 30, e.y + Math.sin(a) * 30, 1 + ctx.runTime / 600);
          }
          ctx.fx.burst(e.x, e.y, 10, 50, 0.4, 0xffffff, 'ring');
        }
        this.finish(b, pat);
        break;
      }
      case 'zones': {
        const p = ctx.player;
        const n = pat.count ?? 4;
        for (let i = 0; i < n; i++) {
          const a = ctx.rng.range(0, Math.PI * 2);
          const d = i === 0 ? 0 : ctx.rng.range(30, 120);
          ctx.hazards.zone(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, pat.radius ?? 30, pat.duration ?? 5, pat.dmg ?? 5, 0.5, color);
        }
        this.finish(b, pat);
        break;
      }
    }
  }

  private reaim(b: BossRuntime): void {
    const p = this.ctx.player;
    const dx = p.x - b.e.x;
    const dy = p.y - b.e.y;
    const d = Math.hypot(dx, dy) || 1;
    b.dirX = dx / d;
    b.dirY = dy / d;
  }
}
