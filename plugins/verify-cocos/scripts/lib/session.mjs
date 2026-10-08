// Сессия игры в headless Chrome: сервер сборки, shim и мост, ввод через CDP.
//
// Старт уровня идёт в два этапа. Сначала мост предзагружает ресурсы в
// свободном режиме — это недетерминированно и неважно. Затем цикл
// замораживается, PRNG пересевается, и уровень запускается кадр за кадром с
// паузой settleMs между кадрами: асинхронные загрузки успевают завершиться к
// одному и тому же кадру в каждом прогоне.
//
// Окружение прогона (env.mjs) — по выбору прогона: параметры URL, часы,
// часовой пояс, сеть, размер окна. Посреди прогона мост меняет его
// операциями act(): network, viewport, clock, reload.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchChrome } from '../vendor/cdp/chrome.mjs';
import { connect } from '../vendor/cdp/cdp.mjs';
import { serveDir } from './serve.mjs';
import { shimSource } from './shim.mjs';
import { viewSource } from './view.mjs';
import { dispatchOps } from './keys.mjs';
import { queryString, clockMs, networkParams, networkAt, viewportParams, timezoneId } from './env.mjs';

const ENV_OPS = new Set(['network', 'viewport', 'clock', 'reload']);
const ONLINE = networkParams('online');
const isOnline = (p) => !p.offline && p.latency === 0 && p.downloadThroughput === -1 && p.uploadThroughput === -1;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForBridge(cdp, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // __botLeaving — метка старой страницы перед перезапуском: её мост ещё
    // отвечает, пока новая не загрузилась.
    const ok = await cdp
      .evaluate(`location.href !== 'about:blank' && !window.__botLeaving && typeof window.__bot === 'object' && typeof window.__botShim === 'object'`)
      .catch(() => false);
    if (ok) return;
    await wait(100);
  }
  throw new Error('Игра не загрузилась: мост не появился на странице');
}

// Порт сервера сборки случаен, а стеки ошибок страницы содержат полный URL.
// В журнал он попадать не должен: replay прогона с ошибкой иначе расходился
// бы на строке нарушения при детерминированной игре.
export function normalizeOrigin(text, url) {
  return String(text).split(url).join('/');
}

