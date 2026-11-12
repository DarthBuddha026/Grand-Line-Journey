import Phaser from 'phaser';
import { GAME_W } from '../../config';
import { backdrop, C, CSS, display, hintRow, inkPanel, label, medallion, parchment, ribbon } from '../ui';
import { centerCamera, relayoutOnResize } from '../layout';
import { CHAR_TEX, TEX } from '../textures';

export interface PanelItem {
  label: string;
  right?: string;
  /** Section header row (not selectable). */
  header?: boolean;
  enabled?: boolean;
  /** Medallion colour behind the icon. */
  color?: number;
  /** Icon texture key (ic_*). */
  icon?: string;
  /** Large sprite shown on the detail page (characters). */
  portrait?: string;
  detail?: string;
  onSelect?: () => void;
}

export interface PanelConfig {
  title: string;
  /** Re-evaluated after every action so prices, levels and Berries stay current. */
  status: () => string;
  items: () => PanelItem[];
  hint?: string;
  onClose?: () => void;
}

const FRAME = { x: 40, y: 72, w: 1200, h: 610 };
const LIST = { x: 80, y: 112, w: 600 };
const DETAIL = { x: 730, y: 112, w: 470 };
const ROW_H = 40;
const VISIBLE = 12;

/**
 * The ship's logbook: a wooden frame holding two parchment pages, a list on the
 * left and the selected entry's details on the right. Used by every hub station.
 */
export class PanelScene extends Phaser.Scene {
  private cfg!: PanelConfig;
  private items: PanelItem[] = [];
  private selected = 0;
  private scroll = 0;
  private listLayer!: Phaser.GameObjects.Container;
  private detailLayer!: Phaser.GameObjects.Container;
  private statusText!: Phaser.GameObjects.Text;
  private statusGfx!: Phaser.GameObjects.Graphics;
  private padPrev = { up: true, down: true, a: true, b: true };
  private openedAt = 0;

  constructor() {
    super('panel');
  }

  init(cfg: PanelConfig): void {
    this.cfg = cfg;
    this.selected = 0;
    this.scroll = 0;
    this.padPrev = { up: true, down: true, a: true, b: true };
  }

