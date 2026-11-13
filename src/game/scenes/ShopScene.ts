import Phaser from 'phaser';
import { SHOP, type ShopUpgradeDef } from '../../data';
import { buyShop, shopCost, shopLevel } from '../../core/meta';
import type { MenuHost } from '../menus';
import { backdrop, C, CSS, display, inkPanel, label, medallion, screenChrome } from '../ui';
import { centerCamera, relayoutOnResize } from '../layout';
import { TEX } from '../textures';

export interface ShopData {
  host: MenuHost;
  tab?: number;
  onClose?: () => void;
}

const SHOP_ICON: Record<string, string> = {
  hp: 'heart', atk: 'sword', spd: 'dash', crit: 'star', haste: 'hourglass', pickup: 'magnet', xp: 'book',
  rerolls: 'compass', holds: 'card', eliminates: 'skull', revive: 'heart',
};

/** Abilities change the rules of a run (meta counts); Stats are permanent stat boosts. */
const TABS: { name: string; icon: string; color: number; items: ShopUpgradeDef[] }[] = [
  { name: 'Abilities', icon: 'ic_star', color: C.gold, items: [...SHOP.values()].filter((d) => d.meta) },
  { name: 'Stats', icon: 'ic_sword', color: C.red, items: [...SHOP.values()].filter((d) => !d.meta) },
];

const TAB = { x: 50, y: 96, w: 280, h: 112, gap: 14 };
const GRID = { x: 360, y: 96, cols: 3, icon: 92, info: 148, h: 92, gapX: 22, gapY: 14 };
const DESC = { x: 360, y: 478, w: 880, h: 170 };

/**
 * The Shipwright: category tabs on the left, a grid of upgrade tiles (icon, level pips,
 * price or SOLD!) and a description box. Buying is permanent and paid in Berries.
 */
export class ShopScene extends Phaser.Scene {
  private d!: ShopData;
  private tab = 0;
  private sel = 0;
  private inGrid = false;
  private layer!: Phaser.GameObjects.Container;
  private berriesText!: Phaser.GameObjects.Text;
  private openedAt = 0;
  private padPrev = { l: true, r: true, u: true, dn: true, a: true, b: true };

  constructor() {
    super('shop');
  }

  init(d: ShopData): void {
    this.d = d;
    this.tab = Phaser.Math.Clamp(d.tab ?? 0, 0, TABS.length - 1);
    this.sel = 0;
    this.inGrid = false;
    this.padPrev = { l: true, r: true, u: true, dn: true, a: true, b: true };
  }

