import Phaser from 'phaser';
import type { MenuHost } from '../menus';
import { backdrop, C, CSS, label, screenChrome, speedLines } from '../ui';
import { centerCamera, relayoutOnResize } from '../layout';

export interface ShopFrontData {
  host: MenuHost;
  onClose?: () => void;
}

/** Sub-screens this front desk opens; each is launched on top with { host, onClose }. */
const OPTIONS = [
  { name: 'Nakama', sub: 'Recruit crewmates: pull a crew for new members', icon: 'ic_card', scene: 'gacha' },
  { name: 'Shipwright', sub: 'Buy permanent upgrades for every voyage', icon: 'ic_anvil', scene: 'shop' },
  { name: 'Back', sub: 'Return to the main menu', icon: 'menu_quit', scene: null },
] as const;

const ROW = { x: 420, y: 196, w: 620, h: 84, gap: 36, stagger: 40, icon: 104 };

/**
 * The Shop front desk (main menu → Shop): a short, centred list of
 * services. Picking one launches that screen over this one; closing it returns here.
 */
export class ShopFrontScene extends Phaser.Scene {
  private d!: ShopFrontData;
  private focus = 0;
  private rows: { c: Phaser.GameObjects.Container; g: Phaser.GameObjects.Graphics; i: number; icon: Phaser.GameObjects.Image; name: Phaser.GameObjects.Text; sub: Phaser.GameObjects.Text }[] = [];
  private berriesText!: Phaser.GameObjects.Text;
  private subClosedAt = 0;
  private openedAt = 0;
  private padPrev = { u: true, d: true, a: true, b: true };

  constructor() {
    super('shopfront');
  }

  init(d: ShopFrontData): void {
    this.d = d;
    this.focus = 0;
    this.rows = [];
    this.subClosedAt = 0;
    this.padPrev = { u: true, d: true, a: true, b: true };
  }

