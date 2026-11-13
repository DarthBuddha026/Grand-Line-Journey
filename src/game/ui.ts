import Phaser from 'phaser';
import { GAME_W, TEXT_RES } from '../config';
import type { ScreenBox } from './layout';
import { TEX } from './textures';

/**
 * UI kit: "manga ink on pirate materials".
 *  - Every panel has a heavy ink outline and a hard, unblurred offset shadow (like print).
 *  - Headers and buttons are slanted parallelograms; information sits on parchment.
 *  - Big moments (level up, bosses, Specials, stage clear) use radial speed lines.
 */

export const C = {
  ink: 0x1d1410,
  inkSoft: 0x3a2a20,
  sea: 0x0f3b63,
  seaDeep: 0x082541,
  seaMid: 0x1b6fa8,
  seaLight: 0x5ec8e5,
  foam: 0xe6f7ff,
  parch: 0xf3e2b8,
  parchLight: 0xfbf0d2,
  parchDark: 0xd9bd84,
  parchEdge: 0xa97c45,
  gold: 0xffcc33,
  goldLight: 0xffe58a,
  goldDeep: 0xe08a00,
  red: 0xe0303a,
  redDeep: 0x9e1b24,
  wood: 0x8a5a2b,
  woodLight: 0xb07a42,
  woodDark: 0x5c3a1a,
  white: 0xfffaf0,
  teal: 0x1fae9f,
  violet: 0x8d5cf6,
  green: 0x3cc46b,
  hp: 0xe8424a,
  xp: 0x47d6ff,
} as const;

export const CSS = {
  ink: '#1d1410',
  inkSoft: '#5b4433',
  white: '#fffaf0',
  gold: '#ffcc33',
  goldLight: '#ffe58a',
  red: '#e0303a',
  sea: '#0f3b63',
  dim: '#a9c4d9',
  parch: '#f3e2b8',
  green: '#3cc46b',
} as const;

export const FONT = {
  display: '"Abril Fatface", "Didot", "Bodoni MT", Georgia, serif',
  ui: '"M PLUS Rounded 1c", "Trebuchet MS", sans-serif',
  poster: '"Rye", Georgia, serif',
} as const;

/** Colour coding for build pieces, used on cards, slots and banners. */
export const KIND_COLOR = { mainAttack: C.gold, weapon: C.red, item: C.teal, skill: C.violet, boost: C.green } as const;
export const KIND_LABEL = { mainAttack: 'Main attack', weapon: 'Weapon', item: 'Item', skill: 'Skill', boost: 'Boost' } as const;

type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;

/** Display type: Abril Fatface with an ink outline and hard drop shadow. */
export function display(scene: Phaser.Scene, x: number, y: number, value: string, size: number, opts: { color?: string; stroke?: string; shadow?: string | null; style?: TextStyle } = {}): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, value, {
    fontFamily: FONT.display,
    fontSize: `${size}px`,
    color: opts.color ?? CSS.white,
    stroke: opts.stroke ?? CSS.ink,
    // Abril's hairlines vanish under a heavy outline: keep it lighter than the shadow.
    strokeThickness: Math.max(3, Math.round(size * 0.11)),
    padding: { x: 6, y: 6 },
    resolution: TEXT_RES,
    ...opts.style,
  });
  if (opts.shadow !== null) {
    const off = Math.max(2, Math.round(size * 0.07));
    t.setShadow(off, off, opts.shadow ?? CSS.ink, 0, true, true);
  }
  return t;
}

/** Fill a display text with a vertical gradient (static texts only: redo after setText). */
export function gradientFill(t: Phaser.GameObjects.Text, top: string, bottom: string): Phaser.GameObjects.Text {
  const g = t.context.createLinearGradient(0, t.padding.top ?? 0, 0, t.height - (t.padding.bottom ?? 0));
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  t.setFill(g);
  return t;
}

