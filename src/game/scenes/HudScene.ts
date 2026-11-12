import Phaser from 'phaser';
import { HAKI, ITEMS, LIMITS, SKILLS, WEAPONS } from '../../data';
import { GAME_W, WORLD_ZOOM, hex } from '../../config';
import { relayoutOnResize, screenBox } from '../layout';
import { CHAR_TEX, TEX } from '../textures';
import { RES } from '../../config';
import { itemIcon, skillIcon, weaponIcon } from '../icons';
import {
  backdrop, burst, Button, C, CSS, display, formatTime, gauge, gradientFill, hintRow, inkPanel, keycap, label, medallion,
  parchment, ribbon, speedLines,
} from '../ui';
import type { Banner, ChoiceInfo, RunScene, RunState } from './RunScene';

type Overlay = Exclude<RunState, 'playing' | 'ended'>;

const SLOT = 40;
const SLOT_GAP = 6;
const SLOTS_X = 18;
const WEAPON_Y = 128;
const ITEM_Y = WEAPON_Y + SLOT + 10;

interface Slot {
  icon: Phaser.GameObjects.Image;
  lvl: Phaser.GameObjects.Text;
  key: string;
}

interface Selectable {
  root: Phaser.GameObjects.Container;
  setOn(on: boolean): void;
}

/**
 * In-run HUD at native 1280×720. Static chrome is drawn once; gauges are redrawn each
 * frame on one Graphics. Overlays (level up, treasure, anvil, stage clear, pause)
 * are rebuilt when the run state or its content changes.
 */
export class HudScene extends Phaser.Scene {
  private run!: RunScene;
  private gfx!: Phaser.GameObjects.Graphics;
  private vignette!: Phaser.GameObjects.Image;
  private sandTint!: Phaser.GameObjects.Rectangle;
  private timerText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private hpText!: Phaser.GameObjects.Text;
  private specialText!: Phaser.GameObjects.Text;
  private specialKey!: Phaser.GameObjects.Container;
  private statusText!: Phaser.GameObjects.Text;
  private killsText!: Phaser.GameObjects.Text;
  private berriesText!: Phaser.GameObjects.Text;
  private debugText!: Phaser.GameObjects.Text;
  private bossNames: Phaser.GameObjects.Text[] = [];
  private slots: Slot[] = [];
  private bannerLayer!: Phaser.GameObjects.Container;
  private bannerFor: Banner | null = null;
  private bannerBorn = 0;
  private overlay!: Phaser.GameObjects.Container;
  private overlayFx!: Phaser.GameObjects.Graphics;
  /** HUD chrome zoom: enlarges the in-run HUD on physically small screens (phones). */
  private uiZoom = 1;
  /** Unzoomed camera for overlays and touch controls. */
  private overlayCam!: Phaser.Cameras.Scene2D.Camera;
  private touchGfx!: Phaser.GameObjects.Graphics;
  private overlayFor: Overlay | null = null;
  private overlayVersion = '';
  private overlayOpenedAt = 0;
  private selectables: Selectable[] = [];
  private selected = 0;
  private padPrev = { left: false, right: false, a: false, b: false };

  /** Live screen size: the canvas expands to the window's aspect ratio. */
  private get sw(): number {
    return this.scale.width / (this.uiZoom * RES);
  }

  private get sh(): number {
    return this.scale.height / (this.uiZoom * RES);
  }

  constructor() {
    super('hud');
  }

