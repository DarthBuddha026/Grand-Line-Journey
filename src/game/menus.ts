import {
  ACHIEVEMENTS, ALLIANCES, CHARACTERS, CREWS, ENEMIES, HAKI, MAIN_ATTACKS, SHOP, SKILLS, STAGES, WEAPONS,
} from '../data';
import { exportSave, importSave, emptySave, type SaveData } from '../core/save';
import { buyShop, equipHaki, isStageOpen, isUnlocked, rankFor, RANK_BONUS, RANK_XP, recruit, shopCost, shopLevel } from '../core/meta';
import { formatBounty } from '../core/progression';
import { hex } from '../config';
import type { PanelConfig, PanelItem } from './scenes/PanelScene';
import { weaponIcon } from './icons';

const SHOP_ICON: Record<string, string> = { hp: 'heart', atk: 'sword', spd: 'dash', crit: 'star', haste: 'hourglass', pickup: 'magnet', xp: 'book', rerolls: 'compass', holds: 'card', eliminates: 'skull', revive: 'heart' };

/** Hub station menus. Each returns a PanelConfig that re-reads the save on refresh. */
export interface MenuHost {
  save: SaveData;
  persist(): void;
  startRun(): void;
  reload(save: SaveData): void;
}

const berries = (s: SaveData) => `฿ ${s.berries.toLocaleString('en-US')}`;

