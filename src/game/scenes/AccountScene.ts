import Phaser from 'phaser';
import { GAME_W } from '../../config';
import { logIn, playAsGuest, register } from '../account';
import { backdrop, Button, C, CSS, display, FONT, inkPanel, label, parchment, speedLines } from '../ui';
import { centerCamera, relayoutOnResize, type ScreenBox } from '../layout';

const CARD = { x: 290, y: 250, w: 700, h: 380 };
const FIELD = { x: CARD.x + 250, w: 390, h: 46, y0: CARD.y + 112, gap: 58 };

type Mode = 'choose' | 'login' | 'register';
export interface AccountData {
  mode?: Mode;
  /** Opened from Profile by a guest: progress to bring into the account (null = none), and Back returns to the menu. */
  fromProfile?: boolean;
  carry?: string | null;
  /** Typed text kept across a resize restart. */
  values?: Record<string, string>;
}

const FIELDS: Record<Exclude<Mode, 'choose'>, [name: string, caption: string, type: string, autocomplete: string][]> = {
  login: [
    ['username', 'Username', 'text', 'username'],
    ['password', 'Password', 'password', 'current-password'],
  ],
  register: [
    ['username', 'Username', 'text', 'username'],
    ['password', 'Password', 'password', 'new-password'],
    ['confirm', 'Confirm password', 'password', 'new-password'],
  ],
};

/**
 * The account screen: on first launch (log in, create an account or play as a guest) and
 * from Profile (a guest logging in, carrying their progress). The choice decides where
 * every save goes, so it comes before the main menu. Text fields are real HTML inputs laid
 * over the parchment, so phone keyboards, paste and password managers work.
 */
export class AccountScene extends Phaser.Scene {
  private d: AccountData = {};
  private buttons: Button[] = [];
  private acts: (() => void)[] = [];
  private focus = 0;
  private status!: Phaser.GameObjects.Text;
  private busy = false;
  private form: HTMLFormElement | null = null;

  constructor() {
    super('account');
  }

  init(d: AccountData): void {
    this.d = d ?? {};
    this.buttons = [];
    this.acts = [];
    this.focus = 0;
    this.busy = false;
    this.form = null;
  }

