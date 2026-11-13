// Exports every tunable number to CSV files in balance/ for spreadsheet tuning.
// Usage: npm run balance
// Loads the real data layer through Vite's SSR loader, so the CSVs show the same
// expanded levels the game uses (main-attack growth curve, item scaling, cumulative levels).
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const d = await server.ssrLoadModule('/src/data/index.ts');
  const out = join(process.cwd(), 'balance');
  mkdirSync(out, { recursive: true });

  const esc = (v) => {
    const s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const write = (name, rows) => {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    writeFileSync(join(out, `${name}.csv`), csv + '\n');
    console.log(`balance/${name}.csv  (${rows.length} rows)`);
  };
  const flatAction = (a, prefix = '') => {
    const o = {};
    for (const [k, v] of Object.entries(a ?? {})) {
      if (k === 'action' || k === 'actions' || k === 'trail') o[prefix + k] = v;
      else if (k === 'effects') for (const [ek, ev] of Object.entries(v)) o[`${prefix}fx_${ek}`] = ev;
      else o[prefix + k] = v;
    }
    return o;
  };

  write('characters', [...d.CHARACTERS.values()].map((c) => ({
    id: c.id, name: c.name, crew: c.crew, devilFruit: c.devilFruit, hp: c.baseStats.hp, atk: c.baseStats.atk, spd: c.baseStats.spd,
    crit: c.baseStats.crit, mainAttack: c.mainAttack, special: c.special.name, specialCooldown: c.special.cooldown,
    specialAction: c.special.action.type, skills: c.skills.join(' / '), unlock: c.unlock.type === 'achievement' ? c.unlock.id : c.unlock.type,
  })));

  const weaponRows = (list, kind) => list.flatMap((w) => w.levels.map((l, i) => ({ kind, id: w.id, name: w.name, level: i + 1, cooldown: l.cooldown, desc: l.desc, ...flatAction(l.action) })));
  write('main_attacks', weaponRows([...d.MAIN_ATTACKS.values()], 'main'));
  write('weapons', weaponRows([...d.WEAPONS.values()], 'weapon').map((r) => ({ ...r, kind: d.WEAPONS.get(r.id).recipe ? `alliance(${d.WEAPONS.get(r.id).recipe.join('+')})` : 'weapon' })));
  write('items', [...d.ITEMS.values()].flatMap((it) => it.levels.map((l, i) => ({ id: it.id, name: it.name, level: i + 1, desc: l.desc, stats: l.stats, mods: l.mods }))));
  write('skills', [...d.SKILLS.values()].flatMap((s) => s.levels.map((l, i) => ({
    id: s.id, name: s.name, trigger: s.trigger, custom: s.custom, level: i + 1, every: l.every, duration: l.duration, desc: l.desc,
    stats: l.stats, mods: l.mods, params: l.params, ...flatAction(l.action, 'action_'),
  }))));
  write('enemies', [...d.ENEMIES.values()].filter((e) => e.archetype !== 'boss').map((e) => ({ ...e })));
  write('bosses', [...d.ENEMIES.values()].filter((e) => e.archetype === 'boss').flatMap((e) => e.patterns.map((p, i) => ({
    id: e.id, name: e.name, hp: i === 0 ? e.hp : '', speed: i === 0 ? e.speed : '', damage: i === 0 ? e.damage : '', pattern: i + 1, ...p,
  }))));
  write('stage_waves', [...d.STAGES.values()].flatMap((st) => [
    ...st.segments.map((s) => ({ stage: st.id, kind: 'segment', from: s.from, to: s.to, rate: s.rate, maxAlive: s.maxAlive, enemies: s.enemies.map((e) => `${e.id}×${e.weight}`).join(' '), hpScalePerMin: st.hpScalePerMin, eliteChance: st.eliteChance })),
    ...st.events.map((e) => ({ stage: st.id, kind: `event:${e.type}${e.role ? `(${e.role})` : ''}`, from: e.at, enemies: `${e.enemy}×${e.count}` })),
  ]));
  write('haki', [...d.HAKI.values()].flatMap((h) => h.levels.map((l, i) => ({ id: h.id, slot: h.slot, name: h.name, level: i + 1, desc: l.desc, stats: l.stats, mods: l.mods }))));
  write('shop', [...d.SHOP.values()].flatMap((s) => Array.from({ length: s.maxLevel }, (_, lv) => ({
    id: s.id, name: s.name, level: lv + 1, cost: Math.round(s.baseCost * Math.pow(s.costGrowth, lv)), stats: s.stats, meta: s.meta,
  }))));
  write('achievements', [...d.ACHIEVEMENTS.values()].map((a) => ({ id: a.id, name: a.name, desc: a.desc, cond: a.cond, berries: a.reward.berries, unlock: a.reward.unlock })));
} finally {
  await server.close();
}
