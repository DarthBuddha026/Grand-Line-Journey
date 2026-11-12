import { SKILLS, type ActionDef, type CharacterDef, type SkillDef, type SkillLevel } from '../../data';
import { hex } from '../../config';
import type { RunContext } from './context';
import type { WeaponRuntime } from './weapons';

/**
 * A character's three exclusive skills, run generically from skills.json:
 *   passive     stats/mods while learned
 *   periodic    run `action` every `every` seconds
 *   mainAttack  run `action` every Nth main attack (Gatling)
 *   hurt        timed buff (`stats` for `duration`) when you take damage (Gear Second)
 *   custom      a named hook below, for the few skills actions can't express
 * Passive stats/mods on any non-hurt skill always apply.
 */
export class Kit {
  /** Extra Special charge per second this frame (Lazy Justice). */
  extraSpecialCharge = 0;
  private readonly character: CharacterDef;
  private readonly skills: SkillDef[];
  private readonly timers = new Map<string, number>();
  private mainShots = 0;
  private flurryLeft = 0;
  private flurryTimer = 0;
  private flurryMul = 1;
  private flurryMain: WeaponRuntime | null = null;
  private driftAngle = 0;
  private rumblePhase = -1;
  private napPending = false;

  constructor(character: CharacterDef) {
    this.character = character;
    this.skills = character.skills.map((id) => SKILLS.get(id)!);
  }

  private level(ctx: RunContext, s: SkillDef): SkillLevel | null {
    const lv = ctx.loadout.skills.get(s.id) ?? 0;
    return lv > 0 ? s.levels[lv - 1] : null;
  }

  /** Re-apply passive stats/mods of all skills. Call whenever a skill level changes. */
  syncPassives(ctx: RunContext): void {
    for (const s of this.skills) {
      const l = this.level(ctx, s);
      const key = `skill:${s.id}`;
      if (!l) {
        ctx.stats.remove(key);
        ctx.mods.remove(key);
        continue;
      }
      if (s.trigger !== 'hurt') ctx.stats.set(key, l.stats ?? []);
      ctx.mods.set(key, l.mods ?? {});
    }
  }

  private run(ctx: RunContext, action: ActionDef, main: WeaponRuntime | null): void {
    if (action.type === 'flurry') {
      if (!main) return;
      this.flurryLeft = action.count ?? 5;
      this.flurryTimer = 0.08;
      this.flurryMul = action.dmgMul ?? 0.6;
      this.flurryMain = main;
      return;
    }
    ctx.runAction(action, { dmgMul: 1, isMain: false, color: hex(this.character.look.body), fireCount: 0 });
  }

  update(ctx: RunContext, dt: number, moving: boolean, main: WeaponRuntime): void {
    this.extraSpecialCharge = 0;
    this.updateFlurry(ctx, dt);
    for (const s of this.skills) {
      const l = this.level(ctx, s);
      if (!l) continue;
      if (s.trigger === 'periodic' && l.action && l.every) {
        const t = (this.timers.get(s.id) ?? 0) + dt;
        if (t >= l.every) {
          this.timers.set(s.id, 0);
          this.run(ctx, l.action, main);
        } else this.timers.set(s.id, t);
      } else if (s.trigger === 'custom') {
        this.custom(ctx, s, l, dt, moving);
      }
    }
  }

  onMainFired(ctx: RunContext, main: WeaponRuntime): void {
    this.mainShots++;
    for (const s of this.skills) {
      if (s.trigger !== 'mainAttack') continue;
      const l = this.level(ctx, s);
      if (l?.action && l.every && this.mainShots % l.every === 0) this.run(ctx, l.action, main);
    }
  }

  onHurt(ctx: RunContext): void {
    for (const s of this.skills) {
      if (s.trigger !== 'hurt') continue;
      const l = this.level(ctx, s);
      if (!l) continue;
      ctx.addBuff(`skill:${s.id}`, l.stats ?? [], l.duration ?? 3);
      if (l.action) this.run(ctx, l.action, null);
      ctx.fx.burst(ctx.player.x, ctx.player.y, 6, 30, 0.4, 0xff8a8a, 'ring', true, 0.9);
    }
  }

