// Окружение прогона с настоящим Chrome: URL, часы, пояс, сеть, размер окна,
// перезапуск. Без Chrome — пропускается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from '../scripts/lib/session.mjs';
import { chromePath } from '../scripts/vendor/cdp/chrome.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
let hasChrome = true;
try { chromePath(); } catch { hasChrome = false; }

const config = {
  build: 'toy-game', bridge: 'env-bridge.js', fps: 60, viewport: { width: 320, height: 240 },
  limits: { bootTimeoutMs: 20000, startFrames: 100, settleMs: 5 },
};
const open = (env = {}, run = {}) => openSession({ root, config, seed: 1, run, env });
// Сервер «не сборки» для проверки сети: отвечает 200 на всё.
async function probeServer() {
  const server = http.createServer((req, res) => res.writeHead(200).end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/probe`,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}
const STEP = Math.ceil((1000 / 60) * 1024) / 1024;

test('без полей окружения — прежняя страница: нет query, онлайн, размер конфига', { skip: !hasChrome }, async () => {
  const game = await open();
  try {
    await game.start({});
    await game.step(1);
    const seen = await game.observe();
    assert.equal(seen.search, '');
    assert.equal(seen.onLine, true);
    assert.equal(seen.fetch, 200);
    assert.deepEqual(seen.size, [320, 240]);
    assert.deepEqual(seen.run, {});
    // Прежняя эпоха шима.
    assert.equal(seen.now, 1767225600000 + Math.floor(1e7 + STEP));
  } finally { await game.close(); }
});

test('query: ?prod, ?api=, ?pf= в адресе страницы', { skip: !hasChrome }, async () => {
  const game = await open({ query: { prod: true, api: 'http://127.0.0.1:18110', pf: 'vk', off: false } });
  try {
    await game.start({});
    const params = new URLSearchParams((await game.observe()).search);
    assert.equal(params.has('prod'), true);
    assert.equal(params.get('api'), 'http://127.0.0.1:18110');
    assert.equal(params.get('pf'), 'vk');
    assert.equal(params.has('off'), false);
  } finally { await game.close(); }
});

test('clock и timezone: Date.now и new Date() идут от часов прогона с кадрами', { skip: !hasChrome }, async () => {
  const at = Date.parse('2026-03-01T23:30:00Z');
  const game = await open({ clock: '2026-03-01T23:30:00Z', timezone: 'Europe/Moscow' });
  try {
    await game.start({});
    const t0 = (await game.observe()).now;
    assert.ok(t0 >= at && t0 < at + 100 * STEP, `t0=${t0}`);
    await game.step(60);
    const seen = await game.observe();
    assert.equal(seen.now - t0, Math.floor(60 * STEP));
    assert.equal(seen.date, seen.now);
    assert.equal(seen.isDate, true);
    // 23:30 UTC — уже 2:30 следующих суток в Москве.
    assert.equal(seen.hours, 2);
    // Часы переводятся посреди прогона.
    await game.act({ ops: [{ type: 'clock', at: '2026-03-02T21:00:00Z' }] });
    assert.equal((await game.observe()).now, Date.parse('2026-03-02T21:00:00Z'));
  } finally { await game.close(); }
});

test('network: нет сети посреди прогона и обратно, отказ запроса — не ошибка игры; сборка доступна всегда', { skip: !hasChrome }, async () => {
  const probe = await probeServer();
  const game = await open({}, { probe: probe.url });
  try {
    await game.start({});
    assert.equal((await game.observe()).remote, 'ok');
    await game.act({ ops: [{ type: 'network', offline: true }] });
    let seen = await game.observe();
    assert.equal(seen.onLine, false);
    assert.equal(seen.offlineEvents, 1);
    assert.equal(seen.remote, 'fail');
    // Файлы сборки — часть игры, а не сеть: лениво грузимое не падает.
    assert.equal(seen.fetch, 200);
    assert.deepEqual(game.errors(), []);
    await game.act({ ops: [{ type: 'network' }] });
    seen = await game.observe();
    assert.equal(seen.onLine, true);
    assert.equal(seen.fetch, 200);
    assert.equal(seen.remote, 'ok');
    await assert.rejects(game.act({ ops: [{ type: 'network', offline: 'yes' }] }), (e) => e.adapterFault === true);
  } finally { await game.close(); await probe.close(); }
});

test('network прогона: at boot — без сети с самого старта уровня, сборка грузится', { skip: !hasChrome }, async () => {
  const probe = await probeServer();
  const game = await open({ network: 'offline' }, { probe: probe.url });
  try {
    await game.start({});
    const seen = await game.observe();
    assert.equal(seen.onLine, false);
    assert.equal(seen.remote, 'fail');
    assert.equal(seen.fetch, 200);
  } finally { await game.close(); await probe.close(); }
});

test('viewport: портрет телефона и обратно', { skip: !hasChrome }, async () => {
  const game = await open();
  try {
    await game.start({});
    const before = await game.observe();
    assert.equal(before.portrait, false);
    await game.act({ ops: [{ type: 'viewport', width: 240, height: 400 }] });
    let seen = await game.observe();
    assert.deepEqual(seen.size, [240, 400]);
    assert.equal(seen.portrait, true);
    assert.ok(seen.resizes > before.resizes);
    await game.act({ ops: [{ type: 'viewport' }] });
    seen = await game.observe();
    assert.deepEqual(seen.size, [320, 240]);
    assert.equal(seen.portrait, false);
    await assert.rejects(game.act({ ops: [{ type: 'viewport', width: 0, height: 10 }] }), (e) => e.adapterFault === true);
  } finally { await game.close(); }
});

test('viewport прогона задаёт начальный размер', { skip: !hasChrome }, async () => {
  const game = await open({ viewport: { width: 200, height: 360, mobile: true } });
  try {
    await game.start({});
    const seen = await game.observe();
    assert.deepEqual(seen.size, [200, 360]);
    assert.equal(seen.portrait, true);
  } finally { await game.close(); }
});

test('reload: хранилище и часы переживают перезапуск, мост видит номер перезапуска', { skip: !hasChrome }, async () => {
  const game = await open({ clock: 1800000000000 }, { theme: 'minimal' });
  try {
    await game.start({ level: 3 });
    await game.act({ store: 'kept' });
    await game.step(30);
    const before = await game.observe();
    assert.equal(before.stored, 'kept');
    await game.act({ ops: [{ type: 'network', offline: true }, { type: 'reload' }] });
    const seen = await game.observe();
    assert.equal(seen.stored, 'kept');
    assert.deepEqual(seen.run, { theme: 'minimal', reloads: 1 });
    // Часы не откатились к началу прогона.
    assert.ok(seen.now >= before.now, `${seen.now} < ${before.now}`);
    // Сборка загрузилась, а условия сети вернулись после загрузки.
    assert.equal(seen.onLine, false);
    // Перезапуск с другими параметрами URL.
    await game.act({ ops: [{ type: 'network' }, { type: 'reload', query: 'prod' }] });
    const again = await game.observe();
    assert.equal(again.search, '?prod');
    assert.equal(again.run.reloads, 2);
    assert.equal(again.stored, 'kept');
    assert.deepEqual(game.errors(), []);
  } finally { await game.close(); }
});