  create(): void {
    this.openedAt = this.time.now;
    const box = centerCamera(this);
    relayoutOnResize(this, () => this.d);
    backdrop(this, box.w, box.h, 0.98)
      .setPosition(box.left, box.top)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, box.w, box.h), Phaser.Geom.Rectangle.Contains);
    const rays = this.add.graphics();
    speedLines(rays, 640, 368, 90, Math.max(box.w, box.h), 36, C.gold, 0.08);
    this.berriesText = screenChrome(this, box, 'SHOP', [['↑↓', 'Select'], ['Enter', 'Confirm'], ['Esc', 'Back']]);

    OPTIONS.forEach((o, i) => this.rows.push(this.makeRow(o, i)));
    this.refresh();

    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      if (this.busy()) return;
      const k = ev.code;
      if (k === 'ArrowUp' || k === 'KeyW') this.setFocus(this.focus < 0 ? 0 : this.focus - 1);
      else if (k === 'ArrowDown' || k === 'KeyS') this.setFocus(this.focus < 0 ? 0 : this.focus + 1);
      else if (k === 'Enter' || k === 'Space' || k === 'KeyZ' || k === 'KeyE') this.choose(this.focus < 0 ? 0 : this.focus);
      else if (k === 'Escape' || k === 'KeyX' || k === 'Backspace') this.close();
    });
    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 140 });
  }

  update(): void {
    const pad = this.input.gamepad?.total ? this.input.gamepad.pad1 : undefined;
    if (!pad) return;
    const now = { u: pad.up || pad.leftStick.y < -0.5, d: pad.down || pad.leftStick.y > 0.5, a: pad.A, b: pad.B };
    if (!this.busy()) {
      const p = this.padPrev;
      if (now.u && !p.u) this.setFocus(this.focus < 0 ? 0 : this.focus - 1);
      if (now.d && !p.d) this.setFocus(this.focus < 0 ? 0 : this.focus + 1);
      if (now.a && !p.a) this.choose(this.focus < 0 ? 0 : this.focus);
      if (now.b && !p.b) this.close();
    }
    this.padPrev = now;
  }

  /** A sub-screen is open (or just closed, so its Esc/Enter must not land here). */
  private busy(): boolean {
    return this.scene.isActive('gacha') || this.scene.isActive('shop') || this.time.now - this.subClosedAt < 250 || this.time.now - this.openedAt < 200;
  }

  private rowX(i: number): number {
    return ROW.x - i * ROW.stagger; // each row steps left, like a staircase
  }

  private makeRow(o: (typeof OPTIONS)[number], i: number) {
    const y = ROW.y + i * (ROW.h + ROW.gap);
    const c = this.add.container(this.rowX(i), y);
    const g = this.add.graphics();
    const icon = this.add.image(0, ROW.h / 2, o.icon).setDisplaySize(ROW.icon, ROW.icon);
    const name = label(this, 96, ROW.h / 2, o.name, 30, { style: { letterSpacing: 1 } }).setOrigin(0, 0.5);
    const sub = label(this, 98, ROW.h / 2 + 22, o.sub, 15, { weight: 500, color: '#dcecf8' }).setOrigin(0, 0.5).setVisible(false);
    const zone = this.add.zone(ROW.w / 2 - 30, ROW.h / 2, ROW.w + 60, ROW.h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => !this.busy() && this.setFocus(i));
    zone.on('pointerout', () => this.focus === i && this.setFocus(-1));
    zone.on('pointerdown', () => !this.busy() && this.choose(i));
    c.add([g, icon, name, sub, zone]);
    return { c, g, i, icon, name, sub };
  }

  /**
   * Rows are borderless translucent bands fading out to the right, with a big icon on the
   * left end. The selected one lights up sea-blue with gold edge lines, its icon pops and
   * its description appears under the name.
   */
  private setFocus(i: number): void {
    this.focus = i < 0 ? -1 : (i + OPTIONS.length) % OPTIONS.length;
    this.rows.forEach((r) => {
      const on = r.i === this.focus;
      const g = r.g;
      g.clear();
      const col = on ? C.seaMid : C.ink;
      const a = on ? 0.95 : 0.78;
      g.fillGradientStyle(col, col, col, col, a, 0, a, 0).fillRect(24, 0, ROW.w, ROW.h);
      if (on) {
        g.fillGradientStyle(C.gold, C.gold, C.gold, C.gold, 1, 0, 1, 0).fillRect(24, 0, ROW.w * 0.8, 3).fillRect(24, ROW.h - 3, ROW.w * 0.8, 3);
        g.fillStyle(0xffffff, 0.08).fillRect(24, 3, ROW.w * 0.6, ROW.h * 0.35);
      }
      r.name.setY(on ? ROW.h / 2 - 12 : ROW.h / 2).setColor(on ? CSS.goldLight : CSS.white);
      r.sub.setVisible(on);
      this.tweens.killTweensOf([r.c, r.icon]);
      this.tweens.add({ targets: r.c, x: this.rowX(r.i) + (on ? 14 : 0), duration: 120, ease: 'Cubic.Out' });
      const s = (ROW.icon / r.icon.width) * (on ? 1.14 : 1);
      this.tweens.add({ targets: r.icon, scaleX: s, scaleY: s, duration: 140, ease: 'Back.Out' });
    });
  }

  private refresh(): void {
    this.berriesText.setText(this.d.host.save.berries.toLocaleString('en-US'));
    this.setFocus(this.focus);
  }

  private choose(i: number): void {
    const o = OPTIONS[i];
    if (!o) return;
    if (!o.scene) return this.close();
    this.scene.launch(o.scene, {
      host: this.d.host,
      onClose: () => {
        this.subClosedAt = this.time.now;
        this.refresh();
      },
    });
  }

  private close(): void {
    this.scene.stop();
    this.d.onClose?.();
  }
}
