import Phaser from 'phaser';
import { CHARACTERS, CREWS } from '../../data';
import { DUPE_XP, gachaPool, isUnlocked, pullCrew, type PullResult } from '../../core/meta';
import { Rng } from '../../core/rng';
import { GAME_W, hex } from '../../config';
import type { MenuHost } from '../menus';
import { backdrop, burst, Button, C, CSS, display, gradientFill, inkPanel, label, medallion, screenChrome, slantPoints, speedLines } from '../ui';
import { centerCamera, relayoutOnResize, type ScreenBox } from '../layout';
import { CHAR_TEX, TEX } from '../textures';

export interface GachaData {
  host: MenuHost;
  crew?: number;
  onClose?: () => void;
}

const CARD = { x: 170, y: 112, w: 940, h: 340 };
const INFO = { x: 150, y: 478, w: 980, h: 150 };
const PULLS = [1, 10] as const;

const darken = (c: number, pct: number) => Phaser.Display.Color.IntegerToColor(c).darken(pct).color;

/**
 * Recruitment: one banner card per crew (←/→ to flip), its members lined up in slanted
 * slices (silhouettes until recruited), a description box and ×1 / ×10 pulls. A pull
 * plays a speed-line reveal of the results.
 */
export class GachaScene extends Phaser.Scene {
  private d!: GachaData;
  private crew = 0;
  private focus = 0;
  private box!: ScreenBox;
  private cardLayer!: Phaser.GameObjects.Container;
  private infoLayer!: Phaser.GameObjects.Container;
  private berriesText!: Phaser.GameObjects.Text;
  private buttons: Button[] = [];
  private reveal: Phaser.GameObjects.Container | null = null;
  private revealAt = 0;
  private openedAt = 0;
  private padPrev = { l: true, r: true, u: true, dn: true, a: true, b: true };

  constructor() {
    super('gacha');
  }

  init(d: GachaData): void {
    this.d = d;
    this.crew = Phaser.Math.Clamp(d.crew ?? 0, 0, CREWS.length - 1);
    this.focus = 0;
    this.reveal = null;
    this.buttons = [];
    this.padPrev = { l: true, r: true, u: true, dn: true, a: true, b: true };
  }

