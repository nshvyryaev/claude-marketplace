// Сервер API прогона, подмена ответов и хранилище: разбор полей и запуск
// игрушечного сервера (без Chrome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { serverSpec, serverConfig, fixtureStatements, startServer } from '../scripts/lib/server.mjs';
import { withParam, interceptRules, storageSpec, validateEnv, pickEnv } from '../scripts/lib/env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const out = path.join(os.tmpdir(), `vc-server-${process.pid}`);
const fault = (e) => e.adapterFault === true;
const config = (server = {}) => ({
  out,
  limits: { bootTimeoutMs: 15000 },
  server: { command: ['node', 'toy-server.mjs'], ...server },
});

test('server прогона: true или { db, env }', () => {
  assert.deepEqual(serverSpec(true), { db: null, env: {} });
  assert.deepEqual(serverSpec({ db: 'a.sql', env: { X: '1' } }), { db: 'a.sql', env: { X: '1' } });
  assert.throws(() => serverSpec('yes'), fault);
  assert.throws(() => serverSpec({ db: 'a.txt' }), fault);
  assert.throws(() => serverSpec({ env: { X: 1 } }), fault);
});

test('server конфига: умолчания и ошибки', () => {
  const cfg = serverConfig(config());
  assert.equal(cfg.portEnv, 'PORT');
  assert.equal(cfg.dbEnv, 'DB_FILE');
  assert.equal(cfg.health, '/healthz');
  assert.equal(cfg.query, 'api');
  assert.equal(cfg.bootTimeoutMs, 15000);
  assert.throws(() => serverConfig({}), fault);
  assert.throws(() => serverConfig({ server: { command: 'node x' } }), fault);
  assert.throws(() => serverConfig({ server: { command: ['node'], prepare: ['node x'] } }), fault);
});

test('фикстура JSON → INSERT по таблицам', () => {
  assert.deepEqual(fixtureStatements({ a: [{ id: 1, o: { x: 1 }, b: true, n: null }] }), [
    { sql: 'INSERT INTO "a" ("id", "o", "b", "n") VALUES (?, ?, ?, ?)', params: [1, '{"x":1}', 1, null] },
  ]);
  assert.throws(() => fixtureStatements([]), fault);
  assert.throws(() => fixtureStatements({ a: {} }), fault);
  assert.throws(() => fixtureStatements({ a: [{}] }), fault);
});

test('withParam: адрес сервера поверх параметров прогона', () => {
  assert.equal(withParam('', 'api', 'http://127.0.0.1:5'), '?api=http%3A%2F%2F127.0.0.1%3A5');
  assert.equal(withParam('?prod&pf=vk', 'api', 'h'), '?prod&pf=vk&api=h');
  assert.equal(withParam('?api=old&prod', 'api', 'h'), '?prod&api=h');
});

test('intercept: правила и шаблон адреса', () => {
  const [rule] = interceptRules([{ url: '*/v1/runs?x*', status: 503 }]);
  assert.equal(rule.re.test('http://h:1/v1/runs?x=1'), true);
  assert.equal(rule.re.test('http://h:1/v1/runs/x'), true);
  assert.equal(rule.re.test('http://h:1/v1/votes'), false);
  assert.equal(interceptRules([{ url: '*', fail: true }])[0].fail, 'refused');
  assert.equal(interceptRules([{ url: '*.json', delay: 10 }])[0].re.test('a.json'), true);
  assert.equal(interceptRules([{ url: '*.json', delay: 10 }])[0].re.test('ajson'), false);
  for (const bad of [{}, { url: '*' }, { url: '*', fail: 'nope' }, { url: '*', fail: true, status: 500 }, { url: '*', status: 100 }, { url: '*', delay: -1 }, { url: '*', status: 500, body: {} }]) {
    assert.throws(() => interceptRules([bad]), fault, JSON.stringify(bad));
  }
  assert.throws(() => interceptRules({}), fault);
});

