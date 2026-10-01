// Ввод идёт настоящим путём браузера — Input.dispatchKeyEvent и
// Input.dispatchTouchEvent, — а не записью в компоненты игры: так проверяется и
// обработка ввода, и его блокировки.
export const KEYS = {
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
};

// Неисполнимый ввод — ошибка моста проекта, а не игры: агент даёт bot-error.
function adapterFault(message) {
  const error = new Error(message);
  error.adapterFault = true;
  return error;
}

const params = (type, { key, code, keyCode }) => ({
  type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
});

export function keyEvents(op) {
  const key = KEYS[op?.key];
  if (!key) throw adapterFault(`Неизвестная клавиша в действии моста: ${op?.key}`);
  if (op.type === 'keyDown') return [params('keyDown', key)];
  if (op.type === 'keyUp') return [params('keyUp', key)];
  if (op.type === 'press') return [params('keyDown', key), params('keyUp', key)];
  throw adapterFault(`Неизвестный тип ввода в действии моста: ${op.type}`);
}

// Касание одним пальцем: x, y — CSS px страницы. touchEnd без точек — палец
// поднят. Игра видит касания, только если прогон включил эмуляцию тача
// (`touch: true`): Cocos подписывается на них по признаку при загрузке.
const TOUCH = new Set(['touchStart', 'touchMove', 'touchEnd']);

export function touchEvent(op) {
  if (op.type === 'touchEnd') return { type: 'touchEnd', touchPoints: [] };
  if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) {
    throw adapterFault(`Касание без координат в действии моста: ${JSON.stringify(op)}`);
  }
  return { type: op.type, touchPoints: [{ x: op.x, y: op.y, id: 0 }] };
}

export async function dispatchOps(cdp, ops) {
  for (const op of ops) {
    if (TOUCH.has(op?.type)) {
      await cdp.send('Input.dispatchTouchEvent', touchEvent(op));
      continue;
    }
    for (const event of keyEvents(op)) await cdp.send('Input.dispatchKeyEvent', event);
  }
}
