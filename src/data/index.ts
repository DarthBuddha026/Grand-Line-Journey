import charactersJson from './characters.json';
import mainAttacksJson from './mainAttacks.json';
import weaponsJson from './weapons.json';
import itemsJson from './items.json';
import skillsJson from './skills.json';
import enemiesJson from './enemies.json';
import hakiJson from './haki.json';
import shopJson from './shop.json';
import achievementsJson from './achievements.json';
import shellsTown from './stages/shells_town.json';
import alabasta from './stages/alabasta.json';
import eniesLobby from './stages/enies_lobby.json';
import impelDown from './stages/impel_down.json';
import { expandCumulative } from '../core/merge';
import type { ModKey, RunModPatch, StatKey, StatModifier } from '../core/stats';
import type {
  AchievementDef, ActionDef, ActionType, CharacterDef, EnemyDef, HakiDef, ItemDef, ShopUpgradeDef, SkillDef, StageDef, WeaponDef, WeaponLevel,
} from './types';

export * from './types';

/** Level caps from the design plan's "Slots and level caps" table. */
export const LIMITS = {
  mainAttackMaxLevel: 7,
  weaponSlots: 5,
  weaponMaxLevel: 7,
  itemSlots: 6,
  itemMaxLevel: 5,
  skillMaxLevel: 3,
  levelUpChoices: 4,
  /** Level-up cards for the character's own main attack + skills: 1 guaranteed, at most this many. */
  kitChoicesMax: 2,
  hakiMaxLevel: 3,
  maxEnhance: 3,
} as const;

function byId<T extends { id: string }>(list: T[], label: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const entry of list) {
    if (map.has(entry.id)) throw new Error(`Duplicate ${label} id "${entry.id}"`);
    map.set(entry.id, entry);
  }
  return map;
}

// ---- Main attacks: one base level + the standard 7-level growth curve ------

interface MainAttackSource {
  id: string;
  name: string;
  desc: string;
  color: string;
  cooldown: number;
  action: ActionDef;
}

const SIZE_KEYS = ['range', 'size', 'radius', 'length', 'width'] as const;
const round = (n: number) => Math.round(n * 10) / 10;

function scaleAction(a: ActionDef, dmgMul: number, sizeMul: number, countAdd: number): ActionDef {
  const out: ActionDef = { ...a };
  if (out.dmg !== undefined) out.dmg = round(out.dmg * dmgMul);
  for (const k of SIZE_KEYS) if (out[k] !== undefined) out[k] = round((out[k] as number) * sizeMul);
  if (countAdd && out.count !== undefined) out.count += countAdd;
  return out;
}

export function growMainAttack(src: MainAttackSource): WeaponDef {
  const hasCount = src.action.count !== undefined;
  const unit = src.action.type === 'punch' ? 'punch' : src.action.type === 'strike' ? 'strike' : 'projectile';
  const lv = (prev: WeaponLevel, desc: string, dmg = 1, size = 1, count = 0, cd = 1): WeaponLevel => ({
    desc,
    cooldown: round(prev.cooldown * cd * 100) / 100,
    action: scaleAction(prev.action, dmg, size, count),
  });
  const l1: WeaponLevel = { desc: src.desc, cooldown: src.cooldown, action: src.action };
  const l2 = lv(l1, '+20% damage.', 1.2);
  const l3 = lv(l2, 'Bigger, with longer reach.', 1, 1.15);
  const l4 = hasCount ? lv(l3, `+1 ${unit}.`, 1, 1, 1) : lv(l3, '+20% damage.', 1.2);
  const l5 = lv(l4, 'Attacks faster.', 1, 1, 0, 0.85);
  const l6 = lv(l5, '+25% damage, bigger.', 1.25, 1.1);
  const l7 = hasCount ? lv(l6, `Max: +1 ${unit}, +15% damage.`, 1.15, 1, 1) : lv(l6, 'Max: +30% damage.', 1.3);
  return { id: src.id, name: src.name, desc: src.desc, color: src.color, levels: [l1, l2, l3, l4, l5, l6, l7] };
}