  create(): void {
    this.openedAt = this.time.now;
    const box = centerCamera(this);
    relayoutOnResize(this, () => ({ ...this.d, tab: this.tab }));
    backdrop(this, box.w, box.h, 0.92)
      .setPosition(box.left, box.top)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, box.w, box.h), Phaser.Geom.Rectangle.Contains);
    this.berriesText = screenChrome(this, box, 'SHIPWRIGHT', [['↑↓←→', 'Select'], ['Enter', 'Buy'], ['Esc', 'Back']]);
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
    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 140 });
  }

  update(): void {
    const pad = this.input.gamepad?.total ? this.input.gamepad.pad1 : undefined;
    if (!pad) return;
    const s = pad.leftStick;
    const now = { l: pad.left || s.x < -0.5, r: pad.right || s.x > 0.5, u: pad.up || s.y < -0.5, dn: pad.down || s.y > 0.5, a: pad.A, b: pad.B };
    const p = this.padPrev;
    if (now.l && !p.l) this.nav(-1, 0);
    if (now.r && !p.r) this.nav(1, 0);
    if (now.u && !p.u) this.nav(0, -1);
    if (now.dn && !p.dn) this.nav(0, 1);
    if (now.a && !p.a) this.confirm();
    if (now.b && !p.b) this.back();
    this.padPrev = now;
  }

  // ---- Flow -------------------------------------------------------------------------------

  private get items(): ShopUpgradeDef[] {
    return TABS[this.tab].items;
  }

  /** Tabs: ↑↓ switch tab, → enters the grid. Grid: arrows move, ← from column 0 returns to the tabs. */
  private nav(dx: number, dy: number): void {
    if (!this.inGrid) {
      if (dy) {
        this.tab = (this.tab + dy + TABS.length) % TABS.length;
        this.sel = 0;
      } else if (dx > 0) this.inGrid = true;
    } else {
      const n = this.items.length;
      const col = this.sel % GRID.cols;
      if (dx < 0 && col === 0) this.inGrid = false;
      else if (dx) this.sel = Phaser.Math.Clamp(this.sel + dx, 0, n - 1);
      else {
        const next = this.sel + dy * GRID.cols;
        if (next >= 0 && next < n) this.sel = next;
      }
    }
    this.render();
  }

  private confirm(): void {
    if (this.time.now - this.openedAt < 200) return;
    if (!this.inGrid) {
      this.inGrid = true;
      this.render();
      return;
    }
    this.buy(this.sel);
  }

  private buy(i: number): void {
    const def = this.items[i];
    if (!def || !buyShop(this.d.host.save, def.id)) {
      this.cameras.main.shake(120, 0.004);
      return;
    }
    this.d.host.persist();
    this.render();
    this.cameras.main.flash(90, 255, 230, 140);
  }

  private back(): void {
    if (this.inGrid) {
      this.inGrid = false;
      this.render();
      return;
    }
    this.scene.stop();
    this.d.onClose?.();
  }

  // ---- Drawing ----------------------------------------------------------------------------

  private render(): void {
    this.layer.removeAll(true);
    this.berriesText.setText(this.d.host.save.berries.toLocaleString('en-US'));
    this.drawTabs();
    this.drawGrid();
    this.drawDesc();
  }

  private drawTabs(): void {
    const g = this.add.graphics();
    this.layer.add(g);
    // Frame behind the tab column
    const fh = TABS.length * (TAB.h + TAB.gap) + 18;
    inkPanel(g, TAB.x - 10, TAB.y - 10, TAB.w + 20, fh, { fill: C.seaDeep, alpha: 0.9, radius: 8, shadow: 6, stroke: 3 });
    g.lineStyle(3, C.seaLight).strokeRoundedRect(TAB.x - 4, TAB.y - 4, TAB.w + 8, fh - 12, 6);
    TABS.forEach((t, i) => {
      const y = TAB.y + i * (TAB.h + TAB.gap);
      const on = i === this.tab;
      inkPanel(g, TAB.x, y, TAB.w, TAB.h, {
        fill: on ? C.seaMid : 0x123a5c,
        radius: 4,
        shadow: 0,
        stroke: on ? 4 : 2,
        strokeColor: on && !this.inGrid ? C.gold : on ? C.white : C.ink,
      });
      if (on) g.fillStyle(0xffffff, 0.14).fillRect(TAB.x + 3, y + 3, TAB.w - 6, TAB.h * 0.4);
      const name = display(this, TAB.x + 18, y + TAB.h / 2, t.name, 28, { shadow: null, color: on ? CSS.goldLight : '#9fb7cc' }).setOrigin(0, 0.5);
      medallion(g, TAB.x + TAB.w - 52, y + TAB.h / 2, 34, on ? t.color : 0x2a3f55);
      const icon = this.add.image(TAB.x + TAB.w - 52, y + TAB.h / 2, t.icon).setScale(0.8 / TEX).setAlpha(on ? 1 : 0.5);
      const zone = this.add.zone(TAB.x + TAB.w / 2, y + TAB.h / 2, TAB.w, TAB.h).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => {
        if (this.tab === i && !this.inGrid) return;
        if (this.tab !== i) this.sel = 0;
        this.tab = i;
        this.inGrid = false;
        this.render();
      });
      this.layer.add([name, icon, zone]);
    });
  }

  private drawGrid(): void {
    const save = this.d.host.save;
    const g = this.add.graphics();
    this.layer.add(g);
    this.items.forEach((def, i) => {
      const col = i % GRID.cols;
      const row = Math.floor(i / GRID.cols);
      const x = GRID.x + col * (GRID.icon + GRID.info + GRID.gapX);
      const y = GRID.y + row * (GRID.h + GRID.gapY);
      const lv = shopLevel(save, def.id);
      const maxed = lv >= def.maxLevel;
      const cost = shopCost(def, lv);
      const on = this.inGrid && i === this.sel;
      const w = GRID.icon + GRID.info;

      if (on) g.lineStyle(4, C.gold).strokeRoundedRect(x - 6, y - 6, w + 12, GRID.h + 12, 6);
      // Icon square
      inkPanel(g, x, y, GRID.icon, GRID.h, { fill: maxed ? 0x16324d : C.seaMid, radius: 4, shadow: 4, stroke: 3, strokeColor: on ? C.white : C.ink });
      const icon = this.add.image(x + GRID.icon / 2, y + GRID.h / 2, `ic_${SHOP_ICON[def.id] ?? 'anvil'}`).setScale(1.05 / TEX).setAlpha(maxed ? 0.55 : 1);
      this.layer.add(icon);
      if (maxed) this.check(x + GRID.icon / 2, y + GRID.h / 2);
      // Info box: level pips (two rows past 5) + price or SOLD!
      const ix = x + GRID.icon + 4;
      inkPanel(g, ix, y, GRID.info, GRID.h, { fill: 0x0b2238, alpha: 0.95, radius: 4, shadow: 4, stroke: 3 });
      const perRow = Math.min(def.maxLevel, 5);
      for (let p = 0; p < def.maxLevel; p++) {
        const px = ix + 14 + (p % perRow) * 18;
        const py = y + 12 + Math.floor(p / perRow) * 14;
        g.fillStyle(p < lv ? C.seaLight : 0x2a3f55).fillRect(px, py, 13, 10);
        g.lineStyle(1.5, C.ink).strokeRect(px, py, 13, 10);
      }
      const can = save.berries >= cost;
      const price = display(this, ix + GRID.info / 2, y + GRID.h - 26, maxed ? 'SOLD!' : `฿${cost.toLocaleString('en-US')}`, maxed ? 26 : 22, {
        shadow: null,
        color: maxed ? CSS.gold : can ? CSS.white : '#ff8a80',
      }).setOrigin(0.5);
      const zone = this.add.zone(x + w / 2, y + GRID.h / 2, w, GRID.h).setInteractive({ useHandCursor: !maxed });
      zone.on('pointerover', () => {
        if (this.inGrid && this.sel === i) return;
        this.inGrid = true;
        this.sel = i;
        this.render();
      });
      zone.on('pointerdown', () => this.buy(i));
      this.layer.add([price, zone]);
    });
  }

  /** Big green tick over a maxed upgrade. */
  private check(cx: number, cy: number): void {
    const g = this.add.graphics();
    this.layer.add(g);
    const pts = [cx - 26, cy + 2, cx - 8, cy + 20, cx + 28, cy - 22];
    for (const [w, col] of [[16, C.ink], [9, C.green]] as const) {
      g.lineStyle(w, col);
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      g.lineTo(pts[2], pts[3]);
      g.lineTo(pts[4], pts[5]);
      g.strokePath();
    }
  }

  private drawDesc(): void {
    const save = this.d.host.save;
    const { x, y, w, h } = DESC;
    const g = this.add.graphics();
    this.layer.add(g);
    inkPanel(g, x, y, w, h, { fill: C.seaDeep, alpha: 0.95, radius: 6, shadow: 6, stroke: 4 });
    g.lineStyle(3, C.seaLight).strokeRoundedRect(x + 8, y + 8, w - 16, h - 16, 4);
    const def = this.inGrid ? this.items[this.sel] : null;
    if (!def) {
      const t = TABS[this.tab];
      this.layer.add(display(this, x + 30, y + 34, t.name, 24, { shadow: null }).setOrigin(0, 0.5));
      g.lineStyle(2, C.white, 0.7).lineBetween(x + 24, y + 56, x + w - 24, y + 56);
      const blurb = this.tab === 0 ? 'Abilities change the rules of every run: rerolls, holds, eliminates and a revive.' : 'Permanent stat boosts for every captain on every voyage.';
      this.layer.add(label(this, x + 40, y + 74, `${blurb}\nPress → or Enter to browse, then Enter to buy.`, 17, { weight: 500, style: { lineSpacing: 6 } }));
      return;
    }
    const lv = shopLevel(save, def.id);
    const maxed = lv >= def.maxLevel;
    const cost = shopCost(def, lv);
    this.layer.add(display(this, x + 30, y + 34, def.name, 24, { shadow: null }).setOrigin(0, 0.5));
    g.lineStyle(2, C.white, 0.7).lineBetween(x + 24, y + 56, x + w - 24, y + 56);
    inkPanel(g, x + 36, y + 70, 80, 80, { fill: C.seaMid, radius: 4, shadow: 4, stroke: 3, strokeColor: C.white });
    this.layer.add(this.add.image(x + 76, y + 110, `ic_${SHOP_ICON[def.id] ?? 'anvil'}`).setScale(0.95 / TEX));
    const status = maxed ? 'Fully upgraded.' : `Next level: ฿${cost.toLocaleString('en-US')}${save.berries < cost ? '  (not enough Berries)' : ''}`;
    this.layer.add(label(this, x + 140, y + 72, `${def.desc}\nLevel ${lv} / ${def.maxLevel}  ·  ${status}`, 18, { weight: 500, style: { wordWrap: { width: w - 180 }, lineSpacing: 8 } }));
  }
}
