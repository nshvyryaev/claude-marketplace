// Шаги сценария: то, что видит автор сценария в объекте `t`.
//
// Клик по тексту, а не по CSS-селектору: текст кнопки — часть продукта и
// меняется осознанно, а класс переживает любую перевёрстку молча.
//
// Ожидания встроены в утверждения: expectText сам опрашивает страницу до
// таймаута. Это убирает из сценариев россыпь wait() со случайными числами —
// главный источник мигающих проверок.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export class VerifyFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerifyFailure';
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const json = (value) => JSON.stringify(value);

async function poll(check, { timeout, interval = 120 }) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    last = await check();
    if (last.ok) return last;
    if (Date.now() >= deadline) return last;
    await wait(interval);
  }
}

export function makeSteps(cdp, { shotsDir, clickable, defaultTimeout = 5000, log, baseUrl, settleMs = 1500 }) {
  const shots = [];

  const click = async (text, { index = 0, timeout = defaultTimeout } = {}) => {
    const expression = `
      (() => {
        const nodes = [...document.querySelectorAll(${json(clickable)})];
        const want = ${json(text)};
        const exact = nodes.filter((n) => n.textContent.trim() === want);
        const hits = exact.length ? exact : nodes.filter((n) => n.textContent.trim().startsWith(want));
        const el = hits[${index}];
        if (!el) return { ok: false, seen: nodes.map((n) => n.textContent.trim()).filter(Boolean) };
        if (el.disabled) return { ok: false, disabled: true };
        // Полная последовательность указательных событий, а не голый click():
        // обработчик, висящий на pointerdown/pointerup (удержание, свайп,
        // перетаскивание), от el.click() не срабатывает вовсе, и сценарий
        // молча идёт дальше по нетронутому экрану.
        const options = {
          bubbles: true,
          cancelable: true,
          composed: true,
          button: 0,
          pointerId: 1,
          isPrimary: true,
          pointerType: 'mouse',
        };
        el.dispatchEvent(new PointerEvent('pointerdown', options));
        el.dispatchEvent(new MouseEvent('mousedown', options));
        el.dispatchEvent(new PointerEvent('pointerup', options));
        el.dispatchEvent(new MouseEvent('mouseup', options));
        el.click();
        return { ok: true };
      })()`;

    const result = await poll(() => cdp.evaluate(expression), { timeout });
    if (!result.ok) {
      const reason = result.disabled
        ? 'элемент найден, но выключен'
        : `на странице есть: ${(result.seen ?? []).join(' | ') || '(ничего кликабельного)'}`;
      throw new VerifyFailure(`Не удалось нажать «${text}»: ${reason}`);
    }
    log?.(`  клик «${text}»`);
    // Одного кадра хватает, чтобы состояние доехало до DOM.
    await wait(120);
  };

  const expectText = async (needle, { timeout = defaultTimeout } = {}) => {
    const expression = `({ ok: document.body.innerText.includes(${json(needle)}) })`;
    const result = await poll(() => cdp.evaluate(expression), { timeout });
    if (!result.ok) {
      const body = await cdp.evaluate('document.body.innerText.slice(0, 600)');
      throw new VerifyFailure(`Ожидался текст «${needle}», на экране:\n${body}`);
    }
    log?.(`  вижу «${needle}»`);
  };

  const expectNoText = async (needle, { timeout = 1200 } = {}) => {
    // Обратное утверждение нельзя «дождаться»: ждём стабилизации и проверяем.
    await wait(timeout);
    const present = await cdp.evaluate(
      `document.body.innerText.includes(${json(needle)})`,
    );
    if (present) throw new VerifyFailure(`Текст «${needle}» не должен быть на экране, но он есть`);
    log?.(`  нет «${needle}» — верно`);
  };

  const expect = async (expression, description, { timeout = defaultTimeout } = {}) => {
    const result = await poll(
      async () => ({ ok: Boolean(await cdp.evaluate(expression)) }),
      { timeout },
    );
    if (!result.ok) throw new VerifyFailure(`Не выполнено: ${description}`);
    log?.(`  ${description} — верно`);
  };

  /**
   * baseline: false — снимок-свидетельство, а не эталон. Кадр, снятый посреди
   * движения, зависит от момента съёмки: записав его в эталоны, мы вернули бы
   * мигающие проверки, от которых только что избавились. Такой кадр нужен
   * глазам, а не пиксельному сравнению.
   */
  const shot = async (name, { baseline = true } = {}) => {
    await mkdir(shotsDir, { recursive: true });
    // Шрифты — главный источник мигающих снимков: пока своя гарнитура едет,
    // текст рисуется запасной, и диф краснеет на каждой букве, хотя вёрстка
    // не менялась. Ждём готовности шрифтов, а не наращиваем допуск.
    await cdp.evaluate('document.fonts.ready.then(() => true)');
    const captured = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(shotsDir, `${name}.png`);
    await writeFile(file, Buffer.from(captured.data, 'base64'));
    shots.push({ name, file, baseline });
    log?.(`  снимок «${name}»`);
    return file;
  };

  // Переход внутри сценария: игра открывается с другими параметрами запуска —
  // проверить откат площадки иначе нельзя.
  const go = async (target) => {
    const url = new URL(target, baseUrl).href;
    await cdp.send('Page.navigate', { url });
    await wait(settleMs);
    cdp.clearErrors();
    log?.(`  переход ${url}`);
  };

  return {
    steps: {
      go,
      click,
      keys: async (letters, options) => {
        for (const letter of letters) await click(letter, options);
      },
      wait,
      expect,
      expectText,
      expectNoText,
      shot,
      eval: (expression) => cdp.evaluate(expression),
      text: async (selector) =>
        cdp.evaluate(
          selector
            ? `document.querySelector(${json(selector)})?.innerText ?? null`
            : 'document.body.innerText',
        ),
    },
    shots,
  };
}
