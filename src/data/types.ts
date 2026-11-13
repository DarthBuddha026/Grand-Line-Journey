import type { ModKey, RunModPatch, StatModifier } from '../core/stats';

/**
 * Content schema. Characters, weapons, items, skills, Haki, enemies, bosses, stages,
 * shop and achievements are plain JSON matching these types. Behaviour is composed
 * from a small library of ACTIONS (src/game/run/actions.ts); content never needs
 * new code unless it introduces a new action type or a `custom` skill hook.
 *
 * Levels are written cumulatively in JSON (see core/merge.ts) and expanded at load.
 */

/** On-hit status effects carried by an action's hits. */
export interface HitEffects {
  burn?: number; // damage per second
  burnTime?: number;
  slow?: number; // fraction of speed removed, 0..1
  slowTime?: number;
  stun?: number; // seconds (also used for freeze / sleep)
  fear?: number; // chance to make the enemy flee for 2 s
  lifesteal?: number; // HP per hit
  vsDF?: number; // +% damage vs Devil Fruit enemies
  pull?: number; // pull strength toward the hit origin
}

export type ActionType =
  | 'punch' // stretching capsule from the player (Gomu Gomu Pistol, thrusts, lunges)
  | 'cone' // arc slash / shockwave sector in front (or behind / all around)
  | 'volley' // projectiles (aimed, at nearest, random, ring, spiral, boomerang)
  | 'strike' // delayed impacts at target spots (lightning, cannonballs, Sea King bites)
  | 'pulse' // expanding ring around the player
  | 'orbit' // things circling the player
  | 'sweep' // rotating capsule around the player (chain whip)
  | 'zone' // persistent area: damage ticks, slow, pull, buff
  | 'beam' // long line from the player
  | 'dash' // player dashes and damages along the path
  | 'blink' // light-speed teleport chain between enemies
  | 'chain' // lightning that jumps between enemies
  | 'screen' // hit every enemy on screen
  | 'buff' // timed stat bonus
  | 'heal'
  | 'flurry' // rapid extra main-attack punches
  | 'magnet' // pull all pickups
  | 'transform' // Special-style form: scale, stats, invulnerability and a periodic sub-action
  | 'multi'; // several actions at once

export type ActionTarget = 'aim' | 'nearest' | 'random' | 'toughest' | 'slowed' | 'player' | 'back';

export interface ActionDef {
  type: ActionType;
  dmg?: number;
  count?: number;
  spread?: number; // degrees between projectiles / punches
  range?: number;
  size?: number;
  radius?: number;
  arc?: number; // cone arc in degrees
  dirs?: number; // cones/beams in N evenly spaced directions
  length?: number;
  width?: number;
  speed?: number;
  pierce?: number;
  duration?: number;
  tick?: number; // seconds between damage ticks for zones/beams/orbits
  delay?: number; // strike telegraph time
  scatter?: number; // strike: random offset around target
  knockback?: number;
  target?: ActionTarget;
  texture?: string;
  color?: string;
  boomerang?: boolean;
  ring?: boolean; // volley: fire evenly in all directions
  spin?: number; // volley ring: rotation added each firing (spiral)
  follow?: boolean; // zone/beam follows the player
  killWeak?: boolean;
  hpCost?: number; // fraction of current HP spent per use (Reject Dial)
  jumps?: number;
  distance?: number;
  scale?: number;
  invuln?: boolean;
  every?: number; // transform: seconds between sub-actions
  frac?: number; // heal fraction
  dmgMul?: number;
  interval?: number;
  stats?: StatModifier[];
  effects?: HitEffects;
  trail?: ActionDef; // dash: zone left along the path
  action?: ActionDef; // transform: periodic sub-action
  actions?: ActionDef[]; // multi
}

export interface WeaponLevel {
  desc: string;
  cooldown: number;
  action: ActionDef;
}

export interface WeaponDef {
  id: string;
  name: string;
  desc: string;
  color: string;
  /** Alliance weapons are created by fusing two max-level weapons with an anvil. */
  recipe?: [string, string];
  levels: WeaponLevel[]; // index 0 = level 1 (after expansion)
}

export interface ItemDef {
  id: string;
  name: string;
  desc: string;
  color: string;
  levels: { desc: string; stats?: StatModifier[]; mods?: RunModPatch }[];
}

export type SkillTrigger = 'passive' | 'periodic' | 'mainAttack' | 'hurt' | 'special' | 'custom';

export interface SkillLevel {
  desc: string;
  stats?: StatModifier[];
  mods?: RunModPatch;
  every?: number; // periodic: seconds; mainAttack: every Nth attack
  duration?: number; // hurt/special: buff length
  action?: ActionDef;
  params?: Record<string, number>; // for custom hooks
}

