import Phaser from 'phaser';
import { TEX } from './textures';
import type { SkillDef, WeaponDef } from '../data';

/**
 * Generated icon glyphs (64×64): white shapes with an ink outline, drawn to sit on a
 * coloured medallion. Keys are `ic_<name>`.
 */
const INK = 0x1d1410;
const W = 0xfffaf0;
const S = 64;

type G = Phaser.GameObjects.Graphics;
type P = { x: number; y: number };

function poly(g: G, pts: number[], fill = W): void {
  const p: P[] = [];
  for (let i = 0; i < pts.length; i += 2) p.push({ x: pts[i], y: pts[i + 1] });
  g.fillStyle(fill).fillPoints(p, true);
  g.lineStyle(4, INK).strokePoints(p, true, true);
}
function circle(g: G, x: number, y: number, r: number, fill = W): void {
  g.fillStyle(fill).fillCircle(x, y, r);
  g.lineStyle(4, INK).strokeCircle(x, y, r);
}
function rrect(g: G, x: number, y: number, w: number, h: number, r: number, fill = W): void {
  g.fillStyle(fill).fillRoundedRect(x, y, w, h, r);
  g.lineStyle(4, INK).strokeRoundedRect(x, y, w, h, r);
}
/** A thick white line with an ink border. */
function thick(g: G, draw: (g: G) => void, width = 8): void {
  g.lineStyle(width + 6, INK);
  draw(g);
  g.lineStyle(width, W);
  draw(g);
}
function arc(g: G, x: number, y: number, r: number, a0: number, a1: number): void {
  g.beginPath();
  g.arc(x, y, r, a0, a1, false);
  g.strokePath();
}
function star(g: G, cx: number, cy: number, r: number, n: number, inner: number, fill = W, rot = -Math.PI / 2): void {
  const pts: number[] = [];
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 === 0 ? r : r * inner;
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  poly(g, pts, fill);
}

