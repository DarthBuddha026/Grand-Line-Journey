import {
  ACHIEVEMENTS, ALLIANCES, CHARACTERS, WEAPONS,
} from '../data';
import { exportSave, importSave, emptySave, type SaveData } from '../core/save';
import { rankFor } from '../core/meta';
import { formatBounty } from '../core/progression';
import { hex } from '../config';
import type { PanelConfig, PanelItem } from './scenes/PanelScene';
import { weaponIcon } from './icons';

/** Main-menu logbook panels (Achievements, Settings). Each returns a PanelConfig that re-reads the save on refresh. */
export interface MenuHost {
  save: SaveData;
  persist(): void;
  startRun(): void;
  reload(save: SaveData): void;
}

const berries = (s: SaveData) => `฿ ${s.berries.toLocaleString('en-US')}`;

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

