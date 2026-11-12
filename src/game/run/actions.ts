import type { ActionDef, ActionTarget } from '../../data';
import { hex, viewport } from '../../config';
import type { ActionSource, RunContext } from './context';
import type { Enemy } from './enemies';

/**
 * The action library. Weapons, main attacks, skills, Specials and Alliances are all
 * data that names one of these actions plus numbers. Adding content rarely needs
 * code; adding a new kind of attack means adding a case here.
 *
 * Damage values are BASE damage: ctx.hitEnemy applies ATK, crits and all modifiers.
 * Sizes scale with the `area` stat and with the player's scale (Gear 5, Monster Point).
 */

const DEG = Math.PI / 180;
const buffIds = new WeakMap<ActionDef, string>();
let nextBuffId = 0;

type Vec = { x: number; y: number };

function fan(base: Vec, count: number, spreadDeg: number, out: (x: number, y: number, i: number) => void): void {
  const a0 = Math.atan2(base.y, base.x);
  for (let i = 0; i < count; i++) {
    const a = a0 + (i - (count - 1) / 2) * spreadDeg * DEG;
    out(Math.cos(a), Math.sin(a), i);
  }
}

function around(count: number, offsetDeg: number, out: (x: number, y: number, i: number) => void): void {
  for (let i = 0; i < count; i++) {
    const a = offsetDeg * DEG + (i / count) * Math.PI * 2;
    out(Math.cos(a), Math.sin(a), i);
  }
}

function dirTo(ctx: RunContext, e: Enemy | null): Vec {
  if (!e) return ctx.aimDir();
  const p = ctx.player;
  const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
  return { x: (e.x - p.x) / d, y: (e.y - p.y) / d };
}

/** Direction for aimed actions. */
function directionFor(ctx: RunContext, target: ActionTarget | undefined, range: number): Vec {
  const p = ctx.player;
  switch (target) {
    case 'nearest':
      return dirTo(ctx, ctx.enemies.nearest(p.x, p.y, range));
    case 'toughest':
      return dirTo(ctx, ctx.enemies.toughest(p.x, p.y, range));
    case 'random':
      return dirTo(ctx, ctx.enemies.randomOnScreen(p.x, p.y));
    case 'back': {
      const a = ctx.aimDir();
      return { x: -a.x, y: -a.y };
    }
    default:
      return ctx.aimDir();
  }
}

/** World positions for placed actions (strikes, zones). */
function pointsFor(ctx: RunContext, target: ActionTarget | undefined, count: number, scatter: number): Vec[] {
  const p = ctx.player;
  const pts: Vec[] = [];
  const rng = ctx.rng;
  const fallback = (): Vec => {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(30, 120);
    return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
  };
  for (let i = 0; i < count; i++) {
    let e: Enemy | null = null;
    switch (target) {
      case 'player':
        pts.push({ x: p.x, y: p.y });
        continue;
      case 'aim': {
        const a = ctx.aimDir();
        pts.push({ x: p.x + a.x * 80, y: p.y + a.y * 80 });
        continue;
      }
      case 'nearest':
        e = ctx.enemies.nearest(p.x, p.y, Math.hypot(viewport.w, viewport.h) / 2);
        break;
      case 'toughest':
        e = ctx.enemies.toughest(p.x, p.y, 320);
        break;
      case 'slowed':
        e = ctx.enemies.randomOnScreen(p.x, p.y, (en) => en.slowT > 0) ?? ctx.enemies.randomOnScreen(p.x, p.y);
        break;
      default:
        e = ctx.enemies.randomOnScreen(p.x, p.y);
    }
    const pt = e ? { x: e.x, y: e.y } : fallback();
    if (scatter > 0) {
      pt.x += rng.range(-scatter, scatter);
      pt.y += rng.range(-scatter, scatter);
    }
    pts.push(pt);
  }
  return pts;
}

