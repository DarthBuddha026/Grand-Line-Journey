import type Phaser from 'phaser';
import { Pool, type Poolable } from '../../core/pool';
import type { HitEffects, StatModifier } from '../../data';
import { CAPS, DEPTH } from '../../config';
import type { RunContext } from './context';
import { TEX } from '../textures';

/**
 * Every player attack is a pooled Hitbox. Actions (actions.ts) spawn them with a
 * motion; collision, pierce, re-hit intervals and knockback all live here, and the
 * actual damage/effects go through ctx.hitEnemy so every source is treated alike.
 *
 *  linear     flies along dir until `travel` runs out          (circle)
 *  boomerang  flies out, then returns to the player            (circle)
 *  punch      capsule from the player that extends + retracts  (capsule)
 *  beam       fixed-length capsule, ticks while alive          (capsule)
 *  sweep      capsule rotating around the player               (capsule)
 *  cone       sector in front of the player, hits once         (sector)
 *  pulse      ring growing around the player                   (circle)
 *  orbit      circles the player                               (circle)
 *  zone       lingering area that ticks, slows, pulls or buffs (circle)
 *  strike     telegraphed, detonates once after `arm` seconds  (circle)
 */
export type HitboxMotion = 'linear' | 'boomerang' | 'punch' | 'beam' | 'sweep' | 'cone' | 'pulse' | 'orbit' | 'zone' | 'strike';

const NO_EFFECTS: HitEffects = {};

export interface Hitbox extends Poolable {
  motion: HitboxMotion;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  travel: number;
  reach: number;
  length: number;
  radius: number;
  maxRadius: number;
  halfArc: number; // cone, radians
  orbitAngle: number;
  orbitSpeed: number;
  orbitRadius: number;
  life: number;
  maxLife: number;
  arm: number; // strike delay remaining
  armTotal: number;
  follow: boolean;
  returning: boolean;
  dmg: number;
  knockback: number;
  pierce: number;
  hitInterval: number;
  radialKnock: boolean;
  killWeak: boolean;
  color: number;
  effects: HitEffects;
  buff: StatModifier[] | null;
  hitIds: number[];
  hitTimes: number[];
  sprite: Phaser.GameObjects.Image;
  tip: Phaser.GameObjects.Image;
  useSprite: boolean;
  useTip: boolean;
}

export interface HitboxSpec {
  motion: HitboxMotion;
  x: number;
  y: number;
  dirX?: number;
  dirY?: number;
  speed?: number;
  travel?: number;
  reach?: number;
  length?: number;
  radius: number;
  arc?: number; // degrees
  life: number;
  arm?: number;
  follow?: boolean;
  dmg: number;
  knockback?: number;
  pierce?: number;
  hitInterval?: number;
  radialKnock?: boolean;
  killWeak?: boolean;
  orbitAngle?: number;
  orbitSpeed?: number;
  orbitRadius?: number;
  effects?: HitEffects;
  buff?: StatModifier[];
  color: number;
  /** Sprite texture; cones, zones and strikes are drawn with graphics instead. */
  texture?: string;
  tipTexture?: string;
  alpha?: number;
}

export class HitboxSystem {
  readonly pool: Pool<Hitbox>;
  /** Stats of a buff zone the player is standing in this frame (Weather Egg), or null. */
  playerBuff: StatModifier[] | null = null;
  private readonly ctx: RunContext;
  private readonly groundGfx: Phaser.GameObjects.Graphics;
  private readonly slashGfx: Phaser.GameObjects.Graphics;

  constructor(ctx: RunContext) {
    this.ctx = ctx;
    const scene = ctx.world;
    this.groundGfx = scene.add.graphics().setDepth(DEPTH.ground + 2);
    this.slashGfx = scene.add.graphics().setDepth(DEPTH.hitbox);
    this.pool = new Pool<Hitbox>(CAPS.hitboxes, () => ({
      poolSlot: -1, motion: 'linear', x: 0, y: 0, dirX: 1, dirY: 0, speed: 0, travel: 0, reach: 0, length: 0, radius: 4,
      maxRadius: 4, halfArc: 0, orbitAngle: 0, orbitSpeed: 0, orbitRadius: 0, life: 0, maxLife: 0, arm: 0, armTotal: 0, follow: false,
      returning: false, dmg: 0, knockback: 0, pierce: -1, hitInterval: 0, radialKnock: false, killWeak: false, color: 0xffffff,
      effects: NO_EFFECTS, buff: null, hitIds: [], hitTimes: [],
      sprite: scene.add.image(0, 0, 'white').setDepth(DEPTH.hitbox).setVisible(false),
      tip: scene.add.image(0, 0, 'fist').setDepth(DEPTH.hitbox + 1).setVisible(false),
      useSprite: false, useTip: false,
    }));
  }

