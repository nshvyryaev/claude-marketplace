import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCheckRunner, unmetRequires, validateChecks } from '../scripts/lib/checks.mjs';

const at = (frame) => ({ frame });
const byId = (cov, id) => cov.find((c) => c.id === id);

test('инвариант считается на каждом шаге и даёт нарушение', () => {
  const r = createCheckRunner([{ id: 'x', kind: 'invariant', level: 'fact', check: (p, c) => (c.v < 0 ? { message: 'минус' } : null) }]);
  assert.equal(r.observe({ v: 1 }, { v: 1 }, [], at(1)).violation, null);
  const out = r.observe({ v: 1 }, { v: -1 }, [], at(2));
  assert.deepEqual(out.violation, { id: 'x', message: 'минус', data: null });
  assert.equal(byId(r.finish(), 'x').steps, 2);
});

test('fact: взведено → подтверждено в пределах within', () => {
  const r = createCheckRunner([{ id: 'e', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? { at: c.f } : null), then: (c) => c.b, within: 3 }]);
  const arm = r.observe({}, { a: true, f: 1 }, [], at(1));
  assert.deepEqual(arm.log.map((l) => l.t), ['arm']);
  assert.equal(r.observe({}, { b: false }, [], at(2)).violation, null);
  const ok = r.observe({}, { b: true }, [], at(3));
  assert.deepEqual(ok.log.map((l) => l.t), ['confirm']);
  assert.deepEqual(byId(r.finish(), 'e'), { id: 'e', kind: 'expectation', level: 'fact', steps: 0, armed: 1, confirmed: 1, missed: 0, cancelled: 0, unfinished: 0, pendingReview: 0 });
});

test('fact: подтверждение в том же наблюдении, где взведено', () => {
  const r = createCheckRunner([{ id: 'e', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? {} : null), then: (c) => c.a, within: 0 }]);
  r.observe({}, { a: true }, [], at(5));
  assert.equal(byId(r.finish(), 'e').confirmed, 1);
});

test('fact: не наступило за within — нарушение с данными триггера', () => {
  const r = createCheckRunner([{ id: 'e', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? { k: 7 } : null), then: () => false, within: 2 }]);
  r.observe({}, { a: true }, [], at(10));
  assert.equal(r.observe({}, {}, [], at(11)).violation, null);
  const out = r.observe({}, {}, [], at(12));
  assert.equal(out.violation.id, 'e');
  assert.match(out.violation.message, /2 кадр/);
  assert.deepEqual(out.violation.data, { k: 7 });
});

test('несколько экземпляров одного ожидания живут отдельно', () => {
  let n = 0;
  const r = createCheckRunner([{ id: 'e', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? { n: ++n } : null), then: (c, ev, t) => c.ok === t.n, within: 10 }]);
  r.observe({}, { a: true }, [], at(1));
  r.observe({}, { a: true }, [], at(2));
  r.observe({}, { ok: 2 }, [], at(3));
  r.observe({}, { ok: 1 }, [], at(4));
  assert.equal(byId(r.finish(), 'e').confirmed, 2);
});

test('прогон кончился до срока — «не дождался», не нарушение', () => {
  const r = createCheckRunner([{ id: 'e', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? {} : null), then: () => false, within: 50 }]);
  r.observe({}, { a: true }, [], at(1));
  const cov = byId(r.finish(), 'e');
  assert.equal(cov.unfinished, 1);
  assert.equal(cov.missed, 0);
  assert.deepEqual(unmetRequires([cov], ['e']), ['e']);
});

test('nextDeadline — кадры до ближайшего срока', () => {
  const r = createCheckRunner([
    { id: 'a', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? {} : null), then: () => false, within: 8 },
    { id: 'b', kind: 'expectation', level: 'pixel', when: (p, c) => (c.b ? {} : null), region: () => ({ x: 0, y: 0, w: 1, h: 1 }), within: 3 },
  ]);
  assert.equal(r.nextDeadline(0), Infinity);
  r.observe({}, { a: true, b: true }, [], at(10));
  assert.equal(r.nextDeadline(10), 3);
  assert.equal(r.nextDeadline(12), 1);
});