/** UI type: M PLUS Rounded 1c. `onDark` adds a thin ink outline for legibility over the game. */
export function label(scene: Phaser.Scene, x: number, y: number, value: string, size: number, opts: { color?: string; weight?: 500 | 800; onDark?: boolean; style?: TextStyle } = {}): Phaser.GameObjects.Text {
  const onDark = opts.onDark ?? true;
  return scene.add.text(x, y, value, {
    fontFamily: FONT.ui,
    fontSize: `${size}px`,
    fontStyle: String(opts.weight ?? 800),
    color: opts.color ?? (onDark ? CSS.white : CSS.ink),
    stroke: onDark ? CSS.ink : undefined,
    strokeThickness: onDark ? Math.max(2, Math.round(size / 6)) : 0,
    padding: { x: 2, y: 2 },
    resolution: TEXT_RES,
    ...opts.style,
  });
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ---- Shapes -------------------------------------------------------------------------------

type Pt = { x: number; y: number };

export function slantPoints(x: number, y: number, w: number, h: number, skew: number): Pt[] {
  return [
    { x: x + skew, y },
    { x: x + w, y },
    { x: x + w - skew, y: y + h },
    { x, y: y + h },
  ];
}

export interface PanelOpts {
  fill?: number;
  alpha?: number;
  skew?: number;
  radius?: number;
  shadow?: number;
  stroke?: number;
  strokeColor?: number;
  shadowColor?: number;
}

/** The house panel: hard shadow, fill, ink outline. Slanted when `skew` is set. */
export function inkPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, o: PanelOpts = {}): void {
  const shadow = o.shadow ?? 5;
  const stroke = o.stroke ?? 3;
  const sc = o.shadowColor ?? C.ink;
  const skew = o.skew ?? 0;
  if (skew) {
    if (shadow) g.fillStyle(sc, 0.9).fillPoints(slantPoints(x + shadow, y + shadow, w, h, skew), true);
    g.fillStyle(o.fill ?? C.parch, o.alpha ?? 1).fillPoints(slantPoints(x, y, w, h, skew), true);
    if (stroke) g.lineStyle(stroke, o.strokeColor ?? C.ink, 1).strokePoints(slantPoints(x, y, w, h, skew), true, true);
    return;
  }
  const r = o.radius ?? 6;
  if (shadow) g.fillStyle(sc, 0.9).fillRoundedRect(x + shadow, y + shadow, w, h, r);
  g.fillStyle(o.fill ?? C.parch, o.alpha ?? 1).fillRoundedRect(x, y, w, h, r);
  if (stroke) g.lineStyle(stroke, o.strokeColor ?? C.ink, 1).strokeRoundedRect(x, y, w, h, r);
}

/** Aged parchment card: warm fill, darker burnt band at the edges, a few stains. */
export function parchment(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, seed = 1, o: PanelOpts = {}): void {
  inkPanel(g, x, y, w, h, { fill: C.parch, radius: 4, ...o });
  g.lineStyle(6, C.parchDark, 0.55).strokeRoundedRect(x + 5, y + 5, w - 10, h - 10, 3);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  g.fillStyle(C.parchDark, 0.35);
  for (let i = 0; i < 7; i++) g.fillCircle(x + 14 + rnd() * (w - 28), y + 14 + rnd() * (h - 28), 2 + rnd() * 7);
}

/** Banner ribbon with notched tail ends. */
export function ribbon(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, o: { tails?: boolean; shadow?: number } = {}): void {
  const notch = h * 0.45;
  const tail = o.tails === false ? 0 : h * 0.9;
  const sh = o.shadow ?? 4;
  if (tail) {
    const dark = Phaser.Display.Color.IntegerToColor(color).darken(30).color;
    for (const [tx, dir] of [[x - tail, 1], [x + w + tail, -1]] as const) {
      const pts = [
        { x: tx, y: y + 8 },
        { x: tx + dir * (tail + 6), y: y + 8 },
        { x: tx + dir * (tail + 6), y: y + h + 8 },
        { x: tx, y: y + h + 8 },
        { x: tx + dir * notch, y: y + 8 + h / 2 },
      ];
      g.fillStyle(dark).fillPoints(pts, true);
      g.lineStyle(3, C.ink).strokePoints(pts, true, true);
    }
  }
  const body = slantPoints(x, y, w, h, 0);
  g.fillStyle(C.ink, 0.9).fillPoints(body.map((p) => ({ x: p.x + sh, y: p.y + sh })), true);
  g.fillStyle(color).fillPoints(body, true);
  g.fillStyle(0xffffff, 0.18).fillRect(x, y + 3, w, h * 0.28);
  g.lineStyle(3, C.ink).strokePoints(body, true, true);
}

