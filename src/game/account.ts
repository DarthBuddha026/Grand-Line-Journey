import { chooseSave, loadSave, SAVE_KEY, useSaveStore, writeSave, type StampedSave } from '../core/save';
import { readUrlFlags } from '../config';

/**
 * Who is playing and where their progress lives.
 *  - Account: username + password on our server (server/, SQLite). The save is cached in
 *    localStorage under `<save key>@<username>`, so loadSave/writeSave stay synchronous;
 *    every write is pushed to the server a moment later.
 *  - Guest: sessionStorage, which the browser wipes when it closes.
 */

export type AccountMode = 'user' | 'guest';
export interface Account {
  mode: AccountMode;
  name: string;
}

const TOKEN_KEY = 'grand-line-survivor/token'; // localStorage: the logged-in session between launches
const GUEST_KEY = 'grand-line-survivor/guest'; // sessionStorage: guest chosen for this browser session
const PUSH_DELAY_MS = 1200;
/** Where the accounts API lives; empty = the same site as the game (see vite.config.ts proxy). */
const API = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

let current: Account | null = null;
export const account = (): Account | null => current;

const safe = <T>(f: () => T, fallback: T): T => {
  try {
    return f();
  } catch {
    return fallback;
  }
};
const local = (): Storage | null => safe(() => globalThis.localStorage ?? null, null);
const session = (): Storage | null => safe(() => globalThis.sessionStorage ?? null, null);

// ---- Server --------------------------------------------------------------------------------

/** A failed API call; `status` is 0 when the server could not be reached. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(method: string, path: string, body?: unknown, token?: string, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/api/${path}`, {
      method,
      keepalive,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Server error (${res.status}).`);
  return data;
}

// ---- Modes ---------------------------------------------------------------------------------

export function playAsGuest(): void {
  safe(() => session()?.setItem(GUEST_KEY, '1'), undefined);
  useSaveStore(session());
  current = { mode: 'guest', name: 'Guest Captain' };
  applyTestMode();
}

/**
 * At boot: resume this session's guest choice or a logged-in account.
 * Returns false when the player still has to choose (show the account screen).
 */
export async function restoreAccount(): Promise<boolean> {
  if (safe(() => session()?.getItem(GUEST_KEY), null)) {
    playAsGuest();
    return true;
  }
  const stored = safe(() => local()?.getItem(TOKEN_KEY) ?? null, null);
  if (!stored) return false;
  const [tok, username] = stored.split(' ');
  try {
    await attachUser(tok, null);
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      safe(() => local()?.removeItem(TOKEN_KEY), undefined); // session expired
      return false;
    }
    return attachOffline(tok, username); // server unreachable: play from this device's copy
  }
}

/** `carry` is progress to bring into the account if it has no save yet (a guest's save). */
export async function register(username: string, password: string, carry: string | null = null): Promise<void> {
  const r = await api<{ token: string; username: string }>('POST', 'register', { username, password });
  await attachUser(r.token, testMode() ? null : carry); // never carry sandbox progress into an account
}

export async function logIn(username: string, password: string, carry: string | null = null): Promise<void> {
  const r = await api<{ token: string; username: string }>('POST', 'login', { username, password });
  await attachUser(r.token, testMode() ? null : carry);
}

export async function signOut(): Promise<void> {
  await flushPush();
  if (token) await api('POST', 'logout', undefined, token).catch(() => undefined);
  token = null;
  safe(() => local()?.removeItem(TOKEN_KEY), undefined);
  safe(() => session()?.removeItem(GUEST_KEY), undefined);
  useSaveStore(undefined);
  current = null;
}

// ---- Save sync -----------------------------------------------------------------------------

let token: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: ((keepalive: boolean) => Promise<void>) | null = null;

async function flushPush(keepalive = false): Promise<void> {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  const p = pending;
  pending = null;
  if (p) await p(keepalive).catch((e) => console.warn('Cloud save failed; it will retry on the next save.', e));
}

const cacheKeys = (username: string) => {
  const cacheKey = `${SAVE_KEY}@${username.toLowerCase()}`;
  return { cacheKey, timeKey: `${cacheKey}:t` };
};

async function attachUser(tok: string, carry: string | null): Promise<void> {
  const ls = local();
  const r = await api<{ username: string; save: string | null; updatedAt: number }>('GET', 'save', undefined, tok);
  const { cacheKey, timeKey } = cacheKeys(r.username);
  const cloud: StampedSave | null = r.save !== null ? { save: r.save, t: r.updatedAt } : null;
  const cached = safe(() => ls?.getItem(cacheKey) ?? null, null);
  const cache: StampedSave | null = cached ? { save: cached, t: Number(safe(() => ls?.getItem(timeKey), '0')) || 0 } : null;
  // The first account on this browser inherits progress saved before accounts existed.
  const legacy = safe(() => ls?.getItem(SAVE_KEY) ?? null, null);
  const pick = chooseSave(cloud, cache, carry ?? legacy);

  if (pick.save !== null) {
    safe(() => ls?.setItem(cacheKey, pick.save!), undefined);
    safe(() => ls?.setItem(timeKey, String(pick.source === 'cloud' ? cloud!.t : Date.now())), undefined);
    if (pick.source === 'carry' && !carry) safe(() => ls?.removeItem(SAVE_KEY), undefined); // legacy save moved
  }
  useAccountStore(tok, r.username);
  if (pick.save !== null && pick.source !== 'cloud') push(pick.save);
}

/**
 * Offline start: play from this device's copy; new saves are pushed once the server answers.
 * Without a copy, start nothing (an empty save pushed later would overwrite the real one).
 */
function attachOffline(tok: string, username: string): boolean {
  if (!safe(() => local()?.getItem(cacheKeys(username).cacheKey), null)) return false;
  useAccountStore(tok, username);
  return true;
}

function push(value: string): void {
  const tok = token;
  if (!tok) return;
  pending = (keepalive) => api('PUT', 'save', { save: value, updatedAt: Date.now() }, tok, keepalive);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void flushPush(), PUSH_DELAY_MS);
}

function useAccountStore(tok: string, username: string): void {
  const ls = local();
  const { cacheKey, timeKey } = cacheKeys(username);
  token = tok;
  useSaveStore({
    getItem: (k) => (k === SAVE_KEY ? safe(() => ls?.getItem(cacheKey) ?? null, null) : null),
    setItem: (k, v) => {
      if (k !== SAVE_KEY) return;
      ls?.setItem(cacheKey, v);
      ls?.setItem(timeKey, String(Date.now()));
      push(v);
    },
  });
  safe(() => ls?.setItem(TOKEN_KEY, `${tok} ${username}`), undefined);
  safe(() => session()?.removeItem(GUEST_KEY), undefined);
  current = { mode: 'user', name: username };
  applyTestMode();
}

// Push any pending save when the tab is hidden or closed (keepalive lets it finish after unload).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPush(true);
  });
}

// ---- Test mode (?unlockall) ----------------------------------------------------------------

export const testMode = (): boolean => readUrlFlags().unlockAll;
export const TEST_BERRIES = 999_999_999;

/**
 * ?unlockall plays in a sandbox: a copy of the current save, in memory only, with
 * TEST_BERRIES. Nothing done in test mode reaches the guest session or the account save.
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