  get count(): number {
    return this.pool.count;
  }

  spawn(s: HitboxSpec): Hitbox | null {
    const h = this.pool.acquire();
    if (!h) return null;
    h.motion = s.motion;
    h.x = s.x;
    h.y = s.y;
    const dl = Math.hypot(s.dirX ?? 1, s.dirY ?? 0) || 1;
    h.dirX = (s.dirX ?? 1) / dl;
    h.dirY = (s.dirY ?? 0) / dl;
    h.speed = s.speed ?? 0;
    h.travel = s.travel ?? Infinity;
    h.reach = s.reach ?? 0;
    h.length = s.motion === 'beam' || s.motion === 'sweep' ? (s.length ?? 100) : 0;
    h.radius = s.motion === 'pulse' ? 0 : s.radius;
    h.maxRadius = s.radius;
    h.halfArc = ((s.arc ?? 90) * Math.PI) / 360;
    h.orbitAngle = s.orbitAngle ?? Math.atan2(h.dirY, h.dirX);
    h.orbitSpeed = s.orbitSpeed ?? 0;
    h.orbitRadius = s.orbitRadius ?? 0;
    h.life = h.maxLife = s.life;
    h.arm = h.armTotal = s.arm ?? 0;
    h.follow = s.follow ?? false;
    h.returning = false;
    h.dmg = s.dmg;
    h.knockback = s.knockback ?? 0;
    h.pierce = s.pierce ?? -1;
    h.hitInterval = s.hitInterval ?? 0;
    h.radialKnock = s.radialKnock ?? false;
    h.killWeak = s.killWeak ?? false;
    h.color = s.color;
    h.effects = s.effects ?? NO_EFFECTS;
    h.buff = s.buff ?? null;
    h.hitIds.length = 0;
    h.hitTimes.length = 0;
    h.useSprite = !!s.texture;
    if (s.texture) {
      h.sprite
        .setTexture(s.texture)
        .setTint(s.color)
        .setAlpha(s.alpha ?? 1)
        .setVisible(true)
        .setOrigin(s.motion === 'punch' || s.motion === 'beam' || s.motion === 'sweep' ? 0 : 0.5, 0.5)
        .setRotation(Math.atan2(h.dirY, h.dirX))
        .setFlipX(false);
    }
    h.useTip = !!s.tipTexture;
    if (s.tipTexture) h.tip.setTexture(s.tipTexture).setTint(s.color).setVisible(true).setScale((s.radius * 2) / 12 / TEX);
    this.place(h);
    return h;
  }