export function executeAction(ctx: RunContext, a: ActionDef, src: ActionSource): void {
  const p = ctx.player;
  const area = ctx.stats.get('area');
  const scale = p.scale;
  const color = a.color ? hex(a.color) : src.color;
  const dmg = (a.dmg ?? 0) * src.dmgMul;
  const extra = src.isMain ? Math.round(ctx.mods.get('mainExtraCount')) : 0;
  const count = (a.count ?? 1) + extra;
  const kb = (a.knockback ?? 0) * (1 + ctx.mods.get('knockbackMul'));

  switch (a.type) {
    case 'punch':
      fan(ctx.aimDir(), count, a.spread ?? 18, (dx, dy) => {
        ctx.hitboxes.spawn({
          motion: 'punch', x: p.x, y: p.y, dirX: dx, dirY: dy,
          reach: (a.range ?? 80) * area * scale, radius: (a.size ?? 6) * area * scale, life: 0.24,
          dmg, knockback: kb || 60, effects: a.effects, color, texture: 'white', tipTexture: a.texture ?? 'fist',
        });
      });
      break;

    case 'cone': {
      const spawnCone = (dx: number, dy: number) =>
        ctx.hitboxes.spawn({
          motion: 'cone', x: p.x, y: p.y, dirX: dx, dirY: dy, radius: (a.radius ?? 40) * area * scale, arc: a.arc ?? 90,
          life: 0.18, follow: true, dmg, knockback: kb, effects: a.effects, color,
        });
      if (a.dirs) around(a.dirs, src.fireCount * 30, spawnCone);
      else {
        const d = directionFor(ctx, a.target, 200);
        spawnCone(d.x, d.y);
      }
      break;
    }

    case 'volley': {
      const shoot = (dx: number, dy: number) =>
        ctx.hitboxes.spawn({
          motion: a.boomerang ? 'boomerang' : 'linear', x: p.x, y: p.y, dirX: dx, dirY: dy, speed: a.speed ?? 200,
          travel: a.boomerang ? Infinity : (a.range ?? 260), reach: a.range ?? 140, radius: (a.size ?? 5) * area,
          life: a.boomerang ? 6 : 5, dmg, pierce: a.pierce ?? 1, knockback: kb || 20, effects: a.effects, color,
          texture: a.texture ?? 'pellet',
        });
      if (a.ring) around(count, src.fireCount * (a.spin ?? 0), shoot);
      else fan(directionFor(ctx, a.target, a.range ?? 300), count, a.spread ?? 12, shoot);
      break;
    }

    case 'strike':
      for (const pt of pointsFor(ctx, a.target ?? 'random', count, a.scatter ?? 0)) {
        const delay = a.delay ?? 0.4;
        ctx.hitboxes.spawn({
          motion: 'strike', x: pt.x, y: pt.y, radius: (a.radius ?? 20) * area, life: delay + 0.5, arm: delay,
          dmg, knockback: kb, effects: a.effects, color,
        });
      }
      break;

    case 'pulse':
      if (a.hpCost) p.hp = Math.max(1, p.hp - p.hp * a.hpCost);
      ctx.hitboxes.spawn({
        motion: 'pulse', x: p.x, y: p.y, radius: (a.radius ?? 50) * area * scale, life: a.duration ?? 0.3, dmg,
        knockback: kb, killWeak: a.killWeak, effects: a.effects, color, texture: 'ring',
      });
      break;

    case 'orbit': {
      const duration = a.duration ?? 3;
      src.onOrbit?.(ctx.runTime + duration);
      around(count, 0, (dx, dy) => {
        ctx.hitboxes.spawn({
          motion: 'orbit', x: p.x, y: p.y, orbitAngle: Math.atan2(dy, dx), orbitSpeed: a.speed ?? 3,
          orbitRadius: (a.range ?? 44) * area, radius: (a.size ?? 7) * area, life: duration, dmg,
          knockback: kb, hitInterval: a.tick ?? 0.5, effects: a.effects, color, texture: a.texture ?? 'snail',
        });
      });
      break;
    }

    case 'sweep': {
      const d = ctx.aimDir();
      ctx.hitboxes.spawn({
        motion: 'sweep', x: p.x, y: p.y, dirX: d.x, dirY: d.y, length: (a.length ?? 60) * area, radius: ((a.width ?? 8) / 2) * area,
        orbitSpeed: a.speed ?? 6, life: a.duration ?? 1.2, dmg, hitInterval: 0.3, knockback: kb || 40, radialKnock: true,
        effects: a.effects, color, texture: 'white',
      });
      break;
    }

    case 'zone':
      for (const pt of pointsFor(ctx, a.follow ? 'player' : (a.target ?? 'player'), a.count ?? 1, a.scatter ?? 0)) {
        ctx.hitboxes.spawn({
          motion: 'zone', x: pt.x, y: pt.y, radius: (a.radius ?? 40) * area, life: a.duration ?? 3, follow: a.follow,
          dmg, hitInterval: a.tick ?? 0.5, knockback: kb, effects: a.effects, color, buff: a.stats,
        });
      }
      break;

    case 'beam': {
      const spawnBeam = (dx: number, dy: number) =>
        ctx.hitboxes.spawn({
          motion: 'beam', x: p.x, y: p.y, dirX: dx, dirY: dy, length: (a.length ?? 260) * area, radius: ((a.width ?? 10) / 2) * area * scale,
          life: a.duration ?? 0.4, follow: a.follow ?? true, dmg, hitInterval: a.tick ?? 0.2, knockback: kb, effects: a.effects,
          color, texture: 'white', alpha: 0.9,
        });
      if (a.dirs) around(a.dirs, src.fireCount * 20, spawnBeam);
      else {
        const d = directionFor(ctx, a.target, (a.length ?? 260) * 1.1);
        spawnBeam(d.x, d.y);
      }
      break;
    }

    case 'dash': {
      const d = directionFor(ctx, a.target, 260);
      const dist = a.distance ?? 100;
      const x0 = p.x;
      const y0 = p.y;
      ctx.dashPlayer(d.x, d.y, dist, 0.16);
      ctx.hitboxes.spawn({
        motion: 'beam', x: x0, y: y0, dirX: d.x, dirY: d.y, length: dist, radius: ((a.width ?? 16) / 2) * area,
        life: 0.22, dmg, hitInterval: 0, knockback: kb || 60, effects: a.effects, color, texture: 'white', alpha: 0.5,
      });
      const t = a.trail;
      if (t) {
        for (let s = 0; s <= dist; s += 22) {
          ctx.hitboxes.spawn({
            motion: 'zone', x: x0 + d.x * s, y: y0 + d.y * s, radius: (t.radius ?? 16) * area, life: t.duration ?? 3,
            dmg: (t.dmg ?? 0) * src.dmgMul, hitInterval: t.tick ?? 0.5, effects: t.effects, color: t.color ? hex(t.color) : color,
          });
        }
      }
      break;
    }

    case 'blink': {
      const steps = a.count ?? 6;
      ctx.addBuff('blink', [], steps * 0.07 + 0.3, true);
      for (let i = 0; i < steps; i++) {
        ctx.schedule(i * 0.07, () => {
          const e = ctx.enemies.randomOnScreen(p.x, p.y) ?? ctx.enemies.nearest(p.x, p.y, 400);
          if (!e) return;
          ctx.fx.line(p.x, p.y, e.x, e.y, 0xfff59d, 3, 0.25);
          p.x = e.x;
          p.y = e.y;
          const r = (a.radius ?? 30) * area;
          for (let k = ctx.enemies.pool.active.length - 1; k >= 0; k--) {
            const o = ctx.enemies.pool.active[k];
            if ((o.x - p.x) ** 2 + (o.y - p.y) ** 2 < (r + o.radius) ** 2) ctx.hitEnemy(o, dmg, 0, 0, 0, a.effects);
          }
          ctx.fx.burst(p.x, p.y, 4, r, 0.25, 0xfff59d, 'disc', false, 0.7);
        });
      }
      break;
    }

    case 'chain': {
      const hit: Enemy[] = [];
      for (let c = 0; c < count; c++) {
        let cx = p.x;
        let cy = p.y;
        let range = 200;
        for (let j = 0; j <= (a.jumps ?? 3); j++) {
          let best: Enemy | null = null;
          let bestD = range * range;
          for (const e of ctx.enemies.pool.active) {
            if (hit.includes(e)) continue;
            const d = (e.x - cx) ** 2 + (e.y - cy) ** 2;
            if (d < bestD) {
              bestD = d;
              best = e;
            }
          }
          if (!best) break;
          hit.push(best);
          ctx.fx.line(cx, cy, best.x, best.y, color, 2, 0.2);
          cx = best.x;
          cy = best.y;
          range = a.range ?? 80;
          ctx.hitEnemy(best, dmg, 0, 0, 0, a.effects);
        }
      }
      break;
    }

    case 'screen': {
      const hw = viewport.w / 2 + 10;
      const hh = viewport.h / 2 + 10;
      ctx.world.cameras.main.shake(140, 0.008);
      ctx.fx.burst(p.x, p.y, 10, Math.max(viewport.w, viewport.h) * 0.6, 0.5, color, 'disc', false, 0.45);
      const list = ctx.enemies.pool.active;
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (Math.abs(e.x - p.x) > hw || Math.abs(e.y - p.y) > hh) continue;
        const len = Math.hypot(e.x - p.x, e.y - p.y) || 1;
        ctx.hitEnemy(e, dmg, (e.x - p.x) / len, (e.y - p.y) / len, kb, a.effects, a.killWeak);
      }
      break;
    }

    case 'buff': {
      let id = buffIds.get(a);
      if (!id) buffIds.set(a, (id = `act${nextBuffId++}`));
      ctx.addBuff(id, a.stats ?? [], a.duration ?? 3, a.invuln);
      ctx.fx.burst(p.x, p.y, 6, 28, 0.35, color, 'ring', true);
      break;
    }

    case 'heal':
      ctx.healPlayer(ctx.stats.get('maxHp') * (a.frac ?? 0.1));
      ctx.fx.burst(p.x, p.y, 6, 26, 0.4, 0x69f0ae, 'ring', true);
      break;

    case 'magnet':
      ctx.pickups.magnetAll();
      ctx.fx.burst(p.x, p.y, 10, 120, 0.5, 0xfff176, 'ring', true, 0.8);
      break;

    case 'multi':
      for (const sub of a.actions ?? []) executeAction(ctx, sub, src);
      break;

    case 'flurry':
    case 'transform':
      // Handled by the kit / RunScene, which own the state these need.
      break;
  }
}
