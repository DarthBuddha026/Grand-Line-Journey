import type Phaser from 'phaser';
import { terrainNoise } from '../../core/noise';
import { boxInCell, inBox, pushOutOfBox, START_CLEAR, type BoxHit, type BoxLayout } from '../../core/boxes';
import type { StageObstacles, TerrainLayer, TerrainType } from '../../data';
import { DEPTH, hex, viewport } from '../../config';

const CELL = 28;
const INK = 0x1d1410;

/** fill, rim (outer edge), detail colours per terrain type. */
const STYLE: Record<TerrainType, { fill: number; rim: number; detail: number }> = {
  water: { fill: 0x2f86c4, rim: 0xbfeeff, detail: 0xe6f7ff },
  quicksand: { fill: 0xb58f52, rim: 0x7a5a2c, detail: 0x8d6e3a },
  heat: { fill: 0xd84315, rim: 0x6d1a08, detail: 0xffab40 },
  cold: { fill: 0xb8e2fa, rim: 0x5f9cc4, detail: 0xffffff },
  poison: { fill: 0x7b1fa2, rim: 0x3c0d54, detail: 0xce93d8 },
};

const shade = (c: number, f: number): number => {
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((c >> s) & 255) * f)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
const boxOf = (l: TerrainLayer): BoxLayout | null => (l.box ? { ...l.box, seed: l.seed } : null);

/**
 * Endless procedural terrain, all deterministic (nothing stored):
 *  - noise layers: organic blobs (quicksand, Impel Down's shifting heat/cold/poison floors),
 *    drawn as overlapping circles with a rim;
 *  - box layers: rectangles (seawater pools, the Devil Fruit rule);
 *  - obstacles: solid blocks the player and enemies must walk around (core/boxes.ts).
 * The run start (0, 0) is always clear. Redrawn only when the view crosses a cell or a floor shifts.
 */
export class TerrainSystem {
  private readonly layers: readonly TerrainLayer[];
  private readonly boxes: (BoxLayout | null)[];
  readonly obstacles: StageObstacles | null;
  private readonly gfx: Phaser.GameObjects.Graphics | null;
  private readonly solidGfx: Phaser.GameObjects.Graphics | null;
  private key = '';
  private types: (TerrainType | null)[] = [];

  constructor(scene: Phaser.Scene, layers: readonly TerrainLayer[], obstacles?: StageObstacles) {
    this.layers = layers;
    this.boxes = layers.map(boxOf);
    this.obstacles = obstacles ?? null;
    this.gfx = layers.length ? scene.add.graphics().setDepth(DEPTH.ground + 1) : null;
    this.solidGfx = obstacles ? scene.add.graphics().setDepth(DEPTH.ground + 2) : null;
  }

  sample(x: number, y: number, t: number): TerrainType | null {
    for (let i = 0; i < this.layers.length; i++) {
      if (this.inLayer(i, x, y)) return this.layerType(this.layers[i], t);
    }
    return null;
  }

  private inLayer(i: number, x: number, y: number): boolean {
    const box = this.boxes[i];
    if (box) return inBox(x, y, box);
    const l = this.layers[i];
    if (x * x + y * y < START_CLEAR * START_CLEAR) return false; // never start a run in terrain
    return terrainNoise(x, y, l.scale ?? 300, l.seed) > (l.threshold ?? 1);
  }

  /** Keep a circle out of the stage's blocks; returns the block it hit, or null if it touched none. */
  pushOut(x: number, y: number, r: number, out: { x: number; y: number }): BoxHit | null {
    return this.obstacles ? pushOutOfBox(x, y, r, this.obstacles, out) : null;
  }

  private layerType(l: TerrainLayer, t: number): TerrainType {
    if (!l.cycle?.length) return l.type;
    return l.cycle[Math.floor(t / (l.period ?? 60)) % l.cycle.length];
  }

  update(cx: number, cy: number, t: number): void {
    if (!this.gfx && !this.solidGfx) return;
    const COLS = Math.ceil(viewport.w / CELL) + 4;
    const ROWS = Math.ceil(viewport.h / CELL) + 4;
    const x0 = Math.floor((cx - viewport.w / 2) / CELL) - 2;
    const y0 = Math.floor((cy - viewport.h / 2) / CELL) - 2;
    const phase = this.layers.map((l) => (l.cycle ? Math.floor(t / (l.period ?? 60)) : 0)).join();
    const key = `${x0},${y0},${COLS},${ROWS},${phase}`;
    if (key === this.key) return;
    this.key = key;
    const view = { x0: x0 * CELL, y0: y0 * CELL, x1: (x0 + COLS) * CELL, y1: (y0 + ROWS) * CELL };
    if (this.gfx) this.drawGround(this.gfx, x0, y0, COLS, ROWS, t, view);
    if (this.solidGfx && this.obstacles) this.drawBlocks(this.solidGfx, this.obstacles, view);
  }