  update(dt: number): void {
    this.playerBuff = null;
    this.groundGfx.clear();
    this.slashGfx.clear();
    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i];
      h.life -= dt;
      this.move(h, dt);
      if (h.motion === 'strike') {
        h.arm -= dt;
        if (h.arm > 0) {
          this.draw(h);
          continue;
        }
        this.collide(h);
        this.ctx.fx.burst(h.x, h.y, h.radius * 0.4, h.radius * 1.15, 0.3, h.color, 'disc', false, 0.7);
        this.release(h);
        continue;
      }
      if (h.life <= 0 || h.travel <= 0) {
        this.release(h);
        continue;
      }
      if (h.motion === 'zone' && h.buff) {
        const p = this.ctx.player;
        if ((p.x - h.x) ** 2 + (p.y - h.y) ** 2 < h.radius * h.radius) this.playerBuff = h.buff;
      }
      if (h.dmg > 0 || h.killWeak || h.effects !== NO_EFFECTS) this.collide(h);
      if (h.pierce === 0) {
        this.release(h);
        continue;
      }
      this.place(h);
      this.draw(h);
    }
  }

  clearAll(): void {
    for (let i = this.pool.active.length - 1; i >= 0; i--) this.release(this.pool.active[i]);
  }

  private release(h: Hitbox): void {
    h.sprite.setVisible(false);
    h.tip.setVisible(false);
    this.pool.release(h);
  }

  private move(h: Hitbox, dt: number): void {
    const p = this.ctx.player;
    switch (h.motion) {
      case 'linear': {
        const step = h.speed * dt;
        h.x += h.dirX * step;
        h.y += h.dirY * step;
        h.travel -= step;
        break;
      }
      case 'boomerang': {
        const step = h.speed * dt;
        if (!h.returning) {
          h.x += h.dirX * step;
          h.y += h.dirY * step;
          h.reach -= step;
          if (h.reach <= 0) {
            h.returning = true;
            h.hitIds.length = 0; // can hit again on the way back
            h.hitTimes.length = 0;
          }
        } else {
          const dx = p.x - h.x;
          const dy = p.y - h.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < 8) h.travel = 0;
          h.x += (dx / d) * step * 1.15;
          h.y += (dy / d) * step * 1.15;
        }
        break;
      }
      case 'punch': {
        h.x = p.x;
        h.y = p.y;
        const t = 1 - h.life / h.maxLife;
        h.length = h.reach * (t < 0.5 ? t * 2 : (1 - t) * 2);
        break;
      }
      case 'sweep':
        h.x = p.x;
        h.y = p.y;
        h.orbitAngle += h.orbitSpeed * dt;
        h.dirX = Math.cos(h.orbitAngle);
        h.dirY = Math.sin(h.orbitAngle);
        break;
      case 'pulse': {
        h.x = p.x;
        h.y = p.y;
        const t = 1 - h.life / h.maxLife;
        h.radius = h.maxRadius * Math.min(1, t * 1.6);
        break;
      }
      case 'orbit':
        h.orbitAngle += h.orbitSpeed * dt;
        h.x = p.x + Math.cos(h.orbitAngle) * h.orbitRadius;
        h.y = p.y + Math.sin(h.orbitAngle) * h.orbitRadius;
        break;
      case 'beam':
      case 'cone':
      case 'zone':
        if (h.follow) {
          h.x = p.x;
          h.y = p.y;
        }
        break;
      case 'strike':
        break;
    }
  }

  private place(h: Hitbox): void {
    if (h.useTip) h.tip.setPosition(h.x + h.dirX * h.length, h.y + h.dirY * h.length);
    if (!h.useSprite) return;
    const s = h.sprite;
    switch (h.motion) {
      case 'punch':
        s.setPosition(h.x, h.y).setDisplaySize(Math.max(1, h.length), h.maxRadius * 0.9);
        break;
      case 'beam': {
        const t = h.life / h.maxLife;
        s.setPosition(h.x, h.y).setDisplaySize(h.length, h.radius * 2 * (0.6 + 0.4 * t)).setAlpha(0.35 + 0.6 * t);
        break;
      }
      case 'sweep':
        s.setPosition(h.x, h.y).setRotation(h.orbitAngle).setDisplaySize(h.length, h.radius * 2);
        break;
      case 'pulse': {
        const t = 1 - h.life / h.maxLife;
        s.setPosition(h.x, h.y).setDisplaySize(h.radius * 2, h.radius * 2).setAlpha(1 - t * 0.8);
        break;
      }
      case 'orbit':
        s.setPosition(h.x, h.y).setDisplaySize(h.radius * 2, (h.radius * 2 * 12) / 14).setRotation(0).setFlipX(Math.sin(h.orbitAngle) > 0);
        break;
      case 'boomerang':
        s.setPosition(h.x, h.y).setDisplaySize(h.radius * 2, h.radius * 2).setRotation(s.rotation + 0.35);
        break;
      default:
        s.setPosition(h.x, h.y).setDisplaySize(h.radius * 2, h.radius * 2);
    }
  }

  /** Graphics-drawn shapes: cones, zones and strike telegraphs. */
  private draw(h: Hitbox): void {
    if (h.motion === 'cone') {
      const t = Math.max(0, h.life / h.maxLife);
      const a = Math.atan2(h.dirY, h.dirX);
      this.slashGfx.fillStyle(h.color, 0.25 + 0.5 * t);
      this.slashGfx.slice(h.x, h.y, h.radius, a - h.halfArc, a + h.halfArc, false).fillPath();
      this.slashGfx.lineStyle(2, 0xffffff, 0.7 * t);
      this.slashGfx.beginPath();
      this.slashGfx.arc(h.x, h.y, h.radius, a - h.halfArc, a + h.halfArc, false);
      this.slashGfx.strokePath();
    } else if (h.motion === 'zone') {
      const fade = Math.min(1, h.life / 0.4);
      this.groundGfx.fillStyle(h.color, 0.22 * fade).fillCircle(h.x, h.y, h.radius);
      this.groundGfx.lineStyle(1.5, h.color, 0.6 * fade).strokeCircle(h.x, h.y, h.radius);
    } else if (h.motion === 'strike') {
      const t = 1 - Math.max(0, h.arm) / Math.max(0.05, h.armTotal);
      this.groundGfx.lineStyle(1.5, h.color, 0.8).strokeCircle(h.x, h.y, h.radius);
      this.groundGfx.fillStyle(h.color, 0.15 + 0.25 * t).fillCircle(h.x, h.y, h.radius * t);
    }
  }

  private collide(h: Hitbox): void {
    const enemies = this.ctx.enemies;
    let cx = h.x;
    let cy = h.y;
    let qr = h.radius;
    const capsule = h.motion === 'punch' || h.motion === 'beam' || h.motion === 'sweep';
    if (capsule) {
      cx = h.x + h.dirX * h.length * 0.5;
      cy = h.y + h.dirY * h.length * 0.5;
      qr = h.length * 0.5 + h.radius;
    }
    if (qr <= 0) return;
    const out = enemies.scratch;
    const n = enemies.hash.queryCircle(cx, cy, qr + 16, out);
    const now = this.ctx.runTime;
    const cosArc = Math.cos(h.halfArc);
    for (let k = 0; k < n; k++) {
      const e = enemies.byId[out[k]];
      if (!e.alive) continue;
      const reach = h.radius + e.radius;
      let d2: number;
      if (capsule) {
        const t = Math.max(0, Math.min(h.length, (e.x - h.x) * h.dirX + (e.y - h.y) * h.dirY));
        const px = h.x + h.dirX * t - e.x;
        const py = h.y + h.dirY * t - e.y;
        d2 = px * px + py * py;
      } else {
        const dx = e.x - h.x;
        const dy = e.y - h.y;
        d2 = dx * dx + dy * dy;
        if (h.motion === 'cone' && d2 <= reach * reach) {
          const d = Math.sqrt(d2) || 1;
          if (d > e.radius + 4 && (dx * h.dirX + dy * h.dirY) / d < cosArc) continue;
        }
      }
      if (d2 > reach * reach) continue;

      const idx = h.hitIds.indexOf(e.id);
      if (idx >= 0) {
        if (h.hitInterval <= 0 || now - h.hitTimes[idx] < h.hitInterval) continue;
        h.hitTimes[idx] = now;
      } else {
        h.hitIds.push(e.id);
        h.hitTimes.push(now);
      }

      let kx = h.dirX;
      let ky = h.dirY;
      if (h.radialKnock || h.motion === 'strike' || h.motion === 'zone' || h.motion === 'pulse' || h.motion === 'orbit' || h.motion === 'cone') {
        const dx = e.x - h.x;
        const dy = e.y - h.y;
        const len = Math.hypot(dx, dy) || 1;
        kx = dx / len;
        ky = dy / len;
      }
      let force = h.knockback;
      if (h.effects.pull) {
        kx = -kx;
        ky = -ky;
        force = h.effects.pull;
      }
      this.ctx.hitEnemy(e, h.dmg, kx, ky, force, h.effects, h.killWeak);
      if (h.pierce > 0) {
        h.pierce--;
        if (h.pierce === 0) return;
      }
    }
  }
}
