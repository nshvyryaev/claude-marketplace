import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectMatches, verdictClass, summarizeSoak, exitCodeRun, exitCodeSoak, compareTraces, formatRunLine } from '../scripts/lib/report.mjs';

test('expect: точный вердикт, список допустимых, лимит кадров', () => {
  assert.ok(expectMatches({ verdict: 'pass', frame: 100 }, { verdict: 'pass' }));
  assert.ok(!expectMatches({ verdict: 'lose', frame: 100 }, { verdict: 'pass' }));
  assert.ok(expectMatches({ verdict: 'lose', frame: 1 }, { verdictIn: ['lose', 'timeout'] }));
  assert.ok(!expectMatches({ verdict: 'pass', frame: 500 }, { verdict: 'pass', maxFrames: 400 }));
});

test('классы вердиктов разделяют игру, бота и среду', () => {
  assert.equal(verdictClass('bug'), 'игра');
  assert.equal(verdictClass('bot-stuck'), 'бот');
  assert.equal(verdictClass('bot-error'), 'бот');
  assert.equal(verdictClass('timeout'), 'бот');
  assert.equal(verdictClass('error'), 'среда');
  assert.equal(verdictClass('pass'), '—');
});

test('soak группирует баги по оракулу', () => {
  const results = [
    { name: 'a', verdict: 'bug', violation: { id: 'x' } },
    { name: 'b', verdict: 'bug', violation: { id: 'x' } },
    { name: 'c', verdict: 'bug', violation: { id: 'y' } },
    { name: 'd', verdict: 'lose' },
  ];
  const summary = summarizeSoak(results);
  assert.deepEqual(summary.byVerdict, { bug: 3, lose: 1 });
  assert.deepEqual(summary.bugs, [{ oracle: 'x', count: 2, runs: ['a', 'b'] }, { oracle: 'y', count: 1, runs: ['c'] }]);
});

test('коды возврата: run — по expect, soak — по багам и среде', () => {
  assert.equal(exitCodeRun([{ ok: true }, { ok: true }]), 0);
  assert.equal(exitCodeRun([{ ok: true }, { ok: false }]), 1);
  assert.equal(exitCodeSoak([{ verdict: 'lose' }, { verdict: 'bot-stuck' }]), 0);
  assert.equal(exitCodeSoak([{ verdict: 'bug' }]), 1);
  assert.equal(exitCodeSoak([{ verdict: 'error' }]), 1);
});

test('сравнение журналов находит первую расходящуюся строку', () => {
  assert.equal(compareTraces(['a', 'b'], ['a', 'b']), null);
  assert.deepEqual(compareTraces(['a', 'b', 'c'], ['a', 'x', 'c']), { line: 2, expected: 'b', actual: 'x' });
  assert.deepEqual(compareTraces(['a', 'b'], ['a']), { line: 2, expected: 'b', actual: '(конец)' });
});

test('prefix: остановленный replay сверяется без своей последней строки', () => {
  const stopped = ['a', 'b', '{"t":"end","verdict":"stopped"}'];
  assert.equal(compareTraces(['a', 'b', 'c', 'd'], stopped, { prefix: true }), null);
});

test('строка отчёта содержит вердикт, имя, нарушение и каталог', () => {
  const line = formatRunLine({ ok: false, name: 'r1', verdict: 'bug', frame: 10, goals: 2, summary: 'захват 12%', violation: { id: 'x', message: 'плохо' }, dir: 'tmp/bot/r1' });
  assert.match(line, /bug/); assert.match(line, /r1/); assert.match(line, /x: плохо/); assert.match(line, /tmp\/bot\/r1/);
});

import { safeSummary, startDifferences } from '../scripts/lib/report.mjs';

test('упавший summary адаптера не роняет отчёт', () => {
  assert.equal(safeSummary({ summary: () => 'ок' }, {}), 'ок');
  assert.match(safeSummary({ summary: () => { throw new Error('опечатка'); } }, {}), /summary упал: опечатка/);
  assert.equal(safeSummary({}, {}), '');
  assert.equal(safeSummary({ summary: () => 'x' }, null), '');
});

test('replay называет всё, что изменилось с исходного прогона, кроме самого прогона', () => {
  const was = { t: 'start', seed: 1, adapter: 'a1', env: { plugin: '0.1.0', build: 'b1', fps: 60, limits: { maxFrames: 10 } } };
  assert.deepEqual(startDifferences(was, was), []);
  const now = { ...was, adapter: 'a2', env: { ...was.env, build: 'b2', limits: { maxFrames: 20 } } };
  assert.deepEqual(startDifferences(was, now).sort(), ['adapter', 'env.build', 'env.limits']);
});

test('строка start не мешает сравнению журналов: расхождение ищется с тела', () => {
  const a = ['{"t":"start","adapter":"a1"}', 'x', 'y'];
  const b = ['{"t":"start","adapter":"a2"}', 'x', 'z'];
  assert.deepEqual(compareTraces(a.slice(1), b.slice(1)), { line: 2, expected: 'y', actual: 'z' });
});
