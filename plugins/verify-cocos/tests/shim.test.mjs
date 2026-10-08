import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { shimSource } from '../scripts/lib/shim.mjs';
import { mulberry32 } from '../scripts/lib/rng.mjs';

// Страница-заглушка: настоящий rAF копит колбэки, их вызывает тест.
function page(seed = 7, fps = 60) {
  const real = [];
  const reported = [];
  const ctx = { requestAnimationFrame: (cb) => { real.push(cb); return real.length; }, performance: { now: () => 123 }, reportError: (e) => reported.push(e) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(shimSource({ seed, fps }), ctx);
  const run = (code) => vm.runInContext(code, ctx);
  const realFrame = () => { const cb = real.shift(); cb(0); };
  return { ctx, run, realFrame, reported };
}

test('Math.random страницы совпадает с mulberry32 плагина', () => {
  const { run } = page(7);
  const expected = mulberry32(7);
  for (let i = 0; i < 5; i++) assert.equal(run('Math.random()'), expected());
});

test('reseed перезапускает поток', () => {
  const { run } = page(7);
  run('Math.random(); Math.random()');
  run('__botShim.reseed(11)');
  assert.equal(run('Math.random()'), mulberry32(11)());
});

test('до заморозки настоящий кадр прокручивает очередь rAF', () => {
  const { run, realFrame } = page();
  run('globalThis.calls = 0; requestAnimationFrame(() => calls++)');
  realFrame();
  assert.equal(run('calls'), 1);
});

test('после заморозки время и кадры идут только по step', () => {
  const { run, realFrame } = page();
  run(`globalThis.stamps = []; const loop = (t) => { stamps.push(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop);`);
  run('__botShim.freeze()');
  realFrame(); realFrame();
  assert.equal(run('stamps.length'), 0);
  run('__botShim.step(3)');
  const stamps = run('stamps');
  assert.equal(stamps.length, 3);
  // Шаг точно представим в double: dt одинаков побитово на любом кадре,
  // и чуть длиннее 1000/60 — Pacer движка не пропускает кадры.
  const step = Math.ceil((1000 / 60) * 1024) / 1024;
  assert.equal(stamps[1] - stamps[0], step);
  assert.equal(stamps[2] - stamps[1], step);
  assert.ok(step > 1000 / 60);
  assert.equal(run('performance.now()'), stamps[2]);
  assert.equal(run('__botShim.frames()'), 3);
});

test('stepUntilEvents останавливается на первом кадре с событиями', () => {
  const { run } = page();
  run(`let n = 0; window.__bot = { frameEvents: () => (++n === 4 ? [{ type: 'x' }] : []) }; __botShim.freeze()`);
  // Объекты из vm — из чужого realm: deepStrictEqual сравнивает прототипы,
  // поэтому результат проходит через JSON.
  const step = (n) => JSON.parse(run(`JSON.stringify(__botShim.stepUntilEvents(${n}))`));
  assert.deepEqual(step(10), { frames: 4, events: [{ type: 'x' }] });
  assert.deepEqual(step(2), { frames: 2, events: [] });
});

test('cancelAnimationFrame снимает колбэк из очереди', () => {
  const { run } = page();
  run('globalThis.calls = 0; const id = requestAnimationFrame(() => calls++); cancelAnimationFrame(id); __botShim.freeze(); __botShim.step(1)');
  assert.equal(run('calls'), 0);
});

test('исключение в колбэке rAF не останавливает остальные и уходит в reportError', () => {
  const { run, reported } = page();
  run("globalThis.calls = 0; requestAnimationFrame(() => { throw new Error('игра упала'); }); requestAnimationFrame(() => calls++); __botShim.freeze(); __botShim.step(1)");
  assert.equal(run('calls'), 1);
  assert.equal(reported.length, 1);
  assert.match(reported[0].message, /игра упала/);
});

test('без часов прогона Date.now — прежняя эпоха шима, конструктор Date настоящий', () => {
  const { run } = page();
  assert.equal(run('Date.now()'), 1767225600000);
  assert.equal(run('Date.name'), 'Date');
});

test('часы прогона: стоят до заморозки, потом идут с кадрами; new Date() их видит', () => {
  const ctx = { requestAnimationFrame: () => 1, performance: {}, reportError: () => {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(shimSource({ seed: 1, fps: 60, clock: 1800000000000 }), ctx);
  const run = (code) => vm.runInContext(code, ctx);
  assert.equal(run('Date.now()'), 1800000000000);
  run('__botShim.freeze(); __botShim.step(60)');
  const step = Math.ceil((1000 / 60) * 1024) / 1024;
  assert.equal(run('Date.now()'), 1800000000000 + Math.floor(60 * step));
  assert.equal(run('new Date().getTime()'), run('Date.now()'));
  assert.equal(run('new Date(5).getTime()'), 5);
  assert.equal(run('new Date() instanceof Date'), true);
  assert.equal(run('typeof Date()'), 'string');
  run('__botShim.setClock(1900000000000)');
  assert.equal(run('Date.now()'), 1900000000000);
  run('__botShim.step(1)');
  assert.equal(run('Date.now()'), 1900000000000 + Math.floor(61 * step) - Math.floor(60 * step));
});
