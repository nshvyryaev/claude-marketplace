// Интеграционный тест с настоящим Chrome. Без Chrome — пропускается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from '../scripts/lib/session.mjs';
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
