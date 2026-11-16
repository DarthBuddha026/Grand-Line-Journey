import type Phaser from 'phaser';
import { Pool, type Poolable } from '../../core/pool';
import type { HitEffects, StatModifier } from '../../data';
import { CAPS, DEPTH } from '../../config';
import type { RunContext } from './context';
import type { Enemy } from './enemies';
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
export type HitboxMotion = 'linear' | 'boomerang' | 'punch' | 'beam' | 'sweep' | 'cone' | 'pulse' | 'orbit' | 'zone' | 'strike' | 'fist';

const NO_EFFECTS: HitEffects = {};
/** Arm/streak thickness: grows with the fist, but much slower, so giant fists keep arm-sized arms. */
const armWidth = (h: { maxRadius: number }): number => Math.min(h.maxRadius * 0.9, 4 + h.maxRadius * 0.2);
/** Where a stretching arm leaves the body: the hand, from the player's feet, in world units (front hand; the back hand mirrors x). */
const HAND = { x: 5, y: 3.5 };
/** How far a bouncing fist looks for its next enemy. */
const BOUNCE_RANGE = 150;
/** Fist phases: reaching out along the aim, bouncing to `target`, pulling back to the player. */
const OUT = 0;
const BOUNCING = 1;
const BACK = 2;

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
  /** fist: enemies left to bounce on to, the phase (OUT/BOUNCING/BACK) and the enemy it's flying at. */
  bounce: number;
  phase: number;
  /** Which hand an arm comes from: 1 front (the side the player faces), -1 back. */
  hand: 1 | -1;
  target: Enemy | null;
  targetId: number;
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
  bounce?: number;
  hand?: 1 | -1;
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
      returning: false, dmg: 0, knockback: 0, pierce: -1, bounce: 0, phase: OUT, hand: 1, target: null, targetId: -1, hitInterval: 0, radialKnock: false, killWeak: false, color: 0xffffff,
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
    h.bounce = s.bounce ?? 0;
    h.phase = OUT;
    h.hand = s.hand ?? 1;
    h.target = null;
    h.targetId = -1;
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
        .setOrigin(s.motion === 'punch' || s.motion === 'fist' || s.motion === 'beam' || s.motion === 'sweep' ? 0 : 0.5, 0.5)
        .setRotation(Math.atan2(h.dirY, h.dirX))
        .setFlipX(false);
    }
    h.useTip = !!s.tipTexture;
    if (s.tipTexture) h.tip.setTexture(s.tipTexture).setTint(s.color).setVisible(true).setScale((s.radius * 2) / 12 / TEX);
    // The back hand's arm goes behind the player's body, the front hand's in front.
    const back = h.hand === -1;
    h.sprite.setDepth(back ? DEPTH.player - 0.5 : DEPTH.hitbox);
    h.tip.setDepth(back ? DEPTH.player - 0.4 : DEPTH.hitbox + 1);
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
        h.x = this.handX(h.hand);
        h.y = this.handY();
        const t = 1 - h.life / h.maxLife;
        h.length = h.reach * (t < 0.5 ? t * 2 : (1 - t) * 2);
        break;
      }
      case 'fist': {
        // A stretching arm: the fist (h.x, h.y) flies while the arm stays attached to the player.
        const step = h.speed * dt;
        if (h.phase === BOUNCING && !(h.target?.alive && h.target.id === h.targetId)) h.phase = BACK; // target died
        if (h.phase === OUT) {
          h.reach -= step;
          if (h.reach <= 0) h.phase = BACK; // hit nothing: pull back
        } else {
          const tx = h.phase === BOUNCING ? h.target!.x : this.handX(h.hand);
          const ty = h.phase === BOUNCING ? h.target!.y : this.handY();
          const dx = tx - h.x;
          const dy = ty - h.y;
          const d = Math.hypot(dx, dy);
          if (h.phase === BACK && d <= step * 1.5) {
            h.travel = 0; // back in hand
            break;
          }
          if (d > 0.001) {
            h.dirX = dx / d;
            h.dirY = dy / d;
          }
        }
        const move = h.phase === BACK ? step * 1.5 : step;
        h.x += h.dirX * move;
        h.y += h.dirY * move;
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
    if (h.useTip) {
      // The tip faces along the arm (a fist's thumb stays on top either way).
      const fist = h.motion === 'fist';
      const a = fist ? Math.atan2(h.y - this.handY(), h.x - this.handX(h.hand)) : Math.atan2(h.dirY, h.dirX);
      h.tip.setPosition(fist ? h.x : h.x + h.dirX * h.length, fist ? h.y : h.y + h.dirY * h.length).setRotation(a).setFlipY(Math.cos(a) < 0);
      // A fist starts hand-sized and swells to full size as the arm stretches out.
      const len = fist ? Math.hypot(h.x - this.handX(h.hand), h.y - this.handY()) : h.length;
      h.tip.setScale(((h.maxRadius * 2) / 12 / TEX) * Math.min(1, 0.35 + len / 45));
    }
    if (!h.useSprite) return;
    const s = h.sprite;
    switch (h.motion) {
      case 'punch':
        s.setPosition(h.x, h.y).setDisplaySize(Math.max(1, h.length), armWidth(h));
        break;
      case 'fist': {
        const hx = this.handX(h.hand);
        const hy = this.handY();
        const dx = h.x - hx;
        const dy = h.y - hy;
        s.setPosition(hx, hy).setRotation(Math.atan2(dy, dx)).setDisplaySize(Math.max(1, Math.hypot(dx, dy)), armWidth(h));
        break;
      }
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

  /** The hand an arm stretches from, following the player's facing and size. */
  handX(hand: 1 | -1): number {
    const p = this.ctx.player;
    return p.x + p.facing * hand * HAND.x * p.scale;
  }

  handY(): number {
    const p = this.ctx.player;
    return p.y - HAND.y * p.scale;
  }

  /** Whether an arm is out (punch or fist): the player keeps facing the punch until it's back. */
  armOut(): boolean {
    for (const h of this.pool.active) if (h.motion === 'fist' || (h.motion === 'punch' && h.sprite.texture.key === 'arm')) return true;
    return false;
  }

  /** The hand that's free for a bouncing fist: the front one unless its fist is still out. */
  freeHand(): 1 | -1 {
    for (const h of this.pool.active) if (h.motion === 'fist' && h.hand === 1) return -1;
    return 1;
  }

  /** Fists currently out (a hand can't punch again until its fist is back). */
  fistsOut(): number {
    let n = 0;
    for (const h of this.pool.active) if (h.motion === 'fist') n++;
    return n;
  }

  /** A fist just hit `from`: on to the nearest enemy it hasn't hit, or back to the player when out of bounces or targets. */
  private nextBounce(h: Hitbox, from: Enemy): void {
    let best: Enemy | null = null;
    let bestD = BOUNCE_RANGE * BOUNCE_RANGE;
    if (h.bounce > 0) {
      for (const e of this.ctx.enemies.pool.active) {
        if (!e.alive || e === from || h.hitIds.includes(e.id)) continue;
        const d = (e.x - from.x) ** 2 + (e.y - from.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
    }
    if (!best) {
      h.phase = BACK;
      h.target = null;
      return;
    }
    h.bounce--;
    h.phase = BOUNCING;
    h.target = best;
    h.targetId = best.id;
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
      if (h.motion === 'fist' && h.phase !== BACK) {
        this.nextBounce(h, e);
        return;
      }
      if (h.pierce > 0) {
        h.pierce--;
        if (h.pierce === 0) return;
      }
    }
  }
}
