/**
 * The single stat pipeline from the design plan:
 *   final = (base + sum of flat) × (1 + sum of pct)
 * Every upgrade (items, skills, timed buffs, meta upgrades, Haki) is a named
 * *source* that contributes modifiers. Replacing a source's modifiers is how levels change.
 */

export const STAT_KEYS = ['maxHp', 'atk', 'spd', 'crit', 'haste', 'pickup', 'area', 'xpGain', 'defense'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export interface StatModifier {
  stat: StatKey;
  flat?: number;
  pct?: number;
}

export type BaseStats = Record<StatKey, number>;

export const DEFAULT_BASE: BaseStats = {
  maxHp: 70,
  atk: 1, // damage multiplier
  spd: 1, // move-speed multiplier
  crit: 0.05, // chance 0..1
  haste: 0, // attack-speed bonus; cooldowns are divided by (1 + haste)
  pickup: 40, // pickup radius in world px
  area: 1, // attack size multiplier
  xpGain: 1,
  defense: 0, // damage reduction fraction 0..0.9
};

export class StatBlock {
  private readonly base: BaseStats;
  private readonly sources = new Map<string, StatModifier[]>();
  private readonly cache = { ...DEFAULT_BASE };
  private dirty = true;

  constructor(base: Partial<BaseStats> = {}) {
    this.base = { ...DEFAULT_BASE, ...base };
  }

  /** Replace all modifiers contributed by `source`. */
  set(source: string, mods: readonly StatModifier[]): void {
    this.sources.set(source, mods as StatModifier[]);
    this.dirty = true;
  }

  remove(source: string): void {
    if (this.sources.delete(source)) this.dirty = true;
  }

  has(source: string): boolean {
    return this.sources.has(source);
  }

  get(stat: StatKey): number {
    if (this.dirty) this.recompute();
    return this.cache[stat];
  }

  private recompute(): void {
    for (const key of STAT_KEYS) {
      let flat = 0;
      let pct = 0;
      for (const mods of this.sources.values()) {
        for (const m of mods) {
          if (m.stat !== key) continue;
          flat += m.flat ?? 0;
          pct += m.pct ?? 0;
        }
      }
      this.cache[key] = (this.base[key] + flat) * (1 + pct);
    }
    this.dirty = false;
  }
}

/**
 * Run modifiers: flags and numbers that are not stats but change rules
 * (dodge chance, healing, chest rate, on-hit burn...). Sources add together.
 */
export const MOD_KEYS = [
  'dodge', // chance to ignore a hit
  'healMul', // +% healing from food
  'revives', // extra lives (revive at 50% HP)
  'chestRate', // +% elite (chest) spawn chance
  'chestExtra', // chance a chest gives one extra upgrade
  'chestRarity', // chance a chest gives the max 3 upgrades
  'berryMul', // +% Berries
  'spawnMul', // +% enemy spawns
  'critDmg', // +crit damage multiplier (base 1.5)
  'aimWobble', // radians of random aim spread
  'maxedWeaponDmg', // +% damage per weapon at max level
  'shieldMax', // shield HP that recharges between hits
  'emergencyDash', // dash away when hit below 30% HP (cooldown seconds; 0 = off)
  'dfSlow', // DF characters lose this much speed (Seastone Cuffs)
  'eliteDmg', // +% damage vs elites and bosses
  'tankDmg', // +% damage vs tanks, elites, bosses
  'farDmg', // +% damage per 100 px of distance
  'burnOnHit', // burn dps applied on hit
  'fearOnHit', // chance to make enemies flee
  'slowOnHit', // slow fraction applied on hit
  'lifesteal', // HP healed per hit
  'selfDrain', // HP lost per hit (Enma)
  'knockbackMul', // +% knockback
  'knockbackImmune', // 1 = no knockback/slow from hits
  'noSlow', // ignore terrain slows
  'seawaterHeals', // seawater heals instead of weakening (Sea Child)
  'ignoreHazards', // ignore terrain hazards
  'waterWalker', // freezes water: no penalty, +speed (Ice Bicycle)
  'foodXp', // food also gives this much XP
  'foodBuff', // food grants a short attack buff
  'lowHpDmg', // up to +% damage at low HP
  'stunnedDmg', // +% damage vs stunned/frozen enemies
  'firstHitBonus', // +% damage on the first hit against each enemy
  'weakContactKill', // chance weak enemies die when touching you
  'specialCharge', // +% Special charge rate
  'extraChoices', // extra level-up cards
  'mainExtraCount', // extra main-attack projectiles/punches
  'magmaPools', // chance a hit leaves burning ground
  'regen', // HP per second
  'telegraphLead', // seconds of extra warning on boss telegraphs
  'eliteRadar', // show off-screen elites and bosses
  'postSpecialInvuln', // seconds of invisibility after a Special
  'hakiPulse', // Conqueror's pulse every N seconds (0 = off)
  'luck', // small bonus to chest and drop rolls
] as const;
export type ModKey = (typeof MOD_KEYS)[number];
export type RunModPatch = Partial<Record<ModKey, number>>;

export class ModBlock {
  private readonly sources = new Map<string, RunModPatch>();
  private readonly cache = Object.fromEntries(MOD_KEYS.map((k) => [k, 0])) as Record<ModKey, number>;
  private dirty = true;

  set(source: string, patch: RunModPatch): void {
    this.sources.set(source, patch);
    this.dirty = true;
  }

  remove(source: string): void {
    if (this.sources.delete(source)) this.dirty = true;
  }

  get(key: ModKey): number {
    if (this.dirty) {
      for (const k of MOD_KEYS) this.cache[k] = 0;
      for (const patch of this.sources.values()) {
        for (const [k, v] of Object.entries(patch)) this.cache[k as ModKey] += v ?? 0;
      }
      this.dirty = false;
    }
    return this.cache[key];
  }
}