  /** Every box of a layout overlapping the view rectangle. */
  private *boxesIn(l: BoxLayout, v: { x0: number; y0: number; x1: number; y1: number }) {
    for (let cy = Math.floor(v.y0 / l.cell); cy <= Math.floor(v.y1 / l.cell); cy++) {
      for (let cx = Math.floor(v.x0 / l.cell); cx <= Math.floor(v.x1 / l.cell); cx++) {
        const b = boxInCell(cx, cy, l);
        if (b) yield b;
      }
    }
  }

  private drawGround(g: Phaser.GameObjects.Graphics, x0: number, y0: number, COLS: number, ROWS: number, t: number, view: { x0: number; y0: number; x1: number; y1: number }): void {
    g.clear();
    // Box layers (seawater pools): foam rim, water, a few ripples.
    this.layers.forEach((l, i) => {
      const box = this.boxes[i];
      if (!box) return;
      const s = STYLE[this.layerType(l, t)];
      for (const b of this.boxesIn(box, view)) {
        g.fillStyle(s.rim, 0.9).fillRoundedRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8, 8);
        g.fillStyle(s.fill).fillRoundedRect(b.x, b.y, b.w, b.h, 5);
        g.fillStyle(s.detail, 0.55);
        for (let k = 0; k < Math.floor((b.w * b.h) / 4000); k++) {
          const h = Math.imul(Math.round(b.x) + k * 977, 73856093) ^ Math.imul(Math.round(b.y), 19349663);
          const rx = b.x + 12 + ((h >>> 0) % Math.max(1, b.w - 30));
          const ry = b.y + 10 + ((h >>> 8) % Math.max(1, b.h - 20));
          g.fillRect(rx, ry, 14, 2).fillRect(rx + 4, ry - 4, 6, 2);
        }
      }
    });

    // Noise layers: overlapping circles merge into blobs. Pass 1 rim, 2 fill, 3 details.
    if (this.boxes.every((b) => b)) return;
    if (this.types.length < COLS * ROWS) this.types = new Array(COLS * ROWS).fill(null);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = (x0 + c) * CELL + CELL / 2;
        const y = (y0 + r) * CELL + CELL / 2;
        let type: TerrainType | null = null;
        for (let i = 0; i < this.layers.length && !type; i++) if (!this.boxes[i] && this.inLayer(i, x, y)) type = this.layerType(this.layers[i], t);
        this.types[r * COLS + c] = type;
      }
    }
    const rad = CELL * 0.74;
    for (let pass = 0; pass < 3; pass++) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const type = this.types[r * COLS + c];
          if (!type) continue;
          const s = STYLE[type];
          const x = (x0 + c) * CELL + CELL / 2;
          const y = (y0 + r) * CELL + CELL / 2;
          if (pass === 0) g.fillStyle(s.rim, type === 'water' ? 0.9 : 1).fillCircle(x, y, rad + 4);
          else if (pass === 1) g.fillStyle(s.fill).fillCircle(x, y, rad);
          else {
            const h = (Math.imul(x0 + c, 73856093) ^ Math.imul(y0 + r, 19349663)) >>> 0;
            if (h % 7 !== 0) continue;
            // Only decorate interior cells so details don't spill over the rim.
            const inside = c > 0 && r > 0 && c < COLS - 1 && r < ROWS - 1 &&
              this.types[r * COLS + c - 1] === type && this.types[r * COLS + c + 1] === type &&
              this.types[(r - 1) * COLS + c] === type && this.types[(r + 1) * COLS + c] === type;
            if (!inside) continue;
            g.fillStyle(s.detail, 0.55);
            if (type === 'water') g.fillRect(x - 7, y, 14, 2).fillRect(x - 3, y - 4, 6, 2);
            else if (type === 'quicksand') g.fillCircle(x, y, 5).fillStyle(s.fill).fillCircle(x, y, 2.5);
            else g.fillCircle(x, y, 3).fillCircle(x + 7, y - 5, 2);
          }
        }
      }
    }
  }

  /** Blocks: drop shadow, a darker front face, the lit top, and an ink outline. */
  private drawBlocks(g: Phaser.GameObjects.Graphics, o: StageObstacles, view: { x0: number; y0: number; x1: number; y1: number }): void {
    g.clear();
    const base = hex(o.color);
    const top = shade(base, 1.12);
    const front = shade(base, 0.68);
    const edge = shade(base, 1.35);
    for (const b of this.boxesIn(o, view)) {
      const side = Math.min(14, b.h * 0.28);
      g.fillStyle(INK, 0.22).fillRect(b.x + 5, b.y + 6, b.w, b.h);
      g.fillStyle(front).fillRect(b.x, b.y + b.h - side, b.w, side);
      g.fillStyle(top).fillRect(b.x, b.y, b.w, b.h - side);
      g.lineStyle(1.5, edge, 0.8).strokeRect(b.x + 4, b.y + 4, b.w - 8, b.h - side - 8);
      g.lineStyle(1, INK, 0.35).lineBetween(b.x, b.y + b.h - side, b.x + b.w, b.y + b.h - side);
      g.lineStyle(2, INK, 1).strokeRect(b.x, b.y, b.w, b.h);
    }
  }
}
