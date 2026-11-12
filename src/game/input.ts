import Phaser from 'phaser';
import { RES } from '../config';

export type AimMode = 'mouse' | 'auto';

/**
 * Unifies keyboard + mouse, gamepad and touch into one per-frame snapshot.
 * Edge-triggered actions (special, pause, toggleAim) are true for one frame.
 */
export class InputController {
  readonly move = { x: 0, y: 0 };
  /** Unit vector the main attack aims along (world space). */
  readonly aim = { x: 1, y: 0 };
  lock = false;
  special = false;
  pause = false;
  aimMode: AimMode;
  readonly isTouch: boolean;

  /** Touch joystick state in screen pixels, for the HUD to draw. */
  readonly stick = { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0 };
  /** Screen-space touch buttons, anchored to the (expanded) screen corners. */
  touchSpecial(): { x: number; y: number; r: number } {
    return { x: this.scene.scale.width / RES - 110, y: this.scene.scale.height / RES - 110, r: 60 };
  }

  touchPause(): { x: number; y: number; r: number } {
    return { x: this.scene.scale.width / RES - 50, y: 140, r: 34 };
  }

  private readonly scene: Phaser.Scene;
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key>;
  private mouseUsed = false;
  private stickPointerId = -1;
  private queuedSpecial = false;
  private queuedPause = false;
  private padPrev = { special: false, pause: false };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.isTouch = scene.sys.game.device.input.touch && !scene.sys.game.device.os.desktop;
    this.aimMode = this.isTouch ? 'auto' : 'mouse';
    const kb = scene.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,SPACE,ESC,P,C') as Record<string, Phaser.Input.Keyboard.Key>;
    scene.input.mouse?.disableContextMenu();

    kb.on('keydown-SPACE', () => (this.queuedSpecial = true));
    kb.on('keydown-ESC', () => (this.queuedPause = true));
    kb.on('keydown-P', () => (this.queuedPause = true));
    kb.on('keydown-C', () => (this.aimMode = this.aimMode === 'mouse' ? 'auto' : 'mouse'));

    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) this.mouseUsed = true;
    });
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) {
        if (p.rightButtonDown()) this.queuedSpecial = true;
        return;
      }
      const s = this.touchSpecial();
      const ps = this.touchPause();
      const lx = p.x / RES;
      const ly = p.y / RES;
      if (Math.hypot(lx - s.x, ly - s.y) < s.r) {
        this.queuedSpecial = true;
      } else if (Math.hypot(lx - ps.x, ly - ps.y) < ps.r) {
        this.queuedPause = true;
      } else if (this.stickPointerId < 0 && lx < (this.scene.scale.width / RES) * 0.6) {
        this.stickPointerId = p.id;
        Object.assign(this.stick, { active: true, baseX: lx, baseY: ly, knobX: lx, knobY: ly });
      }
    });
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id === this.stickPointerId) {
        this.stickPointerId = -1;
        this.stick.active = false;
      }
    });
    scene.input.addPointer(2); // multi-touch: stick + a button
  }

  /**
   * @param px,py player world position (for mouse aim)
   * @param nearest direction to the nearest enemy, or null (for auto-aim)
   */
  update(px: number, py: number, nearest: { x: number; y: number } | null): void {
    const k = this.keys;
    let mx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    let my = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    let lock = k.SHIFT.isDown;
    let special = this.queuedSpecial;
    let pause = this.queuedPause;
    this.queuedSpecial = this.queuedPause = false;
    let stickAim: { x: number; y: number } | null = null;

    // Gamepad
    const pad = this.scene.input.gamepad?.total ? this.scene.input.gamepad.pad1 : undefined;
    if (pad) {
      const lx = pad.leftStick.x;
      const ly = pad.leftStick.y;
      if (Math.hypot(lx, ly) > 0.2) {
        mx = lx;
        my = ly;
      }
      const rx = pad.rightStick.x;
      const ry = pad.rightStick.y;
      if (Math.hypot(rx, ry) > 0.35) stickAim = { x: rx, y: ry };
      if (pad.L2 > 0.5) lock = true;
      const padSpecial = pad.R1 > 0.5;
      const padPause = pad.buttons[9]?.pressed ?? false;
      if (padSpecial && !this.padPrev.special) special = true;
      if (padPause && !this.padPrev.pause) pause = true;
      this.padPrev.special = padSpecial;
      this.padPrev.pause = padPause;
    }

    // Touch joystick
    if (this.stick.active) {
      const p = this.scene.input.manager.pointers.find((pt) => pt.id === this.stickPointerId);
      if (p) {
        const dx = p.x / RES - this.stick.baseX;
        const dy = p.y / RES - this.stick.baseY;
        const len = Math.hypot(dx, dy);
        const max = 60;
        const c = len > max ? max / len : 1;
        this.stick.knobX = this.stick.baseX + dx * c;
        this.stick.knobY = this.stick.baseY + dy * c;
        if (len > 8) {
          mx = dx / Math.max(len, max);
          my = dy / Math.max(len, max);
        }
      }
    }

    const mlen = Math.hypot(mx, my);
    if (mlen > 1) {
      mx /= mlen;
      my /= mlen;
    }
    this.move.x = mx;
    this.move.y = my;
    this.lock = lock;
    this.special = special;
    this.pause = pause;

    if (lock) return; // keep the current aim direction

    let ax = 0;
    let ay = 0;
    if (stickAim) {
      ax = stickAim.x;
      ay = stickAim.y;
    } else if (this.aimMode === 'mouse' && this.mouseUsed) {
      const cam = this.scene.cameras.main;
      const wp = cam.getWorldPoint(this.scene.input.activePointer.x, this.scene.input.activePointer.y);
      ax = wp.x - px;
      ay = wp.y - py;
    } else if (nearest) {
      ax = nearest.x;
      ay = nearest.y;
    } else if (mlen > 0.1) {
      ax = mx;
      ay = my;
    }
    const alen = Math.hypot(ax, ay);
    if (alen > 0.001) {
      this.aim.x = ax / alen;
      this.aim.y = ay / alen;
    }
  }
}
