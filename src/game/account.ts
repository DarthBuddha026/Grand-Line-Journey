import type { FirebaseApp } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { chooseSave, loadSave, SAVE_KEY, useSaveStore, writeSave, type StampedSave } from '../core/save';
import { readUrlFlags } from '../config';

/**
 * Who is playing and where their progress lives.
 *  - Google: Firebase Auth + a Firestore doc `saves/{uid}` ({ save: JSON string, updatedAt }).
 *    A copy is cached in localStorage under `<save key>@<uid>`, so loadSave/writeSave stay
 *    synchronous; every write is pushed to the cloud a moment later.
 *  - Guest: sessionStorage, which the browser wipes when it closes.
 * Firebase is only downloaded when Google sign-in is configured (VITE_FIREBASE_* in .env.local).
 */

export type AccountMode = 'google' | 'guest';
export interface Account {
  mode: AccountMode;
  name: string;
  email?: string;
}

const MODE_KEY = 'grand-line-survivor/account'; // localStorage: remembers a Google sign-in between launches
const GUEST_KEY = 'grand-line-survivor/guest'; // sessionStorage: guest chosen for this browser session
const PUSH_DELAY_MS = 1200;

const env = import.meta.env;
const CONFIG = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

let current: Account | null = null;
export const account = (): Account | null => current;
export const googleConfigured = (): boolean => !!(CONFIG.apiKey && CONFIG.authDomain && CONFIG.projectId && CONFIG.appId);

const safe = <T>(f: () => T, fallback: T): T => {
  try {
    return f();
  } catch {
    return fallback;
  }
};
const local = (): Storage | null => safe(() => globalThis.localStorage ?? null, null);
const session = (): Storage | null => safe(() => globalThis.sessionStorage ?? null, null);

// ---- Firebase (lazy) -----------------------------------------------------------------------

interface FB {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  authM: typeof import('firebase/auth');
  fsM: typeof import('firebase/firestore');
}
let fbPromise: Promise<FB> | null = null;
let fb: FB | null = null;

/** Start downloading Firebase so the sign-in popup can open straight from the click. */
export function prepareGoogle(): Promise<FB> | null {
  if (!googleConfigured()) return null;
  fbPromise ??= (async () => {
    const [appM, authM, fsM] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
    const app = appM.initializeApp(CONFIG as Required<typeof CONFIG>);
    fb = { app, auth: authM.getAuth(app), db: fsM.getFirestore(app), authM, fsM };
    return fb;
  })();
  return fbPromise;
}

// ---- Modes ---------------------------------------------------------------------------------

export function playAsGuest(): void {
  safe(() => session()?.setItem(GUEST_KEY, '1'), undefined);
  safe(() => local()?.removeItem(MODE_KEY), undefined);
  useSaveStore(session());
  current = { mode: 'guest', name: 'Guest Captain' };
  applyTestMode();
}

/**
 * At boot: resume this session's guest choice or a remembered Google sign-in.
 * Returns false when the player still has to choose (show the sign-in screen).
 */
export async function restoreAccount(): Promise<boolean> {
  if (safe(() => session()?.getItem(GUEST_KEY), null)) {
    playAsGuest();
    return true;
  }
  if (safe(() => local()?.getItem(MODE_KEY), null) !== 'google') return false;
  const f = await prepareGoogle();
  if (!f) return false;
  await f.authM.setPersistence(f.auth, f.authM.browserLocalPersistence).catch(() => undefined);
  const user = await new Promise<User | null>((resolve) => {
    const off = f.authM.onAuthStateChanged(f.auth, (u) => {
      off();
      resolve(u);
    });
  });
  if (!user) return false;
  await attachGoogle(user, null);
  return true;
}

/**
 * Open the Google popup. Call straight from a click/key handler: browsers block popups
 * that open after an await, so Firebase must already be loaded (see prepareGoogle).
 * `carry` is progress to bring along if this account has no save yet (a guest's save).
 */
