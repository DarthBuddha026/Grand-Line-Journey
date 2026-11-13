import Phaser from 'phaser';
import '@fontsource/abril-fatface/latin-400.css';
import '@fontsource/m-plus-rounded-1c/latin-500.css';
import '@fontsource/m-plus-rounded-1c/latin-800.css';
import '@fontsource/rye/latin-400.css';
import { GAME_H, GAME_W, RES } from './config';
import { BootScene } from './game/scenes/BootScene';
import { TitleScene } from './game/scenes/TitleScene';
import { RunScene } from './game/scenes/RunScene';
import { HudScene } from './game/scenes/HudScene';
import { ResultScene } from './game/scenes/ResultScene';
import { HubScene } from './game/scenes/HubScene';
import { PanelScene } from './game/scenes/PanelScene';
import { GachaScene } from './game/scenes/GachaScene';
import { SailScene } from './game/scenes/SailScene';
import { ShopScene } from './game/scenes/ShopScene';
import { ShopFrontScene } from './game/scenes/ShopFrontScene';
import { AccountScene } from './game/scenes/AccountScene';
import { ProfileScene } from './game/scenes/ProfileScene';

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  // Rendered at RES× the 1280×720 design size; cameras zoom by RES (see config.ts).
  width: Math.round(GAME_W * RES),
  height: Math.round(GAME_H * RES),
  backgroundColor: '#082541',
  // HD: smooth texture filtering and antialiasing (no pixel-art nearest sampling).
  pixelArt: false,
  antialias: true,
  scale: {
    // Fill any window shape edge to edge: the canvas keeps at least 1280×720 and expands
    // in width or height to match the window (see src/game/layout.ts). No size cap, so
    // there are never bars around the game.
    mode: Phaser.Scale.EXPAND,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: { gamepad: true, activePointers: 3 },
  scene: [BootScene, AccountScene, TitleScene, ProfileScene, HubScene, PanelScene, SailScene, ShopFrontScene, GachaScene, ShopScene, RunScene, HudScene, ResultScene],
});

// Exposed for debugging in the browser console.
(globalThis as unknown as { game: Phaser.Game }).game = game;
