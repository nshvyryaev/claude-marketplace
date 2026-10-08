// Сервер API прогона (B-2): процесс проекта на свободном порту, база —
// фикстура прогона, адрес — странице через параметр URL.
//
// Всё по выбору: без `server` в прогоне плагин сервер не поднимает. Что
// запускать, решает проект в `server` конфига (verify/cocos.json):
//
//   "server": {
//     "command": ["node", "--env-file=server/dev.env", "server/src/index.mjs"],
//     "env": { "DB_FILE": ":memory:" },        переменные процесса
//     "portEnv": "PORT",                       куда передать свободный порт
//     "dbEnv": "DB_FILE",                      куда передать файл базы с фикстурой
//     "health": "/healthz",                    ждать 200 по этому пути
//     "query": "api",                          параметр URL страницы с адресом сервера
//     "prepare": [["node", "…", "build"]],     один раз на процесс плагина, до первого сервера
//     "bootTimeoutMs": 20000
//   }
//
// Прогон: `"server": true` или `{ "db": "<файл .sql|.json>", "env": { … } }`.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

function fault(message) {
  const error = new Error(message);
  error.adapterFault = true;
  return error;
}

const isEnv = (env) => env && typeof env === 'object' && !Array.isArray(env)
  && Object.values(env).every((v) => typeof v === 'string');
const isCommand = (cmd) => Array.isArray(cmd) && cmd.length > 0 && cmd.every((s) => typeof s === 'string' && s !== '');

// `server` прогона → { db, env }. db — путь к фикстуре от корня проекта или null.
export function serverSpec(spec) {
  if (spec === true) return { db: null, env: {} };
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw fault(`server: true или { db, env }, а не ${JSON.stringify(spec)}`);
  if (spec.db !== undefined && !(typeof spec.db === 'string' && /\.(sql|json)$/i.test(spec.db))) {
    throw fault(`server.db: путь к фикстуре .sql или .json, а не ${JSON.stringify(spec.db)}`);
  }
  if (spec.env !== undefined && !isEnv(spec.env)) throw fault('server.env: объект строк');
  return { db: spec.db ?? null, env: spec.env ?? {} };
}

// `server` конфига → нормализованный, с умолчаниями.
export function serverConfig(config) {
  const s = config.server;
  if (!s) throw fault('Прогон просит server, а в verify/cocos.json нет блока server (см. README verify-cocos)');
  if (!isCommand(s.command)) throw fault('server.command конфига: непустой массив строк ["node", "файл.mjs", …]');
  if (s.env !== undefined && !isEnv(s.env)) throw fault('server.env конфига: объект строк');
  if (s.prepare !== undefined && !(Array.isArray(s.prepare) && s.prepare.every(isCommand))) {
    throw fault('server.prepare конфига: массив команд (каждая — массив строк)');
  }
  return {
    command: s.command,
    env: s.env ?? {},
    portEnv: s.portEnv ?? 'PORT',
    dbEnv: s.dbEnv ?? 'DB_FILE',
    health: s.health ?? '/healthz',
    query: s.query ?? 'api',
    prepare: s.prepare ?? [],
    bootTimeoutMs: s.bootTimeoutMs ?? config.limits?.bootTimeoutMs ?? 60000,
  };
}

