import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, botSeed, pickIndex } from '../scripts/lib/rng.mjs';

test('одинаковый seed — одинаковая последовательность', () => {
  const a = mulberry32(42); const b = mulberry32(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('разные seed — разные последовательности', () => {
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('значения в [0, 1)', () => {
  const r = mulberry32(7);
  for (let i = 0; i < 1000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); }
});

test('поток бота не совпадает с потоком игры при том же seed', () => {
  assert.notEqual(mulberry32(42)(), mulberry32(botSeed(42))());
});

test('pickIndex не выходит за границы', () => {
  const r = mulberry32(3);
  for (let i = 0; i < 500; i++) { const k = pickIndex(r, 5); assert.ok(k >= 0 && k < 5 && Number.isInteger(k)); }
});
