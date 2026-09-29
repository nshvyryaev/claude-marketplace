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
  const result = await runAgent({ game, adapter, missionName: mission, policy: createPolicy(policy, rng), rng, limits: { ...LIMITS, ...limits }, trace });
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