// Строки фикстуры JSON: { "<таблица>": [ { "<колонка>": значение } ] } —
// таблицы по порядку ключей (внешние ключи). Объекты и массивы — JSON-строкой.
export function fixtureStatements(fixture) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) throw fault('фикстура базы JSON: { "<таблица>": [ { колонка: значение } ] }');
  const out = [];
  for (const [table, rows] of Object.entries(fixture)) {
    if (!Array.isArray(rows)) throw fault(`фикстура базы: ${table} — массив строк`);
    for (const row of rows) {
      const cols = Object.keys(row ?? {});
      if (cols.length === 0) throw fault(`фикстура базы: пустая строка в ${table}`);
      const q = (name) => `"${name.replace(/"/g, '""')}"`;
      out.push({
        sql: `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        params: cols.map((c) => {
          const v = row[c];
          if (v === undefined) return null;
          if (typeof v === 'boolean') return v ? 1 : 0;
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
        }),
      });
    }
  }
  return out;
}

// Фикстура — в файл базы, которую сервер уже открыл и мигрировал: схема его,
// данные прогона. Одной транзакцией.
export async function applyDbFixture(dbFile, fixtureFile) {
  const text = await readFile(fixtureFile, 'utf8');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbFile);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('BEGIN');
    try {
      if (/\.sql$/i.test(fixtureFile)) db.exec(text);
      else for (const { sql, params } of fixtureStatements(JSON.parse(text))) db.prepare(sql).run(...params);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw fault(`фикстура базы ${path.basename(fixtureFile)}: ${error.message}`);
    }
  } finally {
    db.close();
  }
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// `node` команды — тот же node, что у плагина: PATH на Windows может
// указывать на другой. Без оболочки: kill() останавливает сам сервер.
function launch(command, { cwd, env }) {
  const [bin, ...args] = command;
  return spawn(bin === 'node' ? process.execPath : bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function run(command, cwd) {
  return new Promise((resolve, reject) => {
    const child = launch(command, { cwd, env: process.env });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`server.prepare ${command.join(' ')}: код ${code}\n${output.slice(-2000)}`))));
  });
}

// prepare — один раз на процесс плагина (сборка контента и т. п.): параллельные
// прогоны ждут одну и ту же подготовку.
const prepared = new Map();
function prepareOnce(commands, cwd) {
  const key = JSON.stringify([cwd, commands]);
  if (!prepared.has(key)) {
    prepared.set(key, (async () => { for (const command of commands) await run(command, cwd); })());
  }
  return prepared.get(key);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TAIL = 4000;

// Поднять сервер прогона: { origin, query: [ключ, адрес], close }.
export async function startServer({ root, config, spec }) {
  const cfg = serverConfig(config);
  const run = serverSpec(spec);
  await prepareOnce(cfg.prepare, root);

  const port = await freePort();
  let dir = null;
  const env = { ...process.env, ...cfg.env, ...run.env, [cfg.portEnv]: String(port) };
  if (run.db) {
    // Фикстура пишется в файл: в базу `:memory:` чужого процесса не попасть.
    dir = path.resolve(root, config.out ?? 'tmp/bot', '.server', `${port}-${randomBytes(4).toString('hex')}`);
    await mkdir(dir, { recursive: true });
    env[cfg.dbEnv] = path.join(dir, 'db.sqlite');
  }

  const child = launch(cfg.command, { cwd: root, env });
  let output = '';
  const keep = (d) => { output = (output + d).slice(-TAIL); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let exited = null;
  const exit = new Promise((resolve) => child.on('exit', (code) => { exited = code ?? 'signal'; resolve(); }));
  child.on('error', (error) => { exited = error.message; });

  const origin = `http://127.0.0.1:${port}`;
  const close = async () => {
    if (exited === null) { child.kill(); await Promise.race([exit, wait(5000)]); }
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  };

  try {
    const deadline = Date.now() + cfg.bootTimeoutMs;
    for (;;) {
      if (exited !== null) throw new Error(`сервер прогона завершился (${exited}) до ответа ${cfg.health}`);
      const ok = await fetch(origin + cfg.health, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
      if (ok) break;
      if (Date.now() > deadline) throw new Error(`сервер прогона не ответил на ${cfg.health} за ${cfg.bootTimeoutMs} мс`);
      await wait(100);
    }
    if (run.db) await applyDbFixture(env[cfg.dbEnv], path.resolve(root, run.db));
  } catch (error) {
    await close();
    error.message += output ? `\n--- вывод сервера ---\n${output.trim()}` : '';
    throw error;
  }
  return { origin, port, param: cfg.query, close, output: () => output };
}