const ICONS: Record<string, (g: G) => void> = {
  fist: (g) => {
    rrect(g, 8, 30, 14, 13, 5);
    rrect(g, 16, 18, 36, 28, 9);
    g.lineStyle(3, INK).lineBetween(25, 19, 25, 30).lineBetween(34, 19, 34, 30).lineBetween(43, 19, 43, 30);
    rrect(g, 21, 45, 24, 11, 3);
  },
  slash: (g) => {
    thick(g, (k) => arc(k, 30, 44, 26, -2.7, -0.35), 9);
    poly(g, [50, 26, 60, 18, 54, 34]);
  },
  shot: (g) => {
    g.lineStyle(4, INK).lineBetween(4, 24, 16, 24).lineBetween(2, 32, 16, 32).lineBetween(4, 40, 16, 40);
    rrect(g, 18, 22, 32, 20, 10);
    circle(g, 50, 32, 8);
  },
  bolt: (g) => poly(g, [38, 3, 12, 36, 29, 36, 22, 61, 52, 25, 34, 25, 44, 3], 0xfff27a),
  pulse: (g) => {
    thick(g, (k) => k.strokeCircle(32, 32, 24), 5);
    thick(g, (k) => k.strokeCircle(32, 32, 12), 5);
    circle(g, 32, 32, 4);
  },
  wave: (g) => {
    thick(g, (k) => arc(k, 10, 32, 18, -1, 1), 6);
    thick(g, (k) => arc(k, 6, 32, 32, -0.8, 0.8), 6);
    thick(g, (k) => arc(k, 2, 32, 46, -0.6, 0.6), 5);
  },
  orbit: (g) => {
    g.lineStyle(3, INK).strokeEllipse(32, 32, 56, 30);
    circle(g, 32, 32, 11);
    circle(g, 8, 30, 7);
    circle(g, 55, 36, 7);
  },
  chain: (g) => {
    for (const [x, y] of [[16, 46], [32, 32], [48, 18]]) thick(g, (k) => k.strokeEllipse(x, y, 22, 14), 5);
  },
  zone: (g) => {
    circle(g, 32, 34, 24, 0xbff0ff);
    thick(g, (k) => arc(k, 32, 34, 13, 0, 4.2), 4);
    circle(g, 46, 14, 5);
    circle(g, 54, 26, 3);
  },
  beam: (g) => {
    rrect(g, 14, 24, 48, 16, 6, 0xffe1e1);
    circle(g, 14, 32, 13);
    g.lineStyle(3, INK).lineBetween(26, 32, 58, 32);
  },
  dash: (g) => {
    poly(g, [6, 12, 26, 32, 6, 52, 18, 52, 38, 32, 18, 12]);
    poly(g, [26, 12, 46, 32, 26, 52, 38, 52, 58, 32, 38, 12]);
  },
  blink: (g) => star(g, 32, 32, 28, 4, 0.3, 0xfff6c8, 0),
  burst: (g) => star(g, 32, 32, 28, 10, 0.55, 0xffd28a),
  flame: (g) => {
    poly(g, [32, 4, 50, 30, 52, 44, 44, 56, 20, 56, 12, 44, 16, 28, 24, 36], 0xffb36b);
    poly(g, [32, 26, 40, 40, 38, 52, 26, 52, 24, 42], 0xfff3b0);
  },
  bottle: (g) => {
    rrect(g, 26, 4, 12, 16, 3);
    poly(g, [24, 18, 40, 18, 48, 32, 48, 58, 16, 58, 16, 32]);
    g.lineStyle(3, INK).lineBetween(16, 40, 48, 40);
  },
  heart: (g) => poly(g, [32, 56, 8, 32, 6, 20, 12, 10, 24, 8, 32, 16, 40, 8, 52, 10, 58, 20, 56, 32], 0xffb3b8),
  star: (g) => star(g, 32, 33, 28, 5, 0.45, 0xfff27a),
  shield: (g) => {
    poly(g, [32, 4, 56, 12, 54, 36, 32, 60, 10, 36, 8, 12]);
    g.lineStyle(3, INK).lineBetween(32, 10, 32, 52);
  },
  coin: (g) => {
    circle(g, 32, 32, 26, 0xffd84d);
    g.lineStyle(3, INK).strokeCircle(32, 32, 19);
    g.lineStyle(4, INK).lineBetween(28, 20, 28, 44).lineBetween(36, 20, 36, 44);
  },
  chest: (g) => {
    rrect(g, 8, 26, 48, 30, 4, 0xc98a4b);
    poly(g, [8, 28, 12, 12, 52, 12, 56, 28], 0xe0a35e);
    rrect(g, 27, 26, 10, 12, 2, 0xffd84d);
  },
  book: (g) => {
    poly(g, [32, 16, 8, 10, 8, 52, 32, 58]);
    poly(g, [32, 16, 56, 10, 56, 52, 32, 58]);
    g.lineStyle(2, INK).lineBetween(14, 24, 26, 26).lineBetween(14, 34, 26, 36).lineBetween(38, 26, 50, 24).lineBetween(38, 36, 50, 34);
  },
  compass: (g) => {
    circle(g, 32, 32, 26);
    poly(g, [32, 10, 39, 32, 32, 54, 25, 32], 0xff6b6b);
    circle(g, 32, 32, 4);
  },
  map: (g) => {
    poly(g, [8, 12, 24, 8, 40, 14, 56, 10, 56, 52, 40, 56, 24, 50, 8, 54], 0xf3e2b8);
    g.lineStyle(5, 0xe0303a).lineBetween(34, 26, 46, 38).lineBetween(46, 26, 34, 38);
    g.lineStyle(2, INK).lineBetween(14, 44, 22, 36).lineBetween(22, 36, 30, 40);
  },
  poster: (g) => {
    rrect(g, 12, 6, 40, 52, 2, 0xf3e2b8);
    g.fillStyle(INK).fillRect(18, 12, 28, 5);
    rrect(g, 20, 21, 24, 20, 2, 0xd9bd84);
    g.lineStyle(3, INK).lineBetween(18, 48, 46, 48);
  },
  log: (g) => {
    rrect(g, 6, 18, 46, 28, 12, 0xc98a4b);
    circle(g, 48, 32, 14, 0xe8c08a);
    g.lineStyle(2, INK).strokeCircle(48, 32, 7);
  },
  barrel: (g) => {
    poly(g, [16, 6, 48, 6, 54, 32, 48, 58, 16, 58, 10, 32], 0xb87a3c);
    g.lineStyle(4, INK).lineBetween(12, 20, 52, 20).lineBetween(12, 44, 52, 44);
  },
  cup: (g) => {
    poly(g, [6, 22, 58, 22, 46, 46, 18, 46]);
    rrect(g, 22, 46, 20, 8, 3);
    g.fillStyle(0xe0b3ff).fillEllipse(32, 24, 46, 6);
  },
  skull: (g) => {
    circle(g, 32, 28, 22);
    rrect(g, 22, 42, 20, 14, 3);
    g.fillStyle(INK).fillCircle(24, 28, 6).fillCircle(40, 28, 6).fillTriangle(32, 34, 28, 40, 36, 40);
  },
  cuffs: (g) => {
    thick(g, (k) => k.strokeCircle(20, 36, 13), 6);
    thick(g, (k) => k.strokeCircle(44, 28, 13), 6);
    g.lineStyle(4, INK).lineBetween(30, 30, 34, 32);
  },
  meat: (g) => {
    circle(g, 12, 46, 6);
    circle(g, 18, 54, 6);
    poly(g, [14, 48, 26, 38, 30, 42, 18, 52]);
    g.fillStyle(0xd2603a).fillEllipse(38, 26, 40, 34);
    g.lineStyle(4, INK).strokeEllipse(38, 26, 40, 34);
  },
  card: (g) => {
    poly(g, [14, 8, 42, 8, 52, 18, 52, 56, 14, 56]);
    poly(g, [42, 8, 42, 18, 52, 18], 0xd9bd84);
    poly(g, [32, 26, 40, 38, 36, 48, 28, 48, 24, 38], 0xff9b6b);
  },
  wind: (g) => {
    thick(g, (k) => {
      k.beginPath();
      k.moveTo(6, 22);
      k.lineTo(40, 22);
      k.strokePath();
      arc(k, 42, 16, 7, 1.6, 5.2);
    }, 5);
    thick(g, (k) => {
      k.beginPath();
      k.moveTo(6, 40);
      k.lineTo(48, 40);
      k.strokePath();
      arc(k, 50, 46, 7, -1.6, 2);
    }, 5);
  },
  magnet: (g) => {
    thick(g, (k) => arc(k, 32, 30, 16, 0, Math.PI), 12);
    thick(g, (k) => k.lineBetween(16, 30, 16, 12).lineBetween(48, 30, 48, 12), 12);
    g.fillStyle(0xe0303a).fillRect(10, 6, 12, 8).fillRect(42, 6, 12, 8);
  },
  crown: (g) => poly(g, [6, 50, 8, 18, 22, 32, 32, 10, 42, 32, 56, 18, 58, 50], 0xffd84d),
  haki: (g) => {
    poly(g, [32, 4, 58, 32, 32, 60, 6, 32], 0x6a3ad6);
    poly(g, [32, 16, 46, 32, 32, 48, 18, 32], 0xc9a8ff);
  },
  anvil: (g) => {
    poly(g, [4, 16, 60, 16, 52, 28, 40, 30, 40, 42, 50, 54, 14, 54, 24, 42, 24, 30, 12, 26], 0xb0bec5);
  },
  hourglass: (g) => {
    poly(g, [14, 6, 50, 6, 36, 32, 50, 58, 14, 58, 28, 32], 0xfff3c4);
    g.fillStyle(0xe0a35e).fillTriangle(22, 52, 42, 52, 32, 40);
  },
  sword: (g) => {
    poly(g, [44, 6, 58, 6, 58, 20, 24, 46, 18, 40]);
    poly(g, [10, 36, 28, 54, 24, 58, 6, 40], 0xffd84d);
    rrect(g, 4, 50, 12, 12, 3, 0xc98a4b);
  },
};

