// Accounts + cloud saves for Grand Line Survivor: plain node:http + node:sqlite, no dependencies.
// Also serves the built game (dist/) so one `npm start` runs everything.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SESSION_MS = 180 * 24 * 3600 * 1000;
const MAX_BODY = 512 * 1024;
const FAIL_LIMIT = 20; // failed logins/registrations per IP per window
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

async function hashPassword(pw) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await scryptAsync(pw, salt, 64)).toString('hex')}`;
}
async function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const got = await scryptAsync(pw, Buffer.from(salt, 'hex'), 64);
  return timingSafeEqual(got, Buffer.from(hash, 'hex'));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApp({ dbPath = ':memory:', distDir = null, allowedOrigin = '' } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, pass TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS saves (user_id INTEGER PRIMARY KEY, save TEXT NOT NULL, updated INTEGER NOT NULL);
  `);
  const q = {
    userByName: db.prepare('SELECT id, username, pass FROM users WHERE username = ?'),
    addUser: db.prepare('INSERT INTO users (username, pass, created) VALUES (?, ?, ?)'),
    addSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created) VALUES (?, ?, ?)'),
    session: db.prepare('SELECT s.user_id AS id, s.created, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'),
    dropSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    getSave: db.prepare('SELECT save, updated FROM saves WHERE user_id = ?'),
    putSave: db.prepare('INSERT INTO saves (user_id, save, updated) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET save = excluded.save, updated = excluded.updated'),
  };

  // ponytail: per-process memory; move to SQLite if the server ever runs as several processes.
  const fails = new Map(); // ip -> { n, until }
  const limited = (ip) => {
    const f = fails.get(ip);
    return !!f && f.until > Date.now() && f.n >= FAIL_LIMIT;
  };
  const failed = (ip) => {
    const f = fails.get(ip);
    if (!f || f.until <= Date.now()) fails.set(ip, { n: 1, until: Date.now() + FAIL_WINDOW_MS });
    else f.n++;
  };

  const newSession = (userId) => {
    const token = randomBytes(32).toString('hex');
    q.addSession.run(sha256(token), userId, Date.now());
    return token;
  };
  const authed = (req) => {
    const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? '')?.[1];
    const s = token && q.session.get(sha256(token));
    if (!s || Date.now() - s.created > SESSION_MS) throw new HttpError(401, 'Please log in again.');
    return { ...s, token };
  };

  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Too much data.');
      chunks.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw new HttpError(400, 'Bad request.');
    }
  }

  async function credentials(req, ip) {
    if (limited(ip)) throw new HttpError(429, 'Too many tries. Wait a few minutes and try again.');
    const { username, password } = await body(req);
    if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Enter a username and password.');
    return { username: username.trim(), password };
  }

  async function api(req, res, path) {
    const ip = req.socket.remoteAddress ?? '?';
    const route = `${req.method} ${path}`;
    if (route === 'POST /api/register') {
      const { username, password } = await credentials(req, ip);
      if (!USERNAME.test(username)) throw new HttpError(400, 'Username: 3 to 16 letters, numbers or _.');
      if (password.length < 6 || password.length > 72) throw new HttpError(400, 'Password: 6 to 72 characters.');
      if (q.userByName.get(username)) {
        failed(ip);
        throw new HttpError(409, 'That name is taken.');
      }
      const id = Number(q.addUser.run(username, await hashPassword(password), Date.now()).lastInsertRowid);
      return { token: newSession(id), username };
    }
    if (route === 'POST /api/login') {
      const { username, password } = await credentials(req, ip);
      const u = q.userByName.get(username);
      if (!u || !(await checkPassword(password, u.pass))) {
        failed(ip);
        throw new HttpError(401, 'Wrong username or password.');
      }
      return { token: newSession(u.id), username: u.username };
    }
    if (route === 'POST /api/logout') {
      q.dropSession.run(sha256(authed(req).token));
      return { ok: true };
    }
    if (route === 'GET /api/save') {
      const s = authed(req);
      const row = q.getSave.get(s.id);
      return { username: s.username, save: row?.save ?? null, updatedAt: row?.updated ?? 0 };
    }
    if (route === 'PUT /api/save') {
      const s = authed(req);
      const { save, updatedAt } = await body(req);
      if (typeof save !== 'string') throw new HttpError(400, 'Bad save.');
      q.putSave.run(s.id, save, Number(updatedAt) || Date.now());
      return { ok: true };
    }
    throw new HttpError(404, 'Not found.');
  }

  async function serveStatic(res, path) {
    const root = resolve(distDir);
    let file;
    try {
      file = normalize(join(root, decodeURIComponent(path)));
    } catch {
      throw new HttpError(400, 'Bad request.');
    }
    if (file !== root && !file.startsWith(root + sep)) throw new HttpError(404, 'Not found.');
    if (!(await stat(file).catch(() => null))?.isFile()) file = join(root, 'index.html');
    const data = await readFile(file).catch(() => null);
    if (!data) throw new HttpError(404, 'Not found.');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  }

  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    }
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
      } else if (path.startsWith('/api/')) {
        const out = await api(req, res, path);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(out));
      } else if (distDir && req.method === 'GET') {
        await serveStatic(res, path);
      } else {
        throw new HttpError(404, 'Not found.');
      }
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: status === 500 ? 'Server error.' : e.message }));
    }
  });
  server.on('close', () => db.close());
  return server;
}
