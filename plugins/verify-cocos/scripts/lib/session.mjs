// Сессия игры в headless Chrome: сервер сборки, shim и мост, ввод через CDP.
//
// Старт уровня идёт в два этапа. Сначала мост предзагружает ресурсы в
// свободном режиме — это недетерминированно и неважно. Затем цикл
// замораживается, PRNG пересевается, и уровень запускается кадр за кадром с
// паузой settleMs между кадрами: асинхронные загрузки успевают завершиться к
// одному и тому же кадру в каждом прогоне.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchChrome } from '../vendor/cdp/chrome.mjs';
import { connect } from '../vendor/cdp/cdp.mjs';
import { serveDir } from './serve.mjs';
import { shimSource } from './shim.mjs';
import { viewSource } from './view.mjs';
import { dispatchOps } from './keys.mjs';

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
    const ok = await cdp
      .evaluate(`location.href !== 'about:blank' && typeof window.__bot === 'object' && typeof window.__botShim === 'object'`)
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

export async function openSession({ root, config, seed, run = {} }) {
  const server = await serveDir(path.resolve(root, config.build));
  let chrome = null;
  let cdp = null;
  const close = async () => {
    cdp?.close();
    await chrome?.close();
    await server.close();
  };

  try {
    const bridge = await readFile(path.resolve(root, config.bridge), 'utf8');
    chrome = await launchChrome({
      width: config.viewport.width, height: config.viewport.height, scale: 1, prefix: 'verify-cocos-',
    });
    cdp = await connect(chrome.port);
    // Без эмуляции фокуса игра может поймать blur и уйти на паузу.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    // Размер страницы — ровно viewport конфига. --window-size задаёт окно, а
    // не область отрисовки: в headless она выходит другой, и координаты
    // вырезок и вид игры плыли бы от машины к машине.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: config.viewport.width, height: config.viewport.height, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: shimSource({ seed, fps: config.fps }) });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: viewSource() });
    // Параметры прогона (тема и т. п.) — до моста: он читает их при загрузке.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__botRun = ${JSON.stringify(run)};` });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: bridge });
    await cdp.send('Page.navigate', { url: server.url });
    await waitForBridge(cdp, config.limits.bootTimeoutMs);
    await withTimeout(
      cdp.evaluate('window.__bot.whenBooted()'),
      config.limits.bootTimeoutMs,
      `Игра не загрузилась за ${config.limits.bootTimeoutMs} мс`,
    );
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

  return {
    async start(params) {
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
    },
    observe: () => call('window.__bot.observe()'),
    actions: () => call('window.__bot.actions()'),
    async act(action) {
      const ops = (await call(`window.__bot.act(${json(action)})`)) ?? [];
      await dispatchOps(cdp, ops);
      return ops;
    },
    step: (n) => call(`window.__botShim.stepUntilEvents(${Math.max(1, Math.floor(n))})`),
    errors: () => cdp.errors.map((e) => ({ ...e, text: normalizeOrigin(e.text, server.url) })),
    async shot(region) {
      const page = await call(`window.__botView.pageRect(${json(region)})`, 'pageRect');
      const clip = {
        x: Math.floor(page.x), y: Math.floor(page.y),
        width: Math.ceil(page.width), height: Math.ceil(page.height), scale: 1,
      };
      const size = await call('({ w: innerWidth, h: innerHeight })', 'viewport');
      // Пустая вырезка или вырезка за краем — ошибка проверки проекта.
      if (!(clip.width > 0 && clip.height > 0) || clip.x < 0 || clip.y < 0 || clip.x + clip.width > size.w || clip.y + clip.height > size.h) {
        const error = new Error(`вырезка вне страницы или пустая: ${JSON.stringify(clip)}`);
        error.adapterFault = true;
        throw error;
      }
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