/** Radial manga speed lines between two radii. */
export function speedLines(g: Phaser.GameObjects.Graphics, cx: number, cy: number, inner: number, outer: number, count: number, color: number, alpha: number, phase = 0): void {
  g.fillStyle(color, alpha);
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.04;
    const spread = 0.012 + 0.018 * Math.abs(Math.sin(i * 78.233));
    const r0 = inner * (0.85 + 0.3 * Math.abs(Math.sin(i * 3.7)));
    g.fillTriangle(
      cx + Math.cos(a) * r0, cy + Math.sin(a) * r0,
      cx + Math.cos(a - spread) * outer, cy + Math.sin(a - spread) * outer,
      cx + Math.cos(a + spread) * outer, cy + Math.sin(a + spread) * outer,
    );
  }
}

/** Starburst ("NEW!" stickers, impact behind numbers). */
export function burst(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, points: number, fill: number, rot = 0): void {
  const pts: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? r : r * 0.68;
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  g.fillStyle(C.ink).fillPoints(pts.map((p) => ({ x: p.x + 3, y: p.y + 3 })), true);
  g.fillStyle(fill).fillPoints(pts, true);
  g.lineStyle(2.5, C.ink).strokePoints(pts, true, true);
}

/** Round medallion with a gold ring (portraits, icons). */
export function medallion(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, fill: number, ring: number = C.gold): void {
  g.fillStyle(C.ink).fillCircle(x + 3, y + 3, r + 4);
  g.fillStyle(ring).fillCircle(x, y, r + 4);
  g.fillStyle(fill).fillCircle(x, y, r);
  g.fillStyle(0xffffff, 0.16).fillCircle(x - r * 0.25, y - r * 0.3, r * 0.55);
  g.lineStyle(2.5, C.ink).strokeCircle(x, y, r + 4).strokeCircle(x, y, r);
}

/** Slanted gauge with ink outline, segment ticks and a gloss line. */
export function gauge(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, frac: number, fill: number, o: { back?: number; skew?: number; ticks?: number; glow?: boolean } = {}): void {
  const skew = o.skew ?? h * 0.6;
  const f = Phaser.Math.Clamp(frac, 0, 1);
  g.fillStyle(C.ink, 0.95).fillPoints(slantPoints(x + 3, y + 3, w, h, skew), true);
  g.fillStyle(o.back ?? 0x2a1c16).fillPoints(slantPoints(x, y, w, h, skew), true);
  if (f > 0) {
    const fw = Math.max(skew + 2, w * f);
    g.fillStyle(fill).fillPoints(slantPoints(x, y, fw, h, skew), true);
    g.fillStyle(0xffffff, 0.3).fillPoints(slantPoints(x + skew * 0.2, y + 2, fw - skew * 0.4, Math.max(2, h * 0.28), skew * 0.25), true);
    if (o.glow) g.lineStyle(2, 0xffffff, 0.8).strokePoints(slantPoints(x, y, fw, h, skew), true, true);
  }
  if (o.ticks) {
    g.lineStyle(1.5, C.ink, 0.45);
    for (let i = 1; i < o.ticks; i++) {
      const tx = x + (w * i) / o.ticks;
      g.lineBetween(tx + skew * 0.1, y + 2, tx - skew * 0.1, y + h - 2);
    }
  }
  g.lineStyle(2.5, C.ink).strokePoints(slantPoints(x, y, w, h, skew), true, true);
}