  create(): void {
    const mode = this.d.mode ?? 'choose';
    const box = centerCamera(this);
    relayoutOnResize(this, () => ({ ...this.d, values: this.values() }));
    this.cameras.main.setBackgroundColor(C.seaDeep).fadeIn(250, 8, 37, 65);
    backdrop(this, box.w, box.h, 1).setPosition(box.left, box.top);
    const rays = this.add.graphics();
    speedLines(rays, GAME_W / 2, 140, 120, Math.max(box.w, box.h) * 1.2, 40, C.gold, 0.07);
    const logo = this.add.image(GAME_W / 2, 128, 'menu_logo');
    logo.setScale(560 / logo.width);
    const g = this.add.graphics();
    parchment(g, CARD.x, CARD.y, CARD.w, CARD.h, 5, { shadow: 8 });
    this.status = label(this, GAME_W / 2, CARD.y + CARD.h + 30, '', 16, { color: '#ff8a80' }).setOrigin(0.5);
    label(this, GAME_W / 2, box.bottom - 16, 'Unofficial, non-commercial fan project. One Piece © Eiichiro Oda / Shueisha / Toei Animation.', 11, { weight: 500, color: '#f3e2b8' }).setOrigin(0.5);

    if (mode === 'choose') this.drawChoose();
    else this.drawForm(mode, g, box);

    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement) return; // typing in a field
      const k = ev.code;
      const n = this.buttons.length;
      if (k === 'ArrowUp' || k === 'KeyW') this.setFocus((this.focus + n - 1) % n);
      else if (k === 'ArrowDown' || k === 'KeyS' || k === 'Tab') {
        ev.preventDefault();
        this.setFocus((this.focus + 1) % n);
      } else if ((k === 'Enter' || k === 'Space') && this.focus >= 0) this.acts[this.focus]();
      else if (k === 'Escape' && mode !== 'choose') this.go('choose');
    });
    this.setFocus(this.focus);
  }

  private drawChoose(): void {
    const fromProfile = !!this.d.fromProfile;
    display(this, GAME_W / 2, CARD.y + 46, fromProfile ? 'Keep your progress!' : 'Welcome aboard, Captain!', 34, { color: CSS.red, shadow: null }).setOrigin(0.5);
    label(this, GAME_W / 2, CARD.y + 88, fromProfile ? 'Log in or create an account to save it.' : 'Choose how to keep your progress.', 17, { onDark: false, weight: 500 }).setOrigin(0.5);
    const rows: [string, () => void, 'gold' | 'red' | 'sea'][] = [
      ['Log in', () => this.go('login'), 'gold'],
      ['Create an Account', () => this.go('register'), 'red'],
      fromProfile ? ['Back', () => this.back(), 'sea'] : ['Play as guest', () => this.guest(), 'sea'],
    ];
    rows.forEach(([text, act, variant], i) => this.addButton(GAME_W / 2, CARD.y + 146 + i * 76, 420, 58, text, act, variant));
    if (!fromProfile) label(this, GAME_W / 2, CARD.y + 146 + 2 * 76 + 44, 'No account. Progress is erased when you close the browser.', 14, { onDark: false, weight: 500, color: CSS.inkSoft }).setOrigin(0.5);
  }

  private drawForm(mode: 'login' | 'register', g: Phaser.GameObjects.Graphics, box: ScreenBox): void {
    const reg = mode === 'register';
    display(this, GAME_W / 2, CARD.y + 42, reg ? 'Create your account' : 'Log in', 32, { color: CSS.red, shadow: null }).setOrigin(0.5);
    label(this, GAME_W / 2, CARD.y + 80, reg ? 'Username: 3 to 16 letters, numbers or _. There is no password reset, so keep it safe!' : 'Welcome back, Captain.', 14, { onDark: false, weight: 500, color: CSS.inkSoft }).setOrigin(0.5);

    // HTML inputs over drawn fields. Page position = canvas position + design coords × (page px per design unit).
    const rect = this.game.canvas.getBoundingClientRect();
    const k = rect.width / box.w;
    const form = document.createElement('form');
    form.autocomplete = 'on';
    form.onsubmit = (e) => {
      e.preventDefault();
      this.submit(mode);
    };
    const fields = FIELDS[mode];
    fields.forEach(([name, caption, type, autocomplete], i) => {
      const y = FIELD.y0 + i * FIELD.gap;
      label(this, FIELD.x - 18, y + FIELD.h / 2, caption, 17, { onDark: false }).setOrigin(1, 0.5);
      inkPanel(g, FIELD.x, y, FIELD.w, FIELD.h, { fill: C.white, radius: 6, shadow: 3, stroke: 3 });
      const input = document.createElement('input');
      Object.assign(input, { name, type, autocomplete, maxLength: name === 'username' ? 16 : 72, spellcheck: false, value: this.d.values?.[name] ?? '' });
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('aria-label', caption);
      Object.assign(input.style, {
        position: 'fixed',
        left: `${rect.left + (FIELD.x + 12 + box.ox) * k}px`,
        top: `${rect.top + (y + 4 + box.oy) * k}px`,
        width: `${(FIELD.w - 24) * k}px`,
        height: `${(FIELD.h - 8) * k}px`,
        font: `500 ${20 * k}px ${FONT.ui}`,
        color: CSS.ink,
        background: 'transparent',
        border: 'none',
        outline: 'none',
        padding: '0',
        margin: '0',
        zIndex: '5',
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.go('choose');
        else if (e.key === 'Enter') {
          e.preventDefault();
          const next = form.elements[i + 1] as HTMLInputElement | undefined;
          if (next && !next.value) next.focus();
          else this.submit(mode);
        }
      });
      form.appendChild(input);
    });
    document.body.appendChild(form);
    this.form = form;
    this.input.keyboard!.disableGlobalCapture(); // let W, S, Space... reach the inputs
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      form.remove();
      this.input.keyboard?.enableGlobalCapture();
    });
    const first = ([...form.elements] as HTMLInputElement[]).find((el) => !el.value) ?? (form.elements[0] as HTMLInputElement);
    setTimeout(() => first.focus(), 0);

    const by = CARD.y + CARD.h - 52;
    this.addButton(GAME_W / 2 - 110, by, 220, 56, reg ? 'Create account' : 'Log in', () => this.submit(mode), 'gold');
    this.addButton(GAME_W / 2 + 125, by, 180, 56, 'Back', () => this.go('choose'), 'sea');
    this.focus = -1; // focus is in the fields, not on a button
  }

  private addButton(x: number, y: number, w: number, h: number, text: string, act: () => void, variant: 'gold' | 'red' | 'sea'): void {
    this.buttons.push(new Button(this, x, y, w, h, text, act, variant));
    this.acts.push(act);
  }

  private setFocus(i: number): void {
    this.focus = i;
    this.buttons.forEach((b, k) => b.setFocus(k === i));
  }

  private values(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const el of this.form?.elements ?? []) {
      const input = el as HTMLInputElement;
      if (input.type !== 'password') out[input.name] = input.value; // never keep passwords in scene data
    }
    return out;
  }

  private go(mode: Mode): void {
    if (this.busy) return;
    this.scene.restart({ ...this.d, mode, values: this.values() });
  }

  private submit(mode: 'login' | 'register'): void {
    if (this.busy || !this.form) return;
    const v = (name: string) => (this.form!.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';
    const username = v('username').trim();
    const password = v('password');
    if (!username || !password) return void this.status.setColor('#ff8a80').setText('Enter a username and password.');
    if (mode === 'register' && password !== v('confirm')) return void this.status.setColor('#ff8a80').setText('The passwords do not match.');
    this.busy = true;
    this.status.setColor(CSS.goldLight).setText(mode === 'register' ? 'Creating your account…' : 'Logging in…');
    const carry = this.d.carry ?? null;
    (mode === 'register' ? register(username, password, carry) : logIn(username, password, carry))
      .then(() => this.enter())
      .catch((e: Error) => {
        this.busy = false;
        this.status.setColor('#ff8a80').setText(e.message);
      });
  }

  private guest(): void {
    if (this.busy) return;
    this.busy = true;
    playAsGuest();
    this.enter();
  }

  /** From Profile: back to the menu, still a guest. */
  private back(): void {
    if (this.busy) return;
    this.busy = true;
    this.enter();
  }

  private enter(): void {
    this.form?.remove(); // don't leave inputs over the fade
    this.cameras.main.fadeOut(250, 8, 37, 65);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('title'));
  }
}
