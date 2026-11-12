import Phaser from 'phaser';
import { Pool, type Poolable } from '../../core/pool';
import { CAPS, DEPTH, RES } from '../../config';

interface DamageNumber extends Poolable {
  life: number;
  vy: number;
  text: Phaser.GameObjects.Text;
}

interface Burst extends Poolable {
  life: number;
  maxLife: number;
  fromR: number;
  toR: number;
  followPlayer: boolean;
  alpha0: number;
  line: boolean;
  sprite: Phaser.GameObjects.Image;
}

/** Pooled visual-only effects: floating damage numbers, expanding rings/flashes and lightning lines. */
export class FxSystem {
  private readonly numbers: Pool<DamageNumber>;
  private readonly bursts: Pool<Burst>;
  private readonly getPlayer: () => { x: number; y: number };

  constructor(scene: Phaser.Scene, getPlayer: () => { x: number; y: number }) {
    this.getPlayer = getPlayer;
    this.numbers = new Pool<DamageNumber>(CAPS.damageNumbers, () => ({
      poolSlot: -1,
      life: 0,
      vy: 0,
      text: scene.add
        .text(0, 0, '', {
          fontFamily: '"Abril Fatface", Georgia, serif',
          fontSize: '9px',
          color: '#ffffff',
          stroke: '#1d1410',
          strokeThickness: 2.5,
          resolution: Math.min(6, 2 * RES),
        })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.damage)
        .setVisible(false),
    }));
    this.bursts = new Pool<Burst>(CAPS.fx, () => ({
      poolSlot: -1, life: 0, maxLife: 0, fromR: 0, toR: 0, followPlayer: false, alpha0: 1, line: false,
      sprite: scene.add.image(0, 0, 'ring').setDepth(DEPTH.fx).setVisible(false),
    }));
  }

  damageNumber(x: number, y: number, amount: number, crit: boolean, color?: string): void {
    const n = this.numbers.acquire() ?? this.recycleOldestNumber();
    if (!n) return;
    n.life = 0.6;
    n.vy = -28;
    n.text
      .setText(String(Math.max(1, Math.round(amount))))
      .setColor(color ?? (crit ? '#ffd23f' : '#ffffff'))
      .setScale(crit ? 1.3 : color ? 0.8 : 1)
      .setPosition(x + (Math.random() - 0.5) * 6, y)
      .setAlpha(1)
      .setVisible(true);
  }

  private recycleOldestNumber(): DamageNumber | null {
    const list = this.numbers.active;
    if (list.length === 0) return null;
    let oldest = list[0];
    for (const n of list) if (n.life < oldest.life) oldest = n;
    return oldest;
  }

  /** An expanding ring (texture 'ring') or filled flash (texture 'disc'). */
  burst(x: number, y: number, fromR: number, toR: number, duration: number, tint: number, texture: 'ring' | 'disc' = 'ring', followPlayer = false, alpha = 1): void {
    const b = this.bursts.acquire();
    if (!b) return;
    b.life = b.maxLife = duration;
    b.fromR = fromR;
    b.toR = toR;
    b.followPlayer = followPlayer;
    b.alpha0 = alpha;
    b.line = false;
    b.sprite.setTexture(texture).setTint(tint).setOrigin(0.5).setRotation(0).setPosition(x, y).setDisplaySize(fromR * 2, fromR * 2).setAlpha(alpha).setVisible(true);
  }

  /** A fading line (lightning, light-speed blinks). */
  line(x1: number, y1: number, x2: number, y2: number, tint: number, width = 2, duration = 0.18): void {
    const b = this.bursts.acquire();
    if (!b) return;
    b.life = b.maxLife = duration;
    b.line = true;
    b.followPlayer = false;
    b.alpha0 = 1;
    b.fromR = b.toR = width;
    b.sprite
      .setTexture('white')
      .setTint(tint)
      .setOrigin(0, 0.5)
      .setPosition(x1, y1)
      .setRotation(Math.atan2(y2 - y1, x2 - x1))
      .setDisplaySize(Math.hypot(x2 - x1, y2 - y1), width)
      .setAlpha(1)
      .setVisible(true);
  }

  update(dt: number): void {
    const nums = this.numbers.active;
    for (let i = nums.length - 1; i >= 0; i--) {
      const n = nums[i];
      n.life -= dt;
      if (n.life <= 0) {
        n.text.setVisible(false);
        this.numbers.release(n);
        continue;
      }
      n.vy += 60 * dt;
      n.text.y += n.vy * dt;
      if (n.life < 0.2) n.text.setAlpha(n.life / 0.2);
    }

    const bursts = this.bursts.active;
    const p = this.getPlayer();
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.life -= dt;
      if (b.life <= 0) {
        b.sprite.setVisible(false);
        this.bursts.release(b);
        continue;
      }
      const t = 1 - b.life / b.maxLife;
      if (b.line) {
        b.sprite.setAlpha(1 - t);
        continue;
      }
      const r = Phaser.Math.Linear(b.fromR, b.toR, 1 - (1 - t) * (1 - t));
      if (b.followPlayer) b.sprite.setPosition(p.x, p.y);
      b.sprite.setDisplaySize(r * 2, r * 2).setAlpha(b.alpha0 * (1 - t));
    }
  }
}