export function generateIcons(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (const [name, draw] of Object.entries(ICONS)) {
    g.clear();
    g.setScale(TEX);
    draw(g);
    g.generateTexture(`ic_${name}`, S * TEX, S * TEX);
    scene.textures.get(`ic_${name}`).setFilter(Phaser.Textures.FilterMode.LINEAR);
  }
  g.destroy();
}

const WEAPON_ICON: Record<string, string> = {
  cannon_volley: 'burst', flame_dial: 'flame', impact_dial: 'pulse', den_den_ring: 'orbit', seastone_chain: 'chain',
  rankyaku: 'slash', pacifista_laser: 'beam', sake_bottle: 'bottle', wanted_posters: 'poster', sea_king_bait: 'zone',
  electro: 'bolt', tone_dial: 'wave', buster_call: 'burst', gaon_cannon: 'beam', reject_dial: 'pulse', seraphim_ray: 'bolt',
  storm_leg_tempest: 'slash', sea_king_feast: 'zone',
};
const ACTION_ICON: Record<string, string> = {
  punch: 'fist', cone: 'slash', volley: 'shot', strike: 'bolt', pulse: 'pulse', orbit: 'orbit', sweep: 'chain', zone: 'zone',
  beam: 'beam', dash: 'dash', blink: 'blink', chain: 'bolt', screen: 'burst', buff: 'star', heal: 'heart', flurry: 'fist',
  magnet: 'magnet', transform: 'burst', multi: 'burst',
};
const ITEM_ICON: Record<string, string> = {
  meat_on_the_bone: 'meat', vivre_card: 'card', log_pose: 'compass', eternal_pose: 'compass', treasure_map: 'map',
  bounty_poster: 'poster', adam_wood: 'log', cola_barrel: 'barrel', coup_de_burst: 'dash', sake_cup: 'cup',
  jolly_roger: 'skull', klabautermann: 'shield', gold_doubloon: 'coin', seastone_cuffs: 'cuffs',
};
const MOD_ICON: Record<string, string> = {
  dodge: 'wind', regen: 'heart', revives: 'card', berryMul: 'coin', burnOnHit: 'flame', fearOnHit: 'skull', farDmg: 'compass',
  slowOnHit: 'wave', knockbackMul: 'pulse', eliteDmg: 'crown', shieldMax: 'shield', mainExtraCount: 'fist', chestRarity: 'chest',
  extraChoices: 'book', healMul: 'meat', foodXp: 'meat', stunnedDmg: 'star', magmaPools: 'flame', lowHpDmg: 'heart',
  postSpecialInvuln: 'blink', seawaterHeals: 'wave', waterWalker: 'wave', noSlow: 'compass', ignoreHazards: 'wind', selfDrain: 'sword',
};
const STAT_ICON: Record<string, string> = { atk: 'sword', maxHp: 'heart', defense: 'shield', spd: 'dash', crit: 'star', haste: 'hourglass', pickup: 'magnet', xpGain: 'book' };
const CUSTOM_ICON: Record<string, string> = { lost: 'compass', rumbleBall: 'star', lazyJustice: 'hourglass', powerNap: 'heart', upsetStomach: 'skull' };

export function weaponIcon(def: WeaponDef): string {
  return `ic_${WEAPON_ICON[def.id] ?? ACTION_ICON[def.levels[0].action.type] ?? 'sword'}`;
}

export function itemIcon(id: string): string {
  return `ic_${ITEM_ICON[id] ?? 'star'}`;
}

export function skillIcon(def: SkillDef): string {
  if (def.custom && CUSTOM_ICON[def.custom]) return `ic_${CUSTOM_ICON[def.custom]}`;
  const l = def.levels[0];
  if (l.action) return `ic_${ACTION_ICON[l.action.type] ?? 'star'}`;
  const mod = Object.keys(l.mods ?? {})[0];
  if (mod && MOD_ICON[mod]) return `ic_${MOD_ICON[mod]}`;
  const stat = l.stats?.[0]?.stat;
  if (stat && STAT_ICON[stat]) return `ic_${STAT_ICON[stat]}`;
  return 'ic_star';
}
