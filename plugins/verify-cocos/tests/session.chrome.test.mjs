// Интеграционный тест с настоящим Chrome. Без Chrome — пропускается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession, normalizeOrigin } from '../scripts/lib/session.mjs';
import { decodePng } from '../scripts/vendor/cdp/png.mjs';
import { chromePath } from '../scripts/vendor/cdp/chrome.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
let hasChrome = true;
try { chromePath(); } catch { hasChrome = false; }

const config = (bridge, limits = {}) => ({
  build: 'toy-game', bridge, fps: 60, viewport: { width: 320, height: 240 },
  limits: { bootTimeoutMs: 20000, startFrames: 100, settleMs: 5, ...limits },
});

test('ввод, прокрутка кадров, события и виртуальное время', { skip: !hasChrome }, async () => {
  const game = await openSession({ root, config: config('toy-bridge.js'), seed: 42 });
  try {
    await game.start({});
    // Первый кадр после заморозки: до него время шло от свободных кадров.
    await game.step(1);
    const t0 = (await game.observe()).t;
    const ops = await game.act({ type: 'move', dir: 'right' });
    assert.deepEqual(ops, [{ type: 'keyDown', key: 'ArrowRight' }]);
    const stepped = await game.step(20);
    assert.equal(stepped.frames, 5);
    assert.deepEqual(stepped.events, [{ type: 'five' }]);
    const state = await game.observe();
    assert.equal(state.x, 5);
    const step = Math.ceil((1000 / 60) * 1024) / 1024;
    assert.equal(state.t - t0, 5 * step, `t0=${t0} t=${state.t}`);
    assert.deepEqual(game.errors(), []);
  } finally { await game.close(); }
});

test('один seed — один Math.random в игре, другой seed — другой', { skip: !hasChrome }, async () => {
  const targetOf = async (seed) => {
    const game = await openSession({ root, config: config('toy-bridge.js'), seed });
    try { return (await game.observe()).target; } finally { await game.close(); }
  };
  const a = await targetOf(42);
  assert.equal(await targetOf(42), a);
  assert.notEqual(await targetOf(43), a);
});

test('игра не загрузилась — ошибка за bootTimeoutMs, а не зависание', { skip: !hasChrome }, async () => {
  const started = Date.now();
  await assert.rejects(openSession({ root, config: config('dead-bridge.js', { bootTimeoutMs: 1500 }), seed: 1 }), /не загрузилась/);
  assert.ok(Date.now() - started < 15000);
});

test('вечный preload — ошибка за bootTimeoutMs, а не зависание', { skip: !hasChrome }, async () => {
  const game = await openSession({ root, config: config('stuck-preload-bridge.js', { bootTimeoutMs: 1500 }), seed: 1 });
  try {
    const started = Date.now();
    await assert.rejects(game.start({}), /preload/);
    assert.ok(Date.now() - started < 10000);
  } finally { await game.close(); }
});

test('вызов после закрытия сессии отклоняется, а не висит', { skip: !hasChrome }, async () => {
  const game = await openSession({ root, config: config('toy-bridge.js'), seed: 1 });
  await game.close();
  await assert.rejects(game.observe());
});

test('случайный порт сервера вырезается из текстов ошибок', () => {
  const url = 'http://127.0.0.1:61234/';
  assert.equal(normalizeOrigin('at f (http://127.0.0.1:61234/assets/main/index.js:3:5)', url), 'at f (/assets/main/index.js:3:5)');
  assert.equal(normalizeOrigin('без адреса', url), 'без адреса');
});

test('параметры прогона видны в странице, вырезка — PNG нужного размера', { skip: !hasChrome }, async () => {
  const game = await openSession({ root, config: config('shot-bridge.js'), seed: 1, run: { theme: 'minimal' } });
  try {
    await game.start({});
    const seen = await game.observe();
    assert.deepEqual(seen.run, { theme: 'minimal' });
    // Размер страницы — ровно viewport конфига: от него зависят координаты вырезок.
    assert.deepEqual(seen.size, [320, 240]);
    const png = decodePng(await game.shot({ x: 0, y: 0, w: 32, h: 16 }));
    assert.equal(png.width, 32);
    assert.equal(png.height, 16);
    await assert.rejects(game.shot({ x: 0, y: 0, w: 0, h: 10 }), (e) => e.adapterFault === true);
    // У края страницы вырезка обрезается, а не отклоняется.
    const edge = decodePng(await game.shot({ x: 300, y: 230, w: 40, h: 20 }));
    assert.deepEqual([edge.width, edge.height], [20, 10]);
    await assert.rejects(game.shot({ x: 400, y: 10, w: 10, h: 10 }), (e) => e.adapterFault === true);
  } finally { await game.close(); }
});

test('потерянный фокус канваса возвращается перед вводом', { skip: !hasChrome }, async () => {
  const game = await openSession({ root, config: config('blur-bridge.js'), seed: 1 });
  try {
    await game.start({});
    await game.act({ type: 'move', dir: 'right' });
    await game.step(3);
    assert.equal((await game.observe()).x, 3);
  } finally { await game.close(); }
});
