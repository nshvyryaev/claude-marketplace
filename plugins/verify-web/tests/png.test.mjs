import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng, diffPng } from '../scripts/lib/png.mjs';

// Фикстуры — настоящие снимки Chrome 64x48: одна и та же страница с разной
// надписью. Синтетический PNG проверил бы только наш собственный кодировщик.
const fixtures = path.join(import.meta.dirname, '__fixtures__');
const shotA = readFileSync(path.join(fixtures, 'shot-a.png'));
const shotB = readFileSync(path.join(fixtures, 'shot-b.png'));

test('разбирает снимок Chrome в RGBA нужного размера', () => {
  const decoded = decodePng(shotA);
  assert.equal(decoded.width, 64);
  assert.equal(decoded.height, 48);
  assert.equal(decoded.pixels.length, 64 * 48 * 4);
});

test('сборка и разбор возвращают те же пиксели', () => {
  const decoded = decodePng(shotA);
  const again = decodePng(encodePng(decoded));
  assert.equal(again.width, decoded.width);
  assert.ok(again.pixels.equals(decoded.pixels));
});

test('снимок не отличается сам от себя', () => {
  const result = diffPng(shotA, shotA);
  assert.equal(result.differing, 0);
  assert.equal(result.ratio, 0);
});

test('разные надписи дают ненулевой диф и картинку', () => {
  const result = diffPng(shotA, shotB);
  assert.ok(result.differing > 0, 'ожидались отличающиеся пиксели');
  assert.ok(result.ratio < 0.2, 'отличаться должна надпись, а не весь экран');
  assert.ok(result.image, 'диф должен вернуть картинку');
  assert.equal(decodePng(result.image).width, 64);
});

test('порог гасит отличия ниже него', () => {
  const decoded = decodePng(shotA);
  const nudged = Buffer.from(decoded.pixels);
  for (let i = 0; i < nudged.length; i += 4) nudged[i] = Math.min(255, nudged[i] + 5);
  const shifted = encodePng({ width: decoded.width, height: decoded.height, pixels: nudged });
  assert.equal(diffPng(shotA, shifted, { threshold: 12 }).differing, 0);
  assert.ok(diffPng(shotA, shifted, { threshold: 1 }).differing > 0);
});

test('разный размер помечается отдельно, а не сравнивается', () => {
  const decoded = decodePng(shotA);
  const half = encodePng({
    width: decoded.width,
    height: 24,
    pixels: decoded.pixels.subarray(0, decoded.width * 24 * 4),
  });
  const result = diffPng(shotA, half);
  assert.equal(result.sameSize, false);
  assert.equal(result.ratio, 1);
  assert.equal(result.baselineSize, '64x48');
  assert.equal(result.currentSize, '64x24');
});
