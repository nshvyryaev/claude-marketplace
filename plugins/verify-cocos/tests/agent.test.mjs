import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../scripts/lib/agent.mjs';
import { createTrace } from '../scripts/lib/trace.mjs';
import { createPolicy } from '../scripts/lib/policy.mjs';
import { mulberry32 } from '../scripts/lib/rng.mjs';
import { toyGame, toyAdapter, LIMITS } from './helpers/toy.mjs';

async function run({ game = toyGame(), adapter = toyAdapter(), policy = 'planned', limits = {}, mission = 'reach', seed = 1 } = {}) {
  const trace = createTrace();
  const rng = mulberry32(seed);
  const result = await runAgent({ game, adapter, mission: { name: mission, params: {} }, policy: createPolicy(policy, rng), rng, limits: { ...LIMITS, ...limits }, trace });
  return { result, trace, game };
}

test('по плану бот выбирает цель с лучшей оценкой и выполняет миссию', async () => {
  const { result, trace } = await run();
  assert.equal(result.verdict, 'pass');
  const plan = trace.entries.find((e) => e.t === 'plan');
  assert.equal(plan.chosen, 'go-right');
  assert.equal(plan.by, 'score');
  assert.ok(trace.entries.some((e) => e.t === 'act' && e.by === 'tactic'));
  assert.equal(trace.entries.at(-1).t, 'end');
});

test('событие из replanOn запускает пересмотр целей', async () => {
  const { trace } = await run();
  const plans = trace.entries.filter((e) => e.t === 'plan');
  assert.ok(plans.length >= 2, `пересмотров: ${plans.length}`);
  assert.ok(trace.entries.some((e) => e.t === 'goal-end' && e.result === 'replan'));
});

test('нарушение оракула — вердикт bug с данными нарушения', async () => {
  const adapter = toyAdapter({ candidates: () => [{ kind: 'left', id: 'go-left', score: 1, params: {}, done: () => false, failed: () => false }] });
  const { result, trace } = await run({ adapter });
  assert.equal(result.verdict, 'bug');
  assert.equal(result.violation.id, 'x-nonneg');
  assert.ok(trace.entries.some((e) => e.t === 'violation' && e.oracle === 'x-nonneg'));
});

test('цель, не завершённая за goalTimeoutFrames, N раз подряд — bot-stuck', async () => {
  const adapter = toyAdapter({ candidates: () => [{ kind: 'idle', id: 'idle', score: 1, params: {}, done: () => false, failed: () => false }] });
  const { result, trace } = await run({ adapter, limits: { goalTimeoutFrames: 6, maxGoalFailures: 2 } });
  assert.equal(result.verdict, 'bot-stuck');
  assert.equal(trace.entries.filter((e) => e.t === 'goal-end' && e.result === 'timeout').length, 2);
});

test('нет прогресса за stallFrames — bug stall', async () => {
  const adapter = toyAdapter({ candidates: () => [{ kind: 'idle', id: 'idle', score: 1, params: {}, done: () => false, failed: () => false }] });
  const { result } = await run({ adapter, limits: { stallFrames: 10, goalTimeoutFrames: 1000 } });
  assert.equal(result.verdict, 'bug');
  assert.equal(result.violation.id, 'stall');
});

test('ошибка в консоли страницы — bug console-error', async () => {
  const { result } = await run({ game: toyGame({ target: 50, errorsAfterStep: 1 }) });
  assert.equal(result.verdict, 'bug');
  assert.equal(result.violation.id, 'console-error');
  assert.match(result.violation.message, /boom/);
});

test('исключение в модуле адаптера — bot-error, не bug игры', async () => {
  const adapter = toyAdapter({ tactics: { right: { next: () => { throw new Error('опечатка в тактике'); } }, left: { next: () => ({ action: { dir: -1 }, frames: 1 }) } } });
  const { result } = await run({ adapter });
  assert.equal(result.verdict, 'bot-error');
  assert.match(result.violation.message, /опечатка в тактике/);
});

test('исключение моста — bug bridge-error', async () => {
  const game = toyGame(); game.step = async () => { throw new Error('observe упал'); };
  const { result } = await run({ game });
  assert.equal(result.verdict, 'bug');
  assert.equal(result.violation.id, 'bridge-error');
});

test('превышен maxFrames — timeout', async () => {
  const adapter = toyAdapter({ candidates: () => [{ kind: 'idle', id: 'idle', score: 1, params: {}, done: () => false, failed: () => false }] });
  const { result } = await run({ adapter, limits: { maxFrames: 12, stallFrames: 1000, goalTimeoutFrames: 1000 } });
  assert.equal(result.verdict, 'timeout');
});

