(() => {
  window.__bot = {
    whenBooted: () => new Promise((resolve) => { const tick = () => (window.toy ? resolve(true) : setTimeout(tick, 20)); tick(); }),
    preload: async () => true,
    start: () => true,
    ready: () => true,
    observe: () => ({ run: window.__botRun, size: [innerWidth, innerHeight] }),
    actions: () => [],
    act: () => [],
    frameEvents: () => [],
  };
  // В игрушке нет cc: вырезка задаётся прямо в CSS px страницы.
  window.__botView.pageRect = (r) => ({ x: r.x, y: r.y, width: r.w, height: r.h });
})();
