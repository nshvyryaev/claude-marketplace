import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectMatches, verdictClass, summarizeSoak, exitCodeRun, exitCodeSoak, compareTraces, formatRunLine, mergeCoverage, coveredRuns } from '../scripts/lib/report.mjs';

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

import { runOk, formatCoverage } from '../scripts/lib/report.mjs';

test('зелёный — только вердикт по expect, требования подтверждены и нечего осматривать', () => {
  const base = { verdict: 'pass', frame: 10, unmet: [], needsReview: 0 };
  assert.equal(runOk(base, { verdict: 'pass' }), true);
  assert.equal(runOk({ ...base, unmet: ['x'] }, { verdict: 'pass' }), false);
  assert.equal(runOk({ ...base, needsReview: 1 }, { verdict: 'pass' }), false);
});

test('покрытие печатает ожидания, требования и осмотр', () => {
  const lines = formatCoverage({
    coverage: [
      { id: 'a', kind: 'expectation', level: 'fact', armed: 2, confirmed: 2, missed: 0, unfinished: 0, pendingReview: 0 },
      { id: 'b', kind: 'expectation', level: 'pixel', armed: 1, confirmed: 0, missed: 0, unfinished: 0, pendingReview: 1 },
      { id: 'inv', kind: 'invariant', level: 'fact', steps: 30 },
    ],
    unmet: ['c'], needsReview: 1, review: [{ id: 'g', n: 1, file: 'review/g-1.png' }], dir: 'tmp/bot/r',
  });
  const text = lines.join(String.fromCharCode(10));
  assert.ok(text.includes('a 2/2'), text);
  assert.ok(text.includes('b 0/1') && text.includes('pixel'), text);
  assert.match(text, /не проверено: c/);
  assert.match(text, /на осмотр/);
});

test('покрытие: засчитываются только текущий адаптер и существующие прогоны', () => {
  const inv = (id, steps) => ({ id, kind: 'invariant', steps });
  const exp = (id, confirmed) => ({ id, kind: 'expectation', confirmed, pendingReview: 0 });
  let data = mergeCoverage({}, [{ name: 'a', verdict: 'pass', coverage: [inv('i', 5), exp('e', 1)] }], 'h1');
  data = mergeCoverage(data, [{ name: 'gone', verdict: 'pass', coverage: [exp('e', 2)] }], 'h1');
  data = mergeCoverage(data, [{ name: 'b', verdict: 'error', coverage: [exp('e', 3)] }], 'h1');
  assert.deepEqual(coveredRuns(data, 'e', 'h1', ['a', 'b']), ['a'], 'прогона gone нет, b — error');
  assert.deepEqual(coveredRuns(data, 'i', 'h1', ['a']), ['a']);
  assert.deepEqual(coveredRuns(data, 'e', 'h2', ['a']), [], 'снято другим адаптером');
  assert.deepEqual(coveredRuns({ e: { a: 4 } }, 'e', 'h1', ['a']), [], 'старый формат без адаптера');
});

test('прогон, которому не хватает только осмотра вырезок, помечен отдельно', () => {
  const base = { name: 'r', verdict: 'pass', frame: 10, goals: 1, coverage: [], unmet: [], dir: 'd', expect: { verdict: 'pass' } };
  const review = { ...base, needsReview: 2 };
  review.ok = runOk(review, { verdict: 'pass' });
  assert.equal(review.ok, false);
  assert.match(formatRunLine(review), /^\? pass .*\[осмотр\]/);
  const bad = { ...base, verdict: 'bug', needsReview: 2 };
  bad.ok = runOk(bad, { verdict: 'pass' });
  assert.match(formatRunLine(bad), /^✗/);
});

test('отчёт называет эталоны, удалённые при принятии', () => {
  const lines = formatCoverage({ coverage: [], pruned: ['look-7.png'], dir: 'd' });
  assert.ok(lines.some((l) => /удалены лишние эталоны: look-7\.png/.test(l)), lines.join('\n'));
});
