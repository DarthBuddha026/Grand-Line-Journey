import Phaser from 'phaser';
import { CHARACTERS } from '../../data';
import { GAME_W } from '../../config';
import { loadSave } from '../../core/save';
import { isUnlocked } from '../../core/meta';
import { Button, C, CSS, display, gradientFill, label, medallion, ribbon, speedLines } from '../ui';
import { centerCamera, relayoutOnResize, type ScreenBox } from '../layout';
import { CHAR_TEX, TEX } from '../textures';

const HORIZON = 455;
const DECK_H = 164;

/**
 * Title: a bright Grand Line morning. Sunburst behind the logo, drifting clouds, the
 * unlocked crew lined up on deck. The logo slams in once; the first click also
 * unlocks audio (browser rule). Sky, sea and deck bleed to every screen edge.
 */
export class TitleScene extends Phaser.Scene {
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
    const box = (this.box = centerCamera(this));
    relayoutOnResize(this);
    const save = loadSave();
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
    const logo = this.add.container(GAME_W / 2, 170);
    const title = gradientFill(display(this, 0, 0, 'GRAND LINE', 108, { shadow: CSS.red }).setOrigin(0.5), '#fff3a8', '#ffb300');
    const rib = this.add.graphics();
    ribbon(rib, -190, 62, 380, 64, C.red);
    const sub = display(this, 0, 94, 'SURVIVOR', 46, { shadow: null }).setOrigin(0.5);
    logo.add([title, rib, sub]).setRotation(-0.045);
    label(this, GAME_W / 2, 338, 'A survivor roguelite across the Grand Line', 20).setOrigin(0.5);

    const start = new Button(this, GAME_W / 2, 420, 320, 66, 'Set sail!', () => this.start(), 'gold');
    this.tweens.add({ targets: start, scale: 1.05, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

    // Corner info, pinned to the real screen edges
    const pill = this.add.graphics();
    const px = box.left + 20;
    const py = box.top + 20;
    pill.fillStyle(C.ink, 0.9).fillRoundedRect(px + 4, py + 4, 230, 44, 22);
    pill.fillStyle(C.seaDeep, 0.85).fillRoundedRect(px, py, 230, 44, 22);
    pill.lineStyle(3, C.ink).strokeRoundedRect(px, py, 230, 44, 22);
    medallion(pill, px + 24, py + 22, 14, C.gold);
    this.add.image(px + 24, py + 22, 'ic_coin').setScale(0.42 / TEX);
    label(this, px + 48, py + 22, `${save.berries.toLocaleString('en-US')} Berries`, 17).setOrigin(0, 0.5);
    label(this, box.right - 24, box.top + 30, `Crew ${crew.length} / ${CHARACTERS.size}   ·   Voyages ${save.runs}`, 15).setOrigin(1, 0);
    label(this, GAME_W / 2, box.bottom - 16, 'Unofficial, non-commercial fan project. One Piece © Eiichiro Oda / Shueisha / Toei Animation.', 11, { weight: 500, color: '#f3e2b8' }).setOrigin(0.5);

    logo.setScale(1.9).setAlpha(0);
    this.tweens.add({ targets: logo, scale: 1, alpha: 1, duration: 520, ease: 'Back.Out', onComplete: () => this.cameras.main.shake(160, 0.004) });

    this.input.keyboard!.once('keydown-ENTER', () => this.start());
    this.input.keyboard!.once('keydown-SPACE', () => this.start());
    this.input.gamepad?.once('down', () => this.start());
    this.input.once('pointerdown', (_p: Phaser.Input.Pointer, over: unknown[]) => {
      if (!over.length) this.start();
    });
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.cameras.main.fadeOut(300, 8, 37, 65);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('hub'));
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

    const sea = this.sea;
    sea.clear();
    const seaH = this.deckTop - HORIZON;
    sea.fillGradientStyle(0x1b8fd0, 0x1b8fd0, 0x0f3b63, 0x0f3b63, 1).fillRect(box.left, HORIZON, box.w, seaH);
    sea.fillStyle(0xffffff, 0.75).fillRect(box.left, HORIZON, box.w, 3);
    const rows = Math.max(3, Math.floor((seaH - 20) / 30));
    for (let row = 0; row < rows; row++) {
      const y = HORIZON + 22 + row * 30;
      sea.lineStyle(3 + Math.min(row, 4), 0xe6f7ff, Math.min(0.75, 0.35 + row * 0.1));
      for (let x = box.left - 80; x < box.right + 80; x += 140) {
        const ox = x + ((t * (18 + row * 8)) % 140) + (row % 2) * 70;
        sea.beginPath();
        sea.arc(ox, y + Math.sin(t * 2 + x) * 2, 26 + Math.min(row, 4) * 4, Math.PI * 1.15, Math.PI * 1.85, false);
        sea.strokePath();
      }
    }
  }
}
