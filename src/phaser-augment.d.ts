// Phaser 4's typings ask for Vector2[] in fillPoints/strokePoints, but the runtime
// only reads `x` and `y`. Allow plain point objects so UI code needn't allocate Vector2s.
declare namespace Phaser.GameObjects {
  interface Graphics {
    fillPoints(points: { x: number; y: number }[], closeShape?: boolean, closePath?: boolean, endIndex?: number): this;
    strokePoints(points: { x: number; y: number }[], closeShape?: boolean, closePath?: boolean, endIndex?: number): this;
  }
}
