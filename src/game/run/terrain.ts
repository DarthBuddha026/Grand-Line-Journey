import type Phaser from 'phaser';
import { terrainNoise } from '../../core/noise';
import type { TerrainLayer, TerrainType } from '../../data';
import { DEPTH, viewport } from '../../config';

const CELL = 28;

/** fill, rim (outer edge), detail colours per terrain type. */
const STYLE: Record<TerrainType, { fill: number; rim: number; detail: number }> = {
  water: { fill: 0x2f86c4, rim: 0xbfeeff, detail: 0xe6f7ff },
  quicksand: { fill: 0xb58f52, rim: 0x7a5a2c, detail: 0x8d6e3a },
  heat: { fill: 0xd84315, rim: 0x6d1a08, detail: 0xffab40 },
  cold: { fill: 0xb8e2fa, rim: 0x5f9cc4, detail: 0xffffff },
  poison: { fill: 0x7b1fa2, rim: 0x3c0d54, detail: 0xce93d8 },
};

/**
 * Endless procedural terrain from deterministic noise: seawater (the Devil Fruit
 * rule), quicksand, and Impel Down's shifting heat/cold/poison floors.
 * Cells are drawn as overlapping circles so patches read as organic blobs with a
 * rim (foam on water). Redrawn only when the view crosses a cell or a floor shifts.
 */
export class TerrainSystem {
  private readonly layers: readonly TerrainLayer[];
  private readonly gfx: Phaser.GameObjects.Graphics | null;
  private key = '';
  private types: (TerrainType | null)[] = [];

  constructor(scene: Phaser.Scene, layers: readonly TerrainLayer[]) {
    this.layers = layers;
    this.gfx = layers.length ? scene.add.graphics().setDepth(DEPTH.ground + 1) : null;
  }

  sample(x: number, y: number, t: number): TerrainType | null {
    for (const l of this.layers) {
      if (terrainNoise(x, y, l.scale, l.seed) > l.threshold) return this.layerType(l, t);
    }
    return null;
  }

  private layerType(l: TerrainLayer, t: number): TerrainType {
    if (!l.cycle?.length) return l.type;
    return l.cycle[Math.floor(t / (l.period ?? 60)) % l.cycle.length];
  }

  update(cx: number, cy: number, t: number): void {
    const g = this.gfx;
    if (!g) return;
    const COLS = Math.ceil(viewport.w / CELL) + 4;
    const ROWS = Math.ceil(viewport.h / CELL) + 4;
    if (this.types.length < COLS * ROWS) this.types = new Array(COLS * ROWS).fill(null);
    const x0 = Math.floor((cx - viewport.w / 2) / CELL) - 2;
    const y0 = Math.floor((cy - viewport.h / 2) / CELL) - 2;
    const phase = this.layers.map((l) => (l.cycle ? Math.floor(t / (l.period ?? 60)) : 0)).join();
    const key = `${x0},${y0},${COLS},${ROWS},${phase}`;
    if (key === this.key) return;
    this.key = key;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        this.types[r * COLS + c] = this.sample((x0 + c) * CELL + CELL / 2, (y0 + r) * CELL + CELL / 2, t);
      }
    }
    g.clear();
    const rad = CELL * 0.74;
    // Pass 1: rim; pass 2: fill (overlapping circles merge into blobs); pass 3: details.
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
}
