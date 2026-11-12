import { describe, expect, it } from 'vitest';
import { applyRun, buyShop, equipHaki, hakiModifiers, isStageOpen, isUnlocked, metaCounts, rankFor, recruit, shopCost } from './meta';
import { computeBounty, xpToNext, type RunSummary } from './progression';
import { emptySave, exportSave, importSave, loadSave, migrate, writeSave, type KeyValueStore } from './save';
import { SHOP } from '../data';

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  characterId: 'luffy', stageId: 'shells_town', timeSec: 600, kills: 500, level: 20, berries: 40,
  cleared: false, hakiFound: [], alliancesFound: [], bossesDefeated: 0, ...over,
});

describe('progression', () => {
  it('xp curve is increasing', () => {
    for (let l = 1; l < 60; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
  });

  it('clearing and bosses raise the bounty', () => {
    expect(computeBounty(run({ cleared: true }))).toBeGreaterThan(computeBounty(run()));
    expect(computeBounty(run({ bossesDefeated: 1 }))).toBeGreaterThan(computeBounty(run()));
    expect(computeBounty(run()) % 1000).toBe(0);
  });
});

describe('save', () => {
  const memStore = (): KeyValueStore => {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
  };

  it('round-trips through storage and export/import', () => {
    const store = memStore();
    const s = emptySave();
    s.berries = 123;
    s.haki.coating = 2;
    writeSave(s, store);
    expect(loadSave(store)).toEqual(s);
    expect(importSave(exportSave(s))).toEqual(s);
    expect(() => importSave('{"berries": 5}')).toThrow();
  });

  it('keeps progress saved under the old Grand Line Journey name', () => {
    const mem = new Map<string, string>([['grand-line-journey/save', JSON.stringify({ ...emptySave(), berries: 77 })]]);
    const store: KeyValueStore = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
    const s = loadSave(store);
    expect(s.berries).toBe(77);
    writeSave(s, store);
    expect(mem.has('grand-line-survivor/save')).toBe(true);
    // Old exported files still import; new exports carry the new name.
    expect(importSave(JSON.stringify({ game: 'grand-line-journey', berries: 5 })).berries).toBe(5);
    expect(exportSave(emptySave())).toContain('"game": "grand-line-survivor"');
  });

  it('migrates a v1 save and survives garbage', () => {
    const v1 = { version: 1, berries: 40, bestBounty: { luffy: 3797000 }, runs: 1 };
    const s = migrate(v1);
    expect(s.version).toBe(2);
    expect(s.berries).toBe(40);
    expect(s.bestBounty.luffy).toBe(3797000);
    expect(migrate('nope')).toEqual(emptySave());
    const bad: KeyValueStore = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
    expect(loadSave(bad)).toEqual(emptySave());
    expect(writeSave(emptySave(), bad)).toBe(false);
  });
});

describe('meta', () => {
  it('shop purchases cost Berries and cap at max level', () => {
    const s = emptySave();
    const def = SHOP.get('revive')!;
    s.berries = shopCost(def, 0);
    expect(buyShop(s, 'revive')).toBe(true);
    expect(s.berries).toBe(0);
    s.berries = 1e9;
    expect(buyShop(s, 'revive')).toBe(false);
    expect(metaCounts(s).revives).toBe(1);
  });

  it('recruits characters and respects achievement unlocks', () => {
    const s = emptySave();
    expect(isUnlocked(s, 'luffy')).toBe(true);
    expect(isUnlocked(s, 'zoro')).toBe(false);
    expect(recruit(s, 'zoro')).toBe(false); // no Berries
    s.berries = 10_000;
    expect(recruit(s, 'zoro')).toBe(true);
    expect(isUnlocked(s, 'zoro')).toBe(true);
    expect(recruit(s, 'jinbe')).toBe(false); // achievement-only
  });

  it('opens stages in order and applies a cleared run', () => {
    const s = emptySave();
    expect(isStageOpen(s, 'shells_town')).toBe(true);
    expect(isStageOpen(s, 'alabasta')).toBe(false);
    const out = applyRun(s, run({ cleared: true, characterId: 'koby', hakiFound: ['coating'], alliancesFound: ['buster_call'] }));
    expect(isStageOpen(s, 'alabasta')).toBe(true);
    expect(out.newAchievements.map((a) => a.id)).toEqual(expect.arrayContaining(['first_voyage', 'east_blue', 'hero_koby', 'alliance_1']));
    expect(out.newCharacters).toContain('garp');
    expect(s.haki.coating).toBe(1);
    expect(s.alliances).toEqual(['buster_call']);
    // achievements are only granted once
    expect(applyRun(s, run({ cleared: true, characterId: 'koby' })).newAchievements.map((a) => a.id)).not.toContain('east_blue');
  });

  it('ranks characters by XP', () => {
    expect(rankFor(0)).toBe(1);
    expect(rankFor(1500)).toBe(2);
    expect(rankFor(1e9)).toBe(5);
  });

  it('equips one Haki per slot', () => {
    const s = emptySave();
    s.haki = { coating: 2, heavy_blows: 1 };
    equipHaki(s, 'coating');
    expect(hakiModifiers(s)[0].mods.firstHitBonus).toBe(0.75);
    equipHaki(s, 'heavy_blows'); // same slot: replaces
    expect(s.equippedHaki.armament).toBe('heavy_blows');
    equipHaki(s, 'future_sight'); // not owned
    expect(s.equippedHaki.observation).toBeUndefined();
  });
});
