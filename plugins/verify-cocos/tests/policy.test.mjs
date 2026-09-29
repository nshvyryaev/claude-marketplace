import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePattern, createChooser, createPolicy, policySlug } from '../scripts/lib/policy.mjs';
import { mulberry32 } from '../scripts/lib/rng.mjs';

const take = (choose, n) => Array.from({ length: n }, () => choose());

test('строковые формы разбираются', () => {
  assert.deepEqual(parsePattern('planned'), { pattern: 'planned' });
  assert.deepEqual(parsePattern('random'), { pattern: 'random' });
  assert.deepEqual(parsePattern('every:3'), { pattern: 'every', n: 3 });
  assert.deepEqual(parsePattern('burst:30/10'), { pattern: 'burst', planned: 30, random: 10 });
  assert.deepEqual(parsePattern('chance:0.25'), { pattern: 'chance', p: 0.25 });
  assert.deepEqual(parsePattern({ pattern: 'every', n: 2 }), { pattern: 'every', n: 2 });
});

test('опечатка и недопустимые числа — ошибка с названием паттерна', () => {
  assert.throws(() => parsePattern('evry:2'), /Неизвестный паттерн: evry:2/);
  assert.throws(() => parsePattern('every:0'), /every:0/);
  assert.throws(() => parsePattern('chance:1.5'), /chance:1.5/);
  assert.throws(() => parsePattern('burst:0/0'), /burst:0\/0/);
});

test('every n — каждый n-й выбор случайный', () => {
  assert.deepEqual(take(createChooser('every:3', mulberry32(1)), 6),
    ['planned', 'planned', 'random', 'planned', 'planned', 'random']);
});

test('burst — K по плану, M случайно, по кругу', () => {
  assert.deepEqual(take(createChooser('burst:2/1', mulberry32(1)), 6),
    ['planned', 'planned', 'random', 'planned', 'planned', 'random']);
});

test('planned и random — без исключений', () => {
  assert.ok(take(createChooser('planned', mulberry32(1)), 20).every((v) => v === 'planned'));
  assert.ok(take(createChooser('random', mulberry32(1)), 20).every((v) => v === 'random'));
});

test('chance — доля случайных близка к p и воспроизводима', () => {
  const a = take(createChooser('chance:0.3', mulberry32(9)), 2000);
  const b = take(createChooser('chance:0.3', mulberry32(9)), 2000);
  assert.deepEqual(a, b);
  const share = a.filter((v) => v === 'random').length / a.length;
  assert.ok(share > 0.25 && share < 0.35, `доля ${share}`);
});

test('строка политики задаёт оба уровня, объект — раздельно', () => {
  const both = createPolicy('random', mulberry32(1));
  assert.equal(both.goal(), 'random'); assert.equal(both.action(), 'random');
  const split = createPolicy({ goal: 'planned', action: 'random' }, mulberry32(1));
  assert.equal(split.goal(), 'planned'); assert.equal(split.action(), 'random');
});

test('slug пригоден для имени каталога', () => {
  assert.equal(policySlug('burst:30/10'), 'burst-30-10');
  assert.equal(policySlug({ goal: 'planned', action: 'every:2' }), 'g-planned_a-every-2');
});
