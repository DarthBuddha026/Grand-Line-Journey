import Phaser from 'phaser';
import { GAME_W } from '../../config';
import { googleConfigured, playAsGuest, prepareGoogle, signInWithGoogle } from '../account';
import { backdrop, Button, C, CSS, display, inkPanel, label, parchment, speedLines } from '../ui';
import { centerCamera, relayoutOnResize } from '../layout';

const CARD = { x: 290, y: 250, w: 700, h: 380 };

/**
 * First launch: sign in with Google (progress saved to the cloud, any device) or play as
 * a guest (progress kept only until the browser closes). The choice decides where every
 * save goes, so it comes before the main menu.
 */
export class AccountScene extends Phaser.Scene {
  private buttons: Button[] = [];
  private focus = 0;
  private status!: Phaser.GameObjects.Text;
  private busy = false;

  constructor() {
    super('account');
  }

  create(): void {
    this.buttons = [];
    this.focus = googleConfigured() ? 0 : 1;
    this.busy = false;
    const box = centerCamera(this);
    relayoutOnResize(this);
    void prepareGoogle()?.catch(() => undefined); // load Firebase now so the popup opens from the click
    this.cameras.main.setBackgroundColor(C.seaDeep).fadeIn(250, 8, 37, 65);
    backdrop(this, box.w, box.h, 1).setPosition(box.left, box.top);
    const rays = this.add.graphics();
    speedLines(rays, GAME_W / 2, 140, 120, Math.max(box.w, box.h) * 1.2, 40, C.gold, 0.07);
    const logo = this.add.image(GAME_W / 2, 128, 'menu_logo');
    logo.setScale(560 / logo.width);

    const g = this.add.graphics();
    parchment(g, CARD.x, CARD.y, CARD.w, CARD.h, 5, { shadow: 8 });
    display(this, GAME_W / 2, CARD.y + 46, 'Welcome aboard, Captain!', 34, { color: CSS.red, shadow: null }).setOrigin(0.5);
    label(this, GAME_W / 2, CARD.y + 88, 'Choose how to keep your progress.', 17, { onDark: false, weight: 500 }).setOrigin(0.5);

    const can = googleConfigured();
    const rows: [string, string, () => void, 'gold' | 'sea'][] = [
      ['Sign in with Google', can ? 'Saved to your Google account: keep it on any device.' : 'Google sign-in is not set up in this build yet.', () => this.google(), 'gold'],
      ['Play as guest', 'No account. Progress is erased when you close the browser.', () => this.guest(), 'sea'],
    ];
    rows.forEach(([text, note, act, variant], i) => {
      const y = CARD.y + 160 + i * 104;
      const b = new Button(this, GAME_W / 2, y, 420, 62, text, act, variant);
      if (i === 0 && !can) b.setEnabled(false);
      this.buttons.push(b);
      label(this, GAME_W / 2, y + 44, note, 14, { onDark: false, weight: 500, color: CSS.inkSoft }).setOrigin(0.5);
    });
    // "G" badge on the Google button
    const badge = this.add.graphics();
    inkPanel(badge, GAME_W / 2 - 196, CARD.y + 160 - 20, 40, 40, { fill: C.white, radius: 20, shadow: 0, stroke: 3 });
    display(this, GAME_W / 2 - 176, CARD.y + 159, 'G', 24, { shadow: null, color: '#4285f4', stroke: CSS.white }).setOrigin(0.5);
    badge.setAlpha(can ? 1 : 0.5);

    this.status = label(this, GAME_W / 2, CARD.y + CARD.h + 30, '', 16, { color: '#ff8a80' }).setOrigin(0.5);
    label(this, GAME_W / 2, box.bottom - 16, 'Unofficial, non-commercial fan project. One Piece © Eiichiro Oda / Shueisha / Toei Animation.', 11, { weight: 500, color: '#f3e2b8' }).setOrigin(0.5);

    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      const k = ev.code;
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'KeyW' || k === 'KeyS' || k === 'Tab') {
        ev.preventDefault();
        this.setFocus(this.focus === 0 ? 1 : 0);
      } else if (k === 'Enter' || k === 'Space') (this.focus === 0 ? this.google() : this.guest());
    });
    this.setFocus(this.focus);
  }

  private setFocus(i: number): void {
    if (i === 0 && !googleConfigured()) i = 1;
    this.focus = i;
    this.buttons.forEach((b, k) => b.setFocus(k === i));
  }

  private google(): void {
    if (this.busy || !googleConfigured()) return;
    this.busy = true;
    this.status.setColor(CSS.goldLight).setText('Opening Google sign-in…');
    signInWithGoogle()
      .then(() => this.enter())
      .catch((e: { code?: string; message?: string }) => {
        this.busy = false;
        const cancelled = e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request';
        this.status.setColor('#ff8a80').setText(cancelled ? 'Sign-in cancelled.' : `Could not sign in: ${e?.message ?? e}`);
      });
  }

  private guest(): void {
    if (this.busy) return;
    this.busy = true;
    playAsGuest();
    this.enter();
  }

  private enter(): void {
    this.cameras.main.fadeOut(250, 8, 37, 65);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('title'));
  }
}
