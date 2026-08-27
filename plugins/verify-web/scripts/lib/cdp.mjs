// Тонкий клиент CDP поверх WebSocket: вызовы с ответом и сбор ошибок страницы.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPageTarget(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((target) => target.type === 'page');
      if (page) return page;
    } catch {}
    await wait(150);
  }
  throw new Error('Страница не найдена среди целей CDP');
}

export async function connect(port) {
  const target = await findPageTarget(port);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('WebSocket к Chrome не открылся'));
  });

  let nextId = 0;
  const pending = new Map();
  // Ошибки страницы копятся весь прогон: сценарий проверяет их в конце, а не
  // после каждого шага — иначе асинхронная ошибка проскочит между шагами.
  const errors = [];

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push({
        kind: 'console',
        text: message.params.args
          .map((arg) => arg.value ?? arg.description ?? arg.type)
          .join(' '),
      });
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      errors.push({
        kind: 'exception',
        text: details.exception?.description ?? details.text,
      });
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      errors.push({ kind: 'log', text: message.params.entry.text });
    }

    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`CDP ${message.error.message}`));
      else resolve(message.result);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  // Значение выражения возвращается по значению; исключение внутри страницы
  // поднимается как ошибка здесь, а не молча превращается в undefined.
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `Ошибка в выражении на странице: ${
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
        }`,
      );
    }
    return result.result?.value;
  };

  return {
    send,
    evaluate,
    errors,
    clearErrors: () => errors.splice(0, errors.length),
    close: () => socket.close(),
  };
}
