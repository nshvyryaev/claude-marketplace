import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { serveDir } from '../scripts/lib/serve.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vc-serve-'));
  const dir = path.join(root, 'build');
  await mkdir(dir);
  await writeFile(path.join(dir, 'index.html'), '<p>ok</p>');
  await writeFile(path.join(dir, 'app.js'), 'x=1');
  await writeFile(path.join(root, 'secret.txt'), 'нельзя');
  return dir;
}

const rawGet = (url, rawPath) => new Promise((resolve) => {
  const { hostname, port } = new URL(url);
  http.get({ hostname, port, path: rawPath }, (res) => { res.resume(); resolve(res.statusCode); });
});

test('раздаёт index.html на / и типы по расширению', async () => {
  const server = await serveDir(await fixture());
  try {
    const page = await fetch(server.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal(await page.text(), '<p>ok</p>');
    const js = await fetch(`${server.url}app.js`);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(`${server.url}nope.js`)).status, 404);
  } finally { await server.close(); }
});

test('не выпускает за пределы каталога сборки', async () => {
  const server = await serveDir(await fixture());
  try {
    // '%2e%2e' парсер URL нормализует сам; '..%2f' доживает до decodeURIComponent.
    assert.equal(await rawGet(server.url, '/..%2fsecret.txt'), 403);
  } finally { await server.close(); }
});

test('нет каталога сборки — понятная ошибка', async () => {
  await assert.rejects(serveDir(path.join(os.tmpdir(), 'нет-такой-сборки-vc')), /Нет каталога сборки/);
});
