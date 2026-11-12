import Phaser from 'phaser';
import { validateContent } from '../../data';
import { GAME_H, GAME_W } from '../../config';
import { generatePlaceholderTextures } from '../textures';
import { generateIcons } from '../icons';
import { FONT } from '../ui';

/**
 * Validates content, waits for the bundled fonts (canvas text can't use a webfont
 * until it has loaded), builds placeholder textures and icons, then shows the title.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
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
      loading.destroy();
      generatePlaceholderTextures(this);
      generateIcons(this);
      this.scene.start('title');
    });
  }
}
