// Сервер API прогона, подмена ответов и хранилище до загрузки — с настоящим
// Chrome. Без Chrome — пропускается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from '../scripts/lib/session.mjs';
import { chromePath } from '../scripts/vendor/cdp/chrome.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
let hasChrome = true;
try { chromePath(); } catch { hasChrome = false; }

const config = {
  build: 'toy-game', bridge: 'server-bridge.js', fps: 60, viewport: { width: 320, height: 240 },
  out: path.join(os.tmpdir(), `vc-server-chrome-${process.pid}`),
  limits: { bootTimeoutMs: 20000, startFrames: 100, settleMs: 5 },
  server: { command: ['node', 'toy-server.mjs'] },
};
const open = (env = {}) => openSession({ root, config, seed: 1, run: {}, env });
// Время страницы виртуальное (шим): задержку меряем настоящими часами.
const request = async (game, req) => {
  const t0 = Date.now();
  await game.act({ request: req });
  const result = (await game.observe()).request;
  return { ...result, ms: Date.now() - t0 };
};

test('server: страница получает ?api= с адресом сервера, база — из фикстуры, мост видит адрес', { skip: !hasChrome }, async () => {
  const game = await open({ server: { db: 'db/players.json' }, query: { prod: true } });
  try {
    await game.start({});
    const seen = await game.observe();
    assert.match(seen.api, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(seen.search, /^\?prod&api=/);
    assert.equal(seen.run.server, seen.api);
    const health = await request(game, { url: '{api}/healthz' });
    assert.equal(health.status, 200);
    const players = await request(game, { url: '{api}/v1/players' });
    assert.deepEqual(JSON.parse(players.body), [{ id: 7, name: 'json', meta: '{"vip":true}' }]);
    // Перезапуск с другими параметрами — адрес сервера остаётся.
    await game.act({ ops: [{ type: 'reload', query: 'pf=vk' }] });
    const again = await game.observe();
    assert.equal(again.api, seen.api);
    assert.match(again.search, /^\?pf=vk&api=/);
    assert.deepEqual(game.errors(), []);
  } finally { await game.close(); }
});

test('intercept: задержка, недостижимый адрес, ответ кодом без сервера (и предзапрос CORS); смена правил посреди прогона', { skip: !hasChrome }, async () => {
  const game = await open({
    server: true,
    intercept: [
      { url: '*/v1/players*', delay: 400 },
      { url: 'http://127.0.0.1:9/*', status: 503, body: '{"error":"down"}' },
    ],
  });
  try {
    await game.start({});
    const slow = await request(game, { url: '{api}/v1/players' });
    assert.equal(slow.status, 200);
    assert.ok(slow.ms >= 350, `задержка ${slow.ms}`);
    // Порт 9 никто не слушает: ответ целиком из подмены, с POST JSON (предзапрос).
    const coded = await request(game, { url: 'http://127.0.0.1:9/v1/runs', method: 'POST', json: { a: 1 } });
    assert.deepEqual([coded.status, coded.body], [503, '{"error":"down"}']);
    await game.act({ ops: [{ type: 'intercept', rules: [{ url: '*/healthz', fail: 'refused' }] }] });
    const refused = await request(game, { url: '{api}/healthz' });
    assert.equal(refused.status, undefined);
    assert.match(refused.error, /fetch/i);
    // Прежние правила сняты.
    const fast = await request(game, { url: '{api}/v1/players' });
    assert.ok(fast.status === 200 && fast.ms < 350, JSON.stringify(fast));
    await game.act({ ops: [{ type: 'intercept' }] });
    assert.equal((await request(game, { url: '{api}/healthz' })).status, 200);
    // Отказы и коды подмены — условие прогона, не ошибка игры.
    assert.deepEqual(game.errors(), []);
    await assert.rejects(game.act({ ops: [{ type: 'intercept', rules: [{ url: '*' }] }] }), (e) => e.adapterFault === true);
  } finally { await game.close(); }
});

test('intercept вместе с «нет сети»: сборка с диска, подменённый ответ кодом приходит', { skip: !hasChrome }, async () => {
  const game = await open({ network: 'offline', intercept: [{ url: 'http://127.0.0.1:9/*', status: 200, body: 'ok' }] });
  try {
    await game.start({});
    const fake = await request(game, { url: 'http://127.0.0.1:9/x' });
    assert.deepEqual([fake.status, fake.body], [200, 'ok']);
    const build = await request(game, { url: 'index.html' });
    assert.equal(build.status, 200);
  } finally { await game.close(); }
});

test('storage: localStorage и Cache API заполнены до загрузки игры; {api} и file', { skip: !hasChrome }, async () => {
  const game = await open({
    server: true,
    storage: {
      localStorage: { token: 'abc', settings: { sound: false } },
      caches: {
        content: [
          { url: '{api}/v1/content', body: '{"version":"v1"}', headers: { 'content-type': 'application/json' } },
          { url: '/img/a.txt', file: 'db/players.sql', status: 200 },
        ],
      },
    },
  });
  try {
    await game.start({});
    const seen = await game.observe();
    assert.deepEqual(seen.seenAtLoad.local, { token: 'abc', settings: '{"sound":false}' });
    const cached = seen.caches.content;
    assert.deepEqual(cached[`${seen.api}/v1/content`], { status: 200, type: 'application/json', body: '{"version":"v1"}' });
    const fileEntry = Object.entries(cached).find(([url]) => url.endsWith('/img/a.txt'))[1];
    assert.match(fileEntry.body, /sql-one/);
  } finally { await game.close(); }
});

test('storage из файла фикстуры; без полей — хранилище пустое', { skip: !hasChrome }, async () => {
  let game = await open({ storage: 'storage.json' });
  try {
    await game.start({});
    const seen = await game.observe();
    assert.deepEqual(seen.seenAtLoad.local, { from: 'file' });
    assert.deepEqual(Object.keys(seen.caches), ['file-cache']);
    assert.equal(seen.run.server, undefined);
    assert.equal(seen.api, null);
  } finally { await game.close(); }
  game = await open();
  try {
    await game.start({});
    const seen = await game.observe();
    assert.deepEqual(seen.seenAtLoad.local, {});
    assert.deepEqual(seen.caches, {});
    assert.equal(seen.search, '');
  } finally { await game.close(); }
});
