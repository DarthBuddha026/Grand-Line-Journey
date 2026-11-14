import Phaser from 'phaser';
import { ACHIEVEMENTS, ALLIANCES, CHARACTERS, STAGES } from '../../data';
import { isUnlocked, rankFor } from '../../core/meta';
import { formatBounty } from '../../core/progression';
import { hex } from '../../config';
import { account, signOut } from '../account';
import type { MenuHost } from '../menus';
import { backdrop, Button, C, CSS, display, inkPanel, label, medallion, parchment, screenChrome } from '../ui';
import { centerCamera, relayoutOnResize } from '../layout';
import { CHAR_TEX, TEX } from '../textures';

export interface ProfileData {
  host: MenuHost;
  onClose?: () => void;
}

const CARD = { x: 50, y: 96, w: 440, h: 548 };
const GRID = { x: 520, y: 96, w: 330, h: 124, gap: 18 };

/**
 * Profile (main menu): the account card (account or guest, with log in / log out) and a
 * grid of lifetime stats. Logging in from here carries a guest's progress into the
 * account; logging out returns to the account screen.
 */
export class ProfileScene extends Phaser.Scene {
  private d!: ProfileData;
  private buttons: Button[] = [];
  private acts: (() => void)[] = [];
  private focus = 0;
  private busy = false;
  private openedAt = 0;

  constructor() {
    super('profile');
  }

  init(d: ProfileData): void {
    this.d = d;
    this.buttons = [];
    this.acts = [];
    this.busy = false;
  }

