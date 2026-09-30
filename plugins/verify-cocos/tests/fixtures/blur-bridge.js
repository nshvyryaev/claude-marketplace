(() => {
  let last = 0;
  let held = false;
  window.__bot = {
    whenBooted: () => new Promise((resolve) => { const tick = () => (window.toy ? resolve(true) : setTimeout(tick, 20)); tick(); }),
    preload: async () => true,
    start: () => { window.toy.x = 0; last = 0; return true; },
    ready: () => window.toy.frame > 0,
    observe: () => ({ x: window.toy.x, t: window.toy.t, target: window.toy.target }),
    actions: () => [{ type: 'move', dir: 'right' }, { type: 'move', dir: 'none' }],
    act: (action) => {
      // Проверка восстановления фокуса: мост уводит его с канваса перед вводом.
      document.getElementById('GameCanvas').blur();
      const want = action?.dir === 'right';
      if (want === held) return [];
      held = want;
      return [{ type: want ? 'keyDown' : 'keyUp', key: 'ArrowRight' }];
    },
    frameEvents: () => {
      const events = window.toy.x === 5 && last !== 5 ? [{ type: 'five' }] : [];
      last = window.toy.x;
      return events;
    },
  };
})();
