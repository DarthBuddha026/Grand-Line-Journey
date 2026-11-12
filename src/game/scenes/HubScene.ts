import Phaser from 'phaser';
import { CHARACTERS, STAGES } from '../../data';
import { GAME_W } from '../../config';
import { centerCamera, relayoutOnResize, type ScreenBox } from '../layout';
import { CHAR_TEX, TEX } from '../textures';
import { loadSave, writeSave, type SaveData } from '../../core/save';
import { isStageOpen, isUnlocked, rankFor } from '../../core/meta';
import { burst, Button, C, CSS, display, hintRow, inkPanel, keycap, label, medallion, ribbon } from '../ui';
import { boardMenu, crewMenu, hakiMenu, logMenu, shopMenu, stageMenu, type MenuHost } from '../menus';
import type { PanelConfig } from './PanelScene';

interface Station {
  id: string;
  name: string;
  verb: string;
  x: number;
  y: number;
  icon: string;
  color: number;
  menu: () => PanelConfig;
  sign?: Phaser.GameObjects.Container;
}

const DECK = { x: 150, y: 140, w: 930, h: 450 };
const SPEED = 230;

/**
 * The Thousand Sunny: a walkable hub instead of menus. Walk to a signboard and press
 * E (or click it) to open its logbook panel.
 */
export class HubScene extends Phaser.Scene implements MenuHost {
  save!: SaveData;
  private avatar!: Phaser.GameObjects.Image;
  private avatarShadow!: Phaser.GameObjects.Image;
  private bubble!: Phaser.GameObjects.Container;
  private bubbleText!: Phaser.GameObjects.Text;
  private sea!: Phaser.GameObjects.Graphics;
  private plate!: Phaser.GameObjects.Container;
  private stations: Station[] = [];
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private near: Station | null = null;
  private padPrevA = true;
  private padPrevStart = true;
  private box!: ScreenBox;
  private startAt: { ax: number; ay: number } | null = null;

  constructor() {
    super('hub');
  }

  init(data: { ax?: number; ay?: number }): void {
    this.startAt = data?.ax !== undefined && data.ay !== undefined ? { ax: data.ax, ay: data.ay } : null;
  }

