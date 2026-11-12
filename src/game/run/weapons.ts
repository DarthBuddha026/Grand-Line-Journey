import type { WeaponDef } from '../../data';
import { hex, LIMITS_ENHANCE_DMG } from '../../config';
import type { RunContext } from './context';

export interface WeaponRuntime {
  def: WeaponDef;
  level: number;
  timer: number;
  /** Orbit weapons: run time when the current set of orbiters expires. */
  activeUntil: number;
  /** The character's main attack (Mil Fleur, Gatling). */
  isMain: boolean;
  fireCount: number;
}

export function createWeapon(def: WeaponDef, isMain: boolean): WeaponRuntime {
  return { def, level: 1, timer: 0.4, activeUntil: 0, isMain, fireCount: 0 };
}

/** Tick a weapon's cooldown and fire its action. Returns true when it fired. */
export function updateWeapon(ctx: RunContext, w: WeaponRuntime, dt: number): boolean {
  if (ctx.player.attackPauseT > 0 || ctx.player.sleepT > 0) return false;
  const lv = w.def.levels[Math.min(w.level, w.def.levels.length) - 1];
  const orbit = lv.action.type === 'orbit';
  // Orbit "cooldown" is the full cycle: the next set starts after the current one ends.
  if (orbit && ctx.runTime < w.activeUntil) return false;
  w.timer -= dt * (1 + ctx.stats.get('haste'));
  if (w.timer > 0) return false;
  w.timer = orbit ? Math.max(0.3, lv.cooldown - (lv.action.duration ?? 0)) : Math.max(w.timer + lv.cooldown, lv.cooldown * 0.25);
  const enh = ctx.loadout.enhance.get(w.def.id) ?? 0;
  ctx.runAction(lv.action, {
    dmgMul: 1 + LIMITS_ENHANCE_DMG * enh,
    isMain: w.isMain,
    color: hex(w.def.color),
    fireCount: w.fireCount++,
    onOrbit: (until) => (w.activeUntil = until),
  });
  return true;
}