test('storage: объект или путь, записи кэша', () => {
  assert.equal(storageSpec('x.json'), 'x.json');
  storageSpec({ localStorage: { a: 1 }, caches: { c: [{ url: '/x', body: 'b', status: 200, headers: { a: 'b' } }] } });
  for (const bad of [[], { other: 1 }, { localStorage: [] }, { caches: { c: {} } }, { caches: { c: [{}] } }, { caches: { c: [{ url: '/x', body: 'a', file: 'b' }] } }, { caches: { c: [{ url: '/x', body: {} }] } }]) {
    assert.throws(() => storageSpec(bad), fault, JSON.stringify(bad));
  }
});

test('validateEnv и pickEnv знают server, intercept, storage', () => {
  validateEnv({ server: true, intercept: [{ url: '*', delay: 1 }], storage: { localStorage: {} } });
  validateEnv({ server: false });
  assert.throws(() => validateEnv({ server: { db: 'x' } }), fault);
  assert.throws(() => validateEnv({ intercept: [{ url: '*' }] }), fault);
  assert.deepEqual(pickEnv({ server: true, theme: 'x' }), { server: true });
});

test('startServer: свободный порт, /healthz, env прогона, остановка', async () => {
  const api = await startServer({ root, config: config({ env: { TOY_MARK: 'конфиг' } }), spec: { env: { TOY_MARK: 'прогон' } } });
  try {
    assert.match(api.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(api.param, 'api');
    const health = await (await fetch(`${api.origin}/healthz`)).json();
    assert.deepEqual(health, { ok: true, mark: 'прогон' });
    assert.deepEqual(await (await fetch(`${api.origin}/v1/players`)).json(), []);
  } finally { await api.close(); }
  await assert.rejects(fetch(`${api.origin}/healthz`));
});

test('startServer: фикстура базы SQL и JSON поверх схемы сервера; файл базы удаляется', async () => {
  for (const [db, expected] of [
    ['db/players.sql', [{ id: 1, name: 'sql-one', meta: null }, { id: 2, name: 'sql-two', meta: null }]],
    ['db/players.json', [{ id: 7, name: 'json', meta: '{"vip":true}' }]],
  ]) {
    const api = await startServer({ root, config: config(), spec: { db } });
    try {
      assert.deepEqual(await (await fetch(`${api.origin}/v1/players`)).json(), expected);
    } finally { await api.close(); }
  }
  assert.equal(existsSync(path.join(out, '.server')) && (await import('node:fs')).readdirSync(path.join(out, '.server')).length, 0);
  await rm(out, { recursive: true, force: true });
});

test('startServer: битая фикстура и упавший сервер — ошибка с выводом сервера', async () => {
  await assert.rejects(startServer({ root, config: config(), spec: { db: 'db/broken.json' } }), (e) => fault(e) && /broken\.json/.test(e.message) && /toy: слушает/.test(e.message));
  await assert.rejects(startServer({ root, config: config(), spec: { env: { TOY_FAIL_BOOT: '1' } } }), (e) => /завершился \(3\)/.test(e.message) && /toy: отказ старта/.test(e.message));
  await assert.rejects(startServer({ root, config: { limits: {} }, spec: true }), fault);
  await rm(out, { recursive: true, force: true });
});

test('startServer: prepare — один раз на процесс, даже для параллельных прогонов', async () => {
  const mark = path.join(os.tmpdir(), `vc-prepare-${process.pid}.txt`);
  await rm(mark, { force: true });
  const cfg = config({ prepare: [['node', '-e', `require('fs').appendFileSync(${JSON.stringify(mark)}, 'x')`]] });
  const apis = await Promise.all([startServer({ root, config: cfg, spec: true }), startServer({ root, config: cfg, spec: true })]);
  await Promise.all(apis.map((a) => a.close()));
  assert.equal(await readFile(mark, 'utf8'), 'x');
  await rm(mark, { force: true });
});