test('stopAt останавливает прогон с вердиктом stopped', async () => {
  const { result } = await run({ game: toyGame({ target: 100 }), limits: { stopAt: 4 } });
  assert.equal(result.verdict, 'stopped');
  assert.ok(result.frame >= 4);
});

test('случайная политика воспроизводима: один seed — один журнал', async () => {
  const a = await run({ game: toyGame({ target: 7 }), policy: 'every:2', seed: 5 });
  const b = await run({ game: toyGame({ target: 7 }), policy: 'every:2', seed: 5 });
  assert.deepEqual(a.trace.entries, b.trace.entries);
  assert.ok(a.trace.entries.some((e) => e.by === 'random'));
});

test('stall — только когда наблюдаемое состояние не меняется, а не когда не растёт', async () => {
  // Точка ходит туда-обратно: прогресс меняется, но не растёт. Игра жива —
  // это не зависание; бесцельность бота ловят таймауты целей.
  const adapter = toyAdapter({
    progress: (m) => m.x,
    candidates: () => [{ kind: 'swing', id: 'swing', score: 1, params: {}, done: () => false, failed: () => false }],
    replanOn: [],
    // Качается между x=1 и x=2: событий нет, значение меняется каждый кадр.
    tactics: { swing: { next: (m) => ({ action: { dir: m.x <= 1 ? 1 : -1 }, frames: 1 }) } },
  });
  const { result } = await run({ game: toyGame({ target: 50 }), adapter, limits: { stallFrames: 10, goalTimeoutFrames: 40, maxGoalFailures: 2 } });
  assert.equal(result.verdict, 'bot-stuck');
});

test('тактика без frames — bot-error, а не вечный цикл', async () => {
  const adapter = toyAdapter({ tactics: { right: { next: () => ({ action: { dir: 1 } }) }, left: { next: () => ({ action: { dir: -1 }, frames: 1 }) } } });
  const { result } = await run({ adapter });
  assert.equal(result.verdict, 'bot-error');
  assert.match(result.violation.message, /frames/);
});

test('тактика вернула не объект — bot-error', async () => {
  const adapter = toyAdapter({ tactics: { right: { next: () => undefined }, left: { next: () => ({ action: { dir: -1 }, frames: 1 }) } } });
  const { result } = await run({ adapter });
  assert.equal(result.verdict, 'bot-error');
});

test('candidates вернул не массив — bot-error', async () => {
  const { result } = await run({ adapter: toyAdapter({ candidates: () => null }) });
  assert.equal(result.verdict, 'bot-error');
});

test('огромный шаг тактики урезается до лимитов, а не крутит игру вечно', async () => {
  const adapter = toyAdapter({ candidates: () => [{ kind: 'idle', id: 'idle', score: 1, params: {}, done: () => false, failed: () => false }], tactics: { idle: { next: () => ({ action: { dir: 0 }, frames: Infinity }) } } });
  const game = toyGame(); const steps = []; const step = game.step; game.step = (n) => { steps.push(n); return step(n); };
  const { result } = await run({ game, adapter, limits: { maxFrames: 30, goalTimeoutFrames: 20, stallFrames: 1000 } });
  assert.equal(result.verdict, 'timeout');
  assert.ok(steps.every((n) => Number.isFinite(n) && n <= 20), `шаги: ${steps}`);
});

test('ошибка контракта ввода от моста (adapterFault) — bot-error', async () => {
  const game = toyGame(); game.act = async () => { const e = new Error('Неизвестная клавиша в действии моста: KeyQ'); e.adapterFault = true; throw e; };
  const { result } = await run({ game });
  assert.equal(result.verdict, 'bot-error');
});

test('при случайных действиях таймауты целей не копят провалы бота', async () => {
  const adapter = toyAdapter({ candidates: () => [{ kind: 'idle', id: 'idle', score: 1, params: {}, done: () => false, failed: () => false }] });
  const game = toyGame(); game.actions = async () => [{ dir: 0 }];
  const { result } = await run({ game, adapter, policy: 'random', limits: { goalTimeoutFrames: 5, maxGoalFailures: 2, maxFrames: 60, stallFrames: 1000 } });
  assert.equal(result.verdict, 'timeout');
});

