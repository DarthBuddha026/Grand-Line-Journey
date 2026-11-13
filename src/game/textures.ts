import Phaser from 'phaser';
import { CHARACTERS, STAGES, type CharacterDef } from '../data';
import { hex } from '../config';

/**
 * HD placeholder art, generated at boot. Shapes are drawn in small "logical" boxes
 * (a character is 16×22 world units) but rasterised supersampled — TEX× for most
 * textures, CHAR_TEX× for characters — with smooth filtering, so nothing looks like
 * pixel art when the cameras zoom in. Anything displaying these textures with
 * setScale() must divide by the matching factor (setDisplaySize() needs no change).
 * Most shapes are white so game code can tint them per enemy/weapon.
 */
export const TEX = 4;
export const CHAR_TEX = 12;

const INK = 0x1d1410;

type G = Phaser.GameObjects.Graphics;
type Make = (key: string, w: number, h: number, draw: () => void, tex?: number) => void;

export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const make: Make = (key, w, h, draw, tex = TEX) => {
    g.clear();
    g.setScale(tex);
    draw();
    g.generateTexture(key, Math.ceil(w * tex), Math.ceil(h * tex));
    scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
  };

  make('white', 4, 4, () => g.fillStyle(0xffffff).fillRect(0, 0, 4, 4), 1);

  // Enemy: soft round body (white so it can be tinted), ink rim, determined eyes.
  make('enemy', 16, 16, () => {
    g.fillStyle(INK).fillCircle(8, 8.3, 7.6);
    g.fillStyle(0xd6d6d6).fillCircle(8, 8.2, 7);
    g.fillStyle(0xffffff).fillCircle(7.6, 7.4, 6.2);
    g.fillStyle(0xffffff, 0.9).fillEllipse(5.6, 4.6, 3.2, 2);
    g.fillStyle(INK).fillEllipse(5.6, 8.2, 1.6, 2.4).fillEllipse(10, 8.2, 1.6, 2.4);
    g.fillStyle(0xffffff).fillCircle(5.9, 7.6, 0.45).fillCircle(10.3, 7.6, 0.45);
    g.lineStyle(0.7, INK).lineBetween(4.4, 6, 6.8, 6.8).lineBetween(11.2, 6, 8.8, 6.8);
  });

  make('boss', 32, 34, () => {
    g.fillStyle(INK).fillCircle(16, 19, 14.6);
    g.fillStyle(0xcfcfcf).fillCircle(16, 18.8, 13.8);
    g.fillStyle(0xffffff).fillCircle(15.2, 17.6, 12.4);
    g.fillStyle(0xffffff, 0.9).fillEllipse(11, 11, 6, 3);
    g.fillStyle(INK).fillEllipse(11, 17, 3, 3.6).fillEllipse(21, 17, 3, 3.6);
    g.fillStyle(0xffffff).fillCircle(11.6, 16.2, 0.8).fillCircle(21.6, 16.2, 0.8);
    g.lineStyle(1.3, INK).lineBetween(7.5, 12.5, 13.5, 14.5).lineBetween(24.5, 12.5, 18.5, 14.5);
    g.lineStyle(1.2, INK).lineBetween(12, 24, 20, 24);
    // crown
    const crown = [{ x: 7, y: 7 }, { x: 9, y: 0.8 }, { x: 13, y: 5 }, { x: 16, y: 0 }, { x: 19, y: 5 }, { x: 23, y: 0.8 }, { x: 25, y: 7 }];
    g.fillStyle(0xffd54f).fillPoints(crown, true);
    g.lineStyle(1, INK).strokePoints(crown, true, true);
  });

  make('shadow', 16, 6, () => {
    g.fillStyle(0x000000, 0.12).fillEllipse(8, 3, 16, 6);
    g.fillStyle(0x000000, 0.14).fillEllipse(8, 3, 11, 4);
  });

  // XP gem
  make('orb', 6, 8, () => {
    const pts = [{ x: 3, y: 0.3 }, { x: 5.7, y: 3 }, { x: 3, y: 7.7 }, { x: 0.3, y: 3 }];
    g.fillStyle(0xffffff).fillPoints(pts, true);
    g.fillStyle(0xdddddd).fillTriangle(3, 0.3, 5.7, 3, 3, 3);
    g.fillStyle(0xffffff).fillTriangle(1.4, 2.8, 3, 1, 3, 2.8);
    g.lineStyle(0.45, INK, 0.8).strokePoints(pts, true, true);
  });

  make('berry', 8, 8, () => {
    g.fillStyle(INK).fillCircle(4, 4.2, 3.9);
    g.fillStyle(0xc99a1c).fillCircle(4, 4, 3.6);
    g.fillStyle(0xffd94a).fillCircle(4, 4, 2.9);
    g.fillStyle(0xfff2b0).fillEllipse(3, 2.6, 2.2, 1.2);
    g.lineStyle(0.55, 0x9a6f00).lineBetween(3.3, 2.2, 3.3, 5.8).lineBetween(4.7, 2.2, 4.7, 5.8);
  });

  make('meat', 12, 8, () => {
    g.fillStyle(INK).fillCircle(1.4, 2.2, 1.6).fillCircle(1.4, 5.8, 1.6).fillRect(1, 2.8, 4, 2.4);
    g.fillStyle(0xf6f1e4).fillCircle(1.4, 2.2, 1.2).fillCircle(1.4, 5.8, 1.2).fillRect(1.2, 3.2, 4, 1.6);
    g.fillStyle(INK).fillEllipse(8, 4, 8.6, 7.6);
    g.fillStyle(0xa2452a).fillEllipse(8, 4, 7.8, 6.8);
    g.fillStyle(0xd9673f).fillEllipse(7.6, 3.2, 5.6, 3.6);
    g.fillStyle(0xffffff, 0.5).fillEllipse(6.8, 2.4, 2.2, 1);
  });

  make('chest', 16, 14, () => {
    g.fillStyle(INK).fillRoundedRect(0, 4, 16, 10, 1.6).fillRoundedRect(0.6, 0, 14.8, 6.4, 2.4);
    g.fillStyle(0x7a4520).fillRoundedRect(0.7, 4.6, 14.6, 8.7, 1.2);
    g.fillStyle(0x9e6233).fillRoundedRect(1.3, 0.7, 13.4, 5, 2);
    g.fillStyle(0xffd54f).fillRect(0.7, 5, 14.6, 1.4).fillRect(7, 4, 2, 6.2);
    g.fillStyle(0xfff3c4).fillRect(7.5, 7.4, 1, 1.4);
    g.fillStyle(0xffffff, 0.35).fillRect(2, 1.4, 6, 1);
  });

  make('anvil', 16, 12, () => {
    const pts = [{ x: 0.5, y: 0.5 }, { x: 15.5, y: 0.5 }, { x: 13, y: 4 }, { x: 10.5, y: 4.4 }, { x: 10.5, y: 7.6 }, { x: 13, y: 11.5 }, { x: 3, y: 11.5 }, { x: 5.5, y: 7.6 }, { x: 5.5, y: 4.4 }, { x: 2.8, y: 3.6 }];
    g.fillStyle(0x7d8f99).fillPoints(pts, true);
    g.fillStyle(0xc5d3da).fillRect(1.5, 0.8, 12, 1.2);
    g.lineStyle(0.6, INK).strokePoints(pts, true, true);
  });

  make('haki', 12, 12, () => {
    const outer = [{ x: 6, y: 0.4 }, { x: 11.6, y: 6 }, { x: 6, y: 11.6 }, { x: 0.4, y: 6 }];
    g.fillStyle(0x4a148c).fillPoints(outer, true);
    g.fillStyle(0xb388ff).fillPoints([{ x: 6, y: 2.4 }, { x: 9.6, y: 6 }, { x: 6, y: 9.6 }, { x: 2.4, y: 6 }], true);
    g.fillStyle(0xffffff, 0.7).fillTriangle(6, 2.4, 6, 6, 3.6, 4.8);
    g.lineStyle(0.6, INK).strokePoints(outer, true, true);
  });

  make('fist', 12, 12, () => {
    g.fillStyle(INK).fillCircle(6, 6, 6);
    g.fillStyle(0xffffff).fillCircle(6, 6, 5.2);
    g.fillStyle(0xe8e8e8).fillCircle(6.6, 6.8, 3.8);
    g.lineStyle(0.6, INK, 0.6).lineBetween(4, 3.6, 4, 6).lineBetween(6.2, 3.2, 6.2, 5.8).lineBetween(8.4, 3.6, 8.4, 6);
  });

  make('ring', 64, 64, () => {
    g.lineStyle(3, 0xffffff).strokeCircle(32, 32, 30);
    g.lineStyle(1.2, 0xffffff, 0.5).strokeCircle(32, 32, 26);
  });
  make('disc', 64, 64, () => {
    g.fillStyle(0xffffff, 0.55).fillCircle(32, 32, 32);
    g.fillStyle(0xffffff, 0.8).fillCircle(32, 32, 26);
    g.fillStyle(0xffffff).fillCircle(32, 32, 20);
  });

  make('blade', 16, 16, () => {
    g.fillStyle(0xffffff);
    g.slice(4, 8, 10, Phaser.Math.DegToRad(-70), Phaser.Math.DegToRad(70), false).fillPath();
    g.fillStyle(0xffffff, 0.5);
    g.slice(2.5, 8, 10, Phaser.Math.DegToRad(-55), Phaser.Math.DegToRad(55), false).fillPath();
  });

  make('pellet', 8, 8, () => {
    g.fillStyle(0xffffff, 0.45).fillCircle(4, 4, 4);
    g.fillStyle(0xffffff).fillCircle(4, 4, 3);
    g.fillStyle(0xffffff).fillCircle(3.2, 3, 1.1);
  });

  make('poster', 12, 14, () => {
    g.fillStyle(INK).fillRect(0, 0, 12, 14);
    g.fillStyle(0xffffff).fillRect(0.6, 0.6, 10.8, 12.8);
    g.fillStyle(0x8d6e63).fillRect(2.2, 1.6, 7.6, 1.8).fillRect(2.6, 12, 6.8, 0.8);
    g.fillStyle(0xbfa58a).fillRect(3, 4.4, 6, 5.6);
  });

  make('wave', 16, 16, () => {
    g.lineStyle(1.8, 0xffffff);
    g.beginPath();
    g.arc(4, 8, 7, -1.1, 1.1, false);
    g.strokePath();
    g.lineStyle(1.2, 0xffffff, 0.7);
    g.beginPath();
    g.arc(2, 8, 11, -0.9, 0.9, false);
    g.strokePath();
  });

  make('snail', 14, 12, () => {
    g.fillStyle(INK).fillRoundedRect(0, 7.4, 14, 4.6, 2);
    g.fillStyle(0xf0e2b4).fillRoundedRect(0.6, 8, 12.8, 3.4, 1.6);
    g.fillStyle(INK).fillCircle(8, 6, 5.4);
    g.fillStyle(0xffffff).fillCircle(8, 6, 4.8);
    g.lineStyle(0.8, 0x335522).strokeCircle(8, 6, 3).strokeCircle(8.4, 6.2, 1.4);
    g.fillStyle(0xf0e2b4).fillRoundedRect(1, 3, 2, 6, 1);
    g.fillStyle(INK).fillCircle(2, 3, 0.7);
  });

  make('shot', 6, 6, () => {
    g.fillStyle(INK).fillCircle(3, 3, 3);
    g.fillStyle(0xff6644).fillCircle(3, 3, 1.8);
    g.fillStyle(0xffd0b8).fillCircle(2.5, 2.4, 0.7);
  });

  // Hand-drawn characters (src/assets/characters/<id>/stand.png, loaded at boot) replace the generated chibi.
  for (const c of CHARACTERS.values()) if (!scene.textures.exists(`player_${c.id}`)) drawCharacter(g, make, c);

  for (const st of STAGES.values()) {
    const base = hex(st.ground.base);
    const detail = hex(st.ground.detail);
    make(`ground_${st.id}`, 64, 64, () => {
      g.fillStyle(base).fillRect(0, 0, 64, 64);
      g.fillStyle(detail, 0.8);
      for (const [x, y, r] of [[6, 10, 1.4], [40, 4, 1.1], [22, 30, 1.6], [54, 40, 1.2], [10, 50, 1], [34, 56, 1.4], [50, 20, 0.9]]) g.fillEllipse(x, y, r * 2.4, r * 1.6);
      g.fillStyle(detail, 0.25);
      for (const [x, y] of [[16, 20], [44, 46], [28, 8]]) g.fillEllipse(x, y, 14, 6);
    }, 2);
  }
  g.destroy();

  // Soft radial vignette for sandstorms (canvas gradient).
  const size = 512;
  const tex = scene.textures.createCanvas('vignette', size, size);
  if (tex) {
    const ctx = tex.getContext();
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.12, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }
}

