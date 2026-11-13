import Phaser from 'phaser';
import { CHARACTERS } from '../../data';
import { GAME_W } from '../../config';
import { loadSave, writeSave, type SaveData } from '../../core/save';
import { isStageOpen, isUnlocked } from '../../core/meta';
import { C, display, gradientFill, label, medallion, speedLines } from '../ui';
import { centerCamera, relayoutOnResize, type ScreenBox } from '../layout';
import { CHAR_TEX, TEX } from '../textures';
import { boardMenu, logMenu, type MenuHost } from '../menus';
import { account } from '../account';
import { drawCelSea } from '../sea';
import type { PanelConfig } from './PanelScene';

const HORIZON = 455;
const DECK_H = 164;

interface MenuEntry {
  name: string;
  /** menu_* artwork key (src/assets/menu, loaded in BootScene). */
  icon: string;
  act: () => void;
}
interface MenuButton {
  c: Phaser.GameObjects.Container;
  act: () => void;
  name: Phaser.GameObjects.Text;
}

/**
 * Title: a bright Grand Line morning. Sunburst behind the logo, drifting clouds, the
 * unlocked crew lined up on deck. The logo slams in once; the first click also
 * unlocks audio (browser rule). Sky, sea and deck bleed to every screen edge.
 */
export class TitleScene extends Phaser.Scene implements MenuHost {
  save!: SaveData;
  private menu: MenuButton[] = [];
  private focus = -1;
  private panelClosedAt = 0;
  private berriesText!: Phaser.GameObjects.Text;
  private farewell: Phaser.GameObjects.Container | null = null;
  private farewellAt = 0;
  private padPrev = { l: true, r: true, a: true };
  private sky!: Phaser.GameObjects.Graphics;
  private sea!: Phaser.GameObjects.Graphics;
  private clouds: { g: Phaser.GameObjects.Graphics; speed: number }[] = [];
  private started = false;
  private box!: ScreenBox;
  private deckTop = 556;

  constructor() {
    super('title');
  }

  create(): void {
    this.started = false;
    this.clouds = [];
    this.menu = [];
    this.farewell = null;
    this.panelClosedAt = 0;
    this.padPrev = { l: true, r: true, a: true };
    const box = (this.box = centerCamera(this));
    relayoutOnResize(this);
    const save = (this.save = loadSave());
    if (!isUnlocked(save, save.selectedCharacter)) save.selectedCharacter = 'luffy';
    if (!isStageOpen(save, save.selectedStage)) save.selectedStage = 'shells_town';
    this.deckTop = Math.max(HORIZON + 90, box.bottom - DECK_H);

    // Sky
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x2b8fd0, 0x2b8fd0, 0xaee9f7, 0xaee9f7, 1).fillRect(box.left, box.top, box.w, HORIZON - box.top);
    this.sky = this.add.graphics();
    const span = box.right - box.left;
    for (let i = 0; i < Math.ceil(span / 330) + 1; i++) {
      this.clouds.push({ g: this.cloud(box.left + 100 + i * 330, box.top + 70 + (i % 2) * 90, 0.8 + (i % 3) * 0.25), speed: 6 + (i % 4) * 3 });
    }
    this.sea = this.add.graphics();

    // Deck the crew stands on, anchored to the bottom edge
    const deck = this.add.graphics();
    const top = this.deckTop;
    deck.fillStyle(C.wood).fillRect(box.left, top, box.w, 10);
    deck.lineStyle(3, C.ink).strokeRect(box.left - 4, top, box.w + 8, 10);
    deck.fillStyle(C.woodDark);
    for (let x = box.left + 20; x < box.right; x += 80) deck.fillRect(x, top + 4, 10, 30);
    deck.fillRect(box.left, top + 30, box.w, 14);
    deck.fillStyle(C.ink).fillRect(box.left, top + 42, box.w, 6);
    deck.fillStyle(C.woodLight).fillRect(box.left, top + 48, box.w, box.bottom - top - 48);
    deck.lineStyle(2, C.woodDark, 0.6);
    for (let y = top + 70; y < box.bottom; y += 24) deck.lineBetween(box.left, y, box.right, y);
    for (let x = box.left + 40; x < box.right; x += 160) deck.lineBetween(x, top + 48, x, box.bottom);

