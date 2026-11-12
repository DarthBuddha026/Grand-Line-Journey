import Phaser from 'phaser';
import { CHARACTERS, STAGES, WEAPONS } from '../../data';
import { formatBounty, type RunSummary } from '../../core/progression';
import type { RunOutcome } from '../../core/meta';
import { weaponIcon } from '../icons';
import { centerCamera, relayoutOnResize } from '../layout';
import { CHAR_TEX, TEX } from '../textures';
import { TEXT_RES } from '../../config';
import { backdrop, Button, C, CSS, display, FONT, formatTime, gradientFill, hintRow, label, medallion, parchment, ribbon, speedLines } from '../ui';

interface ResultData {
  summary: RunSummary;
  outcome: RunOutcome;
  saved: boolean;
}

const POSTER = { x: 330, y: 372, w: 440, h: 630 };

/**
 * End of run: the wanted poster drops in, the bounty counts up, a stamp lands if the
 * stage was cleared. Beside it, the ship's log and this voyage's rewards.
 */
export class ResultScene extends Phaser.Scene {
  constructor() {
    super('result');
  }

  create(data: ResultData): void {
    const { summary, outcome, saved } = data;
    const box = centerCamera(this);
    relayoutOnResize(this, () => data);
    const character = CHARACTERS.get(summary.characterId)!;
    const stage = STAGES.get(summary.stageId)!;
    this.cameras.main.setBackgroundColor(C.seaDeep).fadeIn(350, 8, 37, 65);
    backdrop(this, box.w, box.h, 1).setPosition(box.left, box.top);
    const rays = this.add.graphics();
    speedLines(rays, POSTER.x, POSTER.y - 60, 160, Math.max(box.w, box.h) * 1.3, 44, summary.cleared ? C.gold : C.seaLight, 0.12);

    this.buildPoster(summary, outcome, character.id, character.posterName);

    // ---- Right column ----
    const rx = 640;
    const head = summary.cleared ? 'Stage clear!' : 'Defeated';
    const title = display(this, rx, 34, head, 46, { shadow: summary.cleared ? CSS.red : CSS.ink }).setOrigin(0, 0);
    if (summary.cleared) gradientFill(title, '#fff6b0', '#ffb300');
    else title.setColor('#ff8a80');
    if (outcome.newBest) {
      const g = this.add.graphics();
      ribbon(g, rx + title.width + 40, 46, 210, 38, C.gold, { tails: false });
      label(this, rx + title.width + 145, 65, 'New best bounty!', 16, { onDark: false, color: CSS.ink }).setOrigin(0.5);
    }

    // Ship's log
    const g = this.add.graphics();
    parchment(g, rx, 112, 600, 232, 31);
    label(this, rx + 24, 126, "Ship's log", 18, { onDark: false, color: CSS.red });
    const rows: [string, string, string][] = [
      ['ic_map', 'Stage', stage.name],
      ['ic_hourglass', 'Time survived', formatTime(summary.timeSec)],
      ['ic_star', 'Level reached', String(summary.level)],
      ['ic_skull', 'Enemies defeated', summary.kills.toLocaleString('en-US')],
      ['ic_crown', 'Bosses defeated', String(summary.bossesDefeated)],
      ['ic_coin', 'Berries earned', `+${summary.berries.toLocaleString('en-US')}`],
    ];
    rows.forEach(([icon, k, v], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = rx + 30 + col * 290;
      const y = 178 + row * 54;
      medallion(g, x + 14, y + 10, 15, col ? C.teal : C.seaMid);
      this.add.image(x + 14, y + 10, icon).setScale(0.38 / TEX);
      label(this, x + 38, y - 4, k, 13, { onDark: false, weight: 500, color: '#6b4a2e' });
      display(this, x + 38, y + 12, v, 19, { color: CSS.ink, stroke: CSS.parch, shadow: null });
    });

    // Rewards
    const rewards: { icon: string; color: number; text: string }[] = [];
    if (outcome.rankAfter > outcome.rankBefore) rewards.push({ icon: 'ic_star', color: C.gold, text: `${character.name} reached bounty rank ${outcome.rankAfter}` });
    for (const id of outcome.newCharacters) rewards.push({ icon: 'ic_crown', color: C.red, text: `New crew member: ${CHARACTERS.get(id)?.name}` });
    for (const a of outcome.newAchievements) rewards.push({ icon: 'ic_crown', color: C.gold, text: `${a.name}${a.reward.berries ? `   +${a.reward.berries} Berries` : ''}` });
    for (const h of outcome.hakiGained) rewards.push({ icon: 'ic_haki', color: C.violet, text: `Haki fragment found` + (h ? '' : '') });
    for (const a of outcome.alliancesFound) {
      const w = WEAPONS.get(a);
      if (w) rewards.push({ icon: weaponIcon(w), color: C.red, text: `Alliance discovered: ${w.name}` });
    }
    const rg = this.add.graphics();
    parchment(rg, rx, 362, 600, 236, 47);
    label(this, rx + 24, 376, rewards.length ? 'Rewards' : 'No new rewards this time — the sea is wide.', 18, { onDark: false, color: CSS.red });
    rewards.slice(0, 6).forEach((r, i) => {
      const y = 420 + i * 30;
      const row = this.add.container(0, 0);
      const ig = this.add.graphics();
      medallion(ig, rx + 40, y, 11, r.color);
      row.add([ig, this.add.image(rx + 40, y, r.icon).setScale(0.28 / TEX), label(this, rx + 62, y, r.text, 15, { onDark: false, color: CSS.ink }).setOrigin(0, 0.5)]);
      row.setAlpha(0);
      this.tweens.add({ targets: row, alpha: 1, x: { from: 20, to: 0 }, delay: 1300 + i * 140, duration: 220 });
    });
    if (rewards.length > 6) label(this, rx + 300, 590, `+${rewards.length - 6} more`, 13, { onDark: false, color: '#6b4a2e' }).setOrigin(0.5, 1);
    if (!saved) label(this, rx, 606, "Progress couldn't be saved in this browser. Export your save from the Captain's Log.", 13, { color: '#ff8a80' });

    // Buttons (enabled after a beat so a death-frame keypress can't skip the poster)
    const back = new Button(this, rx + 150, 660, 280, 56, 'Back to the Sunny', () => this.go('hub'), 'gold');
    const again = new Button(this, rx + 450, 660, 240, 56, 'Sail again', () => this.go('run', summary), 'sea');
    hintRow(this, rx + 300, 704, [['Enter', 'Sunny'], ['R', 'Sail again']], CSS.dim);
    back.setEnabled(false);
    again.setEnabled(false);
    this.time.delayedCall(900, () => {
      back.setEnabled(true).setFocus(true);
      again.setEnabled(true);
      this.input.keyboard!.once('keydown-ENTER', () => this.go('hub'));
      this.input.keyboard!.once('keydown-R', () => this.go('run', summary));
      this.input.gamepad?.once('down', () => this.go('hub'));
    });
  }

