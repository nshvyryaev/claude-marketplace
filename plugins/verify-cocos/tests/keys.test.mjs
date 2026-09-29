import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyEvents, dispatchOps } from '../scripts/lib/keys.mjs';

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
