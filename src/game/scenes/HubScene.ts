import Phaser from 'phaser';
import { CHARACTERS, type CharacterDef } from '../../data';
import { RES } from '../../config';
import { centerCamera, relayoutOnResize, type ScreenBox } from '../layout';
import { ANIM_FPS, CHAR_TEX, characterFrames, TEX, type CharacterAnim } from '../textures';
import { loadSave } from '../../core/save';
import { isUnlocked, rankFor } from '../../core/meta';
import { burst, Button, C, CSS, display, hintRow, inkPanel, keycap, label, medallion } from '../ui';
import { drawCelSea } from '../sea';

/**
 * Harbour layout in world units (design height 720; the dock scrolls sideways). Everyone
 * stands on a wooden dock in the foreground; the Thousand Sunny (`art_ship`) is moored behind
 * it as scenery only, with slower parallax so it reads as farther away.
 */
const WORLD_W = 2600;
const HORIZON = 300;
const DECK_Y = 600; // feet line on the dock
const DOCK_TOP = DECK_Y - 46; // back edge of the dock's walking surface
const DOCK_FRONT = DECK_Y + 22; // front edge, where the fascia beam starts
const WATERLINE = 668; // the near sea covers the piles below this
const DECK_L = 150; // walkable dock
const DECK_R = WORLD_W - 150;
const SHIP_H = 560; // ship image display height
const SHIP_PARALLAX = 0.72;
const SCALE = 4.6 / CHAR_TEX; // character display scale on the dock
const SPEED = 260;
const TALK_RANGE = 85;
/** Crew strolling on the dock: walk speed (units/s) and how long they stand between strolls (s). */
const WALK_SPEED = 40;
const REST_MIN = 4;
const REST_MAX = 10;

interface Mate {
  def: CharacterDef;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  frames: Record<CharacterAnim, string[]>;
  home: number;
  x: number;
  /** Feet line (the dock). */
  y: number;
  facing: 1 | -1;
  line: number;
  /** Where they are strolling to, and the scene time (s) when they set off again after reaching it. */
  target: number;
  restUntil: number;
}

/**
 * The harbour: walk the dock where the Thousand Sunny is moored and meet the crew you've
 * recruited. Walk up to a crewmate and press E (or click them) to hear what they have to
 * say. The dock scrolls with you; the HUD sits on a second, fixed camera (like HudScene).
 */
export class HubScene extends Phaser.Scene {
  private box!: ScreenBox;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private ui!: Phaser.GameObjects.Container;
  private sky!: Phaser.GameObjects.Graphics;
  private seaBack!: Phaser.GameObjects.Graphics;
  private seaFront!: Phaser.GameObjects.Graphics;
  private clouds!: Phaser.GameObjects.Graphics;
  private ship!: Phaser.GameObjects.Image;
  private shipY = 0;
  private player!: Mate;
  private crew: Mate[] = [];
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private near: Mate | null = null;
  private walkTo: Mate | null = null;
  private prompt!: Phaser.GameObjects.Container;
  private speech!: Phaser.GameObjects.Container;
  private speechText!: Phaser.GameObjects.Text;
  private speechG!: Phaser.GameObjects.Graphics;
  private speaker: Mate | null = null;
  private speechUntil = 0;
  private padPrev = { a: true, b: true };
  private startX = 640;
  private leaving = false;

  constructor() {
    super('hub');
  }

  init(data: { x?: number }): void {
    this.startX = data?.x ?? 640;
    this.crew = [];
    this.near = this.walkTo = this.speaker = null;
    this.speechUntil = 0;
    this.leaving = false;
    this.padPrev = { a: true, b: true };
  }