/** A little keyboard key cap for control hints. */
export function keycap(scene: Phaser.Scene, x: number, y: number, key: string, size = 13): Phaser.GameObjects.Container {
  const t = label(scene, 0, 0, key, size, { onDark: false, color: CSS.ink }).setOrigin(0.5);
  const w = Math.max(size * 1.9, t.width + 12);
  const h = size * 1.9;
  const g = scene.add.graphics();
  g.fillStyle(C.ink).fillRoundedRect(-w / 2 + 2, -h / 2 + 3, w, h, 5);
  g.fillStyle(C.parchLight).fillRoundedRect(-w / 2, -h / 2, w, h, 5);
  g.lineStyle(2, C.ink).strokeRoundedRect(-w / 2, -h / 2, w, h, 5);
  return scene.add.container(x, y, [g, t]).setSize(w, h);
}

/** A row of "keycap + action" hints, centred on x. */
export function hintRow(scene: Phaser.Scene, x: number, y: number, hints: [string, string][], color: string = CSS.dim): Phaser.GameObjects.Container {
  const row = scene.add.container(x, y);
  let cx = 0;
  for (const [key, action] of hints) {
    const cap = keycap(scene, 0, 0, key);
    cap.x = cx + cap.width / 2;
    const t = label(scene, cx + cap.width + 6, 0, action, 14, { color, weight: 500 }).setOrigin(0, 0.5);
    row.add([cap, t]);
    cx += cap.width + 6 + t.width + 22;
  }
  for (const child of row.list as unknown as Phaser.GameObjects.Components.Transform[]) child.x -= (cx - 22) / 2;
  return row;
}

// ---- Button ------------------------------------------------------------------------------

export type ButtonVariant = 'gold' | 'red' | 'sea' | 'parch';

const VARIANT: Record<ButtonVariant, { fill: number; hover: number; text: string; stroke: boolean }> = {
  gold: { fill: C.gold, hover: C.goldLight, text: CSS.ink, stroke: false },
  red: { fill: C.red, hover: 0xff5a62, text: CSS.white, stroke: true },
  sea: { fill: C.seaMid, hover: 0x2d8ccc, text: CSS.white, stroke: true },
  parch: { fill: C.parch, hover: C.parchLight, text: CSS.ink, stroke: false },
};

/**
 * Slanted pirate button with hover lift, press squash, keyboard focus glow and an
 * optional count badge (Reroll ×2).
 */
