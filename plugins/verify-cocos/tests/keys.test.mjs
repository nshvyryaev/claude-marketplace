import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyEvents, touchEvent, dispatchOps } from '../scripts/lib/keys.mjs';

test('press — нажатие и отпускание с кодом клавиши', () => {
  const events = keyEvents({ type: 'press', key: 'ArrowUp' });
  assert.deepEqual(events.map((e) => e.type), ['keyDown', 'keyUp']);
  assert.equal(events[0].windowsVirtualKeyCode, 38);
  assert.equal(events[0].code, 'ArrowUp');
});

test('пробел — key " ", code Space', () => {
  const [down] = keyEvents({ type: 'keyDown', key: 'Space' });
  assert.equal(down.key, ' ');
  assert.equal(down.code, 'Space');
  assert.equal(down.windowsVirtualKeyCode, 32);
});

test('неизвестная клавиша или тип — ошибка с названием', () => {
  assert.throws(() => keyEvents({ type: 'keyDown', key: 'KeyQ' }), /KeyQ/);
  assert.throws(() => keyEvents({ type: 'tap', key: 'Space' }), /tap/);
});

test('dispatchOps шлёт события по порядку', async () => {
  const sent = [];
  await dispatchOps({ send: async (method, params) => sent.push([method, params.type, params.code]) },
    [{ type: 'keyUp', key: 'ArrowLeft' }, { type: 'keyDown', key: 'ArrowUp' }]);
  assert.deepEqual(sent, [['Input.dispatchKeyEvent', 'keyUp', 'ArrowLeft'], ['Input.dispatchKeyEvent', 'keyDown', 'ArrowUp']]);
});

test('ошибка неизвестной клавиши помечена как ошибка адаптера', () => {
  try { keyEvents({ type: 'keyDown', key: 'KeyQ' }); assert.fail('не бросило'); } catch (error) { assert.equal(error.adapterFault, true); }
});

test('касание — одна точка в CSS px, touchEnd без точек', () => {
  assert.deepEqual(touchEvent({ type: 'touchStart', x: 10, y: 20 }), { type: 'touchStart', touchPoints: [{ x: 10, y: 20, id: 0 }] });
  assert.deepEqual(touchEvent({ type: 'touchMove', x: 11, y: 21 }).touchPoints, [{ x: 11, y: 21, id: 0 }]);
  assert.deepEqual(touchEvent({ type: 'touchEnd' }), { type: 'touchEnd', touchPoints: [] });
});

test('касание без координат — ошибка адаптера', () => {
  try { touchEvent({ type: 'touchMove', x: 1 }); assert.fail('не бросило'); } catch (error) { assert.equal(error.adapterFault, true); }
});

test('dispatchOps шлёт касания и клавиши вперемешку по порядку', async () => {
  const sent = [];
  await dispatchOps({ send: async (method, params) => sent.push([method, params.type]) },
    [{ type: 'touchStart', x: 1, y: 2 }, { type: 'press', key: 'Space' }, { type: 'touchEnd' }]);
  assert.deepEqual(sent, [
    ['Input.dispatchTouchEvent', 'touchStart'], ['Input.dispatchKeyEvent', 'keyDown'],
    ['Input.dispatchKeyEvent', 'keyUp'], ['Input.dispatchTouchEvent', 'touchEnd'],
  ]);
});
