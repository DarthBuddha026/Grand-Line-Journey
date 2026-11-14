import Phaser from 'phaser';
import { ACHIEVEMENTS, CHARACTERS, CREWS, ENEMIES, HAKI, LIMITS, MAIN_ATTACKS, SKILLS, STAGES, type CharacterDef } from '../../data';
import { isStageOpen, isUnlocked, rankFor, RANK_BONUS } from '../../core/meta';
import { loadSave, writeSave, type HakiSlot, type SaveData } from '../../core/save';
import { GAME_W, hex } from '../../config';
import { backdrop, burst, Button, C, CSS, display, gauge, hintRow, inkPanel, label, medallion, speedLines } from '../ui';
import { centerCamera, relayoutOnResize } from '../layout';
import { CHAR_TEX, TEX } from '../textures';
import { actionIcon, weaponIcon } from '../icons';
import type { RunMode } from './RunScene';

type Phase = 'character' | 'haki' | 'mode' | 'stage';

export interface SailData {
  phase?: Phase;
  mode?: RunMode;
}

const MODES: { id: RunMode | 'time'; name: string; desc: string; soon?: boolean }[] = [
  { id: 'stage', name: 'STAGE MODE', desc: 'Defeat the final boss to free the island and clear the stage!' },
  { id: 'endless', name: 'ENDLESS MODE', desc: 'Beat the final boss, then keep sailing for as long as you can survive!' },
  { id: 'time', name: 'TIME MODE', desc: 'Complete special objectives as fast as possible!', soon: true },
];

const INFO_X = 40;
const INFO_W = 1200;
const COL2 = 470;
const COL3 = 860;
const TILE = { w: 104, h: 110, gap: 8 };
/** Face close-up on a captain tile: crop width = head width × this, in portrait-texture pixels. */
const FACE_ZOOM = 1.25;
/** Per-portrait overrides (lower = closer), e.g. Luffy, whose wide hat would otherwise zoom out. */
const FACE_ZOOM_BY_KEY: Record<string, number> = { player_luffy: 0.85, player_usopp: 0.9, player_chopper: 0.8, player_franky: 0.5, player_brook: 1.0 };

