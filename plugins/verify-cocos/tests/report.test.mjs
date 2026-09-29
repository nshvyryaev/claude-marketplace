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
