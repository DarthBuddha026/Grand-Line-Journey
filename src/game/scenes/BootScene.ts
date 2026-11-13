import Phaser from 'phaser';
import { validateContent } from '../../data';
import { GAME_H, GAME_W, readUrlFlags } from '../../config';
import { setUnlockAll } from '../../core/meta';
import { generatePlaceholderTextures } from '../textures';
import { generateIcons } from '../icons';
import { FONT } from '../ui';
import { restoreAccount } from '../account';

/** Main-menu artwork (src/assets/menu/*.png), loaded as `menu_<file name>`. */
const MENU_ART = import.meta.glob('../../assets/menu/*.png', { eager: true, import: 'default' }) as Record<string, string>;
/**
 * Hand-made icons (src/assets/icons/<name>.png, 256×256) loaded as `ic_<name>`. They replace
 * the generated glyph of the same name (generateIcons skips keys that already exist).
 */
const ICON_ART = import.meta.glob('../../assets/icons/*.png', { eager: true, import: 'default' }) as Record<string, string>;
const fileKey = (path: string) => path.split('/').pop()!.replace('.png', '');
/** Scene artwork (src/assets/art/*.png), loaded as `art_<file name>`, e.g. the ship hub's `art_ship`. */
const SCENE_ART = import.meta.glob('../../assets/art/*.png', { eager: true, import: 'default' }) as Record<string, string>;
/**
 * Hand-drawn characters, src/assets/characters/<id>/: `stand.png` (192×264, the CHAR_TEX canvas)
 * becomes `player_<id>` everywhere; `<anim>_<n>.png` (same 12 px/unit, feet on the same line)
 * become in-run animation frames `player_<id>_<anim>_<n>` (idle, run, dash).
 */
const CHARACTER_ART = import.meta.glob('../../assets/characters/*/*.png', { eager: true, import: 'default' }) as Record<string, string>;
const characterKey = (path: string) => {
  const [id, file] = path.split('/').slice(-2);
  const name = file.replace('.png', '');
  return name === 'stand' ? `player_${id}` : `player_${id}_${name}`;
};

/**
 * Validates content, waits for the bundled fonts (canvas text can't use a webfont
 * until it has loaded), builds placeholder textures and icons, restores the player's
 * account, then shows the title (or the sign-in screen on first launch).
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    for (const [path, url] of Object.entries(MENU_ART)) this.load.image(`menu_${fileKey(path)}`, url);
    for (const [path, url] of Object.entries(ICON_ART)) this.load.image(`ic_${fileKey(path)}`, url);
    for (const [path, url] of Object.entries(CHARACTER_ART)) this.load.image(characterKey(path), url);
    for (const [path, url] of Object.entries(SCENE_ART)) this.load.image(`art_${fileKey(path)}`, url);
  }

  create(): void {
    setUnlockAll(readUrlFlags().unlockAll);
    const problems = validateContent();
    if (problems.length) {
      this.add.text(20, 20, `Content errors:\n${problems.join('\n')}`, { color: '#ff8080', fontSize: '16px' });
      console.error('Content validation failed', problems);
      return;
    }
    const loading = this.add.text(GAME_W / 2, GAME_H / 2, 'Hoisting the sails…', { fontSize: '22px', color: '#ffcc33' }).setOrigin(0.5);
    const fonts = [`40px ${FONT.display}`, `800 20px ${FONT.ui}`, `500 20px ${FONT.ui}`, `40px ${FONT.poster}`];
    const ready = typeof document !== 'undefined' && document.fonts
      ? Promise.all(fonts.map((f) => document.fonts.load(f))).catch(() => undefined)
      : Promise.resolve();
    // Never block forever on fonts: fall back after 3 s.
    Promise.race([ready, new Promise((r) => setTimeout(r, 3000))]).then(() => {
      generatePlaceholderTextures(this);
      generateIcons(this);
      loading.setText('Checking your account…');
      // Resume a remembered Google sign-in / this session's guest choice, else ask (account screen).
      // Never hang on the network: after 8 s fall back to the account screen.
      const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), 8000));
      Promise.race([restoreAccount().catch(() => false), timeout]).then((ok) => {
        loading.destroy();
        this.scene.start(ok ? 'title' : 'account');
      });
    });
  }
}