export class Button extends Phaser.GameObjects.Container {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private readonly zone: Phaser.GameObjects.Zone;
  private readonly bw: number;
  private readonly bh: number;
  private variant: ButtonVariant;
  private hovered = false;
  private focused = false;
  private pressed = false;
  enabled = true;
  badge: string | null = null;
  private readonly badgeText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, value: string, onClick: () => void, variant: ButtonVariant = 'gold') {
    super(scene, x, y);
    this.bw = w;
    this.bh = h;
    this.variant = variant;
    this.g = scene.add.graphics();
    this.text = label(scene, 0, -1, value, Math.round(h * 0.36), { onDark: VARIANT[variant].stroke, color: VARIANT[variant].text }).setOrigin(0.5);
    this.badgeText = label(scene, w / 2 - 6, -h / 2 - 2, '', 13).setOrigin(0.5);
    this.zone = scene.add.zone(0, 0, w + 10, h).setInteractive({ useHandCursor: true });
    this.zone.on('pointerover', () => this.setHover(true));
    this.zone.on('pointerout', () => {
      this.pressed = false;
      this.setHover(false);
    });
    this.zone.on('pointerdown', () => {
      if (!this.enabled) return;
      this.pressed = true;
      this.redraw();
    });
    this.zone.on('pointerup', () => {
      if (!this.enabled || !this.pressed) return;
      this.pressed = false;
      this.redraw();
      onClick();
    });
    this.add([this.g, this.text, this.badgeText, this.zone]);
    this.setSize(w, h);
    this.redraw();
    scene.add.existing(this);
  }

  setLabel(value: string): this {
    this.text.setText(value);
    return this;
  }

  setEnabled(on: boolean): this {
    this.enabled = on;
    this.zone.input!.cursor = on ? 'pointer' : 'default';
    this.redraw();
    return this;
  }

  setFocus(on: boolean): this {
    this.focused = on;
    this.redraw();
    return this;
  }

  setBadge(value: string | null): this {
    this.badge = value;
    this.redraw();
    return this;
  }

  private setHover(on: boolean): void {
    this.hovered = on;
    this.redraw();
  }

  private redraw(): void {
    const g = this.g;
    const v = VARIANT[this.variant];
    const w = this.bw;
    const h = this.bh;
    const lift = this.enabled && (this.hovered || this.focused) && !this.pressed ? -2 : this.pressed ? 2 : 0;
    const skew = h * 0.35;
    g.clear();
    const x = -w / 2;
    const y = -h / 2 + lift;
    g.fillStyle(C.ink).fillPoints(slantPoints(x + 5, -h / 2 + 5, w, h, skew), true);
    const fill = !this.enabled ? 0x6b6258 : this.hovered || this.focused ? v.hover : v.fill;
    g.fillStyle(fill).fillPoints(slantPoints(x, y, w, h, skew), true);
    g.fillStyle(0xffffff, 0.22).fillPoints(slantPoints(x + skew * 0.3, y + 3, w - skew * 0.6, h * 0.3, skew * 0.3), true);
    g.lineStyle(3, C.ink).strokePoints(slantPoints(x, y, w, h, skew), true, true);
    if (this.focused && this.enabled) g.lineStyle(3, 0xffffff, 0.9).strokePoints(slantPoints(x - 5, y - 5, w + 10, h + 10, skew), true, true);
    this.text.setY(lift - 1).setAlpha(this.enabled ? 1 : 0.6);
    if (this.badge) {
      const bx = w / 2 - 6;
      const by = -h / 2 - 2 + lift;
      g.fillStyle(C.ink).fillCircle(bx + 2, by + 2, 13);
      g.fillStyle(this.enabled ? C.red : 0x6b6258).fillCircle(bx, by, 13);
      g.lineStyle(2.5, C.ink).strokeCircle(bx, by, 13);
      this.badgeText.setText(this.badge).setPosition(bx, by).setVisible(true);
    } else {
      this.badgeText.setVisible(false);
    }
  }
}

/**
 * Full-screen menu chrome (Recruit, Shipwright): ink top bar with the screen title and a
 * Berries counter, ink bottom bar with control hints. Returns the Berries text to update.
 */
export function screenChrome(scene: Phaser.Scene, box: ScreenBox, title: string, hints: [string, string][]): Phaser.GameObjects.Text {
  const bars = scene.add.graphics();
  bars.fillStyle(C.ink, 0.88).fillRect(box.left, box.top, box.w, 72 - box.top);
  bars.fillStyle(C.ink, 0.88).fillRect(box.left, 664, box.w, box.bottom - 664);
  display(scene, Math.max(box.left + 40, 40), 36, title, 38, { shadow: null }).setOrigin(0, 0.5);
  inkPanel(bars, 920, 14, 320, 46, { fill: C.seaDeep, skew: 14, shadow: 5 });
  medallion(bars, 930, 37, 18, C.gold);
  scene.add.image(930, 37, 'ic_coin').setScale(0.7 / TEX);
  hintRow(scene, GAME_W / 2, 692, hints, CSS.white);
  return display(scene, 1216, 37, '', 24, { shadow: null, color: CSS.gold }).setOrigin(1, 0.5);
}

/** Dark sea backdrop with diagonal stripes, for menus and overlays. */
export function backdrop(scene: Phaser.Scene, w: number, h: number, alpha = 0.82): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(C.seaDeep, alpha).fillRect(0, 0, w, h);
  g.fillStyle(0xffffff, 0.025);
  for (let x = -h; x < w; x += 46) g.fillPoints([{ x, y: 0 }, { x: x + 18, y: 0 }, { x: x + 18 + h, y: h }, { x: x + h, y: h }], true);
  return g;
}
