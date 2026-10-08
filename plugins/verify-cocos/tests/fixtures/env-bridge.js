// Мост для проверок окружения: act() возвращает операции из действия как есть,
// observe() — то, что видит страница (часы, сеть, размер, URL, хранилище).
(() => {
  let resizes = 0;
  let offlineEvents = 0;
  window.addEventListener('resize', () => { resizes++; });
  window.addEventListener('offline', () => { offlineEvents++; });
  window.__bot = {
    whenBooted: () => new Promise((resolve) => { const tick = () => (window.toy ? resolve(true) : setTimeout(tick, 20)); tick(); }),
    preload: async () => true,
    start: () => { window.toy.x = 0; return true; },
    ready: () => window.toy.frame > 0,
    observe: async () => ({
      x: window.toy.x,
      now: Date.now(),
      date: new Date().getTime(),
      isDate: new Date() instanceof Date,
      hours: new Date(Date.now()).getHours(),
      onLine: navigator.onLine,
      offlineEvents,
      fetch: await fetch('index.html').then((r) => r.status, () => 'fail'),
      // Не сборка (`probe` прогона — другой сервер): «нет сети» отрезает только его.
      remote: window.__botRun && window.__botRun.probe
        ? await fetch(window.__botRun.probe, { mode: 'no-cors', cache: 'no-store' }).then(() => 'ok', () => 'fail')
        : null,
      size: [innerWidth, innerHeight],
      resizes,
      portrait: matchMedia('(orientation: portrait)').matches,
      search: location.search,
      run: window.__botRun,
      stored: localStorage.getItem('env-bridge'),
    }),
    actions: () => [],
    act: (action) => {
      if (action && action.store) localStorage.setItem('env-bridge', action.store);
      return (action && action.ops) || [];
    },
    frameEvents: () => [],
  };
})();
