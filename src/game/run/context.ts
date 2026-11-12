import type Phaser from 'phaser';
import type { Rng } from '../../core/rng';
import type { ModBlock, StatBlock, StatModifier } from '../../core/stats';
import type { Loadout } from '../../core/loadout';
import type { ActionDef, CharacterDef, HitEffects } from '../../data';
import type { Enemy, EnemySystem } from './enemies';
import type { HitboxSystem } from './hitboxes';
import type { PickupSystem } from './pickups';
import type { FxSystem } from './fx';
import type { HazardSystem } from './hazards';
import type { InputController } from '../input';

export interface PlayerState {
  x: number;
  y: number;
  hp: number;
  iframes: number;
  scale: number;
  facing: 1 | -1;
  /** Shield HP (General Franky, Klabautermann); recharges after a few seconds without hits. */
  shield: number;
  shieldDelay: number;
  revives: number;
  /** Seconds left in a dash; the player moves along dashVx/Vy and is invulnerable. */
  dashT: number;
  dashVx: number;
  dashVy: number;
  /** Power Nap: can't move while asleep. */
  sleepT: number;
  /** Upset Stomach: weapons don't fire while > 0. */
  attackPauseT: number;
  emergencyCd: number;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
}

/** Everything actions, skills, specials, bosses and hazards may touch during a run. */
export interface RunContext {
  /** The Phaser scene (named `world` because Scene#scene is the scene manager plugin). */
  readonly world: Phaser.Scene;
  readonly rng: Rng;
  readonly character: CharacterDef;
  readonly stats: StatBlock;
  readonly mods: ModBlock;
  readonly loadout: Loadout;
  readonly player: PlayerState;
  readonly controls: InputController;
  readonly enemies: EnemySystem;
  readonly hitboxes: HitboxSystem;
  readonly pickups: PickupSystem;
  readonly fx: FxSystem;
  readonly hazards: HazardSystem;
  /** Seconds of run time (pauses don't advance it). */
  readonly runTime: number;

  /** Aim direction including Sake Cup wobble. */
  aimDir(): { x: number; y: number };
  /** The single damage path for player attacks: applies all multipliers, crits and on-hit effects. */
  hitEnemy(e: Enemy, base: number, kx: number, ky: number, knockback: number, effects?: HitEffects, killWeak?: boolean): void;
  hurtPlayer(dmg: number): void;
  healPlayer(amount: number): void;
  isPlayerInvulnerable(): boolean;
  addBuff(id: string, stats: readonly StatModifier[], duration: number, invuln?: boolean): void;
  dashPlayer(dx: number, dy: number, distance: number, time: number): void;
  /** Run an action from content data (skills, Specials, weapons). */
  runAction(action: ActionDef, source: ActionSource): void;
  /** Call `fn` after `delay` seconds of run time. */
  schedule(delay: number, fn: () => void): void;
}

export interface ActionSource {
  /** Multiplier on the action's damage (anvil enhancement, Gatling flurry). */
  dmgMul: number;
  /** True for the character's main attack (Mil Fleur adds extra hits). */
  isMain: boolean;
  /** Fallback colour for effects, as 0xRRGGBB. */
  color: number;
  /** How many times this source has fired (spirals rotate per firing). */
  fireCount: number;
  /** Orbit weapons record when their current set of orbiters expires. */
  onOrbit?: (until: number) => void;
}
