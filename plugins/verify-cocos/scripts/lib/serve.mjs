// Статический сервер сборки игры. Dev-сервер не нужен: гоняется ровно тот
// артефакт, который уходит игрокам.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
};

export const BLANK_PATH = '/__verify-cocos__/blank.html';

// Файл сборки по пути запроса: { status, headers, body }. Тот же ответ отдают
// и сервер, и подмена запросов сборки в прогоне без сети (session.mjs).
export async function buildResponse(root, url) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(url, 'http://local').pathname);
  } catch {
    return { status: 400, headers: {}, body: null };
  }
  // Пустая страница источника сборки: на ней плагин заполняет хранилище
  // (localStorage, Cache API) до загрузки игры.
  if (rel === BLANK_PATH) return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: Buffer.from('<!doctype html><title>verify-cocos</title>') };
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, `.${rel}`);
  if (file !== root && !file.startsWith(root + path.sep)) return { status: 403, headers: {}, body: null };
  try {
    const body = await readFile(file);
    return {
      status: 200,
      headers: {
        'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      },
      body,
    };
  } catch {
    // Иконку вкладки Chrome просит сам; её отсутствие — не ошибка страницы.
    if (rel === '/favicon.ico') return { status: 204, headers: {}, body: null };
    return { status: 404, headers: {}, body: null };
  }
}

export async function serveDir(dir) {
  const root = path.resolve(dir);
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`Нет каталога сборки: ${root}`);

  const server = http.createServer(async (req, res) => {
    const { status, headers, body } = await buildResponse(root, req.url);
    res.writeHead(status, headers);
    res.end(body ?? undefined);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    root,
    // Chrome держит keep-alive соединения — без их обрыва close ждёт вечно.
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}