    const crew = [...CHARACTERS.values()].filter((c) => isUnlocked(save, c.id));
    const fit = Math.max(3, Math.floor((span - 120) / 112));
    const shown = crew.slice(0, Math.min(fit, 13));
    const feet = top + 124;
    shown.forEach((c, i) => {
      const x = GAME_W / 2 + (i - (shown.length - 1) / 2) * 112;
      const big = c.id === save.selectedCharacter;
      this.add.image(x + 4, feet - 4, 'shadow').setScale((big ? 5 : 4) / TEX).setAlpha(0.6);
      const s = this.add.image(x, feet, `player_${c.id}`).setScale((big ? 5.5 : 4.4) / CHAR_TEX).setOrigin(0.5, 1);
      this.tweens.add({ targets: s, y: feet - 6, duration: 600 + i * 70, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    });

    // Logo (composed in the centre design area)
    // A container, so the slam-in tween can scale it from 1 regardless of the image's own scale.
    const logo = this.add.container(GAME_W / 2, 178);
    const art = this.add.image(0, 0, 'menu_logo');
    logo.add(art.setScale(660 / art.width));
    label(this, GAME_W / 2, 326, 'The ONE PIECE is REAL!', 20).setOrigin(0.5);

    // Main menu: one row of icon buttons
    const entries: MenuEntry[] = [
      { name: 'Profile', icon: 'menu_profile', act: () => this.openScene('profile') },
      { name: 'Achievements', icon: 'menu_achievements', act: () => this.openPanel(boardMenu(this)) },
      { name: 'Shop', icon: 'menu_shop', act: () => this.openScene('shopfront') },
      { name: 'Set Sail', icon: 'menu_set-sail', act: () => this.start('sail') },
      { name: 'Pirate Ship', icon: 'menu_pirate-crew', act: () => this.start() },
      { name: 'Settings', icon: 'menu_settings', act: () => this.openPanel(logMenu(this)) },
      { name: 'Quit', icon: 'menu_quit', act: () => this.quit() },
    ];
    this.menu = entries.map((e, i) => this.menuButton(GAME_W / 2 + (i - (entries.length - 1) / 2) * 172, 418, e, i));
    this.setFocus(-1);

    // Corner info, pinned to the real screen edges
    const pill = this.add.graphics();
    const px = box.left + 20;
    const py = box.top + 20;
    pill.fillStyle(C.ink, 0.9).fillRoundedRect(px + 4, py + 4, 268, 44, 22);
    pill.fillStyle(C.seaDeep, 0.85).fillRoundedRect(px, py, 268, 44, 22);
    pill.lineStyle(3, C.ink).strokeRoundedRect(px, py, 268, 44, 22);
    medallion(pill, px + 24, py + 22, 14, C.gold);
    this.add.image(px + 24, py + 22, 'ic_coin').setScale(0.6 / TEX);
    this.berriesText = label(this, px + 48, py + 22, `${save.berries.toLocaleString('en-US')} Berries`, 17).setOrigin(0, 0.5);
    label(this, box.right - 24, box.top + 30, `Playing as ${account()?.name ?? 'Guest Captain'}`, 15).setOrigin(1, 0);
    label(this, GAME_W / 2, box.bottom - 16, 'Unofficial, non-commercial fan project. One Piece © Eiichiro Oda / Shueisha / Toei Animation.', 11, { weight: 500, color: '#f3e2b8' }).setOrigin(0.5);

    logo.setScale(1.9).setAlpha(0);
    this.tweens.add({ targets: logo, scale: 1, alpha: 1, duration: 520, ease: 'Back.Out', onComplete: () => this.cameras.main.shake(160, 0.004) });

    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      if (this.busy()) return;
      if (this.farewell) return this.closeFarewell();
      if (ev.code === 'ArrowLeft' || ev.code === 'KeyA') this.step(-1);
      else if (ev.code === 'ArrowRight' || ev.code === 'KeyD') this.step(1);
      else if (ev.code === 'Enter' || ev.code === 'Space' || ev.code === 'KeyE') this.activate();
    });
  }

  // ---- Main menu ----------------------------------------------------------------------

  private menuButton(x: number, y: number, e: MenuEntry, i: number): MenuButton {
    const c = this.add.container(x, y);
    const icon = this.add.image(0, 0, e.icon).setDisplaySize(96, 96);
    // Name shows only on hover/focus: bold display type with an ink outline, no plate.
    const name = display(this, 0, 72, e.name, 30).setOrigin(0.5).setVisible(false);
    const zone = this.add.zone(0, 0, 100, 100).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => !this.busy() && this.setFocus(i));
    zone.on('pointerout', () => this.focus === i && this.setFocus(-1));
    zone.on('pointerdown', () => !this.busy() && !this.farewell && e.act());
    c.add([icon, name, zone]);
    return { c, name, act: e.act };
  }

  /** Highlight button i, or none with -1 (mouse left the row). Keys wrap around. */
  private setFocus(i: number): void {
    this.focus = i < 0 ? -1 : (i + this.menu.length) % this.menu.length;
    this.menu.forEach((b, k) => {
      const on = k === this.focus;
      b.name.setVisible(on);
      this.tweens.killTweensOf(b.c);
      this.tweens.add({ targets: b.c, scale: on ? 1.12 : 1, duration: 120, ease: 'Back.Out' });
    });
  }

  /** Keys/pad: with nothing highlighted, the first press lands on Set Sail. */
  private step(d: number): void {
    this.setFocus(this.focus < 0 ? 3 : this.focus + d);
  }

  private activate(): void {
    if (this.focus < 0) this.setFocus(3);
    else this.menu[this.focus].act();
  }

  /** A panel, a run start or a just-closed panel's Esc should not reach the menu. */
  private busy(): boolean {
    return this.started || this.overlayOpen() || this.time.now - this.panelClosedAt < 250;
  }

  private overlayOpen(): boolean {
    return ['panel', 'profile', 'shopfront', 'gacha', 'shop'].some((k) => this.scene.isActive(k));
  }

  /** A dedicated menu scene (the Shop front desk) launched over the title with this as its host. */
  private openScene(key: string): void {
    if (this.overlayOpen()) return;
    this.scene.launch(key, { host: this, onClose: () => (this.panelClosedAt = this.time.now) });
  }

  private openPanel(cfg: PanelConfig): void {
    if (this.overlayOpen()) return;
    this.scene.launch('panel', { ...cfg, onClose: () => (this.panelClosedAt = this.time.now) });
  }

  private start(to: 'hub' | 'sail' = 'hub'): void {
    if (this.started) return;
    this.started = true;
    this.cameras.main.fadeOut(300, 8, 37, 65);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start(to));
  }

  /** Browsers only let a page close itself if a script opened it; otherwise say goodbye. */
  private quit(): void {
    window.close();
    const b = this.box;
    const g = this.add.graphics();
    g.fillStyle(C.ink, 0.9).fillRect(b.left, b.top, b.w, b.h);
    const title = display(this, GAME_W / 2, 300, 'Fair winds, Captain!', 64).setOrigin(0.5);
    gradientFill(title, '#fff3a8', '#ffb300');
    const msg = label(this, GAME_W / 2, 390, 'Your progress is saved. Close this tab to quit, or press any key to return.', 18).setOrigin(0.5);
    const zone = this.add.zone(b.left, b.top, b.w, b.h).setOrigin(0).setInteractive();
    zone.on('pointerdown', () => this.closeFarewell());
    this.farewell = this.add.container(0, 0, [g, title, msg, zone]).setDepth(1000);
    this.farewellAt = this.time.now;
  }

  private closeFarewell(): void {
    if (!this.farewell || this.time.now - this.farewellAt < 250) return;
    this.farewell.destroy(true);
    this.farewell = null;
  }

  // ---- MenuHost (panels opened from the title) ----

  persist(): void {
    writeSave(this.save);
    this.berriesText.setText(`${this.save.berries.toLocaleString('en-US')} Berries`);
  }

  reload(save: SaveData): void {
    writeSave(save);
    this.scene.stop('panel');
    this.scene.restart();
  }

  startRun(): void {
    this.scene.stop('panel');
    this.started = true;
    this.cameras.main.fadeOut(250, 8, 37, 65);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('run', { characterId: this.save.selectedCharacter, stageId: this.save.selectedStage }),
    );
  }

  private cloud(x: number, y: number, s: number): Phaser.GameObjects.Graphics {
    const g = this.add.graphics({ x, y });
    const puffs: [number, number, number][] = [[0, 10, 26], [28, -6, 32], [60, 8, 26], [30, 16, 24]];
    g.fillStyle(C.ink, 0.25);
    for (const [px, py, r] of puffs) g.fillCircle(px * s + 4, py * s + 6, (r + 3) * s);
    g.fillStyle(0xffffff);
    for (const [px, py, r] of puffs) g.fillCircle(px * s, py * s, r * s);
    g.fillStyle(0xdff3ff);
    g.fillRect(-20 * s, 16 * s, 100 * s, 10 * s);
    return g;
  }

  update(time: number, delta: number): void {
    const pad = this.input.gamepad?.total ? this.input.gamepad.pad1 : undefined;
    if (pad) {
      const now = { l: pad.left || pad.leftStick.x < -0.5, r: pad.right || pad.leftStick.x > 0.5, a: pad.A };
      if (!this.busy()) {
        if (this.farewell && now.a && !this.padPrev.a) this.closeFarewell();
        else if (!this.farewell) {
          if (now.l && !this.padPrev.l) this.step(-1);
          if (now.r && !this.padPrev.r) this.step(1);
          if (now.a && !this.padPrev.a) this.activate();
        }
      }
      this.padPrev = now;
    }
    const t = time / 1000;
    const box = this.box;
    const sky = this.sky;
    sky.clear();
    speedLines(sky, GAME_W / 2, 230, 140, Math.max(box.w, box.h) * 1.1, 36, 0xfff6c8, 0.28, t * 0.06);
    sky.fillStyle(0xfff6c8, 0.55).fillCircle(GAME_W / 2, 230, 150);
    sky.fillStyle(0xfffbe6, 0.8).fillCircle(GAME_W / 2, 230, 118);

    for (const c of this.clouds) {
      c.g.x += (c.speed * delta) / 1000;
      if (c.g.x > box.right + 120) c.g.x = box.left - 160;
    }

    drawCelSea(this.sea, box.left, box.w, HORIZON, this.deckTop + 50 - HORIZON, t); // runs under the deck rail so no gap shows
  }
}