  create(): void {
    const box = (this.box = centerCamera(this));
    relayoutOnResize(this, () => ({ x: this.player.x }));
    const save = loadSave();
    const captainId = isUnlocked(save, save.selectedCharacter) ? save.selectedCharacter : 'luffy';
    this.cameras.main.setBackgroundColor(C.sea).fadeIn(300, 8, 37, 65);

    // Screen-fixed backdrop (scroll factor 0, drawn in screen units)
    this.sky = this.add.graphics().setScrollFactor(0);
    this.sky.fillGradientStyle(0x2b8fd0, 0x2b8fd0, 0xaee9f7, 0xaee9f7, 1).fillRect(0, 0, box.w, HORIZON + box.oy);
    this.clouds = this.add.graphics().setScrollFactor(0.2);
    this.drawClouds();
    this.seaBack = this.add.graphics().setScrollFactor(0);
    this.ship = this.makeShip();
    this.drawDock();

    // Crew: everyone you've recruited except the captain, spread along the dock
    const mates = [...CHARACTERS.values()].filter((c) => c.id !== captainId && isUnlocked(save, c.id));
    const gap = (DECK_R - DECK_L) / Math.max(1, mates.length);
    mates.forEach((def, i) => this.crew.push(this.makeMate(def, DECK_L + gap * (i + 0.5), DECK_Y, i)));
    if (mates.length <= 1) { // only the free starters so far
      const g = this.add.graphics();
      const cx = 640;
      inkPanel(g, cx - 230, DECK_Y - 230, 460, 64, { fill: C.parch, radius: 8, shadow: 5, stroke: 3 });
      label(this, cx, DECK_Y - 198, 'Recruit crew in the Shop to fill the dock!', 18, { onDark: false, color: CSS.ink }).setOrigin(0.5);
    }
    this.player = this.makeMate(CHARACTERS.get(captainId)!, Phaser.Math.Clamp(this.startX, DECK_L, DECK_R), DECK_Y, -1);

    this.seaFront = this.add.graphics().setScrollFactor(0);
    this.makeBubbles();
    this.makeUi(save, captainId);

    // Cameras: the world follows the player sideways; the HUD camera never scrolls.
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height).setOrigin(0, 0).setZoom(RES).setScroll(-box.ox, -box.oy);
    this.uiCam.ignore(this.children.list.filter((o) => o !== this.ui));
    this.cameras.main.ignore(this.ui);
    this.cameras.main.scrollX = this.cameraTarget();

