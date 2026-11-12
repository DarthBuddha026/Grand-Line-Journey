import { ACHIEVEMENTS, ALLIANCES, CHARACTERS, HAKI, LIMITS, SHOP, STAGES, type AchievementDef, type ShopUpgradeDef } from '../data';
import type { RunModPatch, StatModifier } from './stats';
import type { HakiSlot, SaveData } from './save';
import { computeBounty, type RunSummary } from './progression';
import type { Rng } from './rng';

/**
 * Meta progression rules: shop prices, recruitment, bounty ranks, Haki, achievements,
 * and folding a finished run into the save. Pure functions over SaveData.
 */

// ---- Shop ---------------------------------------------------------------------

export function shopLevel(save: SaveData, id: string): number {
  return save.shop[id] ?? 0;
}

export function shopCost(def: ShopUpgradeDef, level: number): number {
  return Math.round(def.baseCost * Math.pow(def.costGrowth, level));
}

export function buyShop(save: SaveData, id: string): boolean {
  const def = SHOP.get(id);
  if (!def) return false;
  const lv = shopLevel(save, id);
  if (lv >= def.maxLevel) return false;
  const cost = shopCost(def, lv);
  if (save.berries < cost) return false;
  save.berries -= cost;
  save.shop[id] = lv + 1;
  return true;
}

export function metaCounts(save: SaveData): { rerolls: number; holds: number; eliminates: number; revives: number } {
  const out = { rerolls: 0, holds: 0, eliminates: 0, revives: 0 };
  for (const def of SHOP.values()) if (def.meta) out[def.meta] += shopLevel(save, def.id);
  return out;
}

// ---- Recruitment -------------------------------------------------------------------

export function isUnlocked(save: SaveData, characterId: string): boolean {
  const c = CHARACTERS.get(characterId);
  if (!c) return false;
  if (c.unlock.type === 'default') return true;
  if (c.unlock.type === 'berries') return save.recruited.includes(characterId);
  return save.achievements.includes(c.unlock.id) || save.recruited.includes(characterId);
}

export function recruit(save: SaveData, characterId: string): boolean {
  const c = CHARACTERS.get(characterId);
  if (!c || c.unlock.type !== 'berries' || isUnlocked(save, characterId)) return false;
  if (save.berries < c.unlock.cost) return false;
  save.berries -= c.unlock.cost;
  save.recruited.push(characterId);
  return true;
}

/** A stage is open once the previous stage (by order) has been cleared by anyone. */
export function isStageOpen(save: SaveData, stageId: string): boolean {
  const st = STAGES.get(stageId);
  if (!st) return false;
  if (st.order === 1) return true;
  const prev = [...STAGES.values()].find((s) => s.order === st.order - 1);
  return !!prev && (save.clears[prev.id]?.length ?? 0) > 0;
}

// ---- Bounty rank (per-character XP) --------------------------------------------

export const RANK_XP = [0, 1500, 5000, 12000, 30000];
export const RANK_BONUS = 0.03; // per rank above 1: +3% damage and max HP

export function rankFor(xp: number): number {
  let r = 1;
  for (let i = 0; i < RANK_XP.length; i++) if (xp >= RANK_XP[i]) r = i + 1;
  return r;
}

export function runCharacterXp(r: RunSummary): number {
  return Math.floor(r.kills + r.timeSec + (r.cleared ? 1000 : 0));
}

// ---- Haki -----------------------------------------------------------------------

export function hakiModifiers(save: SaveData): { stats: StatModifier[]; mods: RunModPatch }[] {
  const out: { stats: StatModifier[]; mods: RunModPatch }[] = [];
  for (const id of Object.values(save.equippedHaki)) {
    if (!id) continue;
    const def = HAKI.get(id);
    const lv = save.haki[id] ?? 0;
    if (!def || lv <= 0) continue;
    const l = def.levels[Math.min(lv, LIMITS.hakiMaxLevel) - 1];
    out.push({ stats: l.stats ?? [], mods: l.mods ?? {} });
  }
  return out;
}

export function equipHaki(save: SaveData, id: string): void {
  const def = HAKI.get(id);
  if (!def || !(save.haki[id] > 0)) return;
  const slot: HakiSlot = def.slot;
  save.equippedHaki[slot] = save.equippedHaki[slot] === id ? undefined : id;
}

/** Pick a fragment for a boss drop: prefer modifiers that can still level up. */
export function rollHakiFragment(save: SaveData, rng: Rng): string | null {
  const options = [...HAKI.values()].filter((h) => (save.haki[h.id] ?? 0) < LIMITS.hakiMaxLevel);
  if (!options.length) return null;
  return options[Math.floor(rng.next() * options.length)].id;
}

// ---- Achievements -------------------------------------------------------------------

function achieved(a: AchievementDef, save: SaveData, r: RunSummary, bounty: number): boolean {
  const c = a.cond;
  switch (c.type) {
    case 'runs':
      return save.runs >= c.n;
    case 'kills':
      return r.kills >= c.n;
    case 'level':
      return r.level >= c.n;
    case 'bounty':
      return bounty >= c.n;
    case 'survive':
      return r.timeSec >= c.sec;
    case 'alliances':
      return save.alliances.length >= c.n;
    case 'clearStage':
      return r.cleared && (!c.stage || r.stageId === c.stage) && (!c.character || r.characterId === c.character);
    case 'clearAll':
      return [...STAGES.keys()].every((s) => (save.clears[s]?.length ?? 0) > 0);
  }
}

export interface RunOutcome {
  bounty: number;
  newBest: boolean;
  berriesEarned: number;
  newAchievements: AchievementDef[];
  newCharacters: string[];
  rankBefore: number;
  rankAfter: number;
  hakiGained: string[];
  alliancesFound: string[];
}

/** Fold a finished run into the save: Berries, records, rank, Haki, Alliances, achievements. */
export function applyRun(save: SaveData, r: RunSummary): RunOutcome {
  const bounty = computeBounty(r);
  const unlockedBefore = new Set([...CHARACTERS.keys()].filter((id) => isUnlocked(save, id)));
  save.runs += 1;
  save.totalKills += r.kills;
  save.berries += r.berries;
  const newBest = bounty > (save.bestBounty[r.characterId] ?? 0);
  if (newBest) save.bestBounty[r.characterId] = bounty;

  const rankBefore = rankFor(save.charXp[r.characterId] ?? 0);
  save.charXp[r.characterId] = (save.charXp[r.characterId] ?? 0) + runCharacterXp(r);
  const rankAfter = rankFor(save.charXp[r.characterId]);

  if (r.cleared) {
    const list = (save.clears[r.stageId] ??= []);
    if (!list.includes(r.characterId)) list.push(r.characterId);
  }
  for (const id of r.hakiFound) save.haki[id] = Math.min(LIMITS.hakiMaxLevel, (save.haki[id] ?? 0) + 1);
  const alliancesFound = r.alliancesFound.filter((id) => !save.alliances.includes(id));
  save.alliances.push(...alliancesFound);

  const newAchievements: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS.values()) {
    if (save.achievements.includes(a.id) || !achieved(a, save, r, bounty)) continue;
    save.achievements.push(a.id);
    save.berries += a.reward.berries ?? 0;
    newAchievements.push(a);
  }
  const newCharacters = [...CHARACTERS.keys()].filter((id) => !unlockedBefore.has(id) && isUnlocked(save, id));
  return { bounty, newBest, berriesEarned: r.berries, newAchievements, newCharacters, rankBefore, rankAfter, hakiGained: r.hakiFound, alliancesFound };
}

export const ALLIANCE_COUNT = ALLIANCES.length;
