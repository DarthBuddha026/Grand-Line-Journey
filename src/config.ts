/**
 * The canvas is 1280×720 so HUD text stays crisp; the world camera uses an integer
 * zoom of 2, giving the plan's 640×360 internal resolution for gameplay.
 */
/**
 * Render scale. Layout is authored in 1280×720 design units, but the canvas renders at
 * RES× that so the game is sharp on 1080p/1440p/4K and high-DPI phones (Phaser 4 has no
 * global resolution setting, so every camera zooms by RES instead). Chosen once at boot
 * from the screen's physical pixels; override with ?res=N.
 */
export const RES = computeRes();

function computeRes(): number {
  const g = globalThis as unknown as { window?: Window };
  if (!g.window) return 1;
  const forced = Number(new URLSearchParams(g.window.location.search).get('res'));
  if (forced > 0) return Math.min(4, Math.max(0.5, forced));
  const dpr = g.window.devicePixelRatio || 1;
  const sw = Math.max(g.window.screen.width, g.window.screen.height) * dpr;
  const sh = Math.min(g.window.screen.width, g.window.screen.height) * dpr;
  const fit = Math.min(sw / 1280, sh / 720);
  return Math.min(3, Math.max(1, Math.round(fit * 4) / 4));
}

/** Text is rasterised at this resolution so it stays crisp under the RES zoom. */
export const TEXT_RES = Math.min(4, RES * 1.25);

export const GAME_W = 1280;
export const GAME_H = 720;
export const WORLD_ZOOM = 3; // world → design units; 3 shows about 427×240 of the world at 16:9
export const VIEW_W = GAME_W / WORLD_ZOOM;
export const VIEW_H = GAME_H / WORLD_ZOOM;

/**
 * Live size of the visible world in world units. The canvas expands to the screen's
 * aspect ratio (Scale.EXPAND), so wider/taller screens see more of the sea; RunScene
 * updates this on create and on every resize. Spawning, screen-wide attacks and terrain
 * read it instead of VIEW_W/VIEW_H.
 */
export const viewport = { w: VIEW_W, h: VIEW_H };

/** Enemies further than this wrap around to the other side of the screen. */
export function recycleDist(): number {
  return Math.max(RECYCLE_DIST, Math.hypot(viewport.w, viewport.h) / 2 + 160);
}

/** Pool capacities. Everything is allocated at run start; nothing is created mid-run. */
export const CAPS = {
  enemies: 500,
  hitboxes: 600,
  pickups: 700,
  enemyShots: 260,
  damageNumbers: 90,
  fx: 90,
} as const;

/** Each anvil enhancement adds this much damage to a weapon. */
export const LIMITS_ENHANCE_DMG = 0.15;

/** Merge new XP into existing orbs once this many are on the field. */
export const ORB_MERGE_THRESHOLD = 200;

/** Spawn ring just outside the visible area; enemies further than RECYCLE_DIST wrap around. */
export const SPAWN_MARGIN = 24;
export const RECYCLE_DIST = 520;

export const PLAYER_RADIUS = 6;
export const PLAYER_BASE_SPEED = 60; // px/s before the spd multiplier
export const PLAYER_IFRAMES = 0.5;

export const DEPTH = {
  ground: 0,
  pickup: 10,
  enemy: 20,
  player: 30,
  hitbox: 40,
  enemyShot: 45,
  fx: 50,
  damage: 60,
} as const;

/** URL flags: ?debug shows perf counters, ?seed=N fixes RNG, ?time=S starts the run at S seconds, ?unlockall is test mode: every character, 999,999,999 Berries, nothing saved. */
export function readUrlFlags(): { debug: boolean; seed?: number; startTime: number; unlockAll: boolean } {
  const p = new URLSearchParams(globalThis.location?.search ?? '');
  const seed = p.get('seed');
  return {
    debug: p.has('debug'),
    seed: seed !== null ? Number(seed) : undefined,
    startTime: Number(p.get('time') ?? 0) || 0,
    unlockAll: p.has('unlockall'),
  };
}

export function hex(color: string): number {
  return parseInt(color.replace('#', ''), 16);
}