  /** Lost: a slowly wandering offset added to movement. */
  drift(ctx: RunContext, dt: number): { x: number; y: number } | null {
    const s = this.skills.find((k) => k.custom === 'lost');
    const l = s && this.level(ctx, s);
    if (!l) return null;
    this.driftAngle += ctx.rng.range(-4, 4) * dt;
    const k = l.params?.drift ?? 0.3;
    return { x: Math.cos(this.driftAngle) * k, y: Math.sin(this.driftAngle) * k };
  }

  private updateFlurry(ctx: RunContext, dt: number): void {
    if (this.flurryLeft <= 0 || !this.flurryMain) return;
    this.flurryTimer -= dt;
    const main = this.flurryMain;
    const a = main.def.levels[main.level - 1].action;
    while (this.flurryTimer <= 0 && this.flurryLeft > 0) {
      this.flurryTimer += 0.045;
      this.flurryLeft--;
      const aim = ctx.aimDir();
      const ang = Math.atan2(aim.y, aim.x) + ctx.rng.range(-0.45, 0.45);
      const area = ctx.stats.get('area');
      const p = ctx.player;
      ctx.hitboxes.spawn({
        motion: 'punch', x: p.x, y: p.y, dirX: Math.cos(ang), dirY: Math.sin(ang),
        reach: (a.range ?? 80) * area * p.scale * ctx.rng.range(0.7, 1.05), radius: (a.size ?? 6) * area * p.scale, life: 0.24,
        dmg: (a.dmg ?? 10) * this.flurryMul, knockback: a.knockback ?? 60, effects: a.effects, color: hex(main.def.color),
        texture: 'white', tipTexture: a.texture ?? 'fist',
      });
    }
  }

  private custom(ctx: RunContext, s: SkillDef, l: SkillLevel, dt: number, moving: boolean): void {
    const p = l.params ?? {};
    const t = (this.timers.get(s.id) ?? 0) + dt;
    this.timers.set(s.id, t);
    switch (s.custom) {
      case 'rumbleBall': {
        const phase = Math.floor(t / (p.period ?? 8)) % 2;
        if (phase !== this.rumblePhase) {
          this.rumblePhase = phase;
          ctx.stats.set('rumble', phase === 0 ? [{ stat: 'defense', flat: p.def ?? 0.3 }] : [{ stat: 'spd', pct: p.spd ?? 0.3 }]);
          ctx.fx.burst(ctx.player.x, ctx.player.y, 6, 32, 0.4, phase === 0 ? 0x90caf9 : 0xa5d6a7, 'ring', true);
        }
        break;
      }
      case 'lazyJustice':
        if (!moving) {
          ctx.healPlayer((p.heal ?? 2) * dt);
          this.extraSpecialCharge = p.charge ?? 0.5;
        }
        break;
      case 'powerNap': {
        const pl = ctx.player;
        if (this.napPending && pl.sleepT <= 0) {
          this.napPending = false;
          ctx.healPlayer(ctx.stats.get('maxHp'));
          ctx.fx.burst(pl.x, pl.y, 6, 40, 0.5, 0x69f0ae, 'ring', true);
        }
        if (t >= (p.every ?? 30)) {
          this.timers.set(s.id, 0);
          pl.sleepT = p.sleep ?? 1.5;
          this.napPending = true;
        }
        break;
      }
      case 'upsetStomach':
        if (t >= (p.every ?? 20)) {
          this.timers.set(s.id, 0);
          const pause = p.pause ?? 1.5;
          ctx.player.attackPauseT = pause;
          ctx.schedule(pause, () => {
            ctx.addBuff('upset', [{ stat: 'atk', pct: (p.mul ?? 3) - 1 }], 3);
            ctx.fx.burst(ctx.player.x, ctx.player.y, 8, 50, 0.5, 0xab47bc, 'disc', true, 0.6);
          });
        }
        break;
      case 'lost':
        break; // handled by drift()
    }
  }
}