test('pixel и agent: по сроку — запрос вырезки; исход решает resolveShot', () => {
  const r = createCheckRunner([
    { id: 'p', kind: 'expectation', level: 'pixel', when: (p, c) => (c.go ? { at: 1 } : null), region: (c, t) => ({ x: 1, y: 2, w: 3, h: 4 }), within: 2 },
    { id: 'g', kind: 'expectation', level: 'agent', when: (p, c) => (c.go ? {} : null), region: () => ({ x: 0, y: 0, w: 5, h: 5 }), within: 0, criterion: 'смотрится' },
  ]);
  const first = r.observe({}, { go: true }, [], at(1));
  assert.deepEqual(first.shots.map((s) => s.id), ['g']);
  assert.equal(first.shots[0].criterion, 'смотрится');
  assert.deepEqual(r.observe({}, {}, [], at(2)).shots, []);
  const later = r.observe({}, {}, [], at(3));
  assert.deepEqual(later.shots, [{ id: 'p', n: 1, level: 'pixel', region: { x: 1, y: 2, w: 3, h: 4 }, criterion: null, trigger: { at: 1 } }]);
  r.resolveShot('p', 'match');
  r.resolveShot('g', 'review');
  const cov = r.finish();
  assert.equal(byId(cov, 'p').confirmed, 1);
  assert.equal(byId(cov, 'g').pendingReview, 1);
  assert.deepEqual(unmetRequires(cov, ['p', 'g']), []);
});

test('mismatch засчитывается как промах', () => {
  const r = createCheckRunner([{ id: 'p', kind: 'expectation', level: 'pixel', when: (p, c) => (c.go ? {} : null), region: () => ({ x: 0, y: 0, w: 1, h: 1 }), within: 0 }]);
  r.observe({}, { go: true }, [], at(1));
  r.resolveShot('p', 'mismatch');
  assert.equal(byId(r.finish(), 'p').missed, 1);
});

test('неверная форма проверки — ошибка с id', () => {
  assert.throws(() => validateChecks([{ id: 'a', kind: 'invariant', level: 'fact', check: () => null }, { id: 'a', kind: 'invariant', level: 'fact', check: () => null }]), /a.*дважды/);
  assert.throws(() => validateChecks([{ id: 'b', kind: 'expectation', level: 'fact', when: () => null, within: 1 }]), /b.*then/);
  assert.throws(() => validateChecks([{ id: 'c', kind: 'expectation', level: 'pixel', when: () => null, within: 1 }]), /c.*region/);
  assert.throws(() => validateChecks([{ id: 'd', kind: 'expectation', level: 'fact', when: () => null, then: () => true, within: -1 }]), /d.*within/);
  assert.throws(() => validateChecks([{ id: 'e', kind: 'rule', level: 'fact' }]), /e.*kind/);
});

test('требование к инварианту выполнено, если он проверялся хоть раз', () => {
  assert.deepEqual(unmetRequires([{ id: 'inv', kind: 'invariant', level: 'fact', steps: 3, confirmed: 0 }], ['inv']), []);
  assert.deepEqual(unmetRequires([{ id: 'inv', kind: 'invariant', level: 'fact', steps: 0, confirmed: 0 }], ['inv']), ['inv']);
});

test('then может снять ожидание: снятое не подтверждение и не нарушение', () => {
  const r = createCheckRunner([{ id: 'e', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? {} : null), then: (c) => (c.cancel ? 'cancel' : false), within: 5 }]);
  r.observe({}, { a: true }, [], at(1));
  const out = r.observe({}, { cancel: true }, [], at(2));
  assert.deepEqual(out.log.map((l) => l.t), ['cancel']);
  const cov = r.finish().find((c) => c.id === 'e');
  assert.equal(cov.confirmed, 0);
  assert.equal(cov.cancelled, 1);
  assert.deepEqual(unmetRequires([cov], ['e']), ['e']);
});

test('инвариант с applies считает только применимые шаги', () => {
  const r = createCheckRunner([{ id: 'inv', kind: 'invariant', level: 'fact', applies: (p, c) => !!c.on, check: () => null }]);
  r.observe({}, {}, [], at(1));
  assert.deepEqual(unmetRequires(r.finish(), ['inv']), ['inv'], 'ситуация не возникла — не проверено');
  const r2 = createCheckRunner([{ id: 'inv', kind: 'invariant', level: 'fact', applies: (p, c) => !!c.on, check: () => null }]);
  r2.observe({}, { on: true }, [], at(1));
  assert.deepEqual(unmetRequires(r2.finish(), ['inv']), []);
});