  private going = false;

  private go(where: 'hub' | 'run', summary?: RunSummary): void {
    if (this.going) return;
    this.going = true;
    this.cameras.main.fadeOut(250, 8, 37, 65);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.going = false;
      if (where === 'hub') this.scene.start('hub');
      else this.scene.start('run', { characterId: summary!.characterId, stageId: summary!.stageId });
    });
  }

  private buildPoster(summary: RunSummary, outcome: RunOutcome, characterId: string, posterName: string): void {
    const { w, h } = POSTER;
    const c = this.add.container(POSTER.x, POSTER.y);
    const g = this.add.graphics();
    // Burnt, slightly ragged parchment
    const pts: { x: number; y: number }[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const edge = (x0: number, y0: number, x1: number, y1: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const nx = -(y1 - y0);
        const ny = x1 - x0;
        const len = Math.hypot(nx, ny);
        const j = (rnd() - 0.5) * 7;
        pts.push({ x: x0 + (x1 - x0) * t + (nx / len) * j, y: y0 + (y1 - y0) * t + (ny / len) * j });
      }
    };
    edge(-w / 2, -h / 2, w / 2, -h / 2, 18);
    edge(w / 2, -h / 2, w / 2, h / 2, 24);
    edge(w / 2, h / 2, -w / 2, h / 2, 18);
    edge(-w / 2, h / 2, -w / 2, -h / 2, 24);
    g.fillStyle(C.ink, 0.6).fillPoints(pts.map((p) => ({ x: p.x + 10, y: p.y + 12 })), true);
    g.fillStyle(0xc9a465).fillPoints(pts, true);
    g.fillStyle(0xe9d4a0).fillRoundedRect(-w / 2 + 14, -h / 2 + 14, w - 28, h - 28, 6);
    g.fillStyle(0xf3e2b8).fillRoundedRect(-w / 2 + 28, -h / 2 + 28, w - 56, h - 56, 4);
    g.fillStyle(0xc9a465, 0.35);
    for (let i = 0; i < 12; i++) g.fillCircle(-w / 2 + 40 + rnd() * (w - 80), -h / 2 + 40 + rnd() * (h - 80), 3 + rnd() * 10);
    g.lineStyle(3, 0x6b4a2e).strokeRect(-w / 2 + 22, -h / 2 + 22, w - 44, h - 44);
    const rank = outcome.rankAfter;
    if (rank >= 3) g.lineStyle(rank >= 5 ? 6 : 4, rank >= 5 ? 0xff6f00 : 0xd4af37).strokeRect(-w / 2 + 30, -h / 2 + 30, w - 60, h - 60);
    // Photo
    g.fillStyle(0xcdb27a).fillRect(-150, -170, 300, 230);
    g.fillStyle(0xd9c08a).fillRect(-150, -170, 300, 60);
    g.lineStyle(4, 0x3b2a17).strokeRect(-150, -170, 300, 230);
    const ink = '#3b2a17';
    const poster = (y: number, value: string, size: number) =>
      this.add.text(0, y, value, { fontFamily: FONT.poster, fontSize: `${size}px`, color: ink, padding: { x: 4, y: 4 }, resolution: TEXT_RES }).setOrigin(0.5);
    const portrait = this.add.image(0, 56, `player_${characterId}`).setScale(10 / CHAR_TEX).setOrigin(0.5, 1);
    const nameSize = posterName.length > 20 ? 25 : posterName.length > 15 ? 30 : 36;
    c.add([
      g,
      poster(-h / 2 + 82, 'WANTED', 86),
      portrait,
      poster(96, 'DEAD OR ALIVE', 28),
      poster(144, posterName, nameSize),
    ]);
    // Bounty with a hand-lettered Berry sign
    const bounty = poster(206, '0', 44);
    const sign = poster(206, 'B', 44);
    const signLines = this.add.graphics();
    c.add([bounty, sign, signLines]);
    const layout = () => {
      const total = bounty.width + 36;
      bounty.setX(-total / 2 + 36 + bounty.width / 2);
      sign.setX(-total / 2 + 12);
      signLines.clear().lineStyle(3, 0x3b2a17).lineBetween(sign.x - 4, 178, sign.x - 4, 234).lineBetween(sign.x + 4, 178, sign.x + 4, 234);
    };
    layout();
    c.add(poster(h / 2 - 54, `MARINE   ${'★'.repeat(rank)}`, 18).setColor('#6b4a2e').setFontFamily(FONT.ui));

    // Drop in, then count the bounty up.
    c.setY(-420).setRotation(-0.25);
    this.tweens.add({
      targets: c, y: POSTER.y, rotation: -0.035, duration: 650, ease: 'Bounce.Out',
      onComplete: () => {
        this.tweens.addCounter({
          from: 0, to: outcome.bounty, duration: 1100, ease: 'Cubic.Out',
          onUpdate: (tw) => {
            bounty.setText(formatBounty(Math.round((tw.getValue() ?? 0) / 1000) * 1000));
            layout();
          },
          onComplete: () => {
            bounty.setText(formatBounty(outcome.bounty));
            layout();
            if (summary.cleared) this.stamp(c);
          },
        });
      },
    });
  }

  private stamp(poster: Phaser.GameObjects.Container): void {
    const s = this.add.container(110, -40);
    const g = this.add.graphics();
    g.lineStyle(6, C.red, 0.9).strokeRoundedRect(-110, -34, 220, 68, 10);
    g.lineStyle(2, C.red, 0.9).strokeRoundedRect(-102, -26, 204, 52, 8);
    const t = this.add.text(0, 0, 'CLEARED', { fontFamily: FONT.display, fontSize: '40px', color: '#e0303a', resolution: TEXT_RES }).setOrigin(0.5);
    s.add([g, t]).setRotation(-0.32).setScale(2.4).setAlpha(0);
    poster.add(s);
    this.tweens.add({ targets: s, scale: 1, alpha: 0.88, duration: 180, ease: 'Quad.In', onComplete: () => this.cameras.main.shake(140, 0.006) });
  }
}