  create(): void {
    this.openedAt = this.time.now;
    const box = centerCamera(this);
    relayoutOnResize(this, () => this.cfg);
    backdrop(this, box.w, box.h, 0.86)
      .setPosition(box.left, box.top)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, box.w, box.h), Phaser.Geom.Rectangle.Contains);

    const g = this.add.graphics();
    const { x, y, w, h } = FRAME;
    inkPanel(g, x, y, w, h, { fill: C.woodDark, radius: 16, shadow: 8, stroke: 4 });
    g.lineStyle(3, C.wood).strokeRoundedRect(x + 8, y + 8, w - 16, h - 16, 12);
    // Brass corners
    for (const [cx, cy] of [[x + 14, y + 14], [x + w - 14, y + 14], [x + 14, y + h - 14], [x + w - 14, y + h - 14]]) {
      g.fillStyle(C.gold).fillCircle(cx, cy, 6);
      g.lineStyle(2, C.ink).strokeCircle(cx, cy, 6);
    }
    parchment(g, 62, 94, 640, 518, 3, { shadow: 0 });
    parchment(g, 706, 94, 512, 518, 7, { shadow: 0 });
    g.fillStyle(C.ink, 0.25).fillRect(702, 96, 8, 514); // spine

    const title = display(this, 0, 0, this.cfg.title, 28, { shadow: null });
    const tw = title.width + 60;
    ribbon(g, 96, 44, tw, 54, C.red);
    title.setPosition(96 + tw / 2, 71).setOrigin(0.5).setDepth(1);

    this.statusGfx = this.add.graphics();
    this.statusText = label(this, 0, 0, '', 16, { onDark: false, color: CSS.ink }).setOrigin(1, 0.5);

    // Close medallion
    const close = this.add.graphics();
    medallion(close, FRAME.x + FRAME.w - 6, FRAME.y + 4, 20, C.red);
    display(this, FRAME.x + FRAME.w - 6, FRAME.y + 3, '×', 26, { shadow: null }).setOrigin(0.5);
    this.add.zone(FRAME.x + FRAME.w - 6, FRAME.y + 4, 52, 52).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.close());

    if (this.cfg.hint) label(this, GAME_W / 2, 628, this.cfg.hint, 13, { weight: 500, color: '#f3e2b8' }).setOrigin(0.5);
    hintRow(this, GAME_W / 2, 656, [['↑↓', 'Select'], ['Enter', 'Choose'], ['Esc', 'Close']], CSS.white);

    this.listLayer = this.add.container(0, 0);
    this.detailLayer = this.add.container(0, 0);

    const kb = this.input.keyboard!;
    kb.on('keydown', (ev: KeyboardEvent) => {
      if (ev.code === 'ArrowUp' || ev.code === 'KeyW') this.move(-1);
      else if (ev.code === 'ArrowDown' || ev.code === 'KeyS') this.move(1);
      else if (ev.code === 'Enter' || ev.code === 'Space' || ev.code === 'KeyE') this.choose(this.selected);
      else if (ev.code === 'Escape') this.close();
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.scroll = Phaser.Math.Clamp(this.scroll + Math.sign(dy) * 2, 0, Math.max(0, this.items.length - VISIBLE));
      this.renderList();
    });

    this.refresh();
    this.selected = Math.max(0, this.items.findIndex((i) => !i.header));
    this.render();

    // Open: the book drops in.
    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 140 });
  }

  update(): void {
    const pad = this.input.gamepad?.total ? this.input.gamepad.pad1 : undefined;
    if (!pad) return;
    const up = pad.up || pad.leftStick.y < -0.5;
    const down = pad.down || pad.leftStick.y > 0.5;
    if (up && !this.padPrev.up) this.move(-1);
    if (down && !this.padPrev.down) this.move(1);
    if (pad.A && !this.padPrev.a) this.choose(this.selected);
    if (pad.B && !this.padPrev.b) this.close();
    this.padPrev = { up, down, a: pad.A, b: pad.B };
  }

  refresh(): void {
    this.items = this.cfg.items();
    const status = this.cfg.status();
    this.statusText.setText(status);
    const sw = this.statusText.width + 44;
    const sx = FRAME.x + FRAME.w - 60 - sw;
    this.statusGfx.clear();
    inkPanel(this.statusGfx, sx, 46, sw, 40, { fill: C.gold, skew: 14, shadow: 4 });
    this.statusText.setPosition(sx + sw - 22, 66);
  }

  private move(d: number): void {
    if (!this.items.length) return;
    let i = this.selected;
    for (let k = 0; k < this.items.length; k++) {
      i = (i + d + this.items.length) % this.items.length;
      if (!this.items[i].header) break;
    }
    this.selected = i;
    if (this.selected < this.scroll) this.scroll = this.selected;
    if (this.selected >= this.scroll + VISIBLE) this.scroll = this.selected - VISIBLE + 1;
    this.render();
  }

  private choose(i: number): void {
    if (this.time.now - this.openedAt < 200) return;
    const item = this.items[i];
    if (!item || item.header || item.enabled === false || !item.onSelect) return;
    item.onSelect();
    if (!this.scene.isActive()) return; // e.g. set sail closed the panel
    this.refresh();
    this.render();
    this.cameras.main.flash(90, 255, 230, 140);
  }

  private render(): void {
    this.renderList();
    this.renderDetail();
  }

  private renderList(): void {
    this.listLayer.removeAll(true);
    const end = Math.min(this.items.length, this.scroll + VISIBLE);
    const g = this.add.graphics();
    this.listLayer.add(g);
    for (let i = this.scroll; i < end; i++) {
      const item = this.items[i];
      const y = LIST.y + (i - this.scroll) * ROW_H;
      if (item.header) {
        const t = label(this, LIST.x + 16, y + 21, item.label, 14).setOrigin(0, 0.5);
        inkPanel(g, LIST.x, y + 8, t.width + 34, 26, { fill: C.red, skew: 10, shadow: 3, stroke: 2.5 });
        this.listLayer.add(t);
        continue;
      }
      const on = i === this.selected;
      const dim = item.enabled === false;
      if (on) inkPanel(g, LIST.x - 4, y + 3, LIST.w + 8, ROW_H - 4, { fill: C.gold, skew: 12, shadow: 4, stroke: 2.5 });
      else g.lineStyle(1, C.parchEdge, 0.5).lineBetween(LIST.x + 10, y + ROW_H - 1, LIST.x + LIST.w - 10, y + ROW_H - 1);
      let tx = LIST.x + 16;
      if (item.icon || item.color !== undefined) {
        g.fillStyle(C.ink).fillCircle(LIST.x + 32, y + ROW_H / 2 + 2, 15);
        g.fillStyle(item.color ?? C.seaMid).fillCircle(LIST.x + 30, y + ROW_H / 2, 15);
        g.lineStyle(2, C.ink).strokeCircle(LIST.x + 30, y + ROW_H / 2, 15);
        if (item.icon) this.listLayer.add(this.add.image(LIST.x + 30, y + ROW_H / 2, item.icon).setScale(0.36 / TEX).setAlpha(dim ? 0.5 : 1));
        tx = LIST.x + 56;
      }
      const name = label(this, tx, y + ROW_H / 2, item.label, 17, { onDark: false, color: CSS.ink }).setOrigin(0, 0.5).setAlpha(dim && !on ? 0.45 : 1);
      const right = label(this, LIST.x + LIST.w - 18, y + ROW_H / 2, item.right ?? '', 15, { onDark: false, color: on ? CSS.ink : '#8a3a1e' })
        .setOrigin(1, 0.5)
        .setAlpha(dim && !on ? 0.55 : 1);
      const zone = this.add.zone(LIST.x + LIST.w / 2, y + ROW_H / 2, LIST.w, ROW_H).setInteractive({ useHandCursor: !dim });
      zone.on('pointerover', () => {
        if (this.selected !== i) {
          this.selected = i;
          this.render();
        }
      });
      zone.on('pointerdown', () => this.choose(i));
      this.listLayer.add([name, right, zone]);
    }
    if (this.items.length > VISIBLE) {
      const more = `${this.scroll + 1}–${end} of ${this.items.length}  ·  scroll for more`;
      this.listLayer.add(label(this, LIST.x + LIST.w / 2, 596, more, 13, { onDark: false, color: '#8a6a3a', weight: 500 }).setOrigin(0.5));
    }
  }

  private renderDetail(): void {
    this.detailLayer.removeAll(true);
    const item = this.items[this.selected];
    if (!item || item.header) return;
    let y = DETAIL.y + 6;
    const cx = DETAIL.x + DETAIL.w / 2;
    const g = this.add.graphics();
    this.detailLayer.add(g);
    if (item.portrait || item.icon) {
      medallion(g, cx, y + 48, 44, item.color ?? C.seaMid);
      g.lineStyle(2, C.parchEdge, 0.6).lineBetween(DETAIL.x + 20, y + 48, cx - 60, y + 48).lineBetween(cx + 60, y + 48, DETAIL.x + DETAIL.w - 20, y + 48);
      if (item.portrait) this.detailLayer.add(this.add.image(cx, y + 50, item.portrait).setScale(3.4 / CHAR_TEX).setOrigin(0.5, 0.5));
      else if (item.icon) this.detailLayer.add(this.add.image(cx, y + 48, item.icon).setScale(1 / TEX));
      y += 104;
    }
    const heading = display(this, cx, y, item.label, 24, { color: CSS.red, shadow: null, style: { align: 'center', wordWrap: { width: DETAIL.w - 30 } } }).setOrigin(0.5, 0);
    y += heading.height + 4;
    if (item.right) {
      this.detailLayer.add(label(this, cx, y, item.right, 15, { onDark: false, color: '#8a3a1e' }).setOrigin(0.5, 0));
      y += 26;
    }
    g.lineStyle(2, C.parchEdge, 0.6).lineBetween(DETAIL.x + 30, y + 4, DETAIL.x + DETAIL.w - 30, y + 4);
    const body = label(this, DETAIL.x + 22, y + 12, item.detail ?? '', 14, {
      onDark: false,
      weight: 500,
      color: CSS.ink,
      style: { wordWrap: { width: DETAIL.w - 44 }, lineSpacing: 3 },
    });
    this.detailLayer.add([heading, body]);
  }

  private close(): void {
    this.scene.stop();
    this.cfg.onClose?.();
  }
}
