// Игрушечная игра без браузера: точка на прямой идёт к цели.
// Событие 'bump' — на каждой клетке, кратной 3; 'reached' — в цели.
export function toyGame({ target = 5, errorsAfterStep = null } = {}) {
  let x = 0; let dir = 0; let steps = 0;
  return {
    get x() { return x; },
    observe: async () => ({ x, target }),
    actions: async () => [{ dir: 1 }, { dir: -1 }, { dir: 0 }],
    act: async (action) => { dir = action?.dir ?? 0; return []; },
    step: async (n) => {
      steps++;
      for (let i = 1; i <= n; i++) {
        x += dir;
        const events = [];
        if (dir !== 0 && x % 3 === 0) events.push({ type: 'bump', x });
        if (x === target) events.push({ type: 'reached' });
        if (events.length) return { frames: i, events };
      }
      return { frames: n, events: [] };
    },
    errors: () => (errorsAfterStep !== null && steps >= errorsAfterStep ? [{ kind: 'console', text: 'boom' }] : []),
  };
}

export function toyAdapter(overrides = {}) {
  const walk = (dir) => ({ next: () => ({ action: { dir }, frames: 2 }) });
  return {
    toModel: (raw) => ({ ...raw }),
    progress: (m) => m.x,
    missions: { reach: { done: (m) => m.x === m.target } },
    candidates: () => [
      { kind: 'right', id: 'go-right', score: 1, params: {}, done: (m) => m.x === m.target, failed: () => false },
      { kind: 'left', id: 'go-left', score: 0.1, params: {}, done: () => false, failed: () => false },
    ],
    replanOn: ['bump'],
    tactics: { right: walk(1), left: walk(-1), idle: walk(0) },
    checks: [{ id: 'x-nonneg', kind: 'invariant', level: 'fact', check: (prev, cur) => (cur.x < 0 ? { message: `x=${cur.x}`, data: { x: cur.x } } : null) }],
    summary: (m) => `x=${m.x}`,
    ...overrides,
  };
}

export const LIMITS = { maxFrames: 1000, stallFrames: 500, goalTimeoutFrames: 100, maxGoalFailures: 3, randomActionFrames: 4 };