// ---- Items: linear per-level scaling with auto-generated descriptions ------

interface ItemSource {
  id: string;
  name: string;
  desc: string;
  color: string;
  base?: { stats?: StatModifier[]; mods?: RunModPatch };
  perLevel?: { stats?: StatModifier[]; mods?: RunModPatch };
  max?: { stats?: StatModifier[]; mods?: RunModPatch };
}

const STAT_LABEL: Record<StatKey, string> = {
  maxHp: 'max HP', atk: 'damage', spd: 'move speed', crit: 'crit chance', haste: 'attack speed',
  pickup: 'pickup range', area: 'attack area', xpGain: 'XP gain', defense: 'defense',
};
const MOD_LABEL: Partial<Record<ModKey, [string, 'pct' | 'num']>> = {
  dodge: ['dodge chance', 'pct'], healMul: ['food healing', 'pct'], revives: ['revive', 'num'], chestRate: ['chest chance', 'pct'],
  chestExtra: ['chance of an extra chest upgrade', 'pct'], chestRarity: ['chance of a rich chest', 'pct'], berryMul: ['Berries', 'pct'],
  spawnMul: ['enemy spawns', 'pct'], critDmg: ['crit damage', 'pct'], aimWobble: ['aim wobble', 'pct'], maxedWeaponDmg: ['damage per max-level weapon', 'pct'],
  shieldMax: ['shield', 'num'], emergencyDash: ['emergency dash charge', 'num'], dfSlow: ['speed for Devil Fruit users', 'pct'], luck: ['luck', 'pct'],
  regen: ['HP regen per second', 'num'],
};

function sign(n: number): string {
  return n >= 0 ? '+' : '−';
}

export function describeEffects(stats: readonly StatModifier[] = [], mods: RunModPatch = {}): string {
  const parts: string[] = [];
  for (const m of stats) {
    const flatIsPct = m.stat !== 'maxHp' && m.stat !== 'pickup';
    if (m.pct) parts.push(`${sign(m.pct)}${Math.round(Math.abs(m.pct) * 100)}% ${STAT_LABEL[m.stat]}`);
    if (m.flat) parts.push(flatIsPct ? `${sign(m.flat)}${Math.round(Math.abs(m.flat) * 100)}% ${STAT_LABEL[m.stat]}` : `${sign(m.flat)}${m.flat} ${STAT_LABEL[m.stat]}`);
  }
  for (const [k, v] of Object.entries(mods)) {
    const label = MOD_LABEL[k as ModKey];
    if (!label || !v) continue;
    if (k === 'dfSlow') parts.push(`−${Math.round(v * 100)}% ${label[0]}`);
    else parts.push(label[1] === 'pct' ? `${sign(v)}${Math.round(Math.abs(v) * 100)}% ${label[0]}` : `${sign(v)}${round(v)} ${label[0]}`);
  }
  return parts.join(', ') + '.';
}

function scaleMods(mods: RunModPatch | undefined, n: number): RunModPatch {
  const out: RunModPatch = {};
  for (const [k, v] of Object.entries(mods ?? {})) out[k as ModKey] = round((v ?? 0) * n * 100) / 100;
  return out;
}

function addMods(a: RunModPatch, b: RunModPatch | undefined): RunModPatch {
  const out: RunModPatch = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k as ModKey] = (out[k as ModKey] ?? 0) + (v ?? 0);
  return out;
}

export function expandItem(src: ItemSource): ItemDef {
  const levels: ItemDef['levels'] = [];
  for (let n = 1; n <= LIMITS.itemMaxLevel; n++) {
    const stats: StatModifier[] = [
      ...(src.base?.stats ?? []),
      ...(src.perLevel?.stats ?? []).map((m) => ({ stat: m.stat, flat: m.flat !== undefined ? round(m.flat * n * 100) / 100 : undefined, pct: m.pct !== undefined ? round(m.pct * n * 100) / 100 : undefined })),
      ...(n === LIMITS.itemMaxLevel ? (src.max?.stats ?? []) : []),
    ];
    let mods = addMods(src.base?.mods ?? {}, scaleMods(src.perLevel?.mods, n));
    if (n === LIMITS.itemMaxLevel) mods = addMods(mods, src.max?.mods);
    levels.push({ desc: describeEffects(stats, mods), stats, mods });
  }
  return { id: src.id, name: src.name, desc: src.desc, color: src.color, levels };
}

