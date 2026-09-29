import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRect } from '../scripts/lib/view.mjs';

const canvas = { x: 0, y: 0, w: 1280, h: 720 };

test('мировой прямоугольник → CSS px: Y переворачивается, масштаб по элементу', () => {
  assert.deepEqual(mapRect({ x: 0, y: 700, w: 100, h: 20 }, canvas, { left: 0, top: 0, width: 1280, height: 720 }), { x: 0, y: 0, width: 100, height: 20 });
  assert.deepEqual(mapRect({ x: 640, y: 0, w: 64, h: 36 }, canvas, { left: 10, top: 20, width: 640, height: 360 }), { x: 330, y: 362, width: 32, height: 18 });
});

test('канвас со смещённым началом мировых координат', () => {
  assert.deepEqual(mapRect({ x: -640, y: -360, w: 1280, h: 720 }, { x: -640, y: -360, w: 1280, h: 720 }, { left: 0, top: 0, width: 1280, height: 720 }), { x: 0, y: 0, width: 1280, height: 720 });
});
