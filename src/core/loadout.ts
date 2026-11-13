import { LIMITS } from '../data';
import type { Rng } from './rng';

/**
 * A run's build: main attack level, weapons (incl. Alliances), items, skills and
 * weapon enhancements. Pure data + rules for level-up offers, Hold, Eliminate and
 * Alliance fusion. Effects are applied by the RunScene, which reads levels from here.
 */

export type Choice =
  | { kind: 'mainAttack'; id: string; level: number }
  | { kind: 'weapon'; id: string; level: number }
  | { kind: 'item'; id: string; level: number }
  | { kind: 'skill'; id: string; level: number }
  | { kind: 'boost'; id: BoostId; level: 0 };

export type BoostId = 'heal' | 'atk' | 'berries';

export interface LoadoutPools {
  weapons: readonly string[];
  items: readonly string[];
  skills: readonly string[];
}

export interface Recipe {
  id: string;
  recipe: readonly [string, string];
}

/** The character's own kit: main attack and skills (vs. shared weapons/items). */
const isKit = (c: Choice): boolean => c.kind === 'mainAttack' || c.kind === 'skill';

export function choiceKey(c: Choice): string {
  return `${c.kind}:${c.id}`;
}

export class Loadout {
  mainAttack: { id: string; level: number };
  readonly weapons = new Map<string, number>();
  readonly items = new Map<string, number>();
  readonly skills = new Map<string, number>(); // 0 = not learned yet
  readonly enhance = new Map<string, number>(); // weapon id -> anvil enhancements
  /** Weapons consumed by an Alliance (never offered again this run). */
  readonly fused = new Set<string>();
  /** Choice keys removed with Eliminate. */
  readonly banned = new Set<string>();
  /** A card kept with Hold; guaranteed in the next level-up if still valid. */
  held: Choice | null = null;

  constructor(mainAttackId: string, skillIds: readonly string[]) {
    this.mainAttack = { id: mainAttackId, level: 1 };
    for (const s of skillIds) this.skills.set(s, 0);
  }

  apply(choice: Choice): void {
    switch (choice.kind) {
      case 'mainAttack':
        this.mainAttack.level = choice.level;
        break;
      case 'weapon':
        this.weapons.set(choice.id, choice.level);
        break;
      case 'item':
        this.items.set(choice.id, choice.level);
        break;
      case 'skill':
        this.skills.set(choice.id, choice.level);
        break;
      case 'boost':
        break; // handled by the caller
    }
  }

  /** Every non-boost upgrade currently available. */
  candidates(pools: LoadoutPools): Choice[] {
    const out: Choice[] = [];
    if (this.mainAttack.level < LIMITS.mainAttackMaxLevel) {
      out.push({ kind: 'mainAttack', id: this.mainAttack.id, level: this.mainAttack.level + 1 });
    }
    for (const id of pools.weapons) {
      if (this.fused.has(id)) continue;
      const lv = this.weapons.get(id);
      if (lv === undefined) {
        if (this.weapons.size < LIMITS.weaponSlots) out.push({ kind: 'weapon', id, level: 1 });
      } else if (lv < LIMITS.weaponMaxLevel) {
        out.push({ kind: 'weapon', id, level: lv + 1 });
      }
    }
    for (const id of pools.items) {
      const lv = this.items.get(id);
      if (lv === undefined) {
        if (this.items.size < LIMITS.itemSlots) out.push({ kind: 'item', id, level: 1 });
      } else if (lv < LIMITS.itemMaxLevel) {
        out.push({ kind: 'item', id, level: lv + 1 });
      }
    }
    for (const id of pools.skills) {
      const lv = this.skills.get(id) ?? 0;
      if (lv < LIMITS.skillMaxLevel) out.push({ kind: 'skill', id, level: lv + 1 });
    }
    return out.filter((c) => !this.banned.has(choiceKey(c)));
  }

  /**
   * Roll `count` distinct choices. Upgrades to owned things are weighted a bit
   * higher so builds come together; `luck` nudges that further. A held card is
   * included first; boosts fill any empty slots. The character's own kit (main
   * attack + skills) always gets one card but at most two, so weapons and items
   * still show up; the cap lifts only when nothing else is left to offer.
   */
  rollChoices(pools: LoadoutPools, rng: Rng, count: number, luck = 0): Choice[] {
    const pool = this.candidates(pools);
    const picked: Choice[] = [];
    const take = (from: Choice[]): boolean => {
      const c = rng.pickWeighted(from, (ch) => (ch.level > 1 ? 1.4 + luck : 1));
      if (!c) return false;
      picked.push(c);
      pool.splice(pool.indexOf(c), 1);
      return true;
    };
    if (this.held) {
      const h = pool.find((c) => choiceKey(c) === choiceKey(this.held!));
      if (h) {
        picked.push(h);
        pool.splice(pool.indexOf(h), 1);
      }
      this.held = null;
    }
    if (picked.length < count && !picked.some(isKit)) take(pool.filter(isKit));
    while (picked.length < count && pool.length > 0) {
      const others = pool.filter((c) => !isKit(c));
      const capped = picked.filter(isKit).length >= LIMITS.kitChoicesMax;
      if (!take(capped && others.length ? others : pool)) break;
    }
    const boosts: BoostId[] = ['heal', 'atk', 'berries'];
    for (let i = 0; picked.length < count && i < boosts.length; i++) picked.push({ kind: 'boost', id: boosts[i], level: 0 });
    return picked;
  }

  /** Random upgrades for a treasure chest (applied directly, no boosts unless nothing is left). */
  rollChest(pools: LoadoutPools, rng: Rng, count: number): Choice[] {
    const out: Choice[] = [];
    for (let i = 0; i < count; i++) {
      // Chests favour upgrading what you own, like HoloCure.
      const pool = this.candidates(pools);
      const owned = pool.filter((c) => c.level > 1 || c.kind === 'mainAttack');
      const from = owned.length && rng.chance(0.75) ? owned : pool;
      const c = from.length ? from[Math.floor(rng.next() * from.length)] : ({ kind: 'boost', id: 'berries', level: 0 } as Choice);
      this.apply(c);
      out.push(c);
    }
    return out;
  }

  /** Alliances whose two components are both at max level. */
  availableFusions(recipes: readonly Recipe[]): Recipe[] {
    return recipes.filter(
      (r) => !this.weapons.has(r.id) && r.recipe.every((w) => this.weapons.get(w) === LIMITS.weaponMaxLevel),
    );
  }

  fuse(r: Recipe): void {
    for (const w of r.recipe) {
      this.weapons.delete(w);
      this.enhance.delete(w);
      this.fused.add(w);
    }
    this.weapons.set(r.id, 1);
  }

  /** Weapons an anvil can enhance. */
  enhanceable(): string[] {
    return [...this.weapons.keys()].filter((w) => (this.enhance.get(w) ?? 0) < LIMITS.maxEnhance);
  }

  enhanceWeapon(id: string): void {
    this.enhance.set(id, Math.min(LIMITS.maxEnhance, (this.enhance.get(id) ?? 0) + 1));
  }
}