/** Where a portrait's head is: top opaque row and the head's horizontal centre (cached per texture). */
const faces = new Map<string, { top: number; cx: number; w: number; crop: number }>();
function faceOf(scene: Phaser.Scene, key: string): { top: number; cx: number; w: number; crop: number } {
  let f = faces.get(key);
  if (f) return f;
  const src = scene.textures.get(key).getSourceImage() as CanvasImageSource & { width: number; height: number };
  const w = src.width, h = src.height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const a = ctx.getImageData(0, 0, w, h).data;
  const opaque = (x: number, y: number) => a[(y * w + x) * 4 + 3] > 60;
  let top = 0;
  find: for (let y = 0; y < h; y++) for (let x = 0; x < w; x += 2) if (opaque(x, y)) { top = y; break find; }
  let sx = 0, n = 0, x0 = w, x1 = 0;
  for (let y = top; y < Math.min(h, top + 90); y += 3) for (let x = 0; x < w; x += 3) if (opaque(x, y)) { sx += x; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  f = { top, cx: n ? sx / n : w / 2, w, crop: Phaser.Math.Clamp((x1 - x0) * (FACE_ZOOM_BY_KEY[key] ?? FACE_ZOOM), 80, w) };
  faces.set(key, f);
  return f;
}
/** Locked captains: a slate tile with a dark silhouette, so the shape still reads. */
const LOCKED = { tile: 0x5a7590, shape: 0x101c28 } as const;

const chars = [...CHARACTERS.values()];
const ROWS: CharacterDef[][] = CREWS.map((cr) => chars.filter((c) => c.crew === cr.id));
const STAGE_LIST = [...STAGES.values()];
const SLOTS: { id: HakiSlot; name: string; color: number }[] = [
  { id: 'observation', name: 'Observation', color: C.seaMid },
  { id: 'armament', name: 'Armament', color: C.ink },
  { id: 'conqueror', name: "Conqueror's", color: C.red },
];
const MAX = {
  hp: Math.max(...chars.map((c) => c.baseStats.hp)),
  atk: Math.max(...chars.map((c) => c.baseStats.atk)),
  spd: Math.max(...chars.map((c) => c.baseStats.spd)),
  crit: Math.max(...chars.map((c) => c.baseStats.crit)),
};

/**
 * Set Sail: choose your captain (a crew-by-crew portrait grid), equip Haki (only once you own
 * some), then a mode, then a stage.
 * The captain's card (stats, main attack, Special) stays on screen for the later steps.
 */
export class SailScene extends Phaser.Scene {
  private save!: SaveData;
  private phase: Phase = 'character';
  private row = 0;
  private col = 0;
  private modeIdx = 0;
  private stageIdx = 0;
  private hakiSlot = 0;
  private layer!: Phaser.GameObjects.Container;
  private leaving = false;
  private padPrev = { l: true, r: true, u: true, d: true, a: true, b: true };

  constructor() {
    super('sail');
  }

  init(d: SailData): void {
    this.save = loadSave();
    this.phase = d.phase ?? 'character';
    this.modeIdx = Math.max(0, MODES.findIndex((m) => m.id === (d.mode ?? 'stage')));
    this.row = Math.max(0, ROWS.findIndex((r) => r.some((c) => c.id === this.save.selectedCharacter)));
    this.col = Math.max(0, ROWS[this.row].findIndex((c) => c.id === this.save.selectedCharacter));
    this.stageIdx = Math.max(0, STAGE_LIST.findIndex((s) => s.id === this.save.selectedStage));
    this.leaving = false;
    this.padPrev = { l: true, r: true, u: true, d: true, a: true, b: true };
  }

  create(): void {
    const box = centerCamera(this);
    relayoutOnResize(this, () => ({ phase: this.phase, mode: MODES[this.modeIdx].id }));
    this.cameras.main.setBackgroundColor(C.seaDeep).fadeIn(200, 8, 37, 65);
    backdrop(this, box.w, box.h, 1).setPosition(box.left, box.top);
    const rays = this.add.graphics();
    speedLines(rays, GAME_W / 2, 470, 120, Math.max(box.w, box.h) * 1.2, 40, C.seaLight, 0.07);
    rays.fillStyle(C.ink, 0.6).fillRect(box.left, 690, box.w, box.bottom - 690);
    this.layer = this.add.container(0, 0);

    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      const k = ev.code;
      if (k === 'ArrowLeft' || k === 'KeyA') this.nav(-1, 0);
      else if (k === 'ArrowRight' || k === 'KeyD') this.nav(1, 0);
      else if (k === 'ArrowUp' || k === 'KeyW') this.nav(0, -1);
      else if (k === 'ArrowDown' || k === 'KeyS') this.nav(0, 1);
      else if (k === 'Enter' || k === 'Space' || k === 'KeyZ' || k === 'KeyE') this.confirm();
      else if (k === 'Escape' || k === 'KeyX' || k === 'Backspace') this.back();
    });
    this.render();
  }

  update(): void {
    const pad = this.input.gamepad?.total ? this.input.gamepad.pad1 : undefined;
    if (!pad) return;
    const s = pad.leftStick;
    const now = { l: pad.left || s.x < -0.5, r: pad.right || s.x > 0.5, u: pad.up || s.y < -0.5, d: pad.down || s.y > 0.5, a: pad.A, b: pad.B };
    const p = this.padPrev;
    if (now.l && !p.l) this.nav(-1, 0);
    if (now.r && !p.r) this.nav(1, 0);
    if (now.u && !p.u) this.nav(0, -1);
    if (now.d && !p.d) this.nav(0, 1);
    if (now.a && !p.a) this.confirm();
    if (now.b && !p.b) this.back();
    this.padPrev = now;
  }

  // ---- Flow -------------------------------------------------------------------------------

  private get character(): CharacterDef {
    return ROWS[this.row][this.col];
  }

  private nav(dx: number, dy: number): void {
    if (this.leaving) return;
    if (this.phase === 'character') {
      if (dy) {
        this.row = (this.row + dy + ROWS.length) % ROWS.length;
        this.col = Math.min(this.col, ROWS[this.row].length - 1);
      } else this.col = (this.col + dx + ROWS[this.row].length) % ROWS[this.row].length;
    } else if (this.phase === 'haki') {
      if (dx) this.hakiSlot = (this.hakiSlot + dx + SLOTS.length) % SLOTS.length;
      else this.cycleHaki(this.hakiSlot, dy);
    } else if (this.phase === 'mode') {
      if (!dx) return;
      this.modeIdx = (this.modeIdx + dx + MODES.length) % MODES.length;
    } else {
      if (!dx) return;
      this.stageIdx = (this.stageIdx + dx + STAGE_LIST.length) % STAGE_LIST.length;
    }
    this.render();
  }

  private confirm(): void {
    if (this.leaving) return;
    if (this.phase === 'character') {
      if (!isUnlocked(this.save, this.character.id)) return this.deny();
      this.save.selectedCharacter = this.character.id;
      writeSave(this.save);
      this.phase = this.ownsHaki() ? 'haki' : 'mode';
    } else if (this.phase === 'haki') {
      this.phase = 'mode';
    } else if (this.phase === 'mode') {
      if (MODES[this.modeIdx].soon) return this.deny();
      this.phase = 'stage';
    } else {
      const st = STAGE_LIST[this.stageIdx];
      if (!isStageOpen(this.save, st.id)) return this.deny();
      this.save.selectedStage = st.id;
      writeSave(this.save);
      this.leaving = true;
      this.cameras.main.fadeOut(300, 8, 37, 65);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
        this.scene.start('run', { characterId: this.save.selectedCharacter, stageId: st.id, mode: MODES[this.modeIdx].id as RunMode }),
      );
      return;
    }
    this.render();
    this.cameras.main.flash(90, 255, 230, 140);
  }

  private back(): void {
    if (this.leaving) return;
    if (this.phase === 'stage') this.phase = 'mode';
    else if (this.phase === 'mode') this.phase = this.ownsHaki() ? 'haki' : 'character';
    else if (this.phase === 'haki') this.phase = 'character';
    else {
      this.leaving = true;
      this.cameras.main.fadeOut(200, 8, 37, 65);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('title'));
      return;
    }
    this.render();
  }

  private deny(): void {
    this.cameras.main.shake(140, 0.004);
  }

  /** The Haki step only appears once the player has found at least one Haki. */
  private ownsHaki(): boolean {
    return [...HAKI.values()].some((h) => (this.save.haki[h.id] ?? 0) > 0);
  }

  /** Cycle a slot through "none" and the owned Haki for it; saved straight away. */
  private cycleHaki(slot: number, d: number): void {
    if (!d) return;
    const id = SLOTS[slot].id;
    const options: (string | undefined)[] = [undefined, ...[...HAKI.values()].filter((h) => h.slot === id && (this.save.haki[h.id] ?? 0) > 0).map((h) => h.id)];
    if (options.length < 2) return this.deny();
    const i = options.indexOf(this.save.equippedHaki[id]);
    const next = options[(Math.max(0, i) + d + options.length) % options.length];
    if (next) this.save.equippedHaki[id] = next;
    else delete this.save.equippedHaki[id];
    writeSave(this.save);
  }

  // ---- Drawing ----------------------------------------------------------------------------

  private render(): void {
    this.layer.removeAll(true);
    const c = this.character;
    // Big faded captain either side, behind everything
    for (const side of [-1, 1]) {
      const big = this.add.image(GAME_W / 2 + side * 545, 690, `player_${c.id}`).setOrigin(0.5, 1).setScale(15 / CHAR_TEX).setAlpha(0.18).setFlipX(side > 0);
      this.layer.add(big);
    }
    if (this.phase === 'character') {
      this.drawGrid();
      this.drawInfo(c, 380, 270);
      this.hints([['←→↑↓', 'Captain'], ['Enter', 'Confirm'], ['Esc', 'Back']]);
    } else {
      this.drawInfo(c, 16, 214);
      if (this.phase === 'haki') this.drawHaki();
      else if (this.phase === 'mode') this.drawModes();
      else this.drawStage();
      if (this.phase === 'haki') this.hints([['←→', 'Slot'], ['↑↓', 'Change'], ['Enter', 'Confirm'], ['Esc', 'Back']]);
      else this.hints([['←→', this.phase === 'mode' ? 'Mode' : 'Stage'], ['Enter', this.phase === 'mode' ? 'Confirm' : 'Set sail'], ['Esc', 'Back']]);
    }
  }

  private hints(h: [string, string][]): void {
    this.layer.add(hintRow(this, GAME_W / 2, 705, h, CSS.white));
  }

  private title(y: number, text: string): void {
    this.layer.add(display(this, GAME_W / 2, y, text, 46).setOrigin(0.5));
  }

  private drawGrid(): void {
    this.title(44, 'CHOOSE YOUR CAPTAIN');
    const g = this.add.graphics();
    this.layer.add(g);
    ROWS.forEach((members, r) => {
      const y = 104 + r * (TILE.h + 30);
      const rowW = members.length * (TILE.w + TILE.gap) - TILE.gap;
      const x0 = GAME_W / 2 - rowW / 2;
      this.layer.add(label(this, x0, y - 22, CREWS[r].name, 14, { color: CSS.goldLight }).setOrigin(0, 0));
      members.forEach((c, k) => {
        const x = x0 + k * (TILE.w + TILE.gap);
        const have = isUnlocked(this.save, c.id);
        const on = r === this.row && k === this.col;
        inkPanel(g, x, y, TILE.w, TILE.h, {
          fill: have ? hex(c.look.body) : LOCKED.tile,
          alpha: have ? 0.85 : 1,
          radius: 4,
          shadow: 4,
          stroke: on ? 5 : 3,
          strokeColor: on ? C.gold : C.ink,
        });
        g.fillStyle(0xffffff, 0.12).fillRect(x + 3, y + 3, TILE.w - 6, TILE.h * 0.35);
        // Face close-up: crop the portrait texture to a box around the head.
        const key = `player_${c.id}`;
        const f = faceOf(this, key);
        const iw = TILE.w - 6, ih = TILE.h - 6;
        const cw = f.crop, ch = (cw * ih) / iw, s = iw / cw;
        const cx0 = Phaser.Math.Clamp(f.cx - cw / 2, 0, f.w - cw);
        const cy0 = Math.max(0, f.top - 8);
        const img = this.add.image(x + 3 - cx0 * s, y + 3 - cy0 * s, key).setOrigin(0, 0).setScale(s).setCrop(cx0, cy0, cw, ch);
        this.layer.add(img);
        if (!have) {
          img.setTint(LOCKED.shape).setTintMode(Phaser.TintModes.FILL);
          this.layer.add(display(this, x + TILE.w / 2, y + TILE.h * 0.45, '?', 34, { color: CSS.gold }).setOrigin(0.5));
        }
        if (on) {
          const sel = this.add.graphics();
          sel.lineStyle(3, 0xffffff, 0.9).strokeRoundedRect(x - 5, y - 5, TILE.w + 10, TILE.h + 10, 6);
          this.layer.add(sel);
        }
        const zone = this.add.zone(x + TILE.w / 2, y + TILE.h / 2, TILE.w, TILE.h).setInteractive({ useHandCursor: true });
        zone.on('pointerover', () => {
          if (this.row === r && this.col === k) return;
          this.row = r;
          this.col = k;
          this.render();
        });
        zone.on('pointerdown', () => this.confirm());
        this.layer.add(zone);
      });
    });
  }

  /** The captain's card: header strip (name · main attack · Special) over three columns. */
  private drawInfo(c: CharacterDef, y: number, bodyH: number): void {
    const g = this.add.graphics();
    this.layer.add(g);
    const have = isUnlocked(this.save, c.id);
    inkPanel(g, INFO_X, y + 40, INFO_W, bodyH, { fill: C.seaDeep, alpha: 0.92, radius: 4, shadow: 6, stroke: 3 });
    inkPanel(g, INFO_X, y, INFO_W, 44, { fill: C.parch, radius: 4, shadow: 0, stroke: 3 });
    g.lineStyle(2, C.seaLight, 0.5).lineBetween(COL2, y + 52, COL2, y + 32 + bodyH).lineBetween(COL3, y + 52, COL3, y + 32 + bodyH);

    const main = MAIN_ATTACKS.get(c.mainAttack)!;
    this.layer.add(display(this, INFO_X + 20, y + 22, c.name.toUpperCase(), 24, { shadow: null, color: CSS.ink, stroke: CSS.parch }).setOrigin(0, 0.5));
    for (const [x, icon, name] of [
      [COL2 + 14, weaponIcon(main), main.name],
      [COL3 + 14, actionIcon(c.special.action.type), c.special.name],
    ] as const) {
      medallion(g, x + 14, y + 22, 14, C.red);
      this.layer.add(this.add.image(x + 14, y + 22, icon).setScale(0.4 / TEX));
      this.layer.add(label(this, x + 40, y + 22, name, 18, { onDark: false, color: CSS.ink }).setOrigin(0, 0.5));
    }

    // Column 1: portrait, clears, bounty rank and stat bars
    const by = y + 40;
    const px = INFO_X + 104;
    medallion(g, px, by + 72, 50, have ? hex(c.look.body) : LOCKED.tile);
    const portrait = this.add.image(px, by + 112, `player_${c.id}`).setOrigin(0.5, 1).setScale(3.9 / CHAR_TEX);
    if (!have) portrait.setTint(LOCKED.shape).setTintMode(Phaser.TintModes.FILL);
    this.layer.add(portrait);
    const clears = STAGE_LIST.filter((s) => this.save.clears[s.id]?.includes(c.id)).length;
    medallion(g, INFO_X + 26, by + 26, 14, C.gold);
    this.layer.add(this.add.image(INFO_X + 26, by + 26, 'ic_crown').setScale(0.4 / TEX));
    this.layer.add(display(this, INFO_X + 26, by + 56, `${clears}`, 20, { shadow: null, color: CSS.gold }).setOrigin(0.5));
    const rank = rankFor(this.save.charXp[c.id] ?? 0);
    for (let i = 0; i < 5; i++) burst(g, px - 44 + i * 22, by + 150, 9, 5, i < rank ? C.gold : 0x2a3f55, -Math.PI / 2);
    this.layer.add(label(this, px, by + 176, have ? `Bounty rank ${rank}  (+${Math.round(RANK_BONUS * (rank - 1) * 100)}%)` : this.lockText(c), 13, { color: have ? CSS.gold : '#ff8a80', style: { align: 'center', wordWrap: { width: 160 } } }).setOrigin(0.5, 0));

    const st = c.baseStats;
    const rows: [string, string, number, string][] = [
      ['ic_heart', 'HP', st.hp / MAX.hp, `${st.hp}`],
      ['ic_sword', 'ATK', st.atk / MAX.atk, `×${st.atk.toFixed(2)}`],
      ['ic_dash', 'SPD', st.spd / MAX.spd, `×${st.spd.toFixed(2)}`],
      ['ic_star', 'CRIT', st.crit / MAX.crit, `${Math.round(st.crit * 100)}%`],
    ];
    const sx = INFO_X + 196;
    rows.forEach(([icon, name, frac, value], i) => {
      const ry = by + 30 + i * 38;
      this.layer.add(this.add.image(sx, ry, icon).setScale(0.42 / TEX));
      this.layer.add(label(this, sx + 20, ry, name, 14).setOrigin(0, 0.5));
      gauge(g, sx + 62, ry - 7, 110, 14, frac, C.seaLight, { skew: 6 });
      this.layer.add(label(this, COL2 - 14, ry, value, 15, { color: CSS.goldLight }).setOrigin(1, 0.5));
    });

    // Column 2: main attack + skills. Column 3: Special.
    const wrap = { wordWrap: { width: COL3 - COL2 - 40 }, lineSpacing: 4 };
    this.layer.add(label(this, COL2 + 20, by + 16, main.desc, 16, { weight: 500, style: wrap }));
    if (bodyH > 230) {
      this.layer.add(label(this, COL2 + 20, by + 120, 'Skills', 14, { color: CSS.goldLight }));
      this.layer.add(label(this, COL2 + 20, by + 144, c.skills.map((s) => `• ${SKILLS.get(s)?.name ?? s}`).join('\n'), 15, { weight: 500, style: { lineSpacing: 4 } }));
    }
    this.layer.add(label(this, COL3 + 20, by + 16, `${c.special.desc}\n\nCooldown ${c.special.cooldown}s`, 16, { weight: 500, style: { wordWrap: { width: INFO_X + INFO_W - COL3 - 40 }, lineSpacing: 4 } }));
  }

  private lockText(c: CharacterDef): string {
    if (c.unlock.type === 'achievement') return `LOCKED · ${ACHIEVEMENTS.get(c.unlock.id)?.name ?? ''}`;
    return 'LOCKED · Nakama in the Shop';
  }

  /** Three slot cards; each shows the equipped Haki (or none), its level and current effect. */
  private drawHaki(): void {
    this.title(300, 'EQUIP HAKI');
    this.layer.add(label(this, GAME_W / 2, 336, 'Bosses drop Haki fragments; a second fragment levels a Haki up.', 15, { color: CSS.goldLight }).setOrigin(0.5));
    const g = this.add.graphics();
    this.layer.add(g);
    SLOTS.forEach((s, i) => {
      const w = 360;
      const h = 250;
      const x = GAME_W / 2 + (i - 1) * (w + 30) - w / 2;
      const y = 380;
      const on = i === this.hakiSlot;
      const id = this.save.equippedHaki[s.id];
      const def = id ? HAKI.get(id) : undefined;
      const lv = def ? Math.min(this.save.haki[def.id] ?? 0, LIMITS.hakiMaxLevel) : 0;
      const owned = [...HAKI.values()].filter((d) => d.slot === s.id && (this.save.haki[d.id] ?? 0) > 0).length;
      inkPanel(g, x, y, w, h, { fill: on ? C.seaMid : C.seaDeep, alpha: 0.95, radius: 6, shadow: 6, stroke: on ? 5 : 3, strokeColor: on ? C.gold : C.ink });
      g.lineStyle(3, on ? C.goldLight : C.seaLight, owned ? 0.8 : 0.3).strokeRoundedRect(x + 8, y + 8, w - 16, h - 16, 4);
      medallion(g, x + 44, y + 44, 24, def ? C.violet : 0x2a3f55);
      this.layer.add(this.add.image(x + 44, y + 44, 'ic_haki').setScale(0.55 / TEX).setAlpha(def ? 1 : 0.4));
      this.layer.add(display(this, x + 80, y + 30, s.name, 22, { shadow: null }).setOrigin(0, 0.5));
      this.layer.add(label(this, x + 80, y + 58, `${owned} owned`, 13, { color: '#9fb7cc', weight: 500 }).setOrigin(0, 0.5));
      g.lineStyle(2, C.white, 0.5).lineBetween(x + 24, y + 84, x + w - 24, y + 84);
      if (def) {
        this.layer.add(display(this, x + w / 2, y + 112, def.name, 24, { shadow: null, color: CSS.goldLight }).setOrigin(0.5));
        for (let k = 0; k < LIMITS.hakiMaxLevel; k++) burst(g, x + w / 2 - 22 + k * 22, y + 144, 9, 5, k < lv ? C.gold : 0x2a3f55, -Math.PI / 2);
        this.layer.add(label(this, x + w / 2, y + 166, def.levels[lv - 1].desc, 15, { weight: 500, style: { align: 'center', wordWrap: { width: w - 50 } } }).setOrigin(0.5, 0));
      } else {
        this.layer.add(display(this, x + w / 2, y + 120, '— none —', 22, { shadow: null, color: '#9fb7cc' }).setOrigin(0.5));
        this.layer.add(label(this, x + w / 2, y + 160, owned ? '↑↓ or click to equip' : 'None found for this slot yet', 14, { color: '#9fb7cc', weight: 500 }).setOrigin(0.5));
      }
      const zone = this.add.zone(x + w / 2, y + h / 2, w, h).setInteractive({ useHandCursor: owned > 0 });
      zone.on('pointerover', () => {
        if (this.hakiSlot === i) return;
        this.hakiSlot = i;
        this.render();
      });
      zone.on('pointerdown', () => {
        this.hakiSlot = i;
        this.cycleHaki(i, 1);
        this.render();
      });
      this.layer.add(zone);
    });
  }

  private drawModes(): void {
    this.title(318, 'CHOOSE MODE');
    const g = this.add.graphics();
    this.layer.add(g);
    MODES.forEach((m, i) => {
      const w = 360;
      const h = 170;
      const x = GAME_W / 2 + (i - 1) * (w + 30) - w / 2;
      const y = 400;
      const on = i === this.modeIdx;
      inkPanel(g, x, y, w, h, { fill: on ? C.seaMid : C.seaDeep, alpha: 0.95, skew: 0, radius: 6, shadow: 6, stroke: on ? 5 : 3, strokeColor: on ? C.gold : C.ink });
      g.lineStyle(3, on ? C.goldLight : C.seaLight, m.soon ? 0.3 : 0.8).strokeRoundedRect(x + 8, y + 8, w - 16, h - 16, 4);
      g.lineStyle(2, C.white, 0.6).lineBetween(x + 24, y + 58, x + w - 24, y + 58);
      const name = display(this, x + w / 2, y + 34, m.name, 26, { shadow: null }).setOrigin(0.5);
      const desc = label(this, x + w / 2, y + 68, m.desc, 16, { weight: 500, style: { align: 'center', wordWrap: { width: w - 50 }, lineSpacing: 4 } }).setOrigin(0.5, 0);
      if (m.soon) {
        name.setAlpha(0.45);
        desc.setAlpha(0.45);
        // 'To Be Continued' stamp (src/assets/art/to_be_continued.png) over the dimmed card
        const stamp = this.add.image(x + w / 2, y + h - 36, 'art_to_be_continued').setAngle(-6);
        stamp.setScale(176 / stamp.width); // below the title, overhanging the card's bottom edge
        this.layer.add(stamp);
      }
      const zone = this.add.zone(x + w / 2, y + h / 2, w, h).setInteractive({ useHandCursor: !m.soon });
      zone.on('pointerover', () => {
        if (this.modeIdx === i) return;
        this.modeIdx = i;
        this.render();
      });
      zone.on('pointerdown', () => this.confirm());
      this.layer.add([name, desc, zone]);
    });
  }

  private drawStage(): void {
    const st = STAGE_LIST[this.stageIdx];
    const open = isStageOpen(this.save, st.id);
    const cleared = this.save.clears[st.id] ?? [];
    this.title(300, 'CHOOSE STAGE');
    this.layer.add(label(this, GAME_W / 2, 336, MODES[this.modeIdx].name, 15, { color: CSS.goldLight }).setOrigin(0.5));

    // Preview: the stage's own ground texture, framed, with arrows either side
    const P = { x: 230, y: 400, w: 380, h: 220 };
    this.layer.add(label(this, P.x, P.y - 30, `STAGE ${st.order} – ${st.name}`, 20).setOrigin(0, 0));
    const ground = this.add.tileSprite(P.x + P.w / 2, P.y + P.h / 2, P.w, P.h, `ground_${st.id}`).setTileScale(2.5 / 2);
    const g = this.add.graphics();
    if (st.terrain.some((t) => t.type === 'water')) {
      g.fillStyle(C.seaMid, 0.85).fillEllipse(P.x + P.w * 0.72, P.y + P.h * 0.32, 120, 54).fillEllipse(P.x + P.w * 0.22, P.y + P.h * 0.78, 90, 40);
    }
    if (!open) g.fillStyle(C.ink, 0.72).fillRect(P.x, P.y, P.w, P.h);
    g.lineStyle(5, C.ink).strokeRect(P.x, P.y, P.w, P.h);
    g.lineStyle(2, C.white, 0.6).strokeRect(P.x + 6, P.y + 6, P.w - 12, P.h - 12);
    this.layer.add([ground, g]);
    if (!open) this.layer.add(display(this, P.x + P.w / 2, P.y + P.h / 2, 'LOCKED', 40, { color: CSS.red, stroke: CSS.white, shadow: null }).setOrigin(0.5).setAngle(-6));
    for (const dir of [-1, 1]) {
      const ax = dir < 0 ? P.x - 40 : P.x + P.w + 40;
      const ay = P.y + P.h / 2;
      const tri = [{ x: ax + dir * 18, y: ay }, { x: ax - dir * 12, y: ay - 46 }, { x: ax - dir * 12, y: ay + 46 }];
      const a = this.add.graphics();
      a.fillStyle(C.ink).fillPoints(tri.map((p) => ({ x: p.x + 4, y: p.y + 4 })), true);
      a.fillStyle(C.white).fillPoints(tri, true);
      a.lineStyle(3, C.ink).strokePoints(tri, true, true);
      const zone = this.add.zone(ax, ay, 60, 110).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.nav(dir, 0));
      this.layer.add([a, zone]);
    }
    const pz = this.add.zone(P.x + P.w / 2, P.y + P.h / 2, P.w, P.h).setInteractive({ useHandCursor: open });
    pz.on('pointerdown', () => this.confirm());
    this.layer.add(pz);

    // Status under the preview
    const sy = P.y + P.h + 30;
    const sg = this.add.graphics();
    medallion(sg, P.x + 20, sy, 16, cleared.length ? C.gold : 0x2a3f55);
    this.layer.add([sg, this.add.image(P.x + 20, sy, 'ic_crown').setScale(0.44 / TEX).setAlpha(cleared.length ? 1 : 0.4)]);
    const status = !open ? `Clear stage ${st.order - 1} to unlock` : cleared.includes(this.character.id) ? 'CLEARED!' : cleared.length ? `Cleared by ${cleared.length} captain${cleared.length > 1 ? 's' : ''}` : 'Not cleared yet';
    this.layer.add(display(this, P.x + 48, sy, status, 22, { shadow: null, color: cleared.length && open ? CSS.gold : CSS.white }).setOrigin(0, 0.5));

    // Details on the right
    const bosses = st.events.filter((e) => e.type === 'boss');
    const names = (role: string) => bosses.filter((b) => b.role === role).map((b) => ENEMIES.get(b.enemy)?.name).join(' + ');
    const lines = [
      st.desc,
      '',
      `Mid-boss (10:00): ${names('mid')}`,
      `Final boss (20:00): ${names('final')}`,
      st.terrain.some((t) => t.type === 'water') ? '\nSeawater: Devil Fruit users are slowed and weakened.' : '',
    ].join('\n');
    this.layer.add(label(this, 720, P.y - 28, lines, 16, { weight: 500, style: { wordWrap: { width: 480 }, lineSpacing: 5 } }));
    const go = new Button(this, 960, 640, 300, 58, 'Set sail!', () => this.confirm(), 'gold');
    go.setEnabled(open).setFocus(open);
    this.layer.add(go);
  }
}