  create(): void {
    this.slots = [];
    this.bossNames = [];
    this.selectables = [];
    this.overlayFor = null;
    this.overlayVersion = '';
    this.bannerFor = null;
    this.bossCrowns = null;
    this.padPrev = { left: false, right: false, a: false, b: false };
    this.run = this.scene.get('run') as RunScene;
    const run = this.run;
    // CSS pixels per game unit; below ~0.72 HUD text gets too small to read, so zoom the chrome up.
    const cssPerUnit = this.scale.displaySize.height / (this.scale.height / RES);
    this.uiZoom = Phaser.Math.Clamp(0.72 / Math.max(0.01, cssPerUnit), 1, 1.6);
    this.cameras.main.setOrigin(0, 0).setZoom(this.uiZoom * RES);

    this.sandTint = this.add.rectangle(0, 0, this.sw, this.sh, 0xc8a050, 0).setOrigin(0);
    this.vignette = this.add.image(this.sw / 2, this.sh / 2, 'vignette').setDisplaySize(this.sw * 1.25, this.sw * 1.25).setAlpha(0);

    // ---- Static chrome ----
    const s = this.add.graphics();
    inkPanel(s, this.sw / 2 - 86, 16, 172, 46, { fill: C.seaDeep, skew: 16, shadow: 5 });
    inkPanel(s, this.sw - 232, 16, 214, 38, { fill: C.seaDeep, skew: 12, shadow: 4, alpha: 0.92 });
    inkPanel(s, this.sw - 212, 60, 194, 38, { fill: C.seaDeep, skew: 12, shadow: 4, alpha: 0.92 });
    medallion(s, this.sw - 212, 35, 15, C.parch);
    medallion(s, this.sw - 192, 79, 15, C.gold);
    this.add.image(this.sw - 212, 35, 'ic_skull').setScale(0.4 / TEX);
    this.add.image(this.sw - 192, 79, 'ic_coin').setScale(0.42 / TEX);
    // Portrait
    medallion(s, 58, 62, 40, C.parch, C.gold);
    this.add.image(58, 78, `player_${run.character.id}`).setScale(3 / CHAR_TEX).setOrigin(0.5, 0.85);

    this.gfx = this.add.graphics();
    const lvlG = this.add.graphics();
    burst(lvlG, 94, 102, 24, 9, C.red, 0.2);
    this.levelText = display(this, 94, 102, '1', 18, { shadow: null }).setOrigin(0.5);

    this.timerText = display(this, this.sw / 2, 39, '00:00', 28, { shadow: null, color: CSS.goldLight }).setOrigin(0.5);
    this.killsText = display(this, this.sw - 30, 35, '0', 18, { shadow: null }).setOrigin(1, 0.5);
    this.berriesText = display(this, this.sw - 30, 79, '0', 18, { shadow: null, color: CSS.gold }).setOrigin(1, 0.5);
    this.hpText = label(this, 128, 42, '', 14).setOrigin(0, 0.5);
    this.specialText = label(this, 126, 98, '', 13);
    this.specialKey = keycap(this, 0, 106, run.controls.isTouch ? '★' : 'Space', 12).setVisible(false);
    this.statusText = label(this, SLOTS_X, ITEM_Y + SLOT + 16, '', 13, { color: '#ffd59a' });
    this.debugText = label(this, 14, this.sh - 24, '', 12, { color: '#b6ff9e', weight: 500 });
    for (let i = 0; i < 2; i++) this.bossNames.push(display(this, this.sw / 2 - 210, 76 + i * 52, '', 15, { shadow: null }).setOrigin(0, 0.5));

    for (let i = 0; i < 2 * (1 + LIMITS.weaponSlots); i++) {
      const col = i % (1 + LIMITS.weaponSlots);
      const row = Math.floor(i / (1 + LIMITS.weaponSlots));
      const x = SLOTS_X + col * (SLOT + SLOT_GAP) + SLOT / 2;
      const y = (row === 0 ? WEAPON_Y : ITEM_Y) + SLOT / 2;
      this.slots.push({
        icon: this.add.image(x, y - 1, 'ic_star').setScale(0.44 / TEX).setVisible(false),
        lvl: display(this, x + SLOT / 2 - 3, y + SLOT / 2 - 4, '', 11, { shadow: null }).setOrigin(0.5),
        key: '',
      });
    }

    this.bannerLayer = this.add.container(0, 0).setDepth(5);
    this.overlayFx = this.add.graphics().setDepth(9);
    // Overlays are composed for 1280×720 and centred; their backdrops go full-screen.
    const box = screenBox(this);
    this.overlay = this.add.container(box.ox, box.oy).setVisible(false).setDepth(10);
    this.touchGfx = this.add.graphics().setDepth(8);
    relayoutOnResize(this);
    // Chrome renders through the (possibly zoomed) main camera; overlays and touch controls
    // through an unzoomed camera so they keep their full-screen layout.
    const unzoomed = [this.overlay, this.overlayFx, this.touchGfx];
    this.overlayCam = this.cameras.add(0, 0, this.scale.width, this.scale.height).setOrigin(0, 0).setZoom(RES);
    this.overlayCam.ignore(this.children.list.filter((o) => !unzoomed.includes(o as never)));
    this.cameras.main.ignore(unzoomed);
    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => this.onKey(ev.code));
  }

  update(time: number): void {
    const run = this.run;
    if (!run || !run.player || !run.stats) return;
    this.drawHud(time);
    this.updateBanner(time);
    this.syncOverlay();
    this.drawOverlayFx(time);
    this.pollPad();
  }

  // ---- HUD ------------------------------------------------------------------------------

  private drawHud(time: number): void {
    const run = this.run;
    const g = this.gfx;
    g.clear();

    const vision = run.hazards.vision;
    this.vignette.setAlpha(vision * 0.97);
    this.sandTint.setFillStyle(0xc8a050, vision * 0.22);

    // XP strip across the top
    const xpFrac = Math.min(1, run.xp / run.xpNeeded);
    g.fillStyle(C.ink, 0.85).fillRect(0, 0, this.sw, 9);
    g.fillStyle(C.xp).fillRect(0, 0, this.sw * xpFrac, 7);
    g.fillStyle(0xffffff, 0.45).fillRect(0, 0, this.sw * xpFrac, 2);
    this.levelText.setText(String(run.level));

    // HP
    const maxHp = run.stats.get('maxHp');
    const hpFrac = Math.max(0, run.player.hp / maxHp);
    const low = hpFrac < 0.3;
    gauge(g, 112, 28, 300, 28, hpFrac, low && Math.floor(time / 250) % 2 ? 0xff7a7a : C.hp, { ticks: 10 });
    const shieldMax = run.mods.get('shieldMax');
    if (shieldMax > 0 && run.player.shield > 0) gauge(g, 118, 22, 290 * (run.player.shield / shieldMax), 6, 1, C.gold, { skew: 4 });
    const rev = run.revivesLeft;
    this.hpText.setText(`${Math.ceil(run.player.hp)} / ${Math.round(maxHp)}${rev > 0 ? `   ♥ ${rev}` : ''}`);

    // Special
    const sp = run.character.special;
    const active = run.specialActive;
    const ready = active <= 0 && run.specialCharge >= run.specialCooldown;
    const charge = active > 0 ? 1 : run.specialCharge / run.specialCooldown;
    const pulse = ready ? 0.5 + 0.5 * Math.sin(time / 120) : 0;
    gauge(g, 112, 64, 260, 18, charge, ready || active > 0 ? (pulse > 0.75 ? C.goldLight : C.gold) : C.goldDeep, { glow: ready });
    if (ready) g.lineStyle(3, 0xffffff, 0.4 + 0.5 * pulse).strokeRoundedRect(106, 58, 274, 30, 6);
    this.specialText
      .setText(active > 0 ? `${sp.name}!  ${active.toFixed(1)}s` : ready ? `${sp.name} ready` : sp.name)
      .setColor(ready || active > 0 ? CSS.gold : '#cfe3f2');
    this.specialKey.setVisible(ready).setPosition(126 + this.specialText.width + 28, 107);

    this.timerText.setText(formatTime(run.runTime));
    this.killsText.setText(run.kills.toLocaleString('en-US'));
    this.berriesText.setText(Math.floor(run.berries).toLocaleString('en-US'));

    this.drawSlots(g);
    this.drawStatus();
    this.drawBosses(g);
    this.drawRadar(g, time);
    this.touchGfx.clear();
    if (run.controls.isTouch) this.drawTouch(this.touchGfx);
    if (run.debug) {
      this.debugText.setText(`fps ${this.game.loop.actualFps.toFixed(0)}  enemies ${run.enemies.count}  hitboxes ${run.hitboxes.count}  pickups ${run.pickups.count}  aim ${run.controls.aimMode}`);
    }
  }

  private drawSlots(g: Phaser.GameObjects.Graphics): void {
    const run = this.run;
    const entries: ({ icon: string; color: number; level: number | string; enh: number } | null)[] = [];
    const main = run.mainWeapon;
    entries.push({ icon: weaponIcon(main.def), color: hex(main.def.color), level: main.level, enh: run.loadout.enhance.get(main.def.id) ?? 0 });
    for (let w = 0; w < LIMITS.weaponSlots; w++) {
      const rt = run.weaponList[w];
      entries.push(rt ? { icon: weaponIcon(rt.def), color: hex(rt.def.color), level: rt.def.recipe ? '★' : rt.level, enh: run.loadout.enhance.get(rt.def.id) ?? 0 } : null);
    }
    const items = [...run.loadout.items.entries()];
    for (let k = 0; k < LIMITS.itemSlots; k++) {
      const e = items[k];
      entries.push(e ? { icon: itemIcon(e[0]), color: hex(ITEMS.get(e[0])!.color), level: e[1], enh: 0 } : null);
    }
    entries.forEach((e, i) => {
      const col = i % (1 + LIMITS.weaponSlots);
      const row = Math.floor(i / (1 + LIMITS.weaponSlots));
      const x = SLOTS_X + col * (SLOT + SLOT_GAP);
      const y = row === 0 ? WEAPON_Y : ITEM_Y;
      const slot = this.slots[i];
      if (!e) {
        g.fillStyle(C.ink, 0.45).fillRoundedRect(x, y, SLOT, SLOT, 8);
        g.lineStyle(2, 0xffffff, 0.18).strokeRoundedRect(x + 2, y + 2, SLOT - 4, SLOT - 4, 7);
        slot.icon.setVisible(false);
        slot.lvl.setText('');
        return;
      }
      g.fillStyle(C.ink).fillRoundedRect(x + 3, y + 3, SLOT, SLOT, 8);
      g.fillStyle(e.color).fillRoundedRect(x, y, SLOT, SLOT, 8);
      g.fillStyle(0xffffff, 0.2).fillRoundedRect(x + 3, y + 3, SLOT - 6, SLOT * 0.35, 5);
      g.lineStyle(2.5, e.enh ? C.gold : C.ink).strokeRoundedRect(x, y, SLOT, SLOT, 8);
      if (slot.key !== e.icon) {
        slot.key = e.icon;
        slot.icon.setTexture(e.icon);
      }
      slot.icon.setVisible(true);
      g.fillStyle(C.ink).fillCircle(x + SLOT - 3, y + SLOT - 4, 9);
      g.fillStyle(e.enh ? C.red : C.seaDeep).fillCircle(x + SLOT - 3, y + SLOT - 4, 8);
      slot.lvl.setText(e.enh ? `${e.level}+` : String(e.level));
    });
  }

  private drawStatus(): void {
    const run = this.run;
    const t = run.terrainHere;
    const m = run.mods;
    const df = run.character.devilFruit;
    let s = '';
    if (t === 'water') {
      if (m.get('seawaterHeals') > 0) s = 'Seawater is healing you';
      else if (m.get('waterWalker') > 0) s = 'Ice Bicycle: +25% speed on water';
      else s = df ? 'Seawater! Devil Fruit power drained (−35% speed, −20% damage)' : 'Seawater: +10% speed and damage';
    } else if (t === 'quicksand' && !m.get('noSlow') && !m.get('ignoreHazards')) s = 'Quicksand: −40% speed';
    else if (t === 'cold' && !m.get('noSlow') && !m.get('ignoreHazards')) s = 'Freezing floor: −30% speed';
    else if (t === 'heat' && !m.get('ignoreHazards')) s = 'Burning floor: losing HP';
    else if (t === 'poison' && !m.get('ignoreHazards')) s = 'Poison floor: losing HP';
    if (run.player.sleepT > 0) s = 'Zzz… power nap';
    else if (run.player.attackPauseT > 0) s = 'Upset stomach…';
    this.statusText.setText(s);
  }

  private drawBosses(g: Phaser.GameObjects.Graphics): void {
    const bosses = this.run.bossList;
    for (let i = 0; i < this.bossNames.length; i++) {
      const b = bosses[i];
      const t = this.bossNames[i];
      if (!b) {
        t.setText('');
        continue;
      }
      const y = 64 + i * 52;
      const w = 460;
      const x = this.sw / 2 - w / 2;
      inkPanel(g, x, y, w, 46, { fill: C.ink, skew: 14, shadow: 4, alpha: 0.85, strokeColor: C.redDeep });
      medallion(g, x - 4, y + 23, 18, C.red, C.gold);
      gauge(g, x + 30, y + 26, w - 50, 13, Math.max(0, b.hp / b.maxHp), C.red, { ticks: 20, back: 0x3a0d10 });
      t.setPosition(x + 30, y + 13).setText(b.def.name);
    }
    if (bosses.length && !this.bossCrowns) {
      this.bossCrowns = [0, 1].map((i) => this.add.image(this.sw / 2 - 234, 87 + i * 52, 'ic_crown').setScale(0.42 / TEX).setDepth(1));
      this.overlayCam.ignore(this.bossCrowns);
    }
    this.bossCrowns?.forEach((c, i) => c.setVisible(!!bosses[i]));
  }

  private bossCrowns: Phaser.GameObjects.Image[] | null = null;

  /** Chevrons at the screen edge pointing at bosses, treasure and (with Observation Haki) elites. */
  private drawRadar(g: Phaser.GameObjects.Graphics, time: number): void {
    const run = this.run;
    const view = run.cameras.main.worldView;
    const targets: { x: number; y: number; color: number }[] = [];
    for (const b of run.bossList) targets.push({ x: b.x, y: b.y, color: C.red });
    for (const t of run.pickups.treasure()) targets.push({ x: t.x, y: t.y, color: t.kind === 'haki' ? C.violet : C.gold });
    if (run.mods.get('eliteRadar') > 0) for (const e of run.enemies.pool.active) if (e.elite) targets.push({ x: e.x, y: e.y, color: 0xffab40 });
    const bob = Math.sin(time / 150) * 4;
    for (const t of targets) {
      const sx = ((t.x - view.x) * WORLD_ZOOM) / this.uiZoom;
      const sy = ((t.y - view.y) * WORLD_ZOOM) / this.uiZoom;
      if (sx >= 0 && sx <= this.sw && sy >= 0 && sy <= this.sh) continue;
      const cx = this.sw / 2;
      const cy = this.sh / 2;
      const a = Math.atan2(sy - cy, sx - cx);
      const k = Math.min(Math.abs((this.sw / 2 - 34) / Math.cos(a)), Math.abs((this.sh / 2 - 34) / Math.sin(a))) + bob;
      const ax = cx + Math.cos(a) * k;
      const ay = cy + Math.sin(a) * k;
      const pt = (r: number, da: number) => ({ x: ax + Math.cos(a + da) * r, y: ay + Math.sin(a + da) * r });
      const tri = [pt(16, 0), pt(14, 2.4), pt(5, Math.PI), pt(14, -2.4)];
      g.fillStyle(C.ink).fillPoints(tri.map((p) => ({ x: p.x + 2, y: p.y + 2 })), true);
      g.fillStyle(t.color).fillPoints(tri, true);
      g.lineStyle(2.5, C.ink).strokePoints(tri, true, true);
    }
  }

  private drawTouch(g: Phaser.GameObjects.Graphics): void {
    const st = this.run.controls.stick;
    if (st.active) {
      g.fillStyle(C.white, 0.12).fillCircle(st.baseX, st.baseY, 64);
      g.lineStyle(3, C.ink, 0.5).strokeCircle(st.baseX, st.baseY, 64);
      g.fillStyle(C.parch, 0.6).fillCircle(st.knobX, st.knobY, 26);
      g.lineStyle(3, C.ink).strokeCircle(st.knobX, st.knobY, 26);
    }
    const s = this.run.controls.touchSpecial();
    const ready = this.run.specialCharge >= this.run.specialCooldown;
    medallion(g, s.x, s.y, s.r - 4, ready ? C.gold : C.seaMid);
    const p = this.run.controls.touchPause();
    medallion(g, p.x, p.y, p.r - 6, C.seaDeep);
    g.fillStyle(C.white).fillRect(p.x - 9, p.y - 11, 6, 22).fillRect(p.x + 3, p.y - 11, 6, 22);
  }

  // ---- Impact banners --------------------------------------------------------------------

  private updateBanner(time: number): void {
    const b = this.run.banner;
    if (b !== this.bannerFor) {
      this.bannerFor = b;
      this.bannerBorn = time;
      this.bannerLayer.removeAll(true);
      if (b) this.buildBanner(b);
    }
    if (!b) return;
    const age = (time - this.bannerBorn) / 1000;
    const slide = Math.min(1, age / 0.18);
    this.bannerLayer.setX((1 - slide) * -this.sw * 0.6);
    this.bannerLayer.setAlpha(Math.min(1, b.t / 0.4));
  }

  private buildBanner(b: Banner): void {
    const y = 236;
    const h = b.sub ? 104 : 84;
    const color = Phaser.Display.Color.HexStringToColor(b.color).color;
    const g = this.add.graphics();
    speedLines(g, this.sw / 2, y, 140, 760, 40, color, 0.18);
    const band = [
      { x: -40, y: y - h / 2 + 10 },
      { x: this.sw + 40, y: y - h / 2 - 10 },
      { x: this.sw + 40, y: y + h / 2 - 10 },
      { x: -40, y: y + h / 2 + 10 },
    ];
    g.fillStyle(color).fillPoints(band.map((p) => ({ x: p.x, y: p.y + (p.y < y ? -6 : 6) })), true);
    g.fillStyle(C.ink, 0.92).fillPoints(band, true);
    const title = display(this, this.sw / 2, y - (b.sub ? 14 : 0), b.title, 46, { color: b.color, shadow: CSS.ink }).setOrigin(0.5).setRotation(-0.015);
    this.bannerLayer.add([g, title]);
    if (b.sub) this.bannerLayer.add(label(this, this.sw / 2, y + 30, b.sub, 17, { color: CSS.white }).setOrigin(0.5).setRotation(-0.015));
  }

  // ---- Overlays --------------------------------------------------------------------------

  private syncOverlay(): void {
    const run = this.run;
    const want: Overlay | null = run.state === 'playing' || run.state === 'ended' ? null : run.state;
    const version =
      want === 'levelup' ? `${run.choices.map((c) => `${c.kind}${c.id}${c.level}`).join()}|${run.rerolls}${run.holds}${run.eliminates}|${run.loadout.held?.id}` : '';
    if (want === this.overlayFor && version === this.overlayVersion) return;
    const sameKind = want === this.overlayFor;
    this.overlay.removeAll(true);
    this.selectables = [];
    this.overlayFor = want;
    this.overlayVersion = version;
    if (!sameKind) {
      this.overlayOpenedAt = this.time.now;
      this.selected = 0;
    }
    if (!want) {
      this.overlay.setVisible(false);
      this.overlayFx.clear();
      return;
    }
    this.overlay.setVisible(true);
    this.overlay.add(backdrop(this, this.scale.width / RES, this.scale.height / RES, want === 'paused' ? 0.8 : 0.72).setPosition(-this.overlay.x, -this.overlay.y));
    if (want === 'levelup') this.buildLevelUp(sameKind);
    else if (want === 'chest') this.buildChest();
    else if (want === 'anvil') this.buildAnvil();
    else if (want === 'cleared') this.buildCleared();
    else this.buildPause();
    if (!sameKind) {
      this.overlay.setAlpha(0);
      this.tweens.add({ targets: this.overlay, alpha: 1, duration: 140 });
    }
    this.select(Math.min(this.selected, Math.max(0, this.selectables.length - 1)));
  }

  /** Speed lines behind celebratory overlays (redrawn per frame for a slow spin). */
  private drawOverlayFx(time: number): void {
    const f = this.overlayFor;
    this.overlayFx.clear();
    if (f !== 'levelup' && f !== 'chest' && f !== 'cleared') return;
    this.overlayFx.setDepth(10);
    this.overlay.setDepth(11);
    const color = f === 'cleared' ? C.gold : f === 'chest' ? C.goldLight : C.xp;
    speedLines(this.overlayFx, this.scale.width / RES / 2, this.overlay.y + (f === 'levelup' ? 90 : 200), 120, (Math.max(this.scale.width, this.scale.height) / RES) * 1.1, 48, color, 0.1, time / 9000);
  }

  private bigTitle(y: number, value: string, size: number, top = '#fff6b0', bottom = '#ffb300', shadow: string = CSS.red): Phaser.GameObjects.Text {
    const t = gradientFill(display(this, GAME_W / 2, y, value, size, { shadow }).setOrigin(0.5), top, bottom).setRotation(-0.05);
    t.setScale(1.4);
    this.tweens.add({ targets: t, scale: 1, duration: 260, ease: 'Back.Out' });
    this.overlay.add(t);
    return t;
  }

  private buildLevelUp(rebuilt: boolean): void {
    const run = this.run;
    if (!rebuilt) this.bigTitle(84, 'LEVEL UP!', 62);
    else this.overlay.add(gradientFill(display(this, GAME_W / 2, 84, 'LEVEL UP!', 62, { shadow: CSS.red }).setOrigin(0.5), '#fff6b0', '#ffb300').setRotation(-0.05));
    const n = run.choices.length;
    const gap = 18;
    const cardW = Math.min(244, (GAME_W - 80 - gap * (n - 1)) / n);
    const cardH = 330;
    const x0 = (GAME_W - (n * cardW + (n - 1) * gap)) / 2;
    const held = run.loadout.held;
    run.choices.forEach((choice, i) => {
      const info = run.describe(choice);
      const isHeld = !!held && held.kind === choice.kind && held.id === choice.id;
      const card = this.choiceCard(x0 + i * (cardW + gap) + cardW / 2, 158 + cardH / 2, cardW, cardH, choice.kind, choice.level, info, i, isHeld);
      if (!rebuilt) {
        card.root.setY(card.root.y + 40).setAlpha(0);
        this.tweens.add({ targets: card.root, y: card.root.y - 40, alpha: 1, duration: 220, delay: 60 * i, ease: 'Back.Out' });
      }
    });
    const by = 548;
    const reroll = new Button(this, GAME_W / 2 - 230, by, 190, 50, 'Reroll', () => run.reroll(), 'sea').setBadge(String(run.rerolls)).setEnabled(run.rerolls > 0);
    const hold = new Button(this, GAME_W / 2, by, 190, 50, 'Hold', () => run.hold(this.selected), 'parch').setBadge(String(run.holds)).setEnabled(run.holds > 0 && !run.loadout.held);
    const elim = new Button(this, GAME_W / 2 + 230, by, 190, 50, 'Eliminate', () => run.eliminate(this.selected), 'red').setBadge(String(run.eliminates)).setEnabled(run.eliminates > 0);
    this.overlay.add([reroll, hold, elim]);
    this.overlay.add(hintRow(this, GAME_W / 2, 612, [['1–5', 'Pick'], ['←→', 'Browse'], ['Enter', 'Take'], ['R', 'Reroll'], ['H', 'Hold'], ['X', 'Eliminate']], CSS.white));
  }

  /** A parchment upgrade card: kind ribbon, NEW! burst, icon medallion, level stars, description. */
  private choiceCard(cx: number, cy: number, w: number, h: number, kind: keyof typeof KIND, level: number, info: ChoiceInfo, index: number, held: boolean): Selectable {
    const root = this.add.container(cx, cy);
    const glow = this.add.graphics();
    const g = this.add.graphics();
    const x = -w / 2;
    const y = -h / 2;
    parchment(g, x, y, w, h, index + 3, { shadow: 7 });
    ribbon(g, x + 18, y + 14, w - 36, 30, KIND[kind].color, { tails: false, shadow: 3 });
    const kindText = label(this, 0, y + 29, KIND[kind].label, 15).setOrigin(0.5);
    medallion(g, 0, y + 100, 42, info.color);
    const icon = this.add.image(0, y + 100, info.icon).setScale(0.95 / TEX);
    const name = label(this, 0, y + 158, info.name, 19, { onDark: false, color: CSS.ink, style: { align: 'center', wordWrap: { width: w - 26 } } }).setOrigin(0.5, 0);
    const parts: Phaser.GameObjects.GameObject[] = [glow, g, kindText, icon, name];
    let descY = y + 158 + name.height + 8;
    if (info.maxLevel > 0) {
      const pips = this.add.graphics();
      const pw = 16;
      const total = info.maxLevel;
      const px0 = -((total - 1) * pw) / 2;
      for (let k = 0; k < total; k++) {
        const filled = k < level;
        const isNext = k === level - 1;
        burst(pips, px0 + k * pw, descY + 6, isNext ? 8 : 6, 5, filled ? (isNext ? C.gold : C.goldDeep) : C.parchDark, -Math.PI / 2);
      }
      parts.push(pips);
      descY += 22;
    }
    parts.push(label(this, 0, descY, info.desc, 14, { onDark: false, weight: 500, color: '#3a2a20', style: { align: 'center', wordWrap: { width: w - 30 }, lineSpacing: 3 } }).setOrigin(0.5, 0));
    parts.push(keycap(this, 0, h / 2 - 22, String(index + 1), 13));
    if (info.isNew) {
      const sticker = this.add.graphics();
      burst(sticker, w / 2 - 14, y + 10, 30, 12, C.red, 0.2);
      parts.push(sticker, display(this, w / 2 - 14, y + 10, 'NEW!', 14, { shadow: null }).setOrigin(0.5).setRotation(0.25));
    }
    if (held) {
      const stamp = display(this, 0, y + 100, 'HELD', 30, { color: CSS.red, stroke: CSS.parch, shadow: null }).setOrigin(0.5).setRotation(-0.3).setAlpha(0.9);
      parts.push(stamp);
    }
    const zone = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => this.select(index));
    zone.on('pointerdown', () => this.pick(index));
    parts.push(zone);
    root.add(parts);
    this.overlay.add(root);
    const baseY = cy;
    const sel: Selectable = {
      root,
      setOn: (on) => {
        glow.clear();
        if (on) {
          glow.fillStyle(C.gold, 0.35).fillRoundedRect(x - 10, y - 10, w + 20, h + 20, 14);
          glow.lineStyle(5, C.gold).strokeRoundedRect(x - 6, y - 6, w + 12, h + 12, 10);
        }
        this.tweens.killTweensOf(root);
        this.tweens.add({ targets: root, y: on ? baseY - 12 : baseY, scale: on ? 1.04 : 1, alpha: 1, duration: 120, ease: 'Quad.Out' });
      },
    };
    this.selectables.push(sel);
    return sel;
  }

  private buildChest(): void {
    const run = this.run;
    this.bigTitle(96, 'TREASURE!', 58);
    const g = this.add.graphics();
    this.overlay.add(g);
    medallion(g, GAME_W / 2, 186, 38, C.wood);
    this.overlay.add(this.add.image(GAME_W / 2, 186, 'ic_chest').setScale(0.9 / TEX));
    run.chestResults.forEach((c, i) => {
      const info = run.describe(c);
      const y = 250 + i * 96;
      const row = this.add.container(GAME_W / 2, y + 40);
      const rg = this.add.graphics();
      parchment(rg, -320, -40, 640, 82, i + 11, { shadow: 6 });
      medallion(rg, -262, 0, 28, info.color);
      ribbon(rg, 170, -28, 130, 24, KIND[c.kind].color, { tails: false, shadow: 3 });
      row.add([
        rg,
        this.add.image(-262, 0, info.icon).setScale(0.62 / TEX),
        label(this, 235, -16, c.kind === 'boost' ? 'Boost' : `${KIND[c.kind].label} Lv ${c.level}`, 13).setOrigin(0.5),
        label(this, -216, -18, info.name, 19, { onDark: false, color: CSS.ink }),
        label(this, -216, 8, info.desc, 13, { onDark: false, weight: 500, color: '#3a2a20', style: { wordWrap: { width: 500 } } }),
      ]);
      row.setAlpha(0).setScale(0.6);
      this.tweens.add({ targets: row, alpha: 1, scale: 1, duration: 260, delay: 120 + i * 160, ease: 'Back.Out' });
      this.overlay.add(row);
    });
    const btn = new Button(this, GAME_W / 2, 620, 280, 56, 'Collect', () => run.closeChest(), 'gold');
    this.overlay.add(btn);
    this.selectables.push({ root: btn, setOn: (on) => btn.setFocus(on) });
  }

  private buildAnvil(): void {
    const run = this.run;
    this.bigTitle(84, 'ANVIL', 56, '#f5f7fa', '#9fb3c8', CSS.ink);
    this.overlay.add(label(this, GAME_W / 2, 136, 'Enhance a weapon (+15% damage, up to +3) or fuse two max-level weapons into an Alliance.', 16).setOrigin(0.5));
    const opts = run.anvilOptions.slice(0, 7);
    opts.forEach((o, i) => {
      const y = 196 + i * 62;
      const fuse = o.kind === 'fuse';
      const row = this.add.container(GAME_W / 2, y);
      const bg = this.add.graphics();
      const draw = (on: boolean) => {
        bg.clear();
        inkPanel(bg, -360, -26, 720, 52, { fill: on ? C.gold : fuse ? C.parchLight : C.parch, skew: 14, shadow: 5 });
      };
      draw(false);
      let text: string;
      let icon: string;
      let color: number;
      if (fuse) {
        const w = WEAPONS.get(o.recipe.id)!;
        text = `${run.nameOf(o.recipe.recipe[0])} + ${run.nameOf(o.recipe.recipe[1])}  →  ${w.name}`;
        icon = weaponIcon(w);
        color = hex(w.color);
      } else {
        const w = WEAPONS.get(o.id);
        text = `Enhance ${run.nameOf(o.id)}  (+${(run.loadout.enhance.get(o.id) ?? 0) + 1})`;
        icon = w ? weaponIcon(w) : weaponIcon(run.mainWeapon.def);
        color = w ? hex(w.color) : hex(run.mainWeapon.def.color);
      }
      const ig = this.add.graphics();
      medallion(ig, -320, 0, 18, color);
      row.add([bg, ig, this.add.image(-320, 0, icon).setScale(0.4 / TEX), label(this, -290, 0, text, 17, { onDark: false, color: CSS.ink }).setOrigin(0, 0.5), keycap(this, 330, 0, String(i + 1))]);
      if (fuse) {
        const s = this.add.graphics();
        burst(s, 250, -22, 22, 10, C.red, 0.3);
        row.add([s, display(this, 250, -22, 'Alliance!', 11, { shadow: null }).setOrigin(0.5).setRotation(0.15)]);
      }
      const zone = this.add.zone(0, 0, 720, 52).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.select(i));
      zone.on('pointerdown', () => this.pick(i));
      row.add(zone);
      this.overlay.add(row);
      this.selectables.push({ root: row, setOn: (on) => draw(on) });
    });
    this.overlay.add(new Button(this, GAME_W / 2, 650, 200, 48, 'Skip', () => run.skipAnvil(), 'sea'));
  }

  private buildCleared(): void {
    const run = this.run;
    this.bigTitle(220, 'STAGE CLEAR!', 82);
    this.overlay.add(label(this, GAME_W / 2, 310, `${run.stage.name} is free! Sail on into endless mode for a bigger bounty, or head home now.`, 18).setOrigin(0.5));
    const a = new Button(this, GAME_W / 2 - 170, 410, 290, 62, 'Endless mode', () => run.continueEndless(), 'gold');
    const b = new Button(this, GAME_W / 2 + 170, 410, 290, 62, 'Return to ship', () => run.retire(), 'sea');
    this.overlay.add([a, b, hintRow(this, GAME_W / 2, 480, [['Enter', 'Endless'], ['Q', 'Return']], CSS.white)]);
    this.selectables.push({ root: a, setOn: (on) => a.setFocus(on) }, { root: b, setOn: (on) => b.setFocus(on) });
  }

  private buildPause(): void {
    const run = this.run;
    const g = this.add.graphics();
    this.overlay.add(g);
    inkPanel(g, 140, 90, 1000, 520, { fill: C.woodDark, radius: 14, shadow: 8, stroke: 4 });
    parchment(g, 160, 110, 470, 480, 21, { shadow: 0 });
    parchment(g, 650, 110, 470, 480, 22, { shadow: 0 });
    const title = display(this, 0, 0, 'Paused', 30, { shadow: null });
    ribbon(g, 190, 64, title.width + 60, 52, C.red);
    title.setPosition(220 + title.width / 2, 90).setOrigin(0.5);
    this.overlay.add(title);

    // Build list
    const rows: { icon: string; color: number; text: string }[] = [];
    const enh = (id: string) => (run.loadout.enhance.get(id) ? ` +${run.loadout.enhance.get(id)}` : '');
    rows.push({ icon: weaponIcon(run.mainWeapon.def), color: hex(run.mainWeapon.def.color), text: `${run.mainWeapon.def.name}  Lv ${run.mainWeapon.level}${enh(run.mainWeapon.def.id)}` });
    for (const w of run.weaponList) rows.push({ icon: weaponIcon(w.def), color: hex(w.def.color), text: `${w.def.name}  ${w.def.recipe ? 'Alliance' : `Lv ${w.level}`}${enh(w.def.id)}` });
    for (const [id, lv] of run.loadout.items) rows.push({ icon: itemIcon(id), color: hex(ITEMS.get(id)!.color), text: `${ITEMS.get(id)!.name}  Lv ${lv}` });
    for (const [id, lv] of run.loadout.skills) if (lv > 0) rows.push({ icon: skillIcon(SKILLS.get(id)!), color: C.violet, text: `${SKILLS.get(id)!.name}  Lv ${lv}` });
    this.overlay.add(label(this, 190, 132, 'Your build', 18, { onDark: false, color: CSS.red }));
    rows.slice(0, 14).forEach((r, i) => {
      const y = 172 + i * 29;
      medallion(g, 202, y, 11, r.color);
      this.overlay.add([this.add.image(202, y, r.icon).setScale(0.27 / TEX), label(this, 224, y, r.text, 14, { onDark: false, color: CSS.ink }).setOrigin(0, 0.5)]);
    });

    // Stats
    const s = run.stats;
    const haki = Object.values(run.save.equippedHaki).filter(Boolean).map((id) => `${HAKI.get(id!)?.name} Lv ${run.save.haki[id!] ?? 0}`);
    const stats: [string, string][] = [
      ['Damage', `×${s.get('atk').toFixed(2)}`], ['Move speed', `×${s.get('spd').toFixed(2)}`], ['Crit chance', `${(s.get('crit') * 100).toFixed(0)}%`],
      ['Attack speed', `+${(s.get('haste') * 100).toFixed(0)}%`], ['Defense', `${(s.get('defense') * 100).toFixed(0)}%`], ['Pickup range', `${s.get('pickup').toFixed(0)}`],
    ];
    this.overlay.add(label(this, 680, 132, 'Stats', 18, { onDark: false, color: CSS.red }));
    stats.forEach(([k, v], i) => {
      const y = 172 + i * 30;
      g.lineStyle(1, C.parchEdge, 0.5).lineBetween(680, y + 13, 1090, y + 13);
      this.overlay.add([label(this, 680, y, k, 15, { onDark: false, weight: 500, color: CSS.ink }).setOrigin(0, 0.5), label(this, 1090, y, v, 15, { onDark: false, color: CSS.ink }).setOrigin(1, 0.5)]);
    });
    const notes = [
      `Haki: ${haki.length ? haki.join(', ') : 'none equipped'}`,
      `Aim: ${run.controls.aimMode === 'mouse' ? 'mouse' : 'auto (nearest enemy)'} — press C to switch`,
      run.character.devilFruit ? 'Devil Fruit user: seawater drains your power.' : 'Not a Devil Fruit user: seawater gives you a boost.',
    ];
    this.overlay.add(label(this, 680, 372, notes.join('\n'), 14, { onDark: false, weight: 500, color: '#3a2a20', style: { wordWrap: { width: 410 }, lineSpacing: 6 } }));
    const resume = new Button(this, GAME_W / 2 - 290, 652, 250, 54, 'Resume', () => run.togglePause(), 'gold');
    const quit = new Button(this, GAME_W / 2, 652, 250, 54, 'Abandon voyage', () => run.quitRun(), 'red');
    const menu = new Button(this, GAME_W / 2 + 290, 652, 250, 54, 'Main menu', () => run.quitToTitle(), 'sea');
    this.overlay.add([resume, quit, menu]);
    this.selectables.push(
      { root: resume, setOn: (on) => resume.setFocus(on) },
      { root: quit, setOn: (on) => quit.setFocus(on) },
      { root: menu, setOn: (on) => menu.setFocus(on) },
    );
  }

  // ---- Selection / input -------------------------------------------------------------------

  private select(i: number): void {
    if (!this.selectables.length) return;
    this.selected = (i + this.selectables.length) % this.selectables.length;
    this.selectables.forEach((s, k) => s.setOn(k === this.selected));
  }

  private pick(i: number): void {
    // Short delay so a held key or stray click doesn't pick an option the player hasn't seen.
    if (this.time.now - this.overlayOpenedAt < 350) return;
    const run = this.run;
    switch (this.overlayFor) {
      case 'levelup':
        run.choose(i);
        break;
      case 'anvil':
        run.chooseAnvil(i);
        break;
      case 'chest':
        run.closeChest();
        break;
      case 'cleared':
        if (i === 0) run.continueEndless();
        else run.retire();
        break;
      case 'paused':
        if (i === 0) run.togglePause();
        else if (i === 1) run.quitRun();
        else run.quitToTitle();
        break;
    }
  }

  private onKey(code: string): void {
    const run = this.run;
    const f = this.overlayFor;
    if (!f) return;
    if (code.startsWith('Digit') && (f === 'levelup' || f === 'anvil')) {
      const n = Number(code.slice(5)) - 1;
      if (n >= 0 && n < this.selectables.length) this.pick(n);
      return;
    }
    if (['ArrowLeft', 'ArrowUp', 'KeyA', 'KeyW'].includes(code)) this.select(this.selected - 1);
    else if (['ArrowRight', 'ArrowDown', 'KeyD', 'KeyS'].includes(code)) this.select(this.selected + 1);
    else if (code === 'Enter' || (code === 'Space' && f !== 'paused')) this.pick(this.selected);
    else if (f === 'levelup' && code === 'KeyR') run.reroll();
    else if (f === 'levelup' && code === 'KeyH') run.hold(this.selected);
    else if (f === 'levelup' && code === 'KeyX') run.eliminate(this.selected);
    else if (f === 'anvil' && code === 'Escape') run.skipAnvil();
    else if (f === 'cleared' && code === 'KeyQ') run.retire();
    else if (f === 'paused' && code === 'KeyQ') run.quitRun();
  }

  private pollPad(): void {
    if (!this.overlayFor) return;
    const pad = this.input.gamepad?.total ? this.input.gamepad.pad1 : undefined;
    if (!pad) return;
    const left = pad.left || pad.up || pad.leftStick.x < -0.5;
    const right = pad.right || pad.down || pad.leftStick.x > 0.5;
    const a = pad.A;
    const b = pad.B;
    if (left && !this.padPrev.left) this.select(this.selected - 1);
    if (right && !this.padPrev.right) this.select(this.selected + 1);
    if (a && !this.padPrev.a) this.pick(this.selected);
    if (b && !this.padPrev.b) {
      if (this.overlayFor === 'anvil') this.run.skipAnvil();
      else if (this.overlayFor === 'levelup') this.run.reroll();
    }
    this.padPrev = { left, right, a, b };
  }
}

const KIND = {
  mainAttack: { label: 'Main attack', color: C.goldDeep },
  weapon: { label: 'Weapon', color: C.red },
  item: { label: 'Item', color: C.teal },
  skill: { label: 'Skill', color: C.violet },
  boost: { label: 'Boost', color: C.green },
} as const;