  create(): void {
    this.openedAt = this.time.now;
    const box = centerCamera(this);
    relayoutOnResize(this, () => this.d);
    backdrop(this, box.w, box.h, 0.94)
      .setPosition(box.left, box.top)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, box.w, box.h), Phaser.Geom.Rectangle.Contains);
    screenChrome(this, box, 'PROFILE', [['↑↓', 'Select'], ['Enter', 'Confirm'], ['Esc', 'Back']]).setText(this.d.host.save.berries.toLocaleString('en-US'));
    this.drawAccount();
    this.drawStats();

    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      const k = ev.code;
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'KeyW' || k === 'KeyS') this.setFocus(this.focus === 0 ? 1 : 0);
      else if (k === 'Enter' || k === 'Space') this.time.now - this.openedAt > 200 && this.acts[this.focus]();
      else if (k === 'Escape' || k === 'KeyX') this.close();
    });
    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 140 });
  }

  private drawAccount(): void {
    const save = this.d.host.save;
    const acc = account();
    const user = acc?.mode === 'user';
    const c = CHARACTERS.get(save.selectedCharacter) ?? CHARACTERS.values().next().value!;
    const { x, y, w, h } = CARD;
    const cx = x + w / 2;
    const g = this.add.graphics();
    parchment(g, x, y, w, h, 3, { shadow: 8 });
    medallion(g, cx, y + 104, 70, hex(c.look.body));
    this.add.image(cx, y + 160, `player_${c.id}`).setOrigin(0.5, 1).setScale(5.4 / CHAR_TEX);
    display(this, cx, y + 210, acc?.name ?? 'Captain', 30, { color: CSS.red, shadow: null, style: { align: 'center', wordWrap: { width: w - 40 } } }).setOrigin(0.5, 0);

    // Account badge
    const by = y + 262;
    const badge = user ? 'Account' : 'Guest';
    const t = label(this, 0, 0, badge, 16, { onDark: false, color: CSS.white });
    const bw = t.width + 40;
    inkPanel(g, cx - bw / 2, by, bw, 32, { fill: user ? C.seaMid : C.wood, skew: 10, shadow: 3, stroke: 2.5 });
    t.setPosition(cx, by + 16).setOrigin(0.5).setDepth(1);
    const note = user
      ? 'Progress is saved to your account.\nLog in on any device to keep playing.'
      : 'Guest progress is erased when you close the browser.\nLog in to keep it.';
    label(this, cx, by + 46, note, 15, { onDark: false, weight: 500, color: user ? CSS.inkSoft : '#b3261e', style: { align: 'center', wordWrap: { width: w - 50 } } }).setOrigin(0.5, 0);

    // Actions
    const primary: [string, () => void, 'gold' | 'red'] = user ? ['Log out', () => this.doSignOut(), 'red'] : ['Log in or Create an Account', () => this.doSignIn(), 'gold'];
    const b1 = new Button(this, cx, y + h - 112, 320, 54, primary[0], primary[1], primary[2]);
    const b2 = new Button(this, cx, y + h - 48, 320, 54, 'Back', () => this.close(), 'sea');
    this.buttons = [b1, b2];
    this.acts = [primary[1], () => this.close()];
    this.setFocus(user ? 1 : 0);
  }

  private drawStats(): void {
    const save = this.d.host.save;
    const crew = [...CHARACTERS.values()].filter((c) => isUnlocked(save, c.id)).length;
    const stages = [...STAGES.values()].filter((s) => (save.clears[s.id]?.length ?? 0) > 0).length;
    const best = Math.max(0, ...Object.values(save.bestBounty));
    const captain = CHARACTERS.get(save.selectedCharacter);
    const rank = rankFor(save.charXp[save.selectedCharacter] ?? 0);
    const stats: [string, string, string, number][] = [
      ['ic_compass', 'Voyages', save.runs.toLocaleString('en-US'), C.seaMid],
      ['ic_skull', 'Enemies defeated', save.totalKills.toLocaleString('en-US'), C.red],
      ['ic_poster', 'Best bounty', `฿ ${formatBounty(best)}`, C.goldDeep],
      ['ic_star', 'Achievements', `${save.achievements.length} / ${ACHIEVEMENTS.size}`, C.violet],
      ['ic_crown', 'Crew', `${crew} / ${CHARACTERS.size}`, C.gold],
      ['ic_map', 'Stages cleared', `${stages} / ${STAGES.size}`, C.teal],
      ['ic_burst', 'Alliances found', `${save.alliances.length} / ${ALLIANCES.length}`, C.red],
      ['ic_sword', 'Captain', `${captain?.name ?? '?'} · Rank ${rank}`, C.wood],
    ];
    const g = this.add.graphics();
    stats.forEach(([icon, name, value, color], i) => {
      const x = GRID.x + (i % 2) * (GRID.w + GRID.gap);
      const y = GRID.y + Math.floor(i / 2) * (GRID.h + 18);
      inkPanel(g, x, y, GRID.w, GRID.h, { fill: C.seaDeep, alpha: 0.95, radius: 6, shadow: 6, stroke: 3 });
      g.lineStyle(2, C.seaLight, 0.6).strokeRoundedRect(x + 6, y + 6, GRID.w - 12, GRID.h - 12, 4);
      medallion(g, x + 50, y + GRID.h / 2, 28, color);
      this.add.image(x + 50, y + GRID.h / 2, icon).setScale(0.62 / TEX);
      label(this, x + 96, y + 40, name, 15, { color: '#cfe3f2', weight: 500 }).setOrigin(0, 0.5);
      display(this, x + 96, y + 78, value, value.length > 14 ? 20 : 26, { shadow: null, color: CSS.goldLight }).setOrigin(0, 0.5);
    });
  }

  private setFocus(i: number): void {
    this.focus = i;
    this.buttons.forEach((b, k) => b.setFocus(k === i));
  }

  /** A guest goes to the account screen, bringing their progress if they have any. */
  private doSignIn(): void {
    if (this.busy) return;
    const save = this.d.host.save;
    const progress = save.runs > 0 || save.berries > 0 || save.recruited.length > 0;
    this.busy = true;
    this.scene.stop('title');
    this.scene.start('account', { fromProfile: true, carry: progress ? JSON.stringify(save) : null });
  }

  private doSignOut(): void {
    if (this.busy) return;
    this.busy = true;
    void signOut().then(() => {
      this.scene.stop('title');
      this.scene.start('account', {}); // {}: with no data Phaser reuses the previous start's (the last form)
    });
  }

  private close(): void {
    if (this.busy) return;
    this.scene.stop();
    this.d.onClose?.();
  }
}
