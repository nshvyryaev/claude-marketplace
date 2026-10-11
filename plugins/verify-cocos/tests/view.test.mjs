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

test('весь кадр (Show All): поля по бокам и сверху-снизу, масштаб одинаковый по осям', () => {
  // 780×360: масштаб 0,5, кадр 640×360 по центру, поля по 70 px слева и справа.
  assert.deepEqual(mapRect({ x: 0, y: 0, w: 1280, h: 720 }, canvas, { left: 0, top: 0, width: 780, height: 360 }), { x: 70, y: 0, width: 640, height: 360 });
  assert.deepEqual(mapRect({ x: 1180, y: 0, w: 100, h: 100 }, canvas, { left: 0, top: 0, width: 780, height: 360 }), { x: 660, y: 310, width: 50, height: 50 });
  // 640×400: масштаб 0,5, поля по 20 px сверху и снизу.
  assert.deepEqual(mapRect({ x: 0, y: 700, w: 100, h: 20 }, canvas, { left: 0, top: 0, width: 640, height: 400 }), { x: 0, y: 20, width: 50, height: 10 });
});