// ---- Registries -------------------------------------------------------------

export const CHARACTERS = byId(charactersJson as unknown as CharacterDef[], 'character');
export const MAIN_ATTACKS = byId((mainAttacksJson as unknown as MainAttackSource[]).map(growMainAttack), 'main attack');
export const WEAPONS = byId(
  (weaponsJson as unknown as (Omit<WeaponDef, 'levels'> & { levels: unknown[] })[]).map((w) => ({ ...w, levels: expandCumulative<WeaponLevel>(w.levels) })),
  'weapon',
);
export const ITEMS = byId((itemsJson as unknown as ItemSource[]).map(expandItem), 'item');
export const SKILLS = byId(
  (skillsJson as unknown as (Omit<SkillDef, 'levels'> & { levels: unknown[] })[]).map((s) => ({ ...s, levels: expandCumulative<SkillDef['levels'][number]>(s.levels) })),
  'skill',
);
export const ENEMIES = byId(enemiesJson as unknown as EnemyDef[], 'enemy');
export const HAKI = byId(hakiJson as unknown as HakiDef[], 'haki');
export const SHOP = byId(shopJson as unknown as ShopUpgradeDef[], 'shop upgrade');
export const ACHIEVEMENTS = byId(achievementsJson as unknown as AchievementDef[], 'achievement');
export const STAGES = byId(
  ([shellsTown, alabasta, eniesLobby, impelDown] as unknown as StageDef[]).sort((a, b) => a.order - b.order),
  'stage',
);

/** Regular (non-Alliance) weapons offered on level-up. */
export const BASE_WEAPON_IDS = [...WEAPONS.values()].filter((w) => !w.recipe).map((w) => w.id);
export const ALLIANCES = [...WEAPONS.values()].filter((w) => w.recipe);

/**
 * Each crew is a gacha banner: one pull costs `pullCost` Berries and gives a random gacha
 * member. `tag` and `color` style the banner card in the Recruitment screen.
 */
export const CREWS: { id: string; name: string; tag: string; color: string; pullCost: number }[] = [
  { id: 'straw_hat', name: 'Straw Hat Pirates', tag: 'PIRATES', color: '#e0303a', pullCost: 500 },
  { id: 'world_government', name: 'World Government', tag: 'JUSTICE', color: '#1b6fa8', pullCost: 1500 },
];

const ACTION_TYPES: ActionType[] = [
  'punch', 'cone', 'volley', 'strike', 'pulse', 'orbit', 'sweep', 'zone', 'beam', 'dash', 'blink', 'chain', 'screen', 'buff', 'heal', 'flurry', 'magnet', 'transform', 'multi',
];
export const TEXTURE_KEYS = ['white', 'pellet', 'blade', 'snail', 'poster', 'wave', 'fist', 'ring', 'disc'];
const CUSTOM_HOOKS = ['lost', 'rumbleBall', 'lazyJustice', 'powerNap', 'upsetStomach'];

function checkAction(a: ActionDef | undefined, where: string, problems: string[]): void {
  if (!a) return;
  if (!ACTION_TYPES.includes(a.type)) problems.push(`${where}: unknown action type "${a.type}"`);
  if (a.texture && !TEXTURE_KEYS.includes(a.texture)) problems.push(`${where}: unknown texture "${a.texture}"`);
  checkAction(a.action, `${where}.action`, problems);
  checkAction(a.trail, `${where}.trail`, problems);
  a.actions?.forEach((sub, i) => checkAction(sub, `${where}.actions[${i}]`, problems));
}

