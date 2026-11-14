import { afterAll, beforeAll, expect, test } from 'vitest';
import { createApp } from './app.mjs';

let server;
let base;
beforeAll(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const call = async (method, path, body, token) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
};

test('register, log in, save, log out', async () => {
  expect((await call('POST', '/api/register', { username: 'x', password: 'secret1' })).status).toBe(400);
  const reg = await call('POST', '/api/register', { username: 'Zoro_1', password: 'secret1' });
  expect(reg.status).toBe(200);
  expect((await call('POST', '/api/register', { username: 'zoro_1', password: 'other12' })).status).toBe(409);

  expect((await call('POST', '/api/login', { username: 'Zoro_1', password: 'wrong!!' })).status).toBe(401);
  const login = await call('POST', '/api/login', { username: 'ZORO_1', password: 'secret1' });
  expect(login.status).toBe(200);
  expect(login.json.username).toBe('Zoro_1');
  const t = login.json.token;

  expect((await call('GET', '/api/save', null, t)).json).toEqual({ username: 'Zoro_1', save: null, updatedAt: 0 });
  expect((await call('PUT', '/api/save', { save: '{"berries":5}', updatedAt: 123 }, t)).status).toBe(200);
  expect((await call('GET', '/api/save', null, reg.json.token)).json).toEqual({ username: 'Zoro_1', save: '{"berries":5}', updatedAt: 123 });

  expect((await call('GET', '/api/save')).status).toBe(401);
  expect((await call('POST', '/api/logout', null, t)).status).toBe(200);
  expect((await call('GET', '/api/save', null, t)).status).toBe(401);
  expect((await call('GET', '/api/save', null, reg.json.token)).status).toBe(200); // other sessions stay
});