export async function openSession({ root, config, seed, run = {}, env = {} }) {
  const server = await serveDir(path.resolve(root, config.build));
  let chrome = null;
  let cdp = null;
  const close = async () => {
    cdp?.close();
    await chrome?.close();
    await server.close();
  };

  // Окружение прогона. Без полей — ровно прежнее поведение.
  let query = '';
  let clock = null;
  let network = ONLINE;
  let networkReady = null;
  // Размер страницы — ровно viewport конфига (или прогона). --window-size
  // задаёт окно, а не область отрисовки: в headless она выходит другой, и
  // координаты вырезок и вид игры плыли бы от машины к машине.
  let baseViewport = { width: config.viewport.width, height: config.viewport.height, deviceScaleFactor: 1, mobile: false };
  let bridge = '';
  let scripts = [];
  let reloads = 0;
  let lastParams = {};
  let wentOffline = false;

  // Шим, вид, параметры прогона и мост — до загрузки каждой страницы. При
  // перезапуске они ставятся заново: у шима новые часы, у моста — номер
  // перезапуска в __botRun.reloads.
  const installScripts = async () => {
    for (const identifier of scripts) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    const runSeen = reloads > 0 ? { ...run, reloads } : run;
    const sources = [
      shimSource({ seed, fps: config.fps, clock }),
      viewSource(),
      // Параметры прогона (тема и т. п.) — до моста: он читает их при загрузке.
      `window.__botRun = ${JSON.stringify(runSeen)};`,
      bridge,
    ];
    scripts = [];
    for (const source of sources) scripts.push((await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier);
  };

  const boot = async () => {
    await waitForBridge(cdp, config.limits.bootTimeoutMs);
    await withTimeout(
      cdp.evaluate('window.__bot.whenBooted()'),
      config.limits.bootTimeoutMs,
      `Игра не загрузилась за ${config.limits.bootTimeoutMs} мс`,
    );
  };

  try {
    query = queryString(env.query);
    if (env.clock != null) clock = clockMs(env.clock);
    if (env.viewport) baseViewport = viewportParams(env.viewport);
    if (env.network != null) networkReady = { params: networkParams(env.network), at: networkAt(env.network) };
    bridge = await readFile(path.resolve(root, config.bridge), 'utf8');
    chrome = await launchChrome({
      width: config.viewport.width, height: config.viewport.height, scale: 1, prefix: 'verify-cocos-',
    });
    cdp = await connect(chrome.port);
    // Без эмуляции фокуса игра может поймать blur и уйти на паузу.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', baseViewport);
    if (env.timezone != null) await cdp.send('Emulation.setTimezoneOverride', { timezoneId: timezoneId(env.timezone) });
    // Касания (`touch` прогона): Cocos решает, слушать ли тач, при загрузке —
    // эмуляция включается до неё.
    if (run.touch) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await installScripts();
    await cdp.send('Page.navigate', { url: server.url + query });
    await boot();
  } catch (error) {
    await close();
    throw error;
  }

  // Каждый вызов страницы — под таймаутом: зависший мост или рендерер не
  // должен вешать прогон.
  const call = async (expression, what = expression.slice(0, 60)) => {
    try {
      return await withTimeout(cdp.evaluate(expression), config.limits.bootTimeoutMs, `страница не ответила за ${config.limits.bootTimeoutMs} мс: ${what}`);
    } catch (error) {
      error.message = normalizeOrigin(error.message, server.url);
      throw error;
    }
  };
  const json = (value) => JSON.stringify(value ?? null);

  // Смена окружения доходит до страницы событиями (resize, online/offline) в
  // её цикле отрисовки: ждём условия и два настоящих кадра, чтобы следующий
  // шаг игры видел уже новое окружение — одинаково в каждом прогоне.
  const settle = async (condition, what) => {
    const deadline = Date.now() + config.limits.bootTimeoutMs;
    while (condition && !(await call(condition, what))) {
      if (Date.now() > deadline) throw new Error(`окружение не применилось за ${config.limits.bootTimeoutMs} мс: ${what}`);
      await wait(10);
    }
    await call('window.__botShim.realFrame()', 'realFrame');
    await call('window.__botShim.realFrame()', 'realFrame');
  };

  let networkEnabled = false;
  const applyNetwork = async (params) => {
    // Без домена Network условия сети на запросы страницы не действуют.
    if (!networkEnabled) { await cdp.send('Network.enable'); networkEnabled = true; }
    await cdp.send('Network.emulateNetworkConditions', params);
    await settle(`navigator.onLine === ${!params.offline}`, 'network');
  };
  const setNetwork = async (params) => {
    network = params;
    if (params.offline) wentOffline = true;
    await applyNetwork(params);
  };
  const setViewport = async (params) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', params);
    // У телефона (mobile) размер окна ещё зависит от meta viewport страницы —
    // ждём экран эмуляции; без mobile экран остаётся настоящим — ждём окно.
    const [w, h] = params.mobile ? ['screen.width', 'screen.height'] : ['innerWidth', 'innerHeight'];
    await settle(`${w} === ${params.width} && ${h} === ${params.height}`, 'viewport');
  };

  // Запуск уровня из свободного режима: заморозка, пересев, кадры до ready.
  const start = async (params) => {
    lastParams = params;
    await call(`window.__bot.preload(${json(params)})`, 'preload');
    await call(`window.__botShim.freeze(); window.__botShim.reseed(${seed >>> 0}); true`);
    await call(`window.__bot.start(${json(params)})`);
    for (let i = 0; i < config.limits.startFrames; i++) {
      if (await call('window.__bot.ready()')) {
        // Cocos слушает клавиатуру на канвасе: без фокуса на нём клавиши
        // доходят до window, но не до cc.input.
        await call(`document.getElementById('GameCanvas')?.focus(); true`);
        // Ошибки загрузки (например, SDK платформы вне платформы) — не
        // предмет проверки: прогон судит только то, что было после старта.
        cdp.clearErrors();
        return;
      }
      await call('window.__botShim.step(1)');
      await wait(config.limits.settleMs);
    }
    throw new Error(`Уровень не стал готов за ${config.limits.startFrames} кадров`);
  };

  // Перезапуск страницы (B-4): хранилище (localStorage, IndexedDB, Cache API)
  // живёт в профиле Chrome и переживает его. Часы продолжаются с того же
  // Date.now(), seed тот же. Сборка грузится всегда: условия сети снимаются
  // на загрузку и возвращаются после неё — как в начале прогона.
  const reload = async (op) => {
    const nextQuery = op.query !== undefined ? queryString(op.query) : query;
    clock = await call('window.__botShim.wallNow()', 'wallNow');
    reloads++;
    await installScripts();
    if (!isOnline(network)) await cdp.send('Network.emulateNetworkConditions', ONLINE);
    await call('window.__botLeaving = true; true', 'leave');
    if (nextQuery !== query) {
      query = nextQuery;
      await cdp.send('Page.navigate', { url: server.url + query });
    } else {
      await cdp.send('Page.reload', {});
    }
    await boot();
    if (!isOnline(network)) await applyNetwork(network);
    await start(lastParams);
  };

  const envOp = async (op) => {
    if (op.type === 'network') {
      const { type, ...spec } = op;
      return setNetwork(networkParams(spec));
    }
    if (op.type === 'viewport') {
      // Без размеров — назад к размеру прогона (или конфига).
      if (op.width === undefined && op.height === undefined) return setViewport(baseViewport);
      return setViewport(viewportParams({ width: op.width, height: op.height, mobile: op.mobile ?? true }));
    }
    if (op.type === 'clock') return call(`window.__botShim.setClock(${clockMs(op.at)}); true`, 'clock');
    return reload(op);
  };

  return {
    async start(params) {
      // Сеть прогона: после загрузки движка, до preload ('boot'), или когда
      // уровень готов к вводу ('ready').
      const pending = networkReady;
      networkReady = null;
      if (pending?.at === 'boot') await setNetwork(pending.params);
      await start(params);
      if (pending?.at === 'ready') await setNetwork(pending.params);
    },
    observe: () => call('window.__bot.observe()'),
    actions: () => call('window.__bot.actions()'),
    async act(action) {
      const ops = (await call(`window.__bot.act(${json(action)})`)) ?? [];
      // Фокус может уйти с канваса посреди прогона (узлы HUD, оверлеи) — без
      // него клавиши не доходят до cc.input, и бот молча стоит на месте.
      let focus = true;
      for (const op of ops) {
        if (ENV_OPS.has(op?.type)) {
          await envOp(op);
          focus = true;
          continue;
        }
        if (focus) await call(`document.getElementById('GameCanvas')?.focus(); true`, 'focus');
        focus = false;
        await dispatchOps(cdp, [op]);
      }
      return ops;
    },
    step: (n) => call(`window.__botShim.stepUntilEvents(${Math.max(1, Math.floor(n))})`),
    // Отказ запроса из-за эмуляции «нет сети» Chrome пишет в журнал ошибкой —
    // это условие прогона, а не баг игры. Как игра переживает отказ, судят
    // проверки проекта.
    errors: () => cdp.errors
      .filter((e) => !(wentOffline && e.kind === 'log' && e.text.includes('ERR_INTERNET_DISCONNECTED')))
      .map((e) => ({ ...e, text: normalizeOrigin(e.text, server.url) })),
    async shot(region) {
      // Неверный region проекта — ошибка адаптера, а не страницы: иначе он ушёл
      // бы в исключение моста (bug игры) или NaN стал бы null и снял не то место.
      const valid = region && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(region[k])) && region.w > 0 && region.h > 0;
      if (!valid) {
        const error = new Error(`неверный region вырезки: ${JSON.stringify(region)}`);
        error.adapterFault = true;
        throw error;
      }
      const page = await call(`window.__botView.pageRect(${json(region)})`, 'pageRect');
      const size = await call('({ w: innerWidth, h: innerHeight })', 'viewport');
      // Вырезка обрезается границами страницы: объект у края поля — обычный
      // случай. Пустое пересечение — ошибка проверки проекта.
      const x0 = Math.max(0, Math.floor(page.x));
      const y0 = Math.max(0, Math.floor(page.y));
      const x1 = Math.min(size.w, Math.ceil(page.x + page.width));
      const y1 = Math.min(size.h, Math.ceil(page.y + page.height));
      if (!(x1 > x0 && y1 > y0)) {
        const error = new Error(`вырезка вне страницы или пустая: ${JSON.stringify(page)}`);
        error.adapterFault = true;
        throw error;
      }
      const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0, scale: 1 };
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
      return Buffer.from(data, 'base64');
    },
    async screenshot(file) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(file, Buffer.from(data, 'base64'));
    },
    close,
  };
}
