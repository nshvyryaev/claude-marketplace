// Мост для проверок сервера прогона, подмены ответов и хранилища: act({ request })
// шлёт запрос (url с {api} — адрес из ?api=), observe() ждёт его итога и
// показывает хранилище, которое было до загрузки страницы.
(() => {
  const seenAtLoad = { local: { ...localStorage } };
  let pending = null;
  const apiBase = () => new URLSearchParams(location.search).get('api');
  window.__bot = {
    whenBooted: () => new Promise((resolve) => { const tick = () => (window.toy ? resolve(true) : setTimeout(tick, 20)); tick(); }),
    preload: async () => true,
    start: () => true,
    ready: () => window.toy.frame > 0,
    observe: async () => {
      const caches = {};
      for (const name of await window.caches.keys()) {
        const cache = await window.caches.open(name);
        caches[name] = {};
        for (const req of await cache.keys()) {
          const res = await cache.match(req);
          caches[name][req.url] = { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
        }
      }
      return { search: location.search, api: apiBase(), run: window.__botRun, seenAtLoad, caches, request: pending ? await pending : null };
    },
    actions: () => [],
    act: (action) => {
      if (action && action.request) {
        const { url, method = 'GET', json } = action.request;
        const init = { method, cache: 'no-store' };
        if (json !== undefined) { init.body = JSON.stringify(json); init.headers = { 'content-type': 'application/json' }; }
        pending = fetch(url.split('{api}').join(apiBase()), init).then(
          async (r) => ({ status: r.status, body: await r.text() }),
          (e) => ({ error: String(e && e.message) }),
        );
      }
      return (action && action.ops) || [];
    },
    frameEvents: () => [],
  };
})();