/**
 * A smooth inked chibi (16×22 logical units) from the character's look colours:
 * big round head, anime eyes with highlights, hair, optional hat, rounded body.
 */
function drawCharacter(g: G, make: Make, c: CharacterDef): void {
  const L = c.look;
  const body = hex(L.body);
  const hair = hex(L.hair);
  const skin = hex(L.skin ?? '#f6d2b0');
  const pants = hex(L.pants ?? '#37474f');
  const tall = L.tall ? 1.2 : 0;
  const dark = (col: number, by: number) => Phaser.Display.Color.IntegerToColor(col).darken(by).color;
  const headY = 7 - tall * 0.3;
  const headR = L.tall ? 4.7 : 5.1;
  make(`player_${c.id}`, 16, 22, () => {
    const o = 0.42; // ink outline width (logical)
    // Legs and shoes
    g.fillStyle(INK).fillRoundedRect(4.1, 15.2 + tall * 0.3, 3.6, 5.4 + tall, 1.2).fillRoundedRect(8.3, 15.2 + tall * 0.3, 3.6, 5.4 + tall, 1.2);
    g.fillStyle(pants).fillRoundedRect(4.5, 15.4 + tall * 0.3, 2.8, 4.8 + tall, 1).fillRoundedRect(8.7, 15.4 + tall * 0.3, 2.8, 4.8 + tall, 1);
    g.fillStyle(INK).fillEllipse(5.9, 20.9 + tall * 0.6, 4, 1.8).fillEllipse(10.1, 20.9 + tall * 0.6, 4, 1.8);
    // Arms
    g.fillStyle(INK).fillEllipse(2.6, 13.2, 2.8, 4.6).fillEllipse(13.4, 13.2, 2.8, 4.6);
    g.fillStyle(skin).fillEllipse(2.6, 13.3, 2, 3.8).fillEllipse(13.4, 13.3, 2, 3.8);
    // Torso
    g.fillStyle(INK).fillRoundedRect(3, 9.4, 10, 7.4 + tall * 0.6, 2.6);
    g.fillStyle(body).fillRoundedRect(3 + o, 9.4 + o, 10 - o * 2, 7.4 + tall * 0.6 - o * 2, 2.2);
    g.fillStyle(dark(body, 18)).fillRoundedRect(3 + o, 13.6 + tall * 0.4, 10 - o * 2, 2.8, 1.4);
    g.fillStyle(0xffffff, 0.25).fillRoundedRect(4.2, 10.2, 3, 1.2, 0.6);
    g.fillStyle(skin).fillTriangle(6.6, 9.8, 9.4, 9.8, 8, 12); // collar V
    if (c.captain) {
      g.fillStyle(0xffd54f).fillCircle(10.6, 12.4, 0.95);
      g.lineStyle(0.3, INK).strokeCircle(10.6, 12.4, 0.95);
    }
    // Head
    g.fillStyle(INK).fillCircle(8, headY, headR + o);
    g.fillStyle(skin).fillCircle(8, headY, headR);
    // Hair cap and bangs (Brook gets an afro, everyone else spiky bangs)
    if (c.id === 'brook') {
      g.fillStyle(INK).fillCircle(8, headY - 3.4, 5.6);
      g.fillStyle(hair).fillCircle(8, headY - 3.4, 5.1);
    } else {
      g.fillStyle(hair).slice(8, headY, headR + 0.2, Math.PI * 1.02, Math.PI * 1.98, false).fillPath();
      g.fillTriangle(3.2, headY - 0.6, 5.6, headY - 2.2, 4.4, headY + 1.6);
      g.fillTriangle(5.4, headY - 1.6, 8.2, headY - 2.4, 6.6, headY + 0.9);
      g.fillTriangle(8, headY - 2.4, 10.8, headY - 1.8, 9.6, headY + 0.9);
      g.fillTriangle(10.6, headY - 2.2, 12.8, headY - 0.6, 11.8, headY + 1.6);
      g.fillStyle(0xffffff, 0.22).fillEllipse(6.4, headY - 3.6, 3.2, 1.1);
    }
    // Eyes, blush, mouth
    g.fillStyle(INK).fillEllipse(6.2, headY + 1.2, 1.25, 1.9).fillEllipse(9.8, headY + 1.2, 1.25, 1.9);
    g.fillStyle(0xffffff).fillCircle(6.45, headY + 0.75, 0.38).fillCircle(10.05, headY + 0.75, 0.38);
    g.fillStyle(0xff8a8a, 0.45).fillEllipse(4.9, headY + 2.6, 1.6, 0.8).fillEllipse(11.1, headY + 2.6, 1.6, 0.8);
    g.lineStyle(0.35, INK);
    g.beginPath();
    g.arc(8, headY + 2.4, 0.9, 0.3, Math.PI - 0.3, false);
    g.strokePath();
    // Hat
    if (L.hat) {
      const hat = hex(L.hat);
      const top = headY - headR + 0.4;
      g.fillStyle(INK).fillEllipse(8, top + 1.8, 15.6, 3.6);
      g.fillStyle(hat).fillEllipse(8, top + 1.7, 14.8, 2.9);
      g.fillStyle(INK).fillEllipse(8, top - 0.2, 9.6, 5.6);
      g.fillStyle(hat).fillEllipse(8, top - 0.3, 8.8, 4.8);
      g.fillStyle(0xffffff, 0.25).fillEllipse(6.6, top - 1.4, 3, 1.2);
      if (c.id === 'luffy') g.fillStyle(0xc62828).fillRect(3.7, top + 0.6, 8.6, 1.1);
    }
  }, CHAR_TEX);
}

export type CharacterAnim = 'idle' | 'run' | 'dash';
/** Frames per second for hand-drawn character animations. */
export const ANIM_FPS: Record<CharacterAnim, number> = { idle: 6, run: 12, dash: 12 };

/**
 * Animation frames from hand-drawn art (`player_<id>_<anim>_<n>`, loaded by BootScene).
 * Empty lists for characters that only have the generated single pose.
 */
export function characterFrames(scene: Phaser.Scene, id: string): Record<CharacterAnim, string[]> {
  const frames = (anim: CharacterAnim): string[] => {
    const out: string[] = [];
    for (let i = 0; scene.textures.exists(`player_${id}_${anim}_${i}`); i++) out.push(`player_${id}_${anim}_${i}`);
    return out;
  };
  return { idle: frames('idle'), run: frames('run'), dash: frames('dash') };
}