export interface SkillDef {
  id: string;
  name: string;
  trigger: SkillTrigger;
  /** Name of a custom hook in kits.ts, for behaviours the action library can't express. */
  custom?: string;
  levels: SkillLevel[];
}

export interface CharacterDef {
  id: string;
  name: string;
  posterName: string;
  crew: string;
  devilFruit: boolean;
  captain?: boolean;
  baseStats: { hp: number; atk: number; spd: number; crit: number };
  mainAttack: string;
  special: { id: string; name: string; desc: string; cooldown: number; action: ActionDef };
  skills: string[]; // exactly 3
  /** Things they say when you talk to them on the ship (original lines, 3-4 each). */
  lines: string[];
  /** gacha: pulled from the crew's gacha in Crew Quarters (CREWS.pullCost). */
  unlock: { type: 'default' } | { type: 'gacha' } | { type: 'achievement'; id: string };
  look: { body: string; hair: string; skin?: string; pants?: string; hat?: string; tall?: boolean };
}

export type EnemyArchetype = 'fodder' | 'fast' | 'tank' | 'ranged' | 'boss';

export type BossPatternType = 'charge' | 'radial' | 'aimed' | 'slam' | 'summon' | 'zones' | 'teleport';

export interface BossPattern {
  type: BossPatternType;
  cooldown: number;
  count?: number;
  dmg?: number;
  speed?: number;
  radius?: number;
  telegraph?: number;
  spread?: number;
  minion?: string;
  waves?: number;
  duration?: number;
  color?: string;
}

export interface EnemyDef {
  id: string;
  name: string;
  archetype: EnemyArchetype;
  hp: number;
  speed: number;
  damage: number;
  xp: number;
  radius: number;
  color: string;
  weak?: boolean;
  devilFruit?: boolean;
  knockbackResist?: number; // 0..1
  berryChance?: number;
  meatChance?: number;
  dashSpeed?: number;
  dashEvery?: number;
  dashTime?: number;
  range?: number;
  fireEvery?: number;
  projSpeed?: number;
  projDamage?: number;
  patterns?: BossPattern[]; // bosses
  title?: string; // boss banner subtitle
}

export interface SpawnSegment {
  from: number;
  to: number;
  rate: number;
  maxAlive: number;
  enemies: { id: string; weight: number }[];
}

export interface StageEvent {
  at: number;
  type: 'ring' | 'stampede' | 'boss';
  enemy: string;
  count: number;
  /** boss: 'mid' drops an anvil + Haki fragment; 'final' clears the stage. */
  role?: 'mid' | 'final';
}

export type TerrainType = 'water' | 'quicksand' | 'heat' | 'cold' | 'poison';

export interface TerrainLayer {
  type: TerrainType;
  /** Cycle the layer's type over time (Impel Down's shifting floors). */
  cycle?: TerrainType[];
  period?: number;
  scale: number;
  threshold: number; // noise above this value is terrain
  seed: number;
}

export interface StageHazard {
  type: 'bombard' | 'sandstorm';
  from: number;
  every?: number;
  duration?: number;
  dmg?: number;
  radius?: number;
}

export interface StageDef {
  id: string;
  order: number;
  name: string;
  desc: string;
  durationSec: number;
  hpScalePerMin: number;
  eliteChance: number;
  ground: { base: string; detail: string };
  terrain: TerrainLayer[];
  hazards: StageHazard[];
  segments: SpawnSegment[];
  events: StageEvent[];
}

export interface HakiDef {
  id: string;
  slot: 'observation' | 'armament' | 'conqueror';
  name: string;
  levels: { desc: string; stats?: StatModifier[]; mods?: RunModPatch }[];
}

export interface ShopUpgradeDef {
  id: string;
  name: string;
  desc: string;
  maxLevel: number;
  baseCost: number;
  costGrowth: number;
  stats?: StatModifier[]; // per level
  meta?: 'rerolls' | 'holds' | 'eliminates' | 'revives';
}

export type AchievementCond =
  | { type: 'clearStage'; stage?: string; character?: string }
  | { type: 'kills'; n: number }
  | { type: 'level'; n: number }
  | { type: 'bounty'; n: number }
  | { type: 'runs'; n: number }
  | { type: 'alliances'; n: number }
  | { type: 'survive'; sec: number }
  | { type: 'clearAll' };

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  cond: AchievementCond;
  reward: { berries?: number; unlock?: string };
}

export type { ModKey, RunModPatch, StatModifier };
