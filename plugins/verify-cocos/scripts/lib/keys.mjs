// Ввод идёт настоящим путём браузера — Input.dispatchKeyEvent, — а не записью
// в компоненты игры: так проверяется и обработка клавиш, и блокировки ввода.
export const KEYS = {
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
};

const params = (type, { key, code, keyCode }) => ({
  type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
});

export function keyEvents(op) {
  const key = KEYS[op?.key];
  if (!key) throw new Error(`Неизвестная клавиша в действии моста: ${op?.key}`);
  if (op.type === 'keyDown') return [params('keyDown', key)];
  if (op.type === 'keyUp') return [params('keyUp', key)];
  if (op.type === 'press') return [params('keyDown', key), params('keyUp', key)];
  throw new Error(`Неизвестный тип ввода в действии моста: ${op.type}`);
}

export async function dispatchOps(cdp, ops) {
  for (const op of ops) {
    for (const event of keyEvents(op)) await cdp.send('Input.dispatchKeyEvent', event);
  }
}