  create(): void {
    this.openedAt = this.time.now;
    const box = (this.box = centerCamera(this));
    relayoutOnResize(this, () => ({ ...this.d, crew: this.crew }));
    backdrop(this, box.w, box.h, 0.92)
      .setPosition(box.left, box.top)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, box.w, box.h), Phaser.Geom.Rectangle.Contains);

    this.berriesText = screenChrome(this, box, 'NAKAMA', [['←→', 'Crew'], ['↑↓', '×1 / ×10'], ['Enter', 'Recruit'], ['Esc', 'Back']]);

    // Flip arrows either side of the card
    for (const dir of [-1, 1]) {
      const ax = dir < 0 ? CARD.x - 46 : CARD.x + CARD.w + 46;
      const ay = CARD.y + CARD.h / 2;
      const g = this.add.graphics();
      const tri = [{ x: ax + dir * 22, y: ay }, { x: ax - dir * 14, y: ay - 34 }, { x: ax - dir * 14, y: ay + 34 }];
      g.fillStyle(C.ink).fillPoints(tri.map((p) => ({ x: p.x + 4, y: p.y + 4 })), true);
      g.fillStyle(C.white).fillPoints(tri, true);
      g.lineStyle(3, C.ink).strokePoints(tri, true, true);
      g.setAlpha(CREWS.length > 1 ? 1 : 0.25);
      this.add.zone(ax, ay, 70, 100).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.flip(dir));
    }

    this.cardLayer = this.add.container(0, 0);
    this.infoLayer = this.add.container(0, 0);
    this.buttons = PULLS.map(
      (_times, i) =>
        new Button(this, INFO.x + INFO.w - 150, INFO.y + 46 + i * 60, 250, 46, '', () => {
          this.focus = i;
          this.pull();
        }, i === 0 ? 'gold' : 'red'),
    );

    const kb = this.input.keyboard!;
    kb.on('keydown', (ev: KeyboardEvent) => {
      if (this.reveal) {
        if (['Enter', 'Space', 'Escape', 'KeyZ', 'KeyX', 'KeyE'].includes(ev.code)) this.closeReveal();
        return;
      }
      if (ev.code === 'ArrowLeft' || ev.code === 'KeyA') this.flip(-1);
      else if (ev.code === 'ArrowRight' || ev.code === 'KeyD') this.flip(1);
      else if (ev.code === 'ArrowUp' || ev.code === 'KeyW' || ev.code === 'ArrowDown' || ev.code === 'KeyS') this.setFocus(1 - this.focus);
      else if (ev.code === 'Enter' || ev.code === 'Space' || ev.code === 'KeyZ' || ev.code === 'KeyE') this.pull();
      else if (ev.code === 'Escape' || ev.code === 'KeyX') this.close();
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
    if (this.reveal) {
      if ((now.a && !p.a) || (now.b && !p.b)) this.closeReveal();
    } else {
      if (now.l && !p.l) this.flip(-1);
      if (now.r && !p.r) this.flip(1);
      if ((now.u && !p.u) || (now.dn && !p.dn)) this.setFocus(1 - this.focus);
      if (now.a && !p.a) this.pull();
      if (now.b && !p.b) this.close();
    }
    this.padPrev = now;
  }

  // ---- Actions ---------------------------------------------------------------------------

  private flip(dir: number): void {
    if (this.reveal || CREWS.length < 2) return;
    this.crew = (this.crew + dir + CREWS.length) % CREWS.length;
    this.render();
    this.cardLayer.setX(dir * 40).setAlpha(0);
    this.tweens.add({ targets: this.cardLayer, x: 0, alpha: 1, duration: 160, ease: 'Cubic.Out' });
  }

  private setFocus(i: number): void {
    this.focus = i;
    this.buttons.forEach((b, k) => b.setFocus(k === i));
  }

  private pull(): void {
    if (this.reveal || this.time.now - this.openedAt < 200) return;
    const crew = CREWS[this.crew];
    const results = pullCrew(this.d.host.save, crew.id, PULLS[this.focus], new Rng());
    if (!results) {
      this.cameras.main.shake(120, 0.004);
      return;
    }
    this.d.host.persist();
    this.render();
    this.showReveal(results);
  }

  private close(): void {
    if (this.reveal) return;
    this.scene.stop();
    this.d.onClose?.();
  }

  // ---- Drawing ---------------------------------------------------------------------------

  private render(): void {
    const save = this.d.host.save;
    this.berriesText.setText(save.berries.toLocaleString('en-US'));
    this.renderCard();
    this.renderInfo();
    const crew = CREWS[this.crew];
    PULLS.forEach((times, i) => {
      const cost = crew.pullCost * times;
      this.buttons[i].setLabel(`Recruit ×${times}   ฿${cost.toLocaleString('en-US')}`).setEnabled(save.berries >= cost);
    });
    this.setFocus(this.focus);
  }

  private renderCard(): void {
    const L = this.cardLayer;
    L.removeAll(true);
    const save = this.d.host.save;
    const crew = CREWS[this.crew];
    const col = hex(crew.color);
    const pool = gachaPool(crew.id);
    const owned = pool.filter((id) => isUnlocked(save, id)).length;
    const { x, y, w, h } = CARD;

    // Frame: light outer band, crew-coloured inner window with diagonal stripes
    const g = this.add.graphics();
    L.add(g);
    inkPanel(g, x, y, w, h, { fill: C.white, radius: 14, shadow: 8, stroke: 4 });
    g.fillStyle(col, 0.35).fillRoundedRect(x + 4, y + 4, w - 8, 44, 10);
    const ix = x + 16;
    const iy = y + 52;
    const iw = w - 32;
    const ih = h - 68;
    g.fillStyle(darken(col, 25)).fillRect(ix, iy, iw, ih);
    g.fillStyle(0xffffff, 0.06);
    for (let sx = ix - ih; sx < ix + iw; sx += 34) {
      const pts = [{ x: sx, y: iy + ih }, { x: sx + 14, y: iy + ih }, { x: sx + 14 + ih, y: iy }, { x: sx + ih, y: iy }]
        .map((p) => ({ x: Phaser.Math.Clamp(p.x, ix, ix + iw), y: p.y }));
      g.fillPoints(pts, true);
    }

    // One slanted slice per member
    const n = pool.length;
    const sw = iw / n;
    const skew = 26;
    const scale = Math.min((ih * 0.9) / 22, (sw * 1.4) / 16); // neighbours may overlap a little, like a lineup
    const lines = this.add.graphics();
    pool.forEach((id, i) => {
      const c = CHARACTERS.get(id)!;
      const have = isUnlocked(save, id);
      const sx = ix + i * sw;
      const pts = slantPoints(sx - skew / 2, iy, sw + skew, ih, skew).map((p) => ({ x: Phaser.Math.Clamp(p.x, ix, ix + iw), y: p.y }));
      g.fillStyle(have ? hex(c.look.body) : C.ink, have ? 0.55 : 0.45).fillPoints(pts, true);
      if (i > 0) lines.lineStyle(4, C.ink).lineBetween(sx + skew / 2, iy, sx - skew / 2, iy + ih);
      const img = this.add.image(sx + sw / 2, iy + ih + 4, `player_${id}`).setOrigin(0.5, 1).setScale(scale / CHAR_TEX);
      L.add(img);
      if (!have) {
        img.setTint(0x0b1a2a).setTintMode(Phaser.TintModes.FILL);
        L.add(display(this, sx + sw / 2, iy + ih * 0.42, '?', 40, { color: CSS.gold }).setOrigin(0.5));
      }
    });
    lines.lineStyle(4, C.ink).strokeRect(ix, iy, iw, ih);
    L.add(lines);

    // Overlays: crew tag (top-left), recruited count (top), crew name plate (bottom-right)
    const o = this.add.graphics();
    L.add(o);
    const tag = display(this, 0, 0, crew.tag, 40, { shadow: null, color: CSS.ink, stroke: CSS.white }).setOrigin(0, 0.5);
    inkPanel(o, x + 30, y - 22, tag.width + 26, 62, { fill: C.white, shadow: 6, stroke: 4, radius: 2 });
    tag.setPosition(x + 43, y + 9);
    medallion(o, x + tag.width + 110, y + 26, 13, C.gold);
    const crown = this.add.image(x + tag.width + 110, y + 26, 'ic_crown').setScale(0.38 / TEX);
    const count = display(this, x + tag.width + 132, y + 26, `${owned} / ${n}`, 24, { shadow: null, color: CSS.ink, stroke: CSS.white }).setOrigin(0, 0.5);
    const name = display(this, 0, 0, crew.name.toUpperCase(), 30, { shadow: null }).setOrigin(1, 0.5);
    const pw = name.width + 70;
    inkPanel(o, x + w - pw - 10, y + h - 40, pw, 56, { fill: col, skew: 30, shadow: 6, stroke: 4 });
    name.setPosition(x + w - 40, y + h - 12);
    L.add([tag, crown, count, name]);
  }

  private renderInfo(): void {
    const L = this.infoLayer;
    L.removeAll(true);
    const crew = CREWS[this.crew];
    const pool = gachaPool(crew.id);
    const { x, y, w, h } = INFO;
    const g = this.add.graphics();
    inkPanel(g, x, y, w, h, { fill: C.seaDeep, alpha: 0.95, radius: 6, shadow: 6, stroke: 4 });
    g.lineStyle(3, C.seaLight).strokeRoundedRect(x + 8, y + 8, w - 16, h - 16, 4);
    g.lineStyle(2, C.white, 0.7).lineBetween(x + 30, y + 52, x + w - 300, y + 52);
    const head = display(this, x + 30, y + 32, crew.name, 22, { shadow: null }).setOrigin(0, 0.5);
    const body = label(
      this,
      x + 46,
      y + 62,
      `Recruit a random member of the ${crew.name}! On duplicates, that member gains +${DUPE_XP} bounty-rank XP (more ATK & HP).\n` +
        `${pool.length} members · equal odds`,
      15,
      { weight: 500, style: { wordWrap: { width: w - 360 }, lineSpacing: 4 } },
    );
    L.add([g, head, body]);
  }

  // ---- Reveal ------------------------------------------------------------------------------

  private showReveal(results: PullResult[]): void {
    const b = this.box;
    const R = (this.reveal = this.add.container(0, 0).setDepth(100));
    this.revealAt = this.time.now;
    const g = this.add.graphics();
    g.fillStyle(C.ink, 0.88).fillRect(b.left, b.top, b.w, b.h);
    speedLines(g, GAME_W / 2, 360, 160, Math.max(b.w, b.h), 64, C.gold, 0.16);
    R.add([g, this.add.zone(b.left, b.top, b.w, b.h).setOrigin(0).setInteractive().on('pointerdown', () => this.closeReveal())]);
    const anyNew = results.some((r) => r.isNew);
    const title = display(this, GAME_W / 2, 96, anyNew ? 'NEW RECRUIT!' : 'RECRUITED!', 54).setOrigin(0.5).setAngle(-4);
    gradientFill(title, CSS.goldLight, '#e08a00');
    R.add(title);

    const big = results.length === 1;
    const cw = big ? 240 : 196;
    const ch = big ? 300 : 212;
    results.forEach((r, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const cx = big ? GAME_W / 2 : GAME_W / 2 + (col - 2) * (cw + 20);
      const cy = big ? 380 : 284 + row * (ch + 18);
      const card = this.add.container(cx, cy);
      const c = CHARACTERS.get(r.id)!;
      const cg = this.add.graphics();
      inkPanel(cg, -cw / 2, -ch / 2, cw, ch, { fill: r.isNew ? C.gold : C.parch, radius: 8, shadow: 6, stroke: 4 });
      medallion(cg, 0, -ch * 0.12, cw * 0.32, hex(c.look.body));
      const img = this.add.image(0, -ch * 0.12 + cw * 0.3, `player_${r.id}`).setOrigin(0.5, 1).setScale((big ? 7 : 5.2) / CHAR_TEX);
      const name = label(this, 0, ch / 2 - (big ? 62 : 52), c.name, big ? 22 : 17, { onDark: false, color: CSS.ink }).setOrigin(0.5);
      const sub = label(this, 0, ch / 2 - (big ? 30 : 24), r.isNew ? 'Joined the crew!' : `+${DUPE_XP} bounty XP`, big ? 16 : 13, {
        onDark: false,
        weight: 500,
        color: r.isNew ? CSS.ink : '#8a3a1e',
      }).setOrigin(0.5);
      card.add([cg, img, name, sub]);
      if (r.isNew) {
        const sg = this.add.graphics();
        burst(sg, cw / 2 - 14, -ch / 2 + 12, big ? 34 : 26, 9, C.red, 0.2);
        card.add([sg, display(this, cw / 2 - 14, -ch / 2 + 12, 'NEW', big ? 18 : 14, { shadow: null }).setOrigin(0.5).setAngle(-12)]);
      }
      card.setScale(0);
      this.tweens.add({ targets: card, scale: 1, duration: 260, delay: 120 + i * 90, ease: 'Back.Out' });
      R.add(card);
    });
    R.add(label(this, GAME_W / 2, 650, 'Enter / click to continue', 16, { weight: 500, color: CSS.dim }).setOrigin(0.5));
    this.cameras.main.flash(160, 255, 230, 140);
  }

  private closeReveal(): void {
    if (!this.reveal || this.time.now - this.revealAt < 350) return;
    this.reveal.destroy(true);
    this.reveal = null;
  }
}