export async function signInWithGoogle(carry: string | null = null): Promise<void> {
  if (!fb) throw new Error(googleConfigured() ? 'Google sign-in is still loading, try again in a moment.' : 'Google sign-in is not set up in this build.');
  const popup = fb.authM.signInWithPopup(fb.auth, new fb.authM.GoogleAuthProvider());
  const { user } = await popup;
  await attachGoogle(user, testMode() ? null : carry); // never carry sandbox progress into an account
}

export async function signOut(): Promise<void> {
  await flushPush();
  if (fb) await fb.authM.signOut(fb.auth).catch(() => undefined);
  safe(() => local()?.removeItem(MODE_KEY), undefined);
  safe(() => session()?.removeItem(GUEST_KEY), undefined);
  useSaveStore(undefined);
  current = null;
}

// ---- Google save sync ----------------------------------------------------------------------

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: (() => Promise<void>) | null = null;

async function flushPush(): Promise<void> {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  const p = pending;
  pending = null;
  if (p) await p().catch((e) => console.warn('Cloud save failed; it will retry on the next save.', e));
}

async function attachGoogle(user: User, carry: string | null): Promise<void> {
  const f = fb!;
  const ls = local();
  const cacheKey = `${SAVE_KEY}@${user.uid}`;
  const timeKey = `${cacheKey}:t`;
  const ref = f.fsM.doc(f.db, 'saves', user.uid);

  let cloud: StampedSave | null = null;
  try {
    const snap = await f.fsM.getDoc(ref);
    const d = snap.exists() ? (snap.data() as { save?: unknown; updatedAt?: unknown }) : null;
    if (d && typeof d.save === 'string') cloud = { save: d.save, t: Number(d.updatedAt) || 0 };
  } catch (e) {
    console.warn('Could not reach the cloud save; using this device’s copy.', e);
  }
  const cached = safe(() => ls?.getItem(cacheKey) ?? null, null);
  const cache: StampedSave | null = cached ? { save: cached, t: Number(safe(() => ls?.getItem(timeKey), '0')) || 0 } : null;
  // The first Google account on this browser inherits progress saved before accounts existed.
  const legacy = safe(() => ls?.getItem(SAVE_KEY) ?? null, null);
  const pick = chooseSave(cloud, cache, carry ?? legacy);

  const push = (value: string) => {
    pending = () => f.fsM.setDoc(ref, { save: value, updatedAt: Date.now() });
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void flushPush(), PUSH_DELAY_MS);
  };
  if (pick.save !== null) {
    safe(() => ls?.setItem(cacheKey, pick.save!), undefined);
    safe(() => ls?.setItem(timeKey, String(pick.source === 'cloud' ? cloud!.t : Date.now())), undefined);
    if (pick.source !== 'cloud') push(pick.save);
    if (pick.source === 'carry' && !carry) safe(() => ls?.removeItem(SAVE_KEY), undefined); // legacy save moved
  }

  useSaveStore({
    getItem: (k) => (k === SAVE_KEY ? safe(() => ls?.getItem(cacheKey) ?? null, null) : null),
    setItem: (k, v) => {
      if (k !== SAVE_KEY) return;
      ls?.setItem(cacheKey, v);
      ls?.setItem(timeKey, String(Date.now()));
      push(v);
    },
  });
  safe(() => ls?.setItem(MODE_KEY, 'google'), undefined);
  safe(() => session()?.removeItem(GUEST_KEY), undefined);
  current = { mode: 'google', name: user.displayName ?? 'Captain', email: user.email ?? undefined };
  applyTestMode();
}

// Push any pending cloud write when the tab is hidden or closed.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPush();
  });
}

// ---- Test mode (?unlockall) ----------------------------------------------------------------

export const testMode = (): boolean => readUrlFlags().unlockAll;
export const TEST_BERRIES = 999_999_999;

/**
 * ?unlockall plays in a sandbox: a copy of the current save, in memory only, with
 * TEST_BERRIES. Nothing done in test mode reaches the guest session or the cloud save.
 * Called after every account switch (which would otherwise point saves back at real storage).
 */
export function applyTestMode(): void {
  if (!testMode()) return;
  const save = loadSave();
  save.berries = TEST_BERRIES;
  const mem = new Map<string, string>();
  useSaveStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) });
  writeSave(save);
}