    this.keys = this.input.keyboard!.addKeys('A,D,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      if (ev.code === 'KeyE' || ev.code === 'Enter' || ev.code === 'Space') this.talk();
      else if (ev.code === 'Escape') this.toTitle();
    });
  }

  // ---- Building ------------------------------------------------------------------------

  private makeMate(def: CharacterDef, x: number, y: number, i: number): Mate {
    const shadow = this.add.image(x, y + 2, 'shadow').setScale(3.4 / TEX).setAlpha(0.45);
    const sprite = this.add.image(x, y, `player_${def.id}`).setOrigin(0.5, 0.99).setScale(SCALE);
    const m: Mate = { def, sprite, shadow, frames: characterFrames(this, def.id), home: x, x, y, facing: i % 2 ? -1 : 1, line: Math.floor(Math.random() * def.lines.length), target: x, restUntil: this.time.now / 1000 + 1 + Math.random() * 5 };
    if (i >= 0) {
      sprite.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        if (Math.abs(this.player.x - m.x) <= TALK_RANGE) this.talkTo(m);
        else this.walkTo = m; // walk over, then talk
      });
    }
    return m;
  }

  private drawClouds(): void {
    const g = this.clouds;
    const puffs: [number, number, number][] = [[0, 10, 26], [28, -6, 32], [60, 8, 26], [30, 16, 24]];
    for (let i = 0; i < 12; i++) {
      const x = i * 260 + (i % 3) * 40;
      const y = 60 + (i % 2) * 70 + (i % 3) * 12;
      const s = 0.8 + (i % 3) * 0.25;
      g.fillStyle(C.ink, 0.2);
      for (const [px, py, r] of puffs) g.fillCircle(x + px * s + 4, y + py * s + 6, (r + 3) * s);
      g.fillStyle(0xffffff);
      for (const [px, py, r] of puffs) g.fillCircle(x + px * s, y + py * s, r * s);
    }
  }

  /**
   * The Thousand Sunny moored behind the dock: scenery only. Slower parallax puts it in the
   * distance; its keel hides behind the dock's back edge. Placed so it sits centred on screen
   * when the camera is mid-dock.
   */
  private makeShip(): Phaser.GameObjects.Image {
    const img = this.add.image(0, 0, 'art_ship').setOrigin(0.5, 1).setScrollFactor(SHIP_PARALLAX);
    img.setScale(SHIP_H / img.height);
    const midScroll = (WORLD_W - Math.min(this.box.w, WORLD_W)) / 2;
    // A parallax object only gets f × the camera's vertical offset (scrollY = -oy); add the rest back.
    img.setPosition(this.box.w / 2 + midScroll * SHIP_PARALLAX + 60, DOCK_TOP + 26 + this.box.oy * (1 - SHIP_PARALLAX));
    this.shipY = img.y;
    return img;
  }

  /**
   * The dock (original art): plank walkway with seams, a front beam and piles down into the
   * water, plus props along the back edge (bollards, crates, barrels, rope coils, lamps).
   */
  private drawDock(): void {
    const g = this.add.graphics();
    const ink = C.ink;
    const PLANK = 0xc08a52;
    const PLANK_DARK = 0x9a6a3a;
    // Piles under the dock (drawn first; the near sea covers their feet)
    for (let x = 40; x < WORLD_W; x += 150) {
      g.fillStyle(ink).fillRect(x - 15, DOCK_FRONT, 30, 140);
      g.fillStyle(0x6e4622).fillRect(x - 12, DOCK_FRONT, 24, 140);
      g.fillStyle(0x8a5a2b).fillRect(x - 8, DOCK_FRONT, 6, 140);
    }
    // Walking surface: planks running across, seams and nails
    g.fillStyle(ink).fillRect(0, DOCK_TOP - 4, WORLD_W, DOCK_FRONT - DOCK_TOP + 8);
    g.fillStyle(PLANK).fillRect(0, DOCK_TOP, WORLD_W, DOCK_FRONT - DOCK_TOP);
    g.fillStyle(0xffffff, 0.12).fillRect(0, DOCK_TOP, WORLD_W, 8);
    for (let x = 0, k = 0; x < WORLD_W; x += 44, k++) {
      g.lineStyle(2, PLANK_DARK, 0.9).lineBetween(x, DOCK_TOP, x - 10, DOCK_FRONT);
      if (k % 3 === 0) g.lineStyle(2, PLANK_DARK, 0.6).lineBetween(x + 6, DOCK_TOP + 22 + (k % 2) * 14, x + 38, DOCK_TOP + 22 + (k % 2) * 14);
      g.fillStyle(0x5a3a1e).fillCircle(x + 22, DOCK_TOP + 8, 1.6).fillCircle(x + 18, DOCK_FRONT - 8, 1.6);
    }
    // Front beam
    g.fillStyle(ink).fillRect(0, DOCK_FRONT, WORLD_W, 26);
    g.fillStyle(PLANK_DARK).fillRect(0, DOCK_FRONT + 3, WORLD_W, 19);
    g.fillStyle(0xffffff, 0.15).fillRect(0, DOCK_FRONT + 3, WORLD_W, 5);
    for (let x = 40; x < WORLD_W; x += 150) {
      g.fillStyle(ink).fillCircle(x, DOCK_FRONT + 13, 5);
      g.fillStyle(0xb0bec5).fillCircle(x, DOCK_FRONT + 13, 3);
    }

    // Props along the back edge (behind the crew's feet line)
    const by = DOCK_TOP + 6;
    const bollard = (x: number) => {
      inkPanel(g, x - 14, by - 30, 28, 30, { fill: 0x3a4652, radius: 6, shadow: 3, stroke: 3 });
      inkPanel(g, x - 19, by - 38, 38, 12, { fill: 0x4f5d6b, radius: 5, shadow: 0, stroke: 3 });
    };
    const crate = (x: number, s: number) => {
      inkPanel(g, x - s / 2, by - s, s, s, { fill: 0xb07a42, radius: 2, shadow: 4, stroke: 3 });
      g.lineStyle(3, 0x7a4f26).lineBetween(x - s / 2 + 5, by - s + 5, x + s / 2 - 5, by - 5).lineBetween(x + s / 2 - 5, by - s + 5, x - s / 2 + 5, by - 5);
      g.lineStyle(3, ink).strokeRect(x - s / 2, by - s, s, s);
    };
    const barrel = (x: number) => {
      g.fillStyle(ink).fillRoundedRect(x - 20, by - 50, 40, 50, 12);
      g.fillStyle(0xa8743c).fillRoundedRect(x - 17, by - 47, 34, 44, 10);
      g.fillStyle(0x2a2420).fillRect(x - 18, by - 39, 36, 5).fillRect(x - 18, by - 15, 36, 5);
      g.fillStyle(0xffffff, 0.2).fillRect(x - 10, by - 45, 5, 38);
    };
    const coil = (x: number) => {
      g.fillStyle(ink).fillEllipse(x, by - 7, 50, 20);
      g.fillStyle(0xd9b878).fillEllipse(x, by - 9, 44, 15);
      g.lineStyle(2, 0x9a7a40).strokeEllipse(x, by - 9, 30, 9).strokeEllipse(x, by - 9, 16, 5);
    };
    const lamp = (x: number) => {
      g.fillStyle(ink).fillRect(x - 5, by - 150, 10, 150);
      g.fillStyle(0x2a3340).fillRect(x - 3, by - 148, 6, 146);
      inkPanel(g, x - 15, by - 182, 30, 34, { fill: 0x2a3340, radius: 4, shadow: 3, stroke: 3 });
      g.fillStyle(0xffe58a).fillRect(x - 10, by - 176, 20, 22);
      g.fillStyle(ink).fillTriangle(x - 19, by - 182, x + 19, by - 182, x, by - 198);
    };
    const props: [number, (x: number) => void][] = [
      [90, lamp], [260, bollard], [420, (x) => { crate(x, 52); crate(x + 44, 40); }], [700, coil], [880, bollard],
      [1080, barrel], [1124, barrel], [1300, lamp], [1500, bollard], [1700, (x) => crate(x, 56)], [1760, coil],
      [1960, barrel], [2140, bollard], [2320, lamp], [2480, (x) => { crate(x, 46); barrel(x + 50); }],
    ];
    for (const [x, draw] of props) draw(x);
  }

  private makeBubbles(): void {
    // "E Talk" prompt over the nearest crewmate
    const pg = this.add.graphics();
    const pt = label(this, 14, 0, 'Talk', 16, { onDark: false, color: CSS.ink }).setOrigin(0, 0.5);
    const w = pt.width + 54;
    pg.fillStyle(C.ink).fillRoundedRect(-28 + 3, -18 + 3, w, 36, 16);
    pg.fillStyle(C.white).fillRoundedRect(-28, -18, w, 36, 16);
    pg.lineStyle(3, C.ink).strokeRoundedRect(-28, -18, w, 36, 16);
    this.prompt = this.add.container(0, 0, [pg, keycap(this, -8, 0, 'E', 13), pt]).setVisible(false);

    // Speech bubble (one, reused)
    this.speechG = this.add.graphics();
    this.speechText = label(this, 0, 0, '', 17, { onDark: false, color: CSS.ink, weight: 500, style: { wordWrap: { width: 300 }, align: 'center', lineSpacing: 3 } }).setOrigin(0.5, 1);
    this.speech = this.add.container(0, 0, [this.speechG, this.speechText]).setVisible(false);
  }

  private makeUi(save: ReturnType<typeof loadSave>, captainId: string): void {
    const box = this.box;
    const c = CHARACTERS.get(captainId)!;
    const rank = rankFor(save.charXp[c.id] ?? 0);
    const g = this.add.graphics();
    const L = box.left;
    const R = box.right;
    inkPanel(g, L + 70, box.top + 22, 330, 64, { fill: C.seaDeep, skew: 18, shadow: 5 });
    medallion(g, L + 64, box.top + 54, 38, C.parch);
    const portrait = this.add.image(L + 64, box.top + 64, `player_${c.id}`).setScale(2.9 / CHAR_TEX).setOrigin(0.5, 0.8);
    const name = display(this, L + 112, box.top + 30, c.name, 24, { shadow: null }).setOrigin(0, 0);
    for (let i = 0; i < 5; i++) burst(g, L + 122 + i * 19, box.top + 72, 8, 5, i < rank ? C.gold : 0x2a3f55, -Math.PI / 2);
    const stars = label(this, L + 222, box.top + 72, `Bounty rank ${rank}`, 13, { color: CSS.gold }).setOrigin(0, 0.5);
    inkPanel(g, R - 300, box.top + 22, 270, 46, { fill: C.seaDeep, skew: 14, shadow: 5 });
    medallion(g, R - 292, box.top + 45, 17, C.gold);
    const coin = this.add.image(R - 292, box.top + 45, 'ic_coin').setScale(0.68 / TEX);
    const berries = display(this, R - 266, box.top + 45, save.berries.toLocaleString('en-US'), 22, { shadow: null, color: CSS.gold }).setOrigin(0, 0.5);
    const crewCount = label(this, R - 30, box.top + 86, `Crew: ${this.crew.length + 1}`, 14).setOrigin(1, 0.5);
    const hints = hintRow(this, (L + R) / 2, box.bottom - 30, [['A/D', 'Walk'], ['E', 'Talk'], ['Esc', 'Main menu']], CSS.white);
    const back = new Button(this, L + 110, box.bottom - 34, 170, 46, 'Main menu', () => this.toTitle(), 'sea');
    this.ui = this.add.container(0, 0, [g, portrait, name, stars, coin, berries, crewCount, hints, back]).setDepth(1000);
  }

  // ---- Loop -----------------------------------------------------------------------------

  update(time: number, deltaMs: number): void {
    const t = time / 1000;
    const dt = Math.min(deltaMs / 1000, 1 / 30);
    const cam = this.cameras.main;
    const box = this.box;

    // Player input: keys, stick, or walking over to a clicked crewmate
    const k = this.keys;
    let mx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const pad = this.input.gamepad?.total ? this.input.gamepad.pad1 : undefined;
    if (pad) {
      if (Math.abs(pad.leftStick.x) > 0.2) mx = pad.leftStick.x;
      else if (pad.left || pad.right) mx = pad.left ? -1 : 1;
      if (pad.A && !this.padPrev.a) this.talk();
      if (pad.B && !this.padPrev.b) this.toTitle();
      this.padPrev = { a: pad.A, b: pad.B };
    }
    if (mx) this.walkTo = null;
    else if (this.walkTo) {
      const dx = this.walkTo.x - this.player.x;
      if (Math.abs(dx) <= TALK_RANGE * 0.7) {
        this.talkTo(this.walkTo);
        this.walkTo = null;
      } else mx = Math.sign(dx);
    }
    const p = this.player;
    p.x = Phaser.Math.Clamp(p.x + mx * SPEED * dt, DECK_L - 20, DECK_R + 20);
    if (mx) p.facing = mx < 0 ? -1 : 1;
    this.pose(p, mx !== 0, t, 0);

    // Crew wander near their spots, and stop to face the captain when close
    let near: Mate | null = null;
    let best = TALK_RANGE;
    for (let i = 0; i < this.crew.length; i++) {
      const m = this.crew[i];
      const d = Math.abs(m.x - p.x);
      const close = d < 170 || m === this.speaker;
      // Mostly stand around; now and then stroll a few steps from their spot, then rest again.
      if (!close && m.target === m.x && t >= m.restUntil) {
        m.target = Phaser.Math.Clamp(m.home + Phaser.Math.Between(-60, 60), DECK_L, DECK_R);
      }
      const step = close ? 0 : Phaser.Math.Clamp(m.target - m.x, -WALK_SPEED * dt, WALK_SPEED * dt);
      m.x += step;
      if (step !== 0 && Math.abs(m.target - m.x) < 0.5) {
        m.x = m.target; // arrived: rest a while
        m.restUntil = t + REST_MIN + Math.random() * (REST_MAX - REST_MIN);
      }
      if (close) m.facing = p.x < m.x ? -1 : 1;
      else if (Math.abs(step) > 0.01) m.facing = step < 0 ? -1 : 1;
      this.pose(m, Math.abs(step) > 0, t, i + 1);
      if (d < best) {
        best = d;
        near = m;
      }
    }

    // Bubbles
    const talking = this.speaker && this.time.now < this.speechUntil;
    if (!talking && this.speaker) {
      this.speaker = null;
      this.speech.setVisible(false);
    }
    if (this.speaker) this.speech.setPosition(this.speaker.x, this.speaker.y - 98);
    this.near = near;
    this.prompt.setVisible(!!near && near !== this.speaker);
    if (near) this.prompt.setPosition(near.x, near.y - 112);

    // Camera follows sideways; sea layers pan for parallax
    cam.scrollX += (this.cameraTarget() - cam.scrollX) * Math.min(1, dt * 6);
    const sy = HORIZON + box.oy;
    drawCelSea(this.seaBack, 0, box.w, sy, box.h - sy, t, cam.scrollX * 0.4);
    this.ship.setY(this.shipY + Math.sin(t * 0.9) * 3).setAngle(Math.sin(t * 0.6) * 0.4); // gently riding the swell
    const fy = WATERLINE + box.oy;
    drawCelSea(this.seaFront, 0, box.w, fy, box.h - fy, t * 1.2, cam.scrollX);
  }

  private cameraTarget(): number {
    const view = this.box.w;
    if (view >= WORLD_W) return (WORLD_W - view) / 2;
    return Phaser.Math.Clamp(this.player.x - view / 2, 0, WORLD_W - view);
  }

  /** Place a character: animation frames when hand-drawn, else a gentle bob. */
  private pose(m: Mate, moving: boolean, t: number, i: number): void {
    const f = m.frames;
    const anim: CharacterAnim = moving && f.run.length ? 'run' : 'idle';
    let bob = 0;
    if (f[anim].length) m.sprite.setTexture(f[anim][Math.floor(t * ANIM_FPS[anim] + i) % f[anim].length]);
    else bob = moving ? Math.abs(Math.sin(t * 12)) * -4 : Math.sin(t * 2.4 + i) * 1.5;
    m.sprite.setPosition(m.x, m.y + bob).setFlipX(m.facing < 0);
    m.shadow.setPosition(m.x, m.y + 2);
  }

  // ---- Talking ----------------------------------------------------------------------------

  private talk(): void {
    if (this.near) this.talkTo(this.near);
  }

  private talkTo(m: Mate): void {
    m.line = (m.line + 1) % m.def.lines.length;
    const text = m.def.lines[m.line];
    this.speaker = m;
    this.speechUntil = this.time.now + 3500 + text.length * 40;
    this.speechText.setText(text);
    const w = Math.max(160, this.speechText.width + 36);
    const h = this.speechText.height + 26;
    const g = this.speechG;
    g.clear();
    g.fillStyle(C.ink).fillRoundedRect(-w / 2 + 4, -h - 6 + 4, w, h, 18);
    g.fillStyle(C.white).fillRoundedRect(-w / 2, -h - 6, w, h, 18);
    g.lineStyle(3, C.ink).strokeRoundedRect(-w / 2, -h - 6, w, h, 18);
    g.fillStyle(C.white).fillTriangle(-12, -8, 12, -8, 0, 14);
    g.lineStyle(3, C.ink).lineBetween(-12, -6, 0, 14).lineBetween(0, 14, 12, -6);
    this.speechText.setPosition(0, -19);
    this.speech.setPosition(m.x, m.y - 98).setVisible(true).setScale(0.6);
    this.tweens.add({ targets: this.speech, scale: 1, duration: 160, ease: 'Back.Out' });
  }

  /** Back to the title screen (the main menu). */
  toTitle(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(250, 8, 37, 65);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('title'));
  }
}