test('ожидание подтверждается и попадает в покрытие', async () => {
  const adapter = toyAdapter({
    checks: [{ id: 'bump-then-moved', kind: 'expectation', level: 'fact', within: 4,
      when: (p, c, ev) => (ev.some((e) => e.type === 'bump') ? { x: c.x } : null),
      then: (c, ev, t) => c.x !== t.x }],
  });
  const { result, trace } = await run({ adapter });
  const cov = result.coverage.find((c) => c.id === 'bump-then-moved');
  assert.ok(cov.armed >= 1 && cov.confirmed >= 1, JSON.stringify(cov));
  assert.ok(trace.entries.some((e) => e.t === 'arm') && trace.entries.some((e) => e.t === 'confirm'));
});

test('шаг урезается до срока ожидания', async () => {
  const adapter = toyAdapter({
    tactics: { right: { next: () => ({ action: { dir: 1 }, frames: 50 }) }, left: { next: () => ({ action: { dir: -1 }, frames: 1 }) } },
    // Взводится на x=3 (там событие bump и шаг обрывается), подтверждается на x=5.
    checks: [{ id: 'soon', kind: 'expectation', level: 'fact', within: 2, when: (p, c) => (c.x === 3 ? {} : null), then: (c) => c.x >= 5 }],
    replanOn: [],
  });
  const game = toyGame({ target: 5 }); const steps = []; const step = game.step; game.step = (n) => { steps.push(n); return step(n); };
  const { result } = await run({ game, adapter });
  assert.ok(steps[1] <= 2, `шаг после взвода ${steps[1]}`);
  assert.equal(result.coverage.find((c) => c.id === 'soon').confirmed, 1);
});

test('миссия фильтрует цели по goals', async () => {
  const adapter = toyAdapter({ missions: { reach: { done: (m) => m.x === m.target, goals: ['left'] } } });
  const { trace } = await run({ adapter, limits: { maxFrames: 20, stallFrames: 1000 } });
  assert.equal(trace.entries.find((e) => e.t === 'plan').chosen, 'go-left');
});

test('миссия-фабрика получает параметры', async () => {
  const adapter = toyAdapter({ missions: { reachAt: (params) => ({ done: (m) => m.x === params.at }) } });
  const trace = createTrace();
  const rng = mulberry32(1);
  const result = await runAgent({ game: toyGame({ target: 50 }), adapter, mission: { name: 'reachAt', params: { at: 2 } }, policy: createPolicy('planned', rng), rng, limits: LIMITS, trace });
  assert.equal(result.verdict, 'pass');
  assert.equal(result.frame, 2);
});

test('вырезка с нарушением от onShot — bug', async () => {
  const adapter = toyAdapter({ checks: [{ id: 'look', kind: 'expectation', level: 'pixel', within: 0, when: (p, c) => (c.x === 2 ? {} : null), region: () => ({ x: 0, y: 0, w: 1, h: 1 }) }] });
  const trace = createTrace();
  const rng = mulberry32(1);
  const result = await runAgent({ game: toyGame(), adapter, mission: { name: 'reach', params: {} }, policy: createPolicy('planned', rng), rng, limits: LIMITS, trace,
    onShot: async () => ({ outcome: 'mismatch', violation: { id: 'look', message: 'пиксели разошлись', data: null } }) });
  assert.equal(result.verdict, 'bug');
  assert.equal(result.violation.id, 'look');
  assert.ok(trace.entries.some((e) => e.t === 'shot' && e.outcome === 'mismatch'));
});

test('исключение в проверке проекта — bot-error', async () => {
  const adapter = toyAdapter({ checks: [{ id: 'boom', kind: 'invariant', level: 'fact', check: () => { throw new Error('опечатка'); } }] });
  const { result } = await run({ adapter });
  assert.equal(result.verdict, 'bot-error');
  assert.match(result.violation.message, /опечатка/);
});

test('неверная вырезка проверки (adapterFault из onShot) — bot-error', async () => {
  const adapter = toyAdapter({ checks: [{ id: 'look', kind: 'expectation', level: 'pixel', within: 0, when: (p, c) => (c.x === 2 ? {} : null), region: () => ({ x: 0, y: 0, w: 0, h: 0 }) }] });
  const trace = createTrace();
  const rng = mulberry32(1);
  const result = await runAgent({ game: toyGame(), adapter, mission: { name: 'reach', params: {} }, policy: createPolicy('planned', rng), rng, limits: LIMITS, trace,
    onShot: async () => { const e = new Error('вырезка вне страницы или пустая'); e.adapterFault = true; throw e; } });
  assert.equal(result.verdict, 'bot-error');
});
