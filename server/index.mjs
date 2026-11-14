// Start the game server: `npm start` (serves dist/ + the accounts API) or `npm run server` in dev.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = resolve(root, process.env.DB_PATH ?? 'data/grandline.db');
mkdirSync(dirname(dbPath), { recursive: true });
const port = Number(process.env.PORT ?? 8787);

createApp({ dbPath, distDir: resolve(root, 'dist'), allowedOrigin: process.env.ALLOWED_ORIGIN ?? '' }).listen(port, () =>
  console.log(`Grand Line Survivor server on http://localhost:${port} (db: ${dbPath})`),
);