/** Cross-reference checks; returns a list of problems (empty when content is valid). */
export function validateContent(): string[] {
  const problems: string[] = [];
  for (const c of CHARACTERS.values()) {
    if (!MAIN_ATTACKS.has(c.mainAttack)) problems.push(`${c.id}: unknown main attack ${c.mainAttack}`);
    if (c.skills.length !== 3) problems.push(`${c.id}: needs exactly 3 skills`);
    for (const s of c.skills) if (!SKILLS.has(s)) problems.push(`${c.id}: unknown skill ${s}`);
    checkAction(c.special.action, `${c.id}.special`, problems);
    if (c.unlock.type === 'achievement' && !ACHIEVEMENTS.has(c.unlock.id)) problems.push(`${c.id}: unknown unlock achievement ${c.unlock.id}`);
    if (!Array.isArray(c.lines) || !c.lines.length || c.lines.some((l) => typeof l !== 'string' || !l.trim())) problems.push(`${c.id}: needs at least one ship line (lines)`);
  }
  for (const w of MAIN_ATTACKS.values()) w.levels.forEach((l, i) => checkAction(l.action, `${w.id}[${i + 1}]`, problems));
  for (const w of WEAPONS.values()) {
    const want = w.recipe ? 1 : LIMITS.weaponMaxLevel;
    if (w.levels.length !== want) problems.push(`${w.id}: needs ${want} levels`);
    w.levels.forEach((l, i) => {
      checkAction(l.action, `${w.id}[${i + 1}]`, problems);
      if (!(l.cooldown > 0)) problems.push(`${w.id}[${i + 1}]: cooldown must be > 0`);
    });
    for (const r of w.recipe ?? []) if (!WEAPONS.has(r) || WEAPONS.get(r)!.recipe) problems.push(`${w.id}: recipe needs base weapon ${r}`);
  }
  for (const it of ITEMS.values()) if (it.levels.length !== LIMITS.itemMaxLevel) problems.push(`${it.id}: needs ${LIMITS.itemMaxLevel} levels`);
  for (const s of SKILLS.values()) {
    if (s.levels.length !== LIMITS.skillMaxLevel) problems.push(`${s.id}: needs ${LIMITS.skillMaxLevel} levels`);
    if (s.trigger === 'custom' && !CUSTOM_HOOKS.includes(s.custom ?? '')) problems.push(`${s.id}: unknown custom hook ${s.custom}`);
    if ((s.trigger === 'periodic' || s.trigger === 'mainAttack') && s.levels.some((l) => !l.every)) problems.push(`${s.id}: needs "every"`);
    s.levels.forEach((l, i) => checkAction(l.action, `${s.id}[${i + 1}]`, problems));
  }
  for (const h of HAKI.values()) if (h.levels.length !== LIMITS.hakiMaxLevel) problems.push(`${h.id}: needs ${LIMITS.hakiMaxLevel} levels`);
  for (const e of ENEMIES.values()) {
    for (const p of e.patterns ?? []) if (p.minion && !ENEMIES.has(p.minion)) problems.push(`${e.id}: unknown minion ${p.minion}`);
  }
  for (const st of STAGES.values()) {
    for (const seg of st.segments) for (const e of seg.enemies) if (!ENEMIES.has(e.id)) problems.push(`${st.id}: unknown enemy ${e.id}`);
    for (const ev of st.events) {
      const def = ENEMIES.get(ev.enemy);
      if (!def) problems.push(`${st.id}: unknown event enemy ${ev.enemy}`);
      else if (ev.type === 'boss' && def.archetype !== 'boss') problems.push(`${st.id}: ${ev.enemy} is not a boss`);
    }
    if (!st.events.some((e) => e.type === 'boss' && e.role === 'final')) problems.push(`${st.id}: needs a final boss`);
  }
  for (const a of ACHIEVEMENTS.values()) {
    if (a.reward.unlock && !CHARACTERS.has(a.reward.unlock)) problems.push(`${a.id}: unknown unlock ${a.reward.unlock}`);
    if (a.cond.type === 'clearStage' && a.cond.stage && !STAGES.has(a.cond.stage)) problems.push(`${a.id}: unknown stage ${a.cond.stage}`);
    if (a.cond.type === 'clearStage' && a.cond.character && !CHARACTERS.has(a.cond.character)) problems.push(`${a.id}: unknown character`);
  }
  return problems;
}