  create(): void {
    this.box = centerCamera(this);
    relayoutOnResize(this, () => ({ ax: this.avatar.x, ay: this.avatar.y }));
    this.save = loadSave();
    if (!isUnlocked(this.save, this.save.selectedCharacter)) this.save.selectedCharacter = 'luffy';
    if (!isStageOpen(this.save, this.save.selectedStage)) this.save.selectedStage = 'shells_town';
    this.near = null;
    this.cameras.main.setBackgroundColor(C.sea).fadeIn(300, 8, 37, 65);
    this.sea = this.add.graphics().setDepth(-10);
    this.drawShip();

    this.stations = [
      { id: 'sail', name: 'Lion Figurehead', verb: 'Set sail', x: 1010, y: 365, icon: 'ic_compass', color: C.gold, menu: () => stageMenu(this) },
      { id: 'crew', name: 'Crew Quarters', verb: 'Choose your captain', x: 330, y: 245, icon: 'ic_crown', color: C.seaMid, menu: () => crewMenu(this) },
      { id: 'shop', name: 'Shipwright', verb: 'Buy upgrades', x: 330, y: 500, icon: 'ic_anvil', color: C.teal, menu: () => shopMenu(this) },
      { id: 'haki', name: 'Haki Dojo', verb: 'Equip Haki', x: 640, y: 225, icon: 'ic_haki', color: C.violet, menu: () => hakiMenu(this) },
      { id: 'board', name: 'Bounty Board', verb: 'Check records', x: 640, y: 520, icon: 'ic_poster', color: C.red, menu: () => boardMenu(this) },
      { id: 'log', name: "Captain's Log", verb: 'Manage save', x: 205, y: 370, icon: 'ic_book', color: C.wood, menu: () => logMenu(this) },
    ];
    for (const s of this.stations) s.sign = this.makeSign(s);

    const ax = this.startAt?.ax ?? 760;
    const ay = this.startAt?.ay ?? 370;
    this.avatarShadow = this.add.image(ax, ay + 2, 'shadow').setScale(3.2 / TEX).setAlpha(0.7);
    this.avatar = this.add.image(ax, ay, `player_${this.save.selectedCharacter}`).setScale(3.4 / CHAR_TEX).setOrigin(0.5, 0.9);
    this.makeBubble();
    this.plate = this.add.container(0, 0).setDepth(2000);
    this.refreshHeader();

    hintRow(this, GAME_W / 2, this.box.bottom - 30, [['WASD', 'Walk'], ['E', 'Use'], ['Esc', 'Main menu']], CSS.white).setDepth(2000);
    new Button(this, this.box.left + 110, this.box.bottom - 34, 170, 46, 'Main menu', () => this.toTitle(), 'sea').setDepth(2000);

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      if (this.scene.isActive('panel')) return;
      if ((ev.code === 'KeyE' || ev.code === 'Enter' || ev.code === 'Space') && this.near) this.open(this.near);
      // The Esc that closes a logbook must not also leave the ship.
      else if (ev.code === 'Escape' && this.time.now - this.panelClosedAt > 250) this.toTitle();
    });
  }

  private panelClosedAt = 0;
  private leaving = false;

  /** Back to the title screen (the main menu). */
  toTitle(): void {
    if (this.leaving || this.scene.isActive('panel')) return;
    this.leaving = true;
    this.cameras.main.fadeOut(250, 8, 37, 65);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.leaving = false;
      this.scene.start('title');
    });
  }

  // ---- Drawing --------------------------------------------------------------------------

  private drawShip(): void {
    const g = this.add.graphics().setDepth(-5);
    const { x, y, w, h } = DECK;
    // Hull with a hard ink shadow on the water
    g.fillStyle(C.seaDeep, 0.7).fillRoundedRect(x - 10, y + 2, w + 40, h + 40, 90);
    // Bow point toward the figurehead
    const bow = [
      { x: x + w - 60, y: y - 18 },
      { x: x + w + 150, y: y + h / 2 },
      { x: x + w - 60, y: y + h + 18 },
    ];
    g.fillStyle(C.ink).fillPoints(bow.map((p) => ({ x: p.x + 6, y: p.y + 6 })), true);
    g.fillStyle(C.woodDark).fillPoints(bow, true);
    g.lineStyle(4, C.ink).strokePoints(bow, true, true);
    g.fillStyle(C.ink).fillRoundedRect(x - 24, y - 24, w + 48, h + 48, 80);
    g.fillStyle(C.woodDark).fillRoundedRect(x - 20, y - 20, w + 40, h + 40, 78);
    g.fillStyle(C.wood).fillRoundedRect(x - 12, y - 12, w + 24, h + 24, 70);
    // Deck planks
    g.fillStyle(C.woodLight).fillRoundedRect(x, y, w, h, 60);
    g.lineStyle(2, C.wood, 0.75);
    for (let py = y + 22; py < y + h - 10; py += 26) g.lineBetween(x + 24, py, x + w - 24, py);
    g.lineStyle(2, C.wood, 0.35);
    for (let px = x + 70; px < x + w; px += 150) for (let py = y + 22; py < y + h - 10; py += 52) g.lineBetween(px, py, px, py + 26);
    g.lineStyle(4, C.ink).strokeRoundedRect(x, y, w, h, 60);
    // Rail posts
    g.fillStyle(C.woodDark);
    for (let px = x + 60; px < x + w - 40; px += 70) {
      g.fillCircle(px, y - 4, 6).fillCircle(px, y + h + 4, 6);
    }
    // Lawn deck (the Sunny's grass)
    g.fillStyle(C.ink).fillRoundedRect(x + 266, y + 116, 440, 220, 40);
    g.fillStyle(0x58b04a).fillRoundedRect(x + 260, y + 110, 440, 220, 40);
    g.fillStyle(0x6fcf5c);
    for (let i = 0; i < 70; i++) g.fillRect(x + 280 + ((i * 53) % 400), y + 126 + ((i * 37) % 190), 5, 2);
    g.lineStyle(3, C.ink).strokeRoundedRect(x + 260, y + 110, 440, 220, 40);
    // Mast and a furled sail shadow
    g.fillStyle(C.ink).fillCircle(x + 484, y + 224, 24);
    g.fillStyle(C.woodDark).fillCircle(x + 480, y + 220, 22);
    g.fillStyle(C.parchLight).fillCircle(x + 480, y + 220, 10);
    // Lion figurehead: gold mane burst with a face
    const fx = x + w + 104;
    const fy = y + h / 2;
    burst(g, fx, fy, 62, 14, C.gold, 0.1);
    burst(g, fx, fy, 46, 12, C.goldDeep, 0.35);
    g.fillStyle(C.ink).fillCircle(fx + 3, fy + 3, 30);
    g.fillStyle(0xffe08a).fillCircle(fx, fy, 30);
    g.lineStyle(3, C.ink).strokeCircle(fx, fy, 30);
    g.fillStyle(C.ink).fillCircle(fx - 10, fy - 6, 4).fillCircle(fx + 10, fy - 6, 4).fillTriangle(fx - 5, fy + 4, fx + 5, fy + 4, fx, fy + 10);
    g.lineStyle(3, C.ink);
    g.beginPath();
    g.arc(fx, fy + 10, 10, 0.3, Math.PI - 0.3, false);
    g.strokePath();
  }

  private makeSign(s: Station): Phaser.GameObjects.Container {
    const c = this.add.container(s.x, s.y);
    const g = this.add.graphics();
    // post
    g.fillStyle(C.ink).fillRect(-5, -6, 12, 44);
    g.fillStyle(C.woodDark).fillRect(-6, -8, 10, 44);
    // plank
    inkPanel(g, -74, 16, 148, 38, { fill: C.woodLight, skew: 8, shadow: 5 });
    g.lineStyle(2, C.wood, 0.8).lineBetween(-62, 35, 62, 35);
    medallion(g, 0, -26, 25, s.color);
    const icon = this.add.image(0, -26, s.icon).setScale(0.62 / TEX);
    const t = label(this, 0, 34, s.name, 15, { onDark: false, color: CSS.ink }).setOrigin(0.5);
    c.add([g, icon, t]);
    c.setSize(160, 110).setDepth(s.y + 40);
    const zone = this.add.zone(0, 10, 170, 120).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => this.open(s));
    zone.on('pointerover', () => c.setScale(1.06));
    zone.on('pointerout', () => c.setScale(this.near === s ? 1.08 : 1));
    c.add(zone);
    return c;
  }

  private makeBubble(): void {
    const g = this.add.graphics();
    this.bubbleText = label(this, 18, -2, '', 16, { onDark: false, color: CSS.ink }).setOrigin(0, 0.5);
    const cap = keycap(this, -6, -2, 'E', 14);
    this.bubble = this.add.container(0, 0, [g, cap, this.bubbleText]).setVisible(false);
    this.bubble.setData('g', g);
  }

  private drawBubble(): void {
    const g = this.bubble.getData('g') as Phaser.GameObjects.Graphics;
    const w = this.bubbleText.width + 56;
    g.clear();
    const x = -30;
    g.fillStyle(C.ink).fillRoundedRect(x + 4, -22, w, 40, 18);
    g.fillStyle(C.white).fillRoundedRect(x, -26, w, 40, 18);
    g.fillTriangle(x + 22, 12, x + 40, 12, x + 18, 28);
    g.lineStyle(3, C.ink).strokeRoundedRect(x, -26, w, 40, 18);
    g.lineBetween(x + 22, 14, x + 18, 28).lineBetween(x + 18, 28, x + 40, 14);
    g.fillStyle(C.white).fillRect(x + 22, 10, 17, 5);
  }

  /** Top bar: captain portrait plate, Berries and next voyage. */
  refreshHeader(): void {
    const c = CHARACTERS.get(this.save.selectedCharacter)!;
    const st = STAGES.get(this.save.selectedStage)!;
    const rank = rankFor(this.save.charXp[c.id] ?? 0);
    this.avatar?.setTexture(`player_${c.id}`);
    this.plate.removeAll(true);
    this.plate.setPosition(this.box.left, this.box.top);
    const W = this.box.w;
    const g = this.add.graphics();
    inkPanel(g, 70, 22, 330, 64, { fill: C.seaDeep, skew: 18, shadow: 5 });
    medallion(g, 64, 54, 38, C.parch);
    const portrait = this.add.image(64, 64, `player_${c.id}`).setScale(2.9 / CHAR_TEX).setOrigin(0.5, 0.8);
    const name = display(this, 112, 30, c.name, 24, { shadow: null }).setOrigin(0, 0);
    for (let i = 0; i < 5; i++) burst(g, 122 + i * 19, 72, 8, 5, i < rank ? C.gold : 0x2a3f55, -Math.PI / 2);
    const stars = label(this, 222, 72, `Bounty rank ${rank}`, 13, { color: CSS.gold }).setOrigin(0, 0.5);

    inkPanel(g, W - 300, 22, 270, 46, { fill: C.seaDeep, skew: 14, shadow: 5 });
    medallion(g, W - 292, 45, 17, C.gold);
    const coin = this.add.image(W - 292, 45, 'ic_coin').setScale(0.5 / TEX);
    const berries = display(this, W - 266, 45, `${this.save.berries.toLocaleString('en-US')}`, 22, { shadow: null, color: CSS.gold }).setOrigin(0, 0.5);
    ribbon(g, W - 290, 84, 250, 34, C.red, { tails: false, shadow: 4 });
    const voyage = label(this, W - 165, 101, `Next voyage: ${st.name}`, 14).setOrigin(0.5);
    this.plate.add([g, portrait, name, stars, coin, berries, voyage]);
  }

  // ---- Loop -----------------------------------------------------------------------------

  update(time: number, deltaMs: number): void {
    this.drawSea(time / 1000);
    if (this.scene.isActive('panel')) {
      this.bubble.setVisible(false);
      return;
    }
    const dt = Math.min(deltaMs / 1000, 1 / 30);
    const k = this.keys;
    let mx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    let my = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    const pad = this.input.gamepad?.total ? this.input.gamepad.pad1 : undefined;
    if (pad && Math.hypot(pad.leftStick.x, pad.leftStick.y) > 0.2) {
      mx = pad.leftStick.x;
      my = pad.leftStick.y;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const a = this.avatar;
    a.x = Phaser.Math.Clamp(a.x + mx * SPEED * dt, DECK.x + 30, DECK.x + DECK.w + 70);
    a.y = Phaser.Math.Clamp(a.y + my * SPEED * dt, DECK.y + 40, DECK.y + DECK.h - 4);
    if (mx) a.setFlipX(mx < 0);
    const walking = len > 0.1;
    a.setAngle(walking ? Math.sin(time / 70) * 5 : 0);
    this.avatarShadow.setPosition(a.x + 2, a.y + 2);
    a.setDepth(a.y);
    this.avatarShadow.setDepth(a.y - 1);

    let near: Station | null = null;
    let best = 125 * 125;
    for (const s of this.stations) {
      const d = (s.x - a.x) ** 2 + (s.y + 20 - a.y) ** 2;
      if (d < best) {
        best = d;
        near = s;
      }
    }
    if (near !== this.near) {
      for (const s of this.stations) s.sign?.setScale(s === near ? 1.08 : 1);
      this.near = near;
      if (near) {
        this.bubbleText.setText(near.verb);
        this.drawBubble();
      }
    }
    this.bubble.setVisible(!!near).setPosition(a.x - 4, a.y - 74 + Math.sin(time / 200) * 2).setDepth(1000);
    if (pad) {
      if (pad.A && !this.padPrevA && this.near) this.open(this.near);
      this.padPrevA = pad.A;
      const start = pad.buttons[9]?.pressed ?? false;
      if (start && !this.padPrevStart) this.toTitle();
      this.padPrevStart = start;
    }
  }

  private drawSea(t: number): void {
    const g = this.sea;
    g.clear();
    g.fillGradientStyle(0x1b6fa8, 0x1b6fa8, 0x0a2a4a, 0x0a2a4a, 1).fillRect(this.box.left, this.box.top, this.box.w, this.box.h);
    for (let row = 0; row < Math.ceil(this.box.h / 62) + 1; row++) {
      const y = this.box.top + 20 + row * 62;
      g.lineStyle(3, 0xe6f7ff, 0.12 + (row % 3) * 0.05);
      for (let x = this.box.left - 100; x < this.box.right + 100; x += 170) {
        const ox = x + ((t * 14 + row * 37) % 170);
        g.beginPath();
        g.arc(ox, y + Math.sin(t * 1.5 + row) * 3, 22, Math.PI * 1.15, Math.PI * 1.85, false);
        g.strokePath();
      }
    }
    // Wake behind the stern
    g.fillStyle(0xe6f7ff, 0.18);
    for (let i = 0; i < 6; i++) g.fillEllipse(DECK.x - 40 - i * 34, DECK.y + DECK.h / 2 + Math.sin(t * 2 + i) * 6, 50 - i * 5, 110 - i * 12);
  }

  private open(s: Station): void {
    if (this.scene.isActive('panel')) return;
    this.scene.launch('panel', {
      ...s.menu(),
      onClose: () => {
        this.panelClosedAt = this.time.now;
        this.refreshHeader();
      },
    });
  }

  // ---- MenuHost ----

  persist(): void {
    writeSave(this.save);
    this.refreshHeader();
  }

  reload(save: SaveData): void {
    this.save = save;
    writeSave(save);
    this.scene.stop('panel');
    this.scene.restart();
  }

  startRun(): void {
    this.scene.stop('panel');
    this.cameras.main.fadeOut(250, 8, 37, 65);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.scene.start('run', { characterId: this.save.selectedCharacter, stageId: this.save.selectedStage }),
    );
  }
}