export function stageMenu(h: MenuHost): PanelConfig {
  return {
    title: 'Set Sail',
    status: () => `Captain: ${CHARACTERS.get(h.save.selectedCharacter)?.name ?? '?'}   ${berries(h.save)}`,
    items: () =>
      [...STAGES.values()].map((st): PanelItem => {
        const open = isStageOpen(h.save, st.id);
        const clears = h.save.clears[st.id] ?? [];
        const bosses = st.events.filter((e) => e.type === 'boss');
        const mid = bosses.filter((b) => b.role === 'mid').map((b) => ENEMIES.get(b.enemy)?.name);
        const fin = bosses.filter((b) => b.role === 'final').map((b) => ENEMIES.get(b.enemy)?.name);
        return {
          label: `${st.order}. ${st.name}`,
          right: !open ? 'LOCKED' : clears.length ? `Cleared ✓ (${clears.length})` : h.save.selectedStage === st.id ? 'Selected' : '',
          enabled: open,
          color: hex(st.ground.base),
          icon: open ? 'ic_map' : 'ic_skull',
          detail: [
            st.desc,
            '',
            `Mid-boss (10:00): ${mid.join(', ')}`,
            `Final boss (20:00): ${fin.join(' + ')}`,
            st.terrain.some((t) => t.type === 'water') ? 'Seawater: Devil Fruit users are slowed and weakened; others get a small bonus.' : '',
            '',
            open ? 'Press Enter to set sail.' : `Clear stage ${st.order - 1} to unlock.`,
            clears.length ? `Cleared by: ${clears.map((c) => CHARACTERS.get(c)?.name).join(', ')}` : '',
          ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'),
          onSelect: () => {
            h.save.selectedStage = st.id;
            h.persist();
            h.startRun();
          },
        };
      }),
  };
}

export function crewMenu(h: MenuHost): PanelConfig {
  return {
    title: 'Crew Quarters',
    status: () => berries(h.save),
    hint: 'Enter: choose a recruited character, or recruit one for Berries · Esc close',
    items: () => {
      const out: PanelItem[] = [];
      for (const crew of CREWS) {
        out.push({ label: crew.name, header: true });
        for (const c of CHARACTERS.values()) {
          if (c.crew !== crew.id) continue;
          const unlocked = isUnlocked(h.save, c.id);
          const xp = h.save.charXp[c.id] ?? 0;
          const rank = rankFor(xp);
          let right = '';
          if (h.save.selectedCharacter === c.id) right = '★ Selected';
          else if (unlocked) right = `Rank ${rank}`;
          else if (c.unlock.type === 'berries') right = `Recruit ฿${c.unlock.cost}`;
          else if (c.unlock.type === 'achievement') right = `🔒 ${ACHIEVEMENTS.get(c.unlock.id)?.name}`;
          const canBuy = !unlocked && c.unlock.type === 'berries' && h.save.berries >= c.unlock.cost;
          const main = MAIN_ATTACKS.get(c.mainAttack)!;
          const next = RANK_XP[rank] ?? null;
          out.push({
            label: `${c.name}${c.devilFruit ? ' (DF)' : ''}`,
            right,
            color: hex(c.look.body),
            portrait: `player_${c.id}`,
            icon: unlocked ? (c.devilFruit ? 'ic_star' : 'ic_sword') : 'ic_coin',
            enabled: unlocked || canBuy,
            detail: [
              `${c.posterName}`,
              `HP ${c.baseStats.hp} · ATK ×${c.baseStats.atk} · SPD ×${c.baseStats.spd} · CRIT ${Math.round(c.baseStats.crit * 100)}%`,
              c.devilFruit ? 'Devil Fruit user: weak in seawater.' : 'Not a Devil Fruit user: stronger in seawater.',
              '',
              `Main: ${main.name} — ${main.desc}`,
              `Special: ${c.special.name} — ${c.special.desc}`,
              '',
              ...c.skills.map((s) => `• ${SKILLS.get(s)!.name}: ${SKILLS.get(s)!.levels[0].desc}`),
              '',
              `Bounty rank ${rank} (+${Math.round(RANK_BONUS * (rank - 1) * 100)}% ATK & HP)  ·  XP ${xp}${next ? ` / ${next}` : ' (max)'}`,
              `Best bounty: ฿ ${formatBounty(h.save.bestBounty[c.id] ?? 0)}`,
              !unlocked && c.unlock.type === 'achievement' ? `Unlock: ${ACHIEVEMENTS.get(c.unlock.id)?.desc}` : '',
            ].join('\n'),
            onSelect: () => {
              if (!isUnlocked(h.save, c.id) && !recruit(h.save, c.id)) return;
              h.save.selectedCharacter = c.id;
              h.persist();
            },
          });
        }
      }
      return out;
    },
  };
}

export function shopMenu(h: MenuHost): PanelConfig {
  return {
    title: 'Shipwright',
    status: () => berries(h.save),
    items: () =>
      [...SHOP.values()].map((def): PanelItem => {
        const lv = shopLevel(h.save, def.id);
        const maxed = lv >= def.maxLevel;
        const cost = shopCost(def, lv);
        return {
          label: def.name,
          right: maxed ? `Lv ${lv}/${def.maxLevel} · MAX` : `Lv ${lv}/${def.maxLevel} · ฿${cost}`,
          enabled: !maxed && h.save.berries >= cost,
          icon: `ic_${SHOP_ICON[def.id] ?? 'anvil'}`,
          color: maxed ? 0xffcc33 : 0x1fae9f,
          detail: `${def.desc}\n\nCurrent level: ${lv} / ${def.maxLevel}\n${maxed ? 'Fully upgraded.' : `Next level costs ฿${cost}.`}`,
          onSelect: () => {
            if (buyShop(h.save, def.id)) h.persist();
          },
        };
      }),
  };
}

const SLOT_LABEL = { observation: 'Observation', armament: 'Armament', conqueror: "Conqueror's" } as const;

export function hakiMenu(h: MenuHost): PanelConfig {
  return {
    title: 'Haki Dojo',
    status: () =>
      (['observation', 'armament', 'conqueror'] as const)
        .map((s) => `${SLOT_LABEL[s]}: ${HAKI.get(h.save.equippedHaki[s] ?? '')?.name ?? '—'}`)
        .join('   '),
    hint: 'Bosses drop Haki fragments; a second fragment levels a modifier up (max 3) · Enter equip/unequip',
    items: () => {
      const out: PanelItem[] = [];
      for (const slot of ['observation', 'armament', 'conqueror'] as const) {
        out.push({ label: `${SLOT_LABEL[slot]} Haki`, header: true });
        for (const def of HAKI.values()) {
          if (def.slot !== slot) continue;
          const lv = h.save.haki[def.id] ?? 0;
          const equipped = h.save.equippedHaki[slot] === def.id;
          out.push({
            label: lv ? def.name : '??? (not found yet)',
            right: !lv ? '' : equipped ? `Lv ${lv} · EQUIPPED` : `Lv ${lv}`,
            enabled: lv > 0,
            color: lv ? (equipped ? 0xffcc33 : 0x7c4dff) : 0x555555,
            icon: lv ? 'ic_haki' : 'ic_skull',
            detail: lv
              ? def.levels.map((l, i) => `${i + 1 <= lv ? '●' : '○'} Lv ${i + 1}: ${l.desc}`).join('\n')
              : 'Defeat bosses to find Haki fragments.',
            onSelect: () => {
              equipHaki(h.save, def.id);
              h.persist();
            },
          });
        }
      }
      return out;
    },
  };
}

export function boardMenu(h: MenuHost): PanelConfig {
  return {
    title: 'Bounty Board',
    status: () => `${h.save.achievements.length} / ${ACHIEVEMENTS.size} achievements · ${h.save.runs} runs · ${h.save.totalKills.toLocaleString('en-US')} defeated`,
    hint: 'Achievements, records and the Alliance codex · Esc close',
    items: () => {
      const out: PanelItem[] = [{ label: 'Achievements', header: true }];
      for (const a of ACHIEVEMENTS.values()) {
        const done = h.save.achievements.includes(a.id);
        const reward = [a.reward.berries ? `฿${a.reward.berries}` : '', a.reward.unlock ? `unlocks ${CHARACTERS.get(a.reward.unlock)?.name}` : '']
          .filter(Boolean)
          .join(', ');
        out.push({ label: a.name, right: done ? 'Done ✓' : '', enabled: done, icon: done ? 'ic_crown' : 'ic_star', color: done ? 0xffcc33 : 0x555555, detail: `${a.desc}\n\nReward: ${reward}` });
      }
      out.push({ label: 'Best Bounties', header: true });
      for (const c of CHARACTERS.values()) {
        const b = h.save.bestBounty[c.id];
        if (!b) continue;
        out.push({ label: c.name, right: `฿ ${formatBounty(b)}`, color: hex(c.look.body), portrait: `player_${c.id}`, icon: 'ic_poster', detail: `Bounty rank ${rankFor(h.save.charXp[c.id] ?? 0)}` });
      }
      out.push({ label: `Alliance Codex (${h.save.alliances.length}/${ALLIANCES.length})`, header: true });
      for (const a of ALLIANCES) {
        const known = h.save.alliances.includes(a.id);
        const [x, y] = a.recipe!;
        out.push({
          label: known ? a.name : '??? Alliance',
          right: known ? `${WEAPONS.get(x)!.name} + ${WEAPONS.get(y)!.name}` : '',
          color: known ? hex(a.color) : 0x555555,
          icon: known ? weaponIcon(a) : 'ic_skull',
          detail: known
            ? `${a.desc}\n\nRecipe: ${WEAPONS.get(x)!.name} (Lv 7) + ${WEAPONS.get(y)!.name} (Lv 7) + an anvil.`
            : `Recipe unknown. Hint: one ingredient is ${WEAPONS.get(x)!.name}.\nMax two weapons, then use an anvil.`,
        });
      }
      return out;
    },
  };
}

export function logMenu(h: MenuHost): PanelConfig {
  let resetArmed = false;
  return {
    title: "Captain's Log",
    status: () => berries(h.save),
    hint: 'Browsers can clear site data: export your save to keep it safe',
    items: () => [
      {
        label: 'Export save file',
        icon: 'ic_book',
        color: 0x1fae9f,
        detail: 'Download your progress as a .json file.',
        onSelect: () => {
          const blob = new Blob([exportSave(h.save)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `grand-line-survivor-save-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        },
      },
      {
        label: 'Import save file',
        icon: 'ic_map',
        color: 0x1b6fa8,
        detail: 'Load progress from an exported .json file. This replaces your current save.',
        onSelect: () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'application/json,.json';
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              h.reload(importSave(await file.text()));
            } catch (err) {
              window.alert(`Could not import: ${(err as Error).message}`);
            }
          };
          input.click();
        },
      },
      {
        label: resetArmed ? 'Really reset? Press again' : 'Reset all progress',
        right: resetArmed ? '⚠' : '',
        icon: 'ic_skull',
        color: 0xe0303a,
        detail: 'Erase everything: Berries, unlocks, upgrades, Haki and records.',
        onSelect: () => {
          if (!resetArmed) {
            resetArmed = true;
            return;
          }
          resetArmed = false;
          h.reload(emptySave());
        },
      },
      { label: 'About', icon: 'ic_star', color: 0xffcc33, detail: 'Grand Line Survivor — an unofficial, free, non-commercial fan project.\nOne Piece © Eiichiro Oda / Shueisha / Toei Animation.\nAll art in this build is placeholder shapes.' },
    ],
  };
}

