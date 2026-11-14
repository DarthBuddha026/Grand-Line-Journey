/**
 * Persistent meta save. localStorage-backed with export/import to a JSON file,
 * since players can clear browser data. Every storage access is wrapped: storage
 * can be missing or throw (private mode, blocked cookies, quota).
 */

export type HakiSlot = 'observation' | 'armament' | 'conqueror';

export interface SaveData {
  version: 2;
  berries: number;
  bestBounty: Record<string, number>;
  runs: number;
  totalKills: number;
  selectedCharacter: string;
  selectedStage: string;
  /** Characters recruited with Berries (default/achievement unlocks are derived). */
  recruited: string[];
  shop: Record<string, number>;
  charXp: Record<string, number>;
  /** Owned Haki modifiers and their level (1..3). */
  haki: Record<string, number>;
  equippedHaki: Partial<Record<HakiSlot, string>>;
  alliances: string[];
  achievements: string[];
  /** stageId -> characters that cleared it */
  clears: Record<string, string[]>;
}

export const SAVE_KEY = 'grand-line-survivor/save';
const KEY = SAVE_KEY;
/** The game was called Grand Line Journey before; saves under the old key are migrated on load. */
const LEGACY_KEY = 'grand-line-journey/save';
const GAME_ID = 'grand-line-survivor';
const LEGACY_GAME_IDS = ['grand-line-journey'];

export function emptySave(): SaveData {
  return {
    version: 2,
    berries: 0,
    bestBounty: {},
    runs: 0,
    totalKills: 0,
    selectedCharacter: 'luffy',
    selectedStage: 'shells_town',
    recruited: [],
    shop: {},
    charXp: {},
    haki: {},
    equippedHaki: {},
    alliances: [],
    achievements: [],
    clears: {},
  };
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Where loadSave/writeSave go when no store is passed; set by the account layer. */
let activeStore: KeyValueStore | null | undefined;

/**
 * Point every default loadSave/writeSave at `store`: sessionStorage for guests, a
 * server-synced cache for account players. `undefined` restores plain localStorage.
 */
export function useSaveStore(store: KeyValueStore | null | undefined): void {
  activeStore = store;
}

function defaultStore(): KeyValueStore | null {
  if (activeStore !== undefined) return activeStore;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface StampedSave {
  save: string;
  /** ms since epoch of the last write */
  t: number;
}

/**
 * Which copy a signed-in player starts from: the newer of the cloud copy and this
 * device's cache; with neither, the progress carried in (an old local or guest save).
 */
export function chooseSave(cloud: StampedSave | null, local: StampedSave | null, carry: string | null): { save: string | null; source: 'cloud' | 'local' | 'carry' | 'none' } {
  if (cloud && (!local || cloud.t >= local.t)) return { save: cloud.save, source: 'cloud' };
  if (local) return { save: local.save, source: 'local' };
  if (carry) return { save: carry, source: 'carry' };
  return { save: null, source: 'none' };
}

/** Normalise any parsed object (v1 or v2, possibly partial) into a valid v2 save. */
export function migrate(raw: unknown): SaveData {
  const base = emptySave();
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const numRec = (v: unknown) => {
    const out: Record<string, number> = {};
    if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
    return out;
  };
  const clears: Record<string, string[]> = {};
  if (typeof r.clears === 'object' && r.clears !== null) for (const [k, v] of Object.entries(r.clears)) clears[k] = strArr(v);
  const eq: Partial<Record<HakiSlot, string>> = {};
  if (typeof r.equippedHaki === 'object' && r.equippedHaki !== null) {
    for (const slot of ['observation', 'armament', 'conqueror'] as const) {
      const v = (r.equippedHaki as Record<string, unknown>)[slot];
      if (typeof v === 'string') eq[slot] = v;
    }
  }
  return {
    version: 2,
    berries: Math.max(0, Math.floor(num(r.berries, 0))),
    bestBounty: numRec(r.bestBounty),
    runs: num(r.runs, 0),
    totalKills: num(r.totalKills, 0),
    selectedCharacter: str(r.selectedCharacter, base.selectedCharacter),
    selectedStage: str(r.selectedStage, base.selectedStage),
    recruited: strArr(r.recruited),
    shop: numRec(r.shop),
    charXp: numRec(r.charXp),
    haki: numRec(r.haki),
    equippedHaki: eq,
    alliances: strArr(r.alliances),
    achievements: strArr(r.achievements),
    clears,
  };
}

export function loadSave(store: KeyValueStore | null = defaultStore()): SaveData {
  if (!store) return emptySave();
  try {
    const raw = store.getItem(KEY) ?? store.getItem(LEGACY_KEY);
    if (!raw) return emptySave();
    return migrate(JSON.parse(raw));
  } catch {
    return emptySave();
  }
}

export function writeSave(data: SaveData, store: KeyValueStore | null = defaultStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function exportSave(data: SaveData): string {
  return JSON.stringify({ game: GAME_ID, ...data }, null, 2);
}

/** Parse an exported save file; throws on anything that isn't one. */
export function importSave(text: string): SaveData {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (parsed.game !== GAME_ID && !LEGACY_GAME_IDS.includes(String(parsed.game))) throw new Error('Not a Grand Line Survivor save file');
  return migrate(parsed);
}
