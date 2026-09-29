# verify-cocos, фаза 1 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Бот-тестировщик, который проходит уровень ImageUncovered в продовой web-сборке, детерминированно по seed, с журналом решений, оракулами и воспроизведением.

**Architecture:** Плагин `verify-cocos` (Node) поднимает Chrome через CDP, раздаёт сборку своим сервером и внедряет в страницу shim (seed PRNG, виртуальное время, ручная прокрутка кадров через очередь `requestAnimationFrame`) и мост проекта. Агент в Node крутит цикл «модель → цель → тактика → действие → кадры → оракулы». Знание об игре — модули проекта в `verify/bot/`.

**Tech Stack:** Node 22+ (ESM, `node:test`, встроенные `fetch`/`WebSocket`), Chrome по CDP, без npm-зависимостей. Игра — Cocos Creator 3.8.8 web-сборка.

**Spec:** `docs/superpowers/specs/2026-09-29-verify-cocos-design.md` (в этом репозитории).

## Репозитории и пути

- Marketplace: `E:/projects/claude-marketplace` — задачи 1–7.
- Игра: `E:/projects/ImageUncovered` — задачи 0, 8–11.
- Из игры плагин вызывается по пути в marketplace:
  `node E:/projects/claude-marketplace/plugins/verify-cocos/scripts/verify-cocos.mjs <команда> --root E:/projects/ImageUncovered`.
  Ниже это сокращено до `VC` — в командах подставляй полный путь.

## Global Constraints

- Ноль npm-зависимостей в плагине и адаптере; только встроенные модули Node.
- В сборке игры нет ни байта бота: в `assets/` ImageUncovered этот план ничего не добавляет и не меняет.
- Плагин везёт движок, проект владеет только данными: `verify/cocos.json`, `verify/bot/*`, `verify/runs/*`.
- Общий код CDP — один источник `shared/cdp/`, копии в `plugins/*/scripts/vendor/cdp/`, расхождение ловит тест.
- Детерминизм: seed, уровень, миссия, политика и хэш адаптера однозначно определяют прогон. В записях журнала нет времени стенных часов.
- Временные файлы — только в `./tmp` проекта (относительный путь). Журналы прогонов — `tmp/bot/<run-id>/`.
- Комментарии и сообщения — по-русски, как в `verify-web`. Пути в исходниках — с прямыми слэшами; обратный слэш — `String.fromCharCode(92)`.
- `python` на машине — заглушка Windows Store; скрипты только на `node`.
- Коммит — после прохождения тестов задачи; одна логическая правка — один коммит; переделка — отдельным коммитом.
- Сообщения коммитов заканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Нет сборки / неверный путь `build`** → понятная ошибка «Нет каталога сборки: …», а не падение Chrome. Тест — задача 4 (`serve.test.mjs`).
2. **Игра не загрузилась (нет `cc`, мост не ответил)** → прогон завершается вердиктом `error` за `bootTimeoutMs`, процесс не висит. Тест — задача 5 (`session.chrome.test.mjs`, мост с вечным `whenBooted`).
3. **Исключение в модуле адаптера** (опечатка в тактике) → вердикт `bot-error` с текстом исключения, а не `bug` игры и не падение раннера. Тест — задача 3.
4. **Опечатка в паттерне политики в `soak`** → ошибка до запуска Chrome, с названием паттерна. Тест — задача 2 (`parsePattern`) + проверка в раннере задачи 6.
5. **Replay после правки адаптера** → предупреждение о другом хэше, а не молчаливое «расхождение = баг игры». Тест — задача 6 (`adapterHash`).

---

### Task 0: Спайк — управление релизной сборкой снаружи

Выход спайка — **факты**, не код. Код спайка выбрасывается (`tmp/` в .gitignore).

**Files:**
- Create: `E:/projects/ImageUncovered/tmp/spike-bot.mjs`
- Modify: `E:/projects/claude-marketplace/docs/superpowers/specs/2026-09-29-verify-cocos-design.md` (раздел «Результаты спайка» в конце)

**Interfaces:**
- Consumes: `launchChrome`, `connect` из `plugins/verify-web/scripts/lib/` (до задачи 1 они ещё там).
- Produces: ответы на пять вопросов (шаг 3), от них зависит, продолжается ли план.

- [ ] **Step 1: Убедиться, что сборка есть**

Run (из `E:/projects/ImageUncovered`): `ls build/web-mobile-vk/index.html`
Expected: файл есть. Если нет — собрать по `docs/platforms/vk.md`:
```
"C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe" --project E:\projects\ImageUncovered --build "platform=web-mobile;outputName=web-mobile-vk;buildPath=project://build"
```
Успех сборки — строка `build Task (web-mobile-vk) Finished` в выводе, не код возврата.

- [ ] **Step 2: Написать скрипт спайка**

`tmp/spike-bot.mjs`:
```js
// Спайк: можно ли управлять релизной web-сборкой Cocos 3.8.8 снаружи.
// Выбрасывается после записи результатов в спеку.
import { launchChrome } from 'file:///E:/projects/claude-marketplace/plugins/verify-web/scripts/lib/chrome.mjs';
import { connect } from 'file:///E:/projects/claude-marketplace/plugins/verify-web/scripts/lib/cdp.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const BUILD = path.resolve('build/web-mobile-vk');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm' };
  const server = http.createServer(async (req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    try {
      const body = await readFile(path.join(dir, rel));
      res.writeHead(200, { 'content-type': types[path.extname(rel)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

function shim(seed) {
  const makeRng = (s0) => { let s = s0 >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  let rng = makeRng(seed);
  Math.random = () => rng();
  const frameMs = 1000 / 60;
  let base = 0; let frames = 0; let now = 0; let frozen = false;
  performance.now = () => now;
  Date.now = () => 1767225600000 + Math.floor(now);
  const realRaf = window.requestAnimationFrame.bind(window);
  let queue = []; let nextId = 1;
  window.requestAnimationFrame = (cb) => { const id = nextId++; queue.push({ id, cb }); return id; };
  window.cancelAnimationFrame = (id) => { queue = queue.filter((e) => e.id !== id); };
  const pump = () => { frames++; now = base + frames * frameMs + 0.01; const run = queue; queue = []; for (const e of run) e.cb(now); };
  const loop = () => { if (!frozen) pump(); realRaf(loop); };
  realRaf(loop);
  window.__spike = {
    freeze() { frozen = true; base = 1e9; frames = 0; },
    reseed(s) { rng = makeRng(s); },
    step(n) { for (let i = 0; i < n; i++) pump(); },
  };
}

const PROBE = `(() => {
  const C = (n) => cc.js.getClassByName(n);
  const s = cc.director.getScene();
  const one = (n) => (s && C(n)) ? s.getComponentInChildren(C(n)) : null;
  const ls = one('LevelState');
  const player = one('PlayerTag');
  const enemies = (s && C('EnemyTag')) ? s.getComponentsInChildren(C('EnemyTag')) : [];
  return {
    scene: s?.name, totalFrames: cc.director.getTotalFrames(),
    level: ls ? { loaded: ls.loaded, ready: ls.readyFrames, index: ls.currentLevelIndex } : null,
    player: player ? [player.node.position.x, player.node.position.y] : null,
    enemies: enemies.map((e) => { const v = e.getComponent(C('Velocity')); return [e.node.position.x, e.node.position.y, v?.vx, v?.vy]; }),
    focus: document.hasFocus(), paused: cc.game.isPaused(),
  };
})()`;

async function session(seed) {
  const { server, url } = await serve(BUILD);
  const chrome = await launchChrome({ width: 1280, height: 720, scale: 1 });
  const cdp = await connect(chrome.port);
  const facts = { seed };
  try {
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${shim})(${seed})` });
    await cdp.send('Page.navigate', { url });
    // 1. Доступ к cc
    let access = null;
    for (let i = 0; i < 300 && !access; i++) {
      await wait(200);
      access = await cdp.evaluate(`(async () => {
        if (typeof cc === 'undefined' && window.System?.import) { try { window.cc = await System.import('cc'); window.__ccVia = 'System.import'; } catch {} }
        if (typeof cc === 'undefined' || !cc.director?.getScene?.()) return null;
        return { via: window.__ccVia ?? 'window.cc', scene: cc.director.getScene().name, world: !!cc.js.getClassByName('World') };
      })()`).catch(() => null);
    }
    facts.access = access;
    if (!access) return facts;
    // 2. Предзагрузка в свободном режиме, затем заморозка и детерминированный старт
    facts.preload = await cdp.evaluate(`new Promise((res) => cc.director.preloadScene('Main', (e) => res(e ? String(e) : 'ok')))`);
    await cdp.evaluate(`window.__spike.freeze(); window.__spike.reseed(${seed}); cc.director.loadScene('Main'); true`);
    let probe = null; let frames = 0;
    for (; frames < 3000; frames++) {
      probe = await cdp.evaluate(PROBE).catch((e) => ({ error: e.message }));
      if (probe?.level?.loaded && probe.level.ready >= 2 && probe.player) break;
      await cdp.evaluate('window.__spike.step(1)');
      await wait(10);
    }
    facts.readyAfterFrames = frames;
    facts.atReady = probe;
    // 3. Один pump = ровно один кадр движка?
    const before = (await cdp.evaluate(PROBE)).totalFrames;
    await cdp.evaluate('window.__spike.step(100)');
    facts.framesPer100Pumps = (await cdp.evaluate(PROBE)).totalFrames - before;
    // 4. Ввод через CDP двигает игрока при замороженном цикле
    const key = { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 };
    const p0 = (await cdp.evaluate(PROBE)).player;
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
    await cdp.evaluate('window.__spike.step(30)');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    const p1 = (await cdp.evaluate(PROBE)).player;
    facts.input = { before: p0, after: p1, moved: JSON.stringify(p0) !== JSON.stringify(p1) };
    facts.after = await cdp.evaluate(PROBE);
    facts.errors = cdp.errors.slice(0, 10);
    return facts;
  } finally {
    cdp.close(); await chrome.close(); server.close(); server.closeAllConnections?.();
  }
}

const a = await session(42);
const b = await session(42);
const c = await session(43);
console.log(JSON.stringify({ a, b, c }, null, 2));
console.log('--- выводы ---');
console.log('1. доступ к cc:', a.access ? `да (${a.access.via})` : 'НЕТ');
console.log('2. старт до готовности уровня за кадров:', a.readyAfterFrames, '/ повтор:', b.readyAfterFrames);
console.log('3. кадров движка на 100 pump:', a.framesPer100Pumps);
console.log('4. ввод через CDP двигает игрока:', a.input?.moved);
console.log('5. детерминизм (42 vs 42):', JSON.stringify(a.after) === JSON.stringify(b.after), ' seed влияет (42 vs 43):', JSON.stringify(a.after) !== JSON.stringify(c.after));
```

- [ ] **Step 3: Прогнать и прочитать выводы**

Run (из `E:/projects/ImageUncovered`): `node tmp/spike-bot.mjs`
Ожидаемые ответы для продолжения плана:
1. `доступ к cc: да` (через `window.cc` или `System.import`).
2. Уровень готов за конечное число кадров (< 3000) в обоих прогонах.
3. `кадров движка на 100 pump: 100`.
4. `ввод через CDP двигает игрока: true`.
5. `детерминизм: true`; `seed влияет` — желательно `true` (если `false`, уровень 1 может не использовать `Math.random` после старта — это не блокер, записать).

Ещё смотреть: `focus: true`, `paused: false`, `errors` (ошибки VK SDK вне VK ожидаемы и допустимы — они до старта уровня).

- [ ] **Step 4: Развилка**

- Все пять пунктов пройдены → записать результаты (шаг 5), продолжать с задачи 1.
- Пункт 3 даёт не 100 (например 99 или 0): поменять `+ 0.01` на `+ 0.5` в `pump` и повторить; если не помогает — **стоп**, доложить инженеру.
- Пункт 1, 2 или 4 провален → **стоп**. Записать факты в спеку и вернуться к инженеру: переход на вариант B (отдельная сборка со сценой `BotStart`, спека §4.3) требует нового плана.
- Пункт 5 провален (прогоны с одним seed разошлись) → **стоп**, доложить с выводом `a.after` / `b.after`: детерминизм — основа replay.

- [ ] **Step 5: Записать результаты в спеку и закоммитить**

Дописать в конец спеки раздел:
```markdown
## Результаты спайка (YYYY-MM-DD)

| Вопрос | Ответ |
|---|---|
| Доступ к `cc` из внедрённого кода | <да, через window.cc / System.import> |
| Старт уровня 1 после заморозки | <N> кадров, повтор — <M> |
| Кадров движка на 100 pump | <100> (эпсилон времени <0.01>) |
| Ввод через CDP при замороженном цикле | <двигает> |
| Детерминизм при одном seed | <да>; seed влияет на старт: <да/нет> |
| Фокус / пауза | <hasFocus, isPaused> |
| Ошибки консоли до старта уровня | <кратко> |
```
```bash
cd E:/projects/claude-marketplace
git add docs/superpowers/specs/2026-09-29-verify-cocos-design.md
git commit -m "docs(verify-cocos): результаты спайка управления сборкой"
```

---

### Task 1: Общий код CDP — `shared/cdp` с копиями под тестом

**Files:**
- Create: `shared/cdp/cdp.mjs` (перенос из `plugins/verify-web/scripts/lib/cdp.mjs`, без изменений)
- Create: `shared/cdp/chrome.mjs` (перенос из `plugins/verify-web/scripts/lib/chrome.mjs` + параметр `prefix`)
- Create: `shared/cdp/zones.mjs` (перенос из `plugins/verify-web/scripts/lib/zones.mjs`, без изменений)
- Create: `tools/sync-shared.mjs`
- Create: `tests/shared-sync.test.mjs`
- Move: `plugins/verify-web/tests/zones.test.mjs` → `tests/zones.test.mjs` (импорт из `../shared/cdp/zones.mjs`)
- Delete: `plugins/verify-web/scripts/lib/{cdp,chrome,zones}.mjs`
- Create (генерируется): `plugins/verify-web/scripts/vendor/cdp/{cdp,chrome,zones}.mjs`
- Modify: импорты в `plugins/verify-web/scripts/verify.mjs`, `plugins/verify-web/scripts/lib/run.mjs` (и любых других файлов, где найдутся, — шаг 4)

**Interfaces:**
- Produces: `shared/cdp/chrome.mjs` → `launchChrome({ width, height, scale, prefix = 'verify-web-' }) → { proc, profile, port, close }`, `chromePath()`; `shared/cdp/cdp.mjs` → `connect(port) → { send, evaluate, errors, clearErrors, close }`; `shared/cdp/zones.mjs` → `normalizePath`, `matchesPattern`, `zonesForFiles(files, zoneMap) → { zones, unmapped }`, `selectScenarios(items, { zones, unmapped }) → { selected, reason }` (работает с любыми объектами, у которых есть `zone`).
- Produces: `tools/sync-shared.mjs` экспортирует `ROOT`, `SOURCE`, `CONSUMERS`, `vendorDir(plugin)`, `sourceFiles()`.

- [ ] **Step 1: Написать падающий тест синхронизации**

`tests/shared-sync.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, SOURCE, CONSUMERS, vendorDir, sourceFiles } from '../tools/sync-shared.mjs';

test('копии shared/cdp в плагинах совпадают с источником', async () => {
  const files = await sourceFiles();
  assert.ok(files.length > 0, 'shared/cdp пуст');
  let checked = 0;
  for (const plugin of CONSUMERS) {
    if (!existsSync(path.join(ROOT, 'plugins', plugin))) continue;
    const dir = vendorDir(plugin);
    assert.ok(existsSync(dir), `${plugin}: нет ${dir} — запустите node tools/sync-shared.mjs`);
    assert.deepEqual((await readdir(dir)).sort(), files, `${plugin}: набор файлов разошёлся`);
    for (const file of files) {
      assert.equal(
        await readFile(path.join(dir, file), 'utf8'),
        await readFile(path.join(SOURCE, file), 'utf8'),
        `${plugin}/${file} разошёлся с shared/cdp — запустите node tools/sync-shared.mjs`,
      );
    }
    checked++;
  }
  assert.ok(checked > 0, 'ни одного плагина-потребителя');
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run (из `E:/projects/claude-marketplace`): `node --test tests/`
Expected: FAIL — `Cannot find module .../tools/sync-shared.mjs`.

- [ ] **Step 3: Перенести общий код и написать синхронизацию**

```bash
cd E:/projects/claude-marketplace
mkdir -p shared/cdp
git mv plugins/verify-web/scripts/lib/cdp.mjs shared/cdp/cdp.mjs
git mv plugins/verify-web/scripts/lib/chrome.mjs shared/cdp/chrome.mjs
git mv plugins/verify-web/scripts/lib/zones.mjs shared/cdp/zones.mjs
git mv plugins/verify-web/tests/zones.test.mjs tests/zones.test.mjs
```

В `tests/zones.test.mjs` заменить строку импорта на:
```js
import { matchesPattern, normalizePath, zonesForFiles, selectScenarios } from '../shared/cdp/zones.mjs';
```

В `shared/cdp/chrome.mjs` заменить сигнатуру и строку создания профиля:
```js
export async function launchChrome({ width = 390, height = 844, scale = 2, prefix = 'verify-web-' } = {}) {
  // Профиль вне проекта: внутри него dev-сервер видит файлы и перезагружает
  // страницу прямо посреди сценария.
  const profile = await mkdtemp(path.join(os.tmpdir(), prefix));
```

`tools/sync-shared.mjs`:
```js
#!/usr/bin/env node
// Раскладывает общий код из shared/cdp по vendor/ плагинов-потребителей.
//
// Источник один — shared/cdp. Копии правятся только этим скриптом; тест
// tests/shared-sync.test.mjs падает, если копия разошлась с источником.
// Импорт между плагинами невозможен: скрипт плагина знает только свой
// CLAUDE_PLUGIN_ROOT, путь к соседнему плагину в кэше меняется с версией.
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = path.join(ROOT, 'shared', 'cdp');
export const CONSUMERS = ['verify-web', 'verify-cocos'];

export const vendorDir = (plugin) => path.join(ROOT, 'plugins', plugin, 'scripts', 'vendor', 'cdp');

export async function sourceFiles() {
  return (await readdir(SOURCE)).filter((file) => file.endsWith('.mjs')).sort();
}

async function sync() {
  const files = await sourceFiles();
  for (const plugin of CONSUMERS) {
    if (!existsSync(path.join(ROOT, 'plugins', plugin))) continue;
    const dir = vendorDir(plugin);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const file of files) {
      await writeFile(path.join(dir, file), await readFile(path.join(SOURCE, file)));
    }
    console.log(`${plugin}: ${files.length} файлов → ${path.relative(ROOT, dir)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await sync();
}
```

- [ ] **Step 4: Разложить копии и переключить verify-web на vendor**

Run: `node tools/sync-shared.mjs`
Expected: `verify-web: 3 файлов → plugins/verify-web/scripts/vendor/cdp`

Найти все импорты перенесённых файлов:
Run: `grep -rn "cdp.mjs\|chrome.mjs\|zones.mjs" plugins/verify-web/scripts plugins/verify-web/tests`
Заменить каждый найденный импорт:
- в `plugins/verify-web/scripts/lib/*.mjs`: `'./cdp.mjs'` → `'../vendor/cdp/cdp.mjs'`, `'./chrome.mjs'` → `'../vendor/cdp/chrome.mjs'`, `'./zones.mjs'` → `'../vendor/cdp/zones.mjs'`;
- в `plugins/verify-web/scripts/verify.mjs`: `'./lib/zones.mjs'` → `'./vendor/cdp/zones.mjs'` (и аналогично для cdp/chrome, если есть).

- [ ] **Step 5: Прогнать все тесты**

Run: `node --test tests/ && node --test plugins/verify-web/tests/`
Expected: PASS (sync-тест, zones-тесты, png-тесты verify-web).
Run: `node plugins/verify-web/scripts/verify.mjs --help 2>&1 | head -3`
Expected: ошибка про отсутствующий `verify/config.json` (значит, модуль загрузился и импорты целы), а не `Cannot find module`.

- [ ] **Step 6: Commit**

```bash
git add shared tools tests plugins/verify-web
git commit -m "refactor(shared): общий CDP-код в shared/cdp с копиями под тестом"
```

---

### Task 2: Каркас verify-cocos — PRNG и паттерны случайности

**Files:**
- Create: `plugins/verify-cocos/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json` (запись плагина)
- Create: `plugins/verify-cocos/scripts/lib/rng.mjs`
- Create: `plugins/verify-cocos/scripts/lib/policy.mjs`
- Test: `plugins/verify-cocos/tests/rng.test.mjs`, `plugins/verify-cocos/tests/policy.test.mjs`

**Interfaces:**
- Produces: `rng.mjs` → `mulberry32(seed) → () => number в [0,1)`, `botSeed(seed) → uint32`, `pickIndex(rng, n) → int в [0,n)`.
- Produces: `policy.mjs` → `parsePattern(spec) → { pattern, n?, planned?, random?, p? }` (бросает `Error('Неизвестный паттерн: …')`), `createChooser(spec, rng) → () => 'planned' | 'random'`, `createPolicy(spec, rng) → { goal: chooser, action: chooser }`, где `spec` — строка (оба уровня) или `{ goal, action }`; `policySlug(spec) → string` для имён каталогов.

- [ ] **Step 1: Написать падающие тесты**

`plugins/verify-cocos/tests/rng.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, botSeed, pickIndex } from '../scripts/lib/rng.mjs';

test('одинаковый seed — одинаковая последовательность', () => {
  const a = mulberry32(42); const b = mulberry32(42);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('разные seed — разные последовательности', () => {
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('значения в [0, 1)', () => {
  const r = mulberry32(7);
  for (let i = 0; i < 1000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); }
});

test('поток бота не совпадает с потоком игры при том же seed', () => {
  assert.notEqual(mulberry32(42)(), mulberry32(botSeed(42))());
});

test('pickIndex не выходит за границы', () => {
  const r = mulberry32(3);
  for (let i = 0; i < 500; i++) { const k = pickIndex(r, 5); assert.ok(k >= 0 && k < 5 && Number.isInteger(k)); }
});
```

`plugins/verify-cocos/tests/policy.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePattern, createChooser, createPolicy, policySlug } from '../scripts/lib/policy.mjs';
import { mulberry32 } from '../scripts/lib/rng.mjs';

const take = (choose, n) => Array.from({ length: n }, () => choose());

test('строковые формы разбираются', () => {
  assert.deepEqual(parsePattern('planned'), { pattern: 'planned' });
  assert.deepEqual(parsePattern('random'), { pattern: 'random' });
  assert.deepEqual(parsePattern('every:3'), { pattern: 'every', n: 3 });
  assert.deepEqual(parsePattern('burst:30/10'), { pattern: 'burst', planned: 30, random: 10 });
  assert.deepEqual(parsePattern('chance:0.25'), { pattern: 'chance', p: 0.25 });
  assert.deepEqual(parsePattern({ pattern: 'every', n: 2 }), { pattern: 'every', n: 2 });
});

test('опечатка и недопустимые числа — ошибка с названием паттерна', () => {
  assert.throws(() => parsePattern('evry:2'), /Неизвестный паттерн: evry:2/);
  assert.throws(() => parsePattern('every:0'), /every:0/);
  assert.throws(() => parsePattern('chance:1.5'), /chance:1.5/);
  assert.throws(() => parsePattern('burst:0/0'), /burst:0\/0/);
});

test('every n — каждый n-й выбор случайный', () => {
  assert.deepEqual(take(createChooser('every:3', mulberry32(1)), 6),
    ['planned', 'planned', 'random', 'planned', 'planned', 'random']);
});

test('burst — K по плану, M случайно, по кругу', () => {
  assert.deepEqual(take(createChooser('burst:2/1', mulberry32(1)), 6),
    ['planned', 'planned', 'random', 'planned', 'planned', 'random']);
});

test('planned и random — без исключений', () => {
  assert.ok(take(createChooser('planned', mulberry32(1)), 20).every((v) => v === 'planned'));
  assert.ok(take(createChooser('random', mulberry32(1)), 20).every((v) => v === 'random'));
});

test('chance — доля случайных близка к p и воспроизводима', () => {
  const a = take(createChooser('chance:0.3', mulberry32(9)), 2000);
  const b = take(createChooser('chance:0.3', mulberry32(9)), 2000);
  assert.deepEqual(a, b);
  const share = a.filter((v) => v === 'random').length / a.length;
  assert.ok(share > 0.25 && share < 0.35, `доля ${share}`);
});

test('строка политики задаёт оба уровня, объект — раздельно', () => {
  const both = createPolicy('random', mulberry32(1));
  assert.equal(both.goal(), 'random'); assert.equal(both.action(), 'random');
  const split = createPolicy({ goal: 'planned', action: 'random' }, mulberry32(1));
  assert.equal(split.goal(), 'planned'); assert.equal(split.action(), 'random');
});

test('slug пригоден для имени каталога', () => {
  assert.equal(policySlug('burst:30/10'), 'burst-30-10');
  assert.equal(policySlug({ goal: 'planned', action: 'every:2' }), 'g-planned_a-every-2');
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run (из `E:/projects/claude-marketplace`): `node --test plugins/verify-cocos/tests/`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализация**

`plugins/verify-cocos/.claude-plugin/plugin.json`:
```json
{
  "name": "verify-cocos",
  "version": "0.1.0",
  "description": "Game-playing QA bot for Cocos Creator web builds: deterministic runs by seed, goal/tactic agent with configurable randomness, oracles, decision trace and replay",
  "author": {
    "name": "Nikita Shvyryaev",
    "email": "nikitagsh@gmail.com"
  }
}
```

В `.claude-plugin/marketplace.json` добавить в массив `plugins` после `verify-web`:
```json
    {
      "name": "verify-cocos",
      "source": "./plugins/verify-cocos",
      "description": "Game-playing QA bot for Cocos Creator web builds: deterministic runs by seed, goal/tactic agent with configurable randomness, oracles, decision trace and replay"
    }
```

`plugins/verify-cocos/scripts/lib/rng.mjs`:
```js
// Детерминированный PRNG. Тот же алгоритм живёт в shim.mjs внутри страницы —
// тест shim.test.mjs сверяет, что последовательности совпадают.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Поток бота отделён от потока игры: смена паттерна случайности не должна
// менять спавн врагов при том же seed.
export const botSeed = (seed) => (seed ^ 0x9e3779b9) >>> 0;

export const pickIndex = (rng, n) => Math.floor(rng() * n);
```

`plugins/verify-cocos/scripts/lib/policy.mjs`:
```js
// Паттерны случайности: когда бот выбирает по плану, а когда наугад.
//
// Применяются отдельно к выбору краткосрочной цели и к выбору действия.
// Строка вида 'every:10' задаёт оба уровня сразу, объект { goal, action } —
// раздельно.

function fail(spec) {
  return new Error(`Неизвестный паттерн: ${typeof spec === 'string' ? spec : JSON.stringify(spec)}`);
}

export function parsePattern(spec) {
  if (spec && typeof spec === 'object') {
    return parsePattern(
      spec.pattern === 'every' ? `every:${spec.n}`
        : spec.pattern === 'burst' ? `burst:${spec.planned}/${spec.random}`
          : spec.pattern === 'chance' ? `chance:${spec.p}`
            : String(spec.pattern),
    );
  }
  if (spec === 'planned' || spec === 'random') return { pattern: spec };
  const [name, arg = ''] = String(spec).split(':');
  if (name === 'every') {
    const n = Number(arg);
    if (Number.isInteger(n) && n >= 1) return { pattern: 'every', n };
  }
  if (name === 'burst') {
    const [planned, random] = arg.split('/').map(Number);
    if (Number.isInteger(planned) && Number.isInteger(random) && planned >= 0 && random >= 0 && planned + random > 0) {
      return { pattern: 'burst', planned, random };
    }
  }
  if (name === 'chance') {
    const p = Number(arg);
    if (arg !== '' && p >= 0 && p <= 1) return { pattern: 'chance', p };
  }
  throw fail(spec);
}

export function createChooser(spec, rng) {
  const parsed = parsePattern(spec);
  let count = 0;
  switch (parsed.pattern) {
    case 'planned': return () => 'planned';
    case 'random': return () => 'random';
    case 'every': return () => (++count % parsed.n === 0 ? 'random' : 'planned');
    case 'burst': return () => {
      const at = count++ % (parsed.planned + parsed.random);
      return at < parsed.planned ? 'planned' : 'random';
    };
    case 'chance': return () => (rng() < parsed.p ? 'random' : 'planned');
    default: throw fail(spec);
  }
}

const split = (spec) => (spec && typeof spec === 'object' && ('goal' in spec || 'action' in spec)
  ? { goal: spec.goal ?? 'planned', action: spec.action ?? 'planned' }
  : { goal: spec ?? 'planned', action: spec ?? 'planned' });

export function createPolicy(spec, rng) {
  const { goal, action } = split(spec);
  return { goal: createChooser(goal, rng), action: createChooser(action, rng) };
}

const slugOf = (s) => String(typeof s === 'object' ? JSON.stringify(s) : s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

export function policySlug(spec) {
  const { goal, action } = split(spec);
  return goal === action ? slugOf(goal) : `g-${slugOf(goal)}_a-${slugOf(action)}`;
}
```

- [ ] **Step 4: Разложить общий код в новый плагин**

С появлением каталога `plugins/verify-cocos` sync-тест ждёт в нём `vendor/cdp`.
Run: `node tools/sync-shared.mjs`
Expected: строки для `verify-web` и `verify-cocos`.

- [ ] **Step 5: Тесты проходят**

Run: `node --test tests/ && node --test plugins/verify-cocos/tests/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin/marketplace.json plugins/verify-cocos
git commit -m "feat(verify-cocos): каркас плагина, PRNG и паттерны случайности"
```

---

### Task 3: Агент — цикл целей, оракулы, журнал

**Files:**
- Create: `plugins/verify-cocos/scripts/lib/trace.mjs`
- Create: `plugins/verify-cocos/scripts/lib/oracles.mjs`
- Create: `plugins/verify-cocos/scripts/lib/agent.mjs`
- Test: `plugins/verify-cocos/tests/helpers/toy.mjs`, `plugins/verify-cocos/tests/agent.test.mjs`, `plugins/verify-cocos/tests/trace.test.mjs`

**Interfaces:**
- Consumes: `pickIndex` (задача 2); `createPolicy` (в тестах).
- Produces: `trace.mjs` → `createTrace() → { write(entry), entries }`, `saveTrace(dir, trace, tail = 200)` (пишет `trace.jsonl`, `tail.jsonl`), `readTraceLines(file) → string[]`.
- Produces: `oracles.mjs` → `createStallOracle(stallFrames, progress) → { id: 'stall', check }`, `checkOracles(oracles, prev, cur, events, ctx) → { id, message, data } | null`. Сигнатура проектного оракула: `{ id, check(prev, cur, events, ctx) → null | { message, data } }`, `ctx = { frame }`.
- Produces: `agent.mjs` → `runAgent({ game, adapter, missionName, policy, rng, limits, trace }) → Promise<{ verdict, frame, goals, violation, lastRaw, lastModel }>`.
  - `game`: `{ observe(): Promise<raw>, actions(): Promise<action[]>, act(action|null): Promise<op[]>, step(n): Promise<{ frames, events }>, errors(): {kind,text}[] }`.
  - `adapter`: `{ toModel(raw), progress(model) → number, missions: { [name]: { done(model, events) } }, candidates(model, mission) → goal[], replanOn: string[], tactics: { [kind]: { next(model, goal) → { action, frames } } }, oracles: oracle[], summary?(model) → string }`.
  - `goal`: `{ kind, id, score, params, done(model, events), failed(model, events) }`; агент добавляет `goal.memo = {}`.
  - `limits`: `{ maxFrames, stallFrames, goalTimeoutFrames, maxGoalFailures, randomActionFrames, stopAt? }`.
  - Вердикты: `pass`, `lose`, `bug`, `bot-stuck`, `bot-error`, `timeout`, `stopped`.

- [ ] **Step 1: Игрушечная игра и адаптер для тестов**

`plugins/verify-cocos/tests/helpers/toy.mjs`:
```js
// Игрушечная игра без браузера: точка на прямой идёт к цели.
// Событие 'bump' — на каждой клетке, кратной 3; 'reached' — в цели.
export function toyGame({ target = 5, errorsAfterStep = null } = {}) {
  let x = 0; let dir = 0; let steps = 0;
  return {
    get x() { return x; },
    observe: async () => ({ x, target }),
    actions: async () => [{ dir: 1 }, { dir: -1 }, { dir: 0 }],
    act: async (action) => { dir = action?.dir ?? 0; return []; },
    step: async (n) => {
      steps++;
      for (let i = 1; i <= n; i++) {
        x += dir;
        const events = [];
        if (dir !== 0 && x % 3 === 0) events.push({ type: 'bump', x });
        if (x === target) events.push({ type: 'reached' });
        if (events.length) return { frames: i, events };
      }
      return { frames: n, events: [] };
    },
    errors: () => (errorsAfterStep !== null && steps >= errorsAfterStep ? [{ kind: 'console', text: 'boom' }] : []),
  };
}

export function toyAdapter(overrides = {}) {
  const walk = (dir) => ({ next: () => ({ action: { dir }, frames: 2 }) });
  return {
    toModel: (raw) => ({ ...raw }),
    progress: (m) => m.x,
    missions: { reach: { done: (m) => m.x === m.target } },
    candidates: () => [
      { kind: 'right', id: 'go-right', score: 1, params: {}, done: (m) => m.x === m.target, failed: () => false },
      { kind: 'left', id: 'go-left', score: 0.1, params: {}, done: () => false, failed: () => false },
    ],
    replanOn: ['bump'],
    tactics: { right: walk(1), left: walk(-1), idle: walk(0) },
    oracles: [{ id: 'x-nonneg', check: (prev, cur) => (cur.x < 0 ? { message: `x=${cur.x}`, data: { x: cur.x } } : null) }],
    summary: (m) => `x=${m.x}`,
    ...overrides,
  };
}

export const LIMITS = { maxFrames: 1000, stallFrames: 500, goalTimeoutFrames: 100, maxGoalFailures: 3, randomActionFrames: 4 };
```

- [ ] **Step 2: Написать падающие тесты агента и журнала**

`plugins/verify-cocos/tests/agent.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../scripts/lib/agent.mjs';
import { createTrace } from '../scripts/lib/trace.mjs';
import { createPolicy } from '../scripts/lib/policy.mjs';
import { mulberry32 } from '../scripts/lib/rng.mjs';
import { toyGame, toyAdapter, LIMITS } from './helpers/toy.mjs';

async function run({ game = toyGame(), adapter = toyAdapter(), policy = 'planned', limits = {}, mission = 'reach', seed = 1 } = {}) {
  const trace = createTrace();
  const rng = mulberry32(seed);
  const result = await runAgent({ game, adapter, missionName: mission, policy: createPolicy(policy, rng), rng, limits: { ...LIMITS, ...limits }, trace });
  return { result, trace, game };
}

test('по плану бот выбирает цель с лучшей оценкой и выполняет миссию', async () => {
  const { result, trace } = await run();
  assert.equal(result.verdict, 'pass');
  const plan = trace.entries.find((e) => e.t === 'plan');
  assert.equal(plan.chosen, 'go-right');
  assert.equal(plan.by, 'score');
  assert.ok(trace.entries.some((e) => e.t === 'act' && e.by === 'tactic'));
  assert.equal(trace.entries.at(-1).t, 'end');
});

test('событие из replanOn запускает пересмотр целей', async () => {
  const { trace } = await run();
  const plans = trace.entries.filter((e) => e.t === 'plan');
  assert.ok(plans.length >= 2, `пересмотров: ${plans.length}`);
  assert.ok(trace.entries.some((e) => e.t === 'goal-end' && e.result === 'replan'));
});

test('нарушение оракула — вердикт bug с данными нарушения', async () => {
  const adapter = toyAdapter({ candidates: () => [{ kind: 'left', id: 'go-left', score: 1, params: {}, done: () => false, failed: () => false }] });
  const { result, trace } = await run({ adapter });
  assert.equal(result.verdict, 'bug');
  assert.equal(result.violation.id, 'x-nonneg');
  assert.ok(trace.entries.some((e) => e.t === 'violation' && e.oracle === 'x-nonneg'));
});

test('цель, не завершённая за goalTimeoutFrames, N раз подряд — bot-stuck', async () => {
  const adapter = toyAdapter({ candidates: () => [{ kind: 'idle', id: 'idle', score: 1, params: {}, done: () => false, failed: () => false }] });
  const { result, trace } = await run({ adapter, limits: { goalTimeoutFrames: 6, maxGoalFailures: 2 } });
  assert.equal(result.verdict, 'bot-stuck');
  assert.equal(trace.entries.filter((e) => e.t === 'goal-end' && e.result === 'timeout').length, 2);
});

test('нет прогресса за stallFrames — bug stall', async () => {
  const adapter = toyAdapter({ candidates: () => [{ kind: 'idle', id: 'idle', score: 1, params: {}, done: () => false, failed: () => false }] });
  const { result } = await run({ adapter, limits: { stallFrames: 10, goalTimeoutFrames: 1000 } });
  assert.equal(result.verdict, 'bug');
  assert.equal(result.violation.id, 'stall');
});

test('ошибка в консоли страницы — bug console-error', async () => {
  const { result } = await run({ game: toyGame({ target: 50, errorsAfterStep: 1 }) });
  assert.equal(result.verdict, 'bug');
  assert.equal(result.violation.id, 'console-error');
  assert.match(result.violation.message, /boom/);
});

test('исключение в модуле адаптера — bot-error, не bug игры', async () => {
  const adapter = toyAdapter({ tactics: { right: { next: () => { throw new Error('опечатка в тактике'); } }, left: { next: () => ({ action: { dir: -1 }, frames: 1 }) } } });
  const { result } = await run({ adapter });
  assert.equal(result.verdict, 'bot-error');
  assert.match(result.violation.message, /опечатка в тактике/);
});

test('исключение моста — bug bridge-error', async () => {
  const game = toyGame(); game.step = async () => { throw new Error('observe упал'); };
  const { result } = await run({ game });
  assert.equal(result.verdict, 'bug');
  assert.equal(result.violation.id, 'bridge-error');
});

test('превышен maxFrames — timeout', async () => {
  const adapter = toyAdapter({ candidates: () => [{ kind: 'idle', id: 'idle', score: 1, params: {}, done: () => false, failed: () => false }] });
  const { result } = await run({ adapter, limits: { maxFrames: 12, stallFrames: 1000, goalTimeoutFrames: 1000 } });
  assert.equal(result.verdict, 'timeout');
});

test('stopAt останавливает прогон с вердиктом stopped', async () => {
  const { result } = await run({ game: toyGame({ target: 100 }), limits: { stopAt: 4 } });
  assert.equal(result.verdict, 'stopped');
  assert.ok(result.frame >= 4);
});

test('случайная политика воспроизводима: один seed — один журнал', async () => {
  const a = await run({ game: toyGame({ target: 7 }), policy: 'every:2', seed: 5 });
  const b = await run({ game: toyGame({ target: 7 }), policy: 'every:2', seed: 5 });
  assert.deepEqual(a.trace.entries, b.trace.entries);
  assert.ok(a.trace.entries.some((e) => e.by === 'random'));
});
```

`plugins/verify-cocos/tests/trace.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTrace, saveTrace, readTraceLines } from '../scripts/lib/trace.mjs';

test('журнал пишется построчно, хвост — последние N строк', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vc-trace-'));
  const trace = createTrace();
  for (let f = 0; f < 10; f++) trace.write({ f, t: 'act' });
  await saveTrace(dir, trace, 3);
  const lines = await readTraceLines(path.join(dir, 'trace.jsonl'));
  assert.equal(lines.length, 10);
  assert.deepEqual(JSON.parse(lines[9]), { f: 9, t: 'act' });
  const tail = (await readFile(path.join(dir, 'tail.jsonl'), 'utf8')).trim().split('\n');
  assert.deepEqual(tail.map((l) => JSON.parse(l).f), [7, 8, 9]);
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `node --test plugins/verify-cocos/tests/`
Expected: FAIL — `agent.mjs`, `trace.mjs` не найдены.

- [ ] **Step 4: Реализация**

`plugins/verify-cocos/scripts/lib/trace.mjs`:
```js
// Журнал решений бота: одна запись на событие, JSONL.
//
// В записях нет времени стенных часов — только кадры. Иначе replay не смог бы
// сравнить журналы построчно.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

export function createTrace() {
  const entries = [];
  return { entries, write: (entry) => entries.push(entry) };
}

export async function saveTrace(dir, trace, tail = 200) {
  await mkdir(dir, { recursive: true });
  const lines = trace.entries.map((entry) => JSON.stringify(entry));
  await writeFile(path.join(dir, 'trace.jsonl'), `${lines.join('\n')}\n`);
  await writeFile(path.join(dir, 'tail.jsonl'), `${lines.slice(-tail).join('\n')}\n`);
}

export async function readTraceLines(file) {
  return (await readFile(file, 'utf8')).split('\n').map((line) => line.trim()).filter(Boolean);
}
```

`plugins/verify-cocos/scripts/lib/oracles.mjs`:
```js
// Оракулы — правила, которые должны выполняться всегда. Нарушение — баг игры.
//
// Базовый оракул плагина — «нет прогресса»: что считать прогрессом, решает
// проект (adapter.progress). Остальные базовые проверки (ошибки консоли,
// исключения моста) агент делает сам — им не нужны состояния.

export function createStallOracle(stallFrames, progress) {
  let best = -Infinity;
  let since = 0;
  return {
    id: 'stall',
    check(prev, cur, events, { frame }) {
      const value = progress(cur);
      if (value > best || events.length > 0) {
        best = Math.max(best, value);
        since = frame;
        return null;
      }
      if (frame - since >= stallFrames) {
        return { message: `нет прогресса ${frame - since} кадров (прогресс ${value})`, data: { value, since } };
      }
      return null;
    },
  };
}

export function checkOracles(oracles, prev, cur, events, ctx) {
  for (const oracle of oracles) {
    const violation = oracle.check(prev, cur, events, ctx);
    if (violation) return { id: oracle.id, message: violation.message, data: violation.data ?? null };
  }
  return null;
}
```

`plugins/verify-cocos/scripts/lib/agent.mjs`:
```js
// Агент: долгосрочная миссия → краткосрочная цель → тактика → действие.
//
// Модель по мотивам BDI (iv4XR/aplib): цели пересматриваются по событиям из
// adapter.replanOn, по завершению, провалу или таймауту цели. Выбор цели и
// выбор действия проходят через политику случайности независимо.
//
// Три класса исходов: баг игры (bug), беда бота (bot-stuck, bot-error,
// timeout) и нормальный конец (pass, lose, stopped).
import { pickIndex } from './rng.mjs';
import { createStallOracle, checkOracles } from './oracles.mjs';

const TOP_CANDIDATES = 5;
const round = (value) => Math.round(value * 1000) / 1000;

class AdapterError extends Error {}

function guard(fn, label) {
  try {
    return fn();
  } catch (error) {
    throw new AdapterError(`${label}: ${error.message}`);
  }
}

export async function runAgent({ game, adapter, missionName, policy, rng, limits, trace }) {
  const mission = adapter.missions[missionName];
  if (!mission) throw new Error(`Нет миссии ${missionName}; есть: ${Object.keys(adapter.missions).join(', ')}`);
  const stall = createStallOracle(limits.stallFrames, adapter.progress);

  let frame = 0;
  let goals = 0;
  let failures = 0;
  let goal = null;
  let goalStart = 0;
  let events = [];
  let raw = null;
  let model = null;

  const end = (verdict, violation = null) => {
    trace.write({ f: frame, t: 'end', verdict, ...(violation ? { violation: violation.id } : {}) });
    return { verdict, frame, goals, violation, lastRaw: raw, lastModel: model };
  };

  trace.write({ f: 0, t: 'mission', mission: missionName });

  try {
    raw = await game.observe();
    model = guard(() => adapter.toModel(raw), 'toModel');

    for (;;) {
      if (guard(() => mission.done(model, events), 'mission.done')) return end('pass');
      if (events.some((event) => event.type === 'gameOver')) return end('lose');
      if (frame >= limits.maxFrames) return end('timeout');
      if (limits.stopAt != null && frame >= limits.stopAt) return end('stopped');

      if (goal) {
        let result = null;
        if (guard(() => goal.done(model, events), 'goal.done')) result = 'done';
        else if (guard(() => goal.failed(model, events), 'goal.failed')) result = 'failed';
        else if (frame - goalStart >= limits.goalTimeoutFrames) result = 'timeout';
        else if (events.some((event) => adapter.replanOn.includes(event.type))) result = 'replan';
        if (result) {
          trace.write({ f: frame, t: 'goal-end', goal: goal.id, result, frames: frame - goalStart });
          if (result === 'failed' || result === 'timeout') failures++;
          if (result === 'done') failures = 0;
          goal = null;
        }
      }
      if (failures >= limits.maxGoalFailures) return end('bot-stuck');

      if (!goal) {
        const candidates = guard(() => adapter.candidates(model, mission), 'candidates');
        if (candidates.length > 0) {
          const by = policy.goal() === 'random' ? 'random' : 'score';
          let chosen = candidates[0];
          if (by === 'random') chosen = candidates[pickIndex(rng, candidates.length)];
          else for (const candidate of candidates) if (candidate.score > chosen.score) chosen = candidate;
          goal = { ...chosen, memo: {} };
          goalStart = frame;
          goals++;
          const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, TOP_CANDIDATES);
          trace.write({
            f: frame, t: 'plan', count: candidates.length,
            candidates: top.map((c) => ({ id: c.id, score: round(c.score) })),
            chosen: goal.id, by,
          });
        } else {
          trace.write({ f: frame, t: 'plan', count: 0 });
        }
      }

      let action = null;
      let frames = 1;
      let by;
      if (goal && policy.action() !== 'random') {
        ({ action, frames } = guard(() => adapter.tactics[goal.kind].next(model, goal), `tactics.${goal.kind}`));
        by = 'tactic';
      } else {
        const actions = await game.actions();
        action = actions.length > 0 ? actions[pickIndex(rng, actions.length)] : null;
        frames = 1 + pickIndex(rng, limits.randomActionFrames);
        by = goal ? 'random' : 'no-goal';
      }
      frames = Math.max(1, Math.floor(frames));

      await game.act(action);
      trace.write({ f: frame, t: 'act', goal: goal?.id ?? null, action, frames, by });
      const stepped = await game.step(frames);
      frame += stepped.frames;
      events = stepped.events;
      for (const event of events) trace.write({ f: frame, t: 'event', ...event });

      const prev = model;
      raw = await game.observe();
      model = guard(() => adapter.toModel(raw), 'toModel');

      const errors = game.errors();
      const violation = errors.length > 0
        ? { id: 'console-error', message: errors.map((e) => e.text).join(' | '), data: errors }
        : guard(() => checkOracles([stall, ...adapter.oracles], prev, model, events, { frame }), 'oracles');
      if (violation) {
        trace.write({ f: frame, t: 'violation', oracle: violation.id, message: violation.message, data: violation.data });
        return end('bug', violation);
      }
    }
  } catch (error) {
    if (error instanceof AdapterError) {
      const violation = { id: 'adapter-error', message: error.message, data: null };
      trace.write({ f: frame, t: 'violation', oracle: violation.id, message: violation.message });
      return end('bot-error', violation);
    }
    const violation = { id: 'bridge-error', message: error.message, data: null };
    trace.write({ f: frame, t: 'violation', oracle: violation.id, message: violation.message });
    return end('bug', violation);
  }
}
```

- [ ] **Step 5: Тесты проходят**

Run: `node --test plugins/verify-cocos/tests/`
Expected: PASS (все тесты задач 2–3).

- [ ] **Step 6: Commit**

```bash
git add plugins/verify-cocos
git commit -m "feat(verify-cocos): агент целей и тактик, оракулы, журнал решений"
```

---

### Task 4: Статический сервер, клавиши, shim страницы

**Files:**
- Create: `plugins/verify-cocos/scripts/lib/serve.mjs`
- Create: `plugins/verify-cocos/scripts/lib/keys.mjs`
- Create: `plugins/verify-cocos/scripts/lib/shim.mjs`
- Test: `plugins/verify-cocos/tests/serve.test.mjs`, `plugins/verify-cocos/tests/keys.test.mjs`, `plugins/verify-cocos/tests/shim.test.mjs`

**Interfaces:**
- Consumes: `mulberry32` (в тесте shim).
- Produces: `serveDir(dir) → Promise<{ url, close() }>` (бросает `Нет каталога сборки: <путь>`).
- Produces: `KEYS` (имя → `{ key, code, keyCode }`), `keyEvents(op) → CDP-параметры[]`, `dispatchOps(cdp, ops)`. `op = { type: 'keyDown' | 'keyUp' | 'press', key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Space' | 'Enter' | 'Escape' }`.
- Produces: `shimSource({ seed, fps }) → string`. В странице — `window.__botShim = { fps, freeze(), reseed(seed), step(n), stepUntilEvents(n) → { frames, events }, frames(), now() }`; `stepUntilEvents` после каждого кадра вызывает `window.__bot.frameEvents()` и останавливается на первом непустом.

- [ ] **Step 1: Написать падающие тесты**

`plugins/verify-cocos/tests/serve.test.mjs`:
```js
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
```

`plugins/verify-cocos/tests/keys.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyEvents, dispatchOps } from '../scripts/lib/keys.mjs';

test('press — нажатие и отпускание с кодом клавиши', () => {
  const events = keyEvents({ type: 'press', key: 'ArrowUp' });
  assert.deepEqual(events.map((e) => e.type), ['keyDown', 'keyUp']);
  assert.equal(events[0].windowsVirtualKeyCode, 38);
  assert.equal(events[0].code, 'ArrowUp');
});

test('пробел — key " ", code Space', () => {
  const [down] = keyEvents({ type: 'keyDown', key: 'Space' });
  assert.equal(down.key, ' ');
  assert.equal(down.code, 'Space');
  assert.equal(down.windowsVirtualKeyCode, 32);
});

test('неизвестная клавиша или тип — ошибка с названием', () => {
  assert.throws(() => keyEvents({ type: 'keyDown', key: 'KeyQ' }), /KeyQ/);
  assert.throws(() => keyEvents({ type: 'tap', key: 'Space' }), /tap/);
});

test('dispatchOps шлёт события по порядку', async () => {
  const sent = [];
  await dispatchOps({ send: async (method, params) => sent.push([method, params.type, params.code]) },
    [{ type: 'keyUp', key: 'ArrowLeft' }, { type: 'keyDown', key: 'ArrowUp' }]);
  assert.deepEqual(sent, [['Input.dispatchKeyEvent', 'keyUp', 'ArrowLeft'], ['Input.dispatchKeyEvent', 'keyDown', 'ArrowUp']]);
});
```

`plugins/verify-cocos/tests/shim.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { shimSource } from '../scripts/lib/shim.mjs';
import { mulberry32 } from '../scripts/lib/rng.mjs';

// Страница-заглушка: настоящий rAF копит колбэки, их вызывает тест.
function page(seed = 7, fps = 60) {
  const real = [];
  const ctx = { requestAnimationFrame: (cb) => { real.push(cb); return real.length; }, performance: { now: () => 123 } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(shimSource({ seed, fps }), ctx);
  const run = (code) => vm.runInContext(code, ctx);
  const realFrame = () => { const cb = real.shift(); cb(0); };
  return { ctx, run, realFrame };
}

test('Math.random страницы совпадает с mulberry32 плагина', () => {
  const { run } = page(7);
  const expected = mulberry32(7);
  for (let i = 0; i < 5; i++) assert.equal(run('Math.random()'), expected());
});

test('reseed перезапускает поток', () => {
  const { run } = page(7);
  run('Math.random(); Math.random()');
  run('__botShim.reseed(11)');
  assert.equal(run('Math.random()'), mulberry32(11)());
});

test('до заморозки настоящий кадр прокручивает очередь rAF', () => {
  const { run, realFrame } = page();
  run('globalThis.calls = 0; requestAnimationFrame(() => calls++)');
  realFrame();
  assert.equal(run('calls'), 1);
});

test('после заморозки время и кадры идут только по step', () => {
  const { run, realFrame } = page();
  run(`globalThis.stamps = []; const loop = (t) => { stamps.push(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop);`);
  run('__botShim.freeze()');
  realFrame(); realFrame();
  assert.equal(run('stamps.length'), 0);
  run('__botShim.step(3)');
  const stamps = run('stamps');
  assert.equal(stamps.length, 3);
  const frameMs = 1000 / 60;
  // Время после заморозки ~1e9 мс: точность double там ~1e-7.
  assert.ok(Math.abs(stamps[1] - stamps[0] - frameMs) < 1e-6);
  assert.ok(Math.abs(stamps[2] - stamps[1] - frameMs) < 1e-6);
  assert.equal(run('performance.now()'), stamps[2]);
  assert.equal(run('__botShim.frames()'), 3);
});

test('stepUntilEvents останавливается на первом кадре с событиями', () => {
  const { run } = page();
  run(`let n = 0; window.__bot = { frameEvents: () => (++n === 4 ? [{ type: 'x' }] : []) }; __botShim.freeze()`);
  // Объекты из vm — из чужого realm: deepStrictEqual сравнивает прототипы,
  // поэтому результат проходит через JSON.
  const step = (n) => JSON.parse(run(`JSON.stringify(__botShim.stepUntilEvents(${n}))`));
  assert.deepEqual(step(10), { frames: 4, events: [{ type: 'x' }] });
  assert.deepEqual(step(2), { frames: 2, events: [] });
});

test('cancelAnimationFrame снимает колбэк из очереди', () => {
  const { run } = page();
  run('globalThis.calls = 0; const id = requestAnimationFrame(() => calls++); cancelAnimationFrame(id); __botShim.freeze(); __botShim.step(1)');
  assert.equal(run('calls'), 0);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test plugins/verify-cocos/tests/`
Expected: FAIL — `serve.mjs`, `keys.mjs`, `shim.mjs` не найдены.

- [ ] **Step 3: Реализация**

`plugins/verify-cocos/scripts/lib/serve.mjs`:
```js
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

export async function serveDir(dir) {
  const root = path.resolve(dir);
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`Нет каталога сборки: ${root}`);

  const server = http.createServer(async (req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, `.${rel}`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    // Chrome держит keep-alive соединения — без их обрыва close ждёт вечно.
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}
```

`plugins/verify-cocos/scripts/lib/keys.mjs`:
```js
// Ввод идёт настоящим путём браузера — Input.dispatchKeyEvent, — а не записью
// в компоненты игры: так проверяется и обработка клавиш, и блокировки ввода.
export const KEYS = {
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
};

const params = (type, { key, code, keyCode }) => ({
  type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
});

export function keyEvents(op) {
  const key = KEYS[op?.key];
  if (!key) throw new Error(`Неизвестная клавиша в действии моста: ${op?.key}`);
  if (op.type === 'keyDown') return [params('keyDown', key)];
  if (op.type === 'keyUp') return [params('keyUp', key)];
  if (op.type === 'press') return [params('keyDown', key), params('keyUp', key)];
  throw new Error(`Неизвестный тип ввода в действии моста: ${op.type}`);
}

export async function dispatchOps(cdp, ops) {
  for (const op of ops) {
    for (const event of keyEvents(op)) await cdp.send('Input.dispatchKeyEvent', event);
  }
}
```

`plugins/verify-cocos/scripts/lib/shim.mjs`:
```js
// Код, который внедряется в страницу раньше самой игры.
//
// 1. Math.random — PRNG с seed (тот же алгоритм, что rng.mjs).
// 2. performance.now и Date.now — виртуальное время, растущее только с кадрами.
// 3. requestAnimationFrame — своя очередь. До freeze() её прокручивает
//    настоящий rAF (игра грузится как обычно); после — только step(n).
//
// Главный цикл Cocos держится на rAF, поэтому очередь rAF и есть его кадры:
// один step — один кадр движка с dt ровно 1/fps.
//
// После freeze время прыгает на фиксированную базу: сколько кадров прошло до
// заморозки, зависит от скорости загрузки, и абсолютное время иначе было бы
// недетерминированным.

function shimMain(cfg) {
  const makeRng = (seed) => {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const FROZEN_BASE_MS = 1e9;
  const EPOCH_MS = 1767225600000;
  // Запас против округления: счётчики кадров движка делят прошедшее время на
  // длину кадра, и 0.99999 кадра не должно превращаться в ноль.
  const EPS_MS = 0.01;
  const frameMs = 1000 / cfg.fps;

  let rng = makeRng(cfg.seed);
  Math.random = () => rng();

  let base = 0;
  let frames = 0;
  let now = 0;
  performance.now = () => now;
  Date.now = () => EPOCH_MS + Math.floor(now);

  const realRaf = window.requestAnimationFrame.bind(window);
  let queue = [];
  let nextId = 1;
  let frozen = false;

  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue = queue.filter((entry) => entry.id !== id);
  };

  const pump = () => {
    frames++;
    now = base + frames * frameMs + EPS_MS;
    const run = queue;
    queue = [];
    for (const entry of run) entry.cb(now);
  };
  const loop = () => {
    if (!frozen) pump();
    realRaf(loop);
  };
  realRaf(loop);

  window.__botShim = {
    fps: cfg.fps,
    freeze() {
      frozen = true;
      base = FROZEN_BASE_MS;
      frames = 0;
    },
    reseed(seed) {
      rng = makeRng(seed);
    },
    step(n) {
      for (let i = 0; i < n; i++) pump();
    },
    stepUntilEvents(n) {
      let events = [];
      let i = 0;
      while (i < n) {
        pump();
        i++;
        events = window.__bot.frameEvents();
        if (events.length > 0) break;
      }
      return { frames: i, events };
    },
    frames: () => frames,
    now: () => now,
  };
}

export function shimSource({ seed, fps }) {
  return `(${shimMain.toString()})(${JSON.stringify({ seed: seed >>> 0, fps })});`;
}
```

- [ ] **Step 4: Тесты проходят**

Run: `node --test plugins/verify-cocos/tests/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/verify-cocos
git commit -m "feat(verify-cocos): сервер сборки, ввод через CDP и shim страницы"
```

---

### Task 5: Сессия игры в браузере

**Files:**
- Create: `plugins/verify-cocos/scripts/lib/session.mjs`
- Create (генерируется): `plugins/verify-cocos/scripts/vendor/cdp/*` — `node tools/sync-shared.mjs`
- Test: `plugins/verify-cocos/tests/fixtures/toy-game/index.html`, `plugins/verify-cocos/tests/fixtures/toy-bridge.js`, `plugins/verify-cocos/tests/fixtures/dead-bridge.js`, `plugins/verify-cocos/tests/session.chrome.test.mjs`

**Interfaces:**
- Consumes: `launchChrome`, `connect`, `chromePath` из `../vendor/cdp/`; `serveDir`, `shimSource`, `dispatchOps` (задача 4).
- Produces: `openSession({ root, config, seed }) → Promise<game>`; `config` — полный конфиг с `build`, `bridge`, `fps`, `viewport: { width, height }`, `limits: { bootTimeoutMs, startFrames, settleMs }`; пути относительно `root`.
  `game = { start(params), observe(), actions(), act(action), step(n), errors(), screenshot(file), close() }` — тот же `game`, что ждёт `runAgent`.
- Контракт моста в странице (`window.__bot`): `whenBooted() → Promise`, `preload(params) → Promise`, `start(params)`, `ready() → boolean`, `observe() → State`, `actions() → action[]`, `act(action) → op[]`, `frameEvents() → event[]`.

- [ ] **Step 1: Фикстуры и падающий тест**

`plugins/verify-cocos/tests/fixtures/toy-game/index.html`:
```html
<!doctype html>
<html><body><script>
  // Игрушка: x растёт, пока зажата стрелка вправо; target — из Math.random.
  const toy = { x: 0, dir: null, frame: 0, t: 0, target: Math.floor(Math.random() * 1000) };
  addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') toy.dir = 'right'; });
  addEventListener('keyup', (e) => { if (e.key === 'ArrowRight') toy.dir = null; });
  const loop = (t) => { toy.frame++; toy.t = t; if (toy.dir === 'right') toy.x++; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.toy = toy;
</script></body></html>
```

`plugins/verify-cocos/tests/fixtures/toy-bridge.js`:
```js
(() => {
  let last = 0;
  let held = false;
  window.__bot = {
    whenBooted: () => new Promise((resolve) => { const tick = () => (window.toy ? resolve(true) : setTimeout(tick, 20)); tick(); }),
    preload: async () => true,
    start: () => { window.toy.x = 0; last = 0; return true; },
    ready: () => window.toy.frame > 0,
    observe: () => ({ x: window.toy.x, t: window.toy.t, target: window.toy.target }),
    actions: () => [{ type: 'move', dir: 'right' }, { type: 'move', dir: 'none' }],
    act: (action) => {
      const want = action?.dir === 'right';
      if (want === held) return [];
      held = want;
      return [{ type: want ? 'keyDown' : 'keyUp', key: 'ArrowRight' }];
    },
    frameEvents: () => {
      const events = window.toy.x === 5 && last !== 5 ? [{ type: 'five' }] : [];
      last = window.toy.x;
      return events;
    },
  };
})();
```

`plugins/verify-cocos/tests/fixtures/dead-bridge.js`:
```js
window.__bot = { whenBooted: () => new Promise(() => {}) };
```

`plugins/verify-cocos/tests/session.chrome.test.mjs`:
```js
// Интеграционный тест с настоящим Chrome. Без Chrome — пропускается.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from '../scripts/lib/session.mjs';
import { chromePath } from '../scripts/vendor/cdp/chrome.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
let hasChrome = true;
try { chromePath(); } catch { hasChrome = false; }

const config = (bridge, limits = {}) => ({
  build: 'toy-game', bridge, fps: 60, viewport: { width: 320, height: 240 },
  limits: { bootTimeoutMs: 20000, startFrames: 100, settleMs: 5, ...limits },
});

test('ввод, прокрутка кадров, события и виртуальное время', { skip: !hasChrome }, async () => {
  const game = await openSession({ root, config: config('toy-bridge.js'), seed: 42 });
  try {
    await game.start({});
    // Первый кадр после заморозки: до него время шло от свободных кадров.
    await game.step(1);
    const t0 = (await game.observe()).t;
    const ops = await game.act({ type: 'move', dir: 'right' });
    assert.deepEqual(ops, [{ type: 'keyDown', key: 'ArrowRight' }]);
    const stepped = await game.step(20);
    assert.equal(stepped.frames, 5);
    assert.deepEqual(stepped.events, [{ type: 'five' }]);
    const state = await game.observe();
    assert.equal(state.x, 5);
    assert.ok(Math.abs(state.t - t0 - 5 * (1000 / 60)) < 1e-6, `t0=${t0} t=${state.t}`);
    assert.deepEqual(game.errors(), []);
  } finally { await game.close(); }
});

test('один seed — один Math.random в игре, другой seed — другой', { skip: !hasChrome }, async () => {
  const targetOf = async (seed) => {
    const game = await openSession({ root, config: config('toy-bridge.js'), seed });
    try { return (await game.observe()).target; } finally { await game.close(); }
  };
  const a = await targetOf(42);
  assert.equal(await targetOf(42), a);
  assert.notEqual(await targetOf(43), a);
});

test('игра не загрузилась — ошибка за bootTimeoutMs, а не зависание', { skip: !hasChrome }, async () => {
  const started = Date.now();
  await assert.rejects(openSession({ root, config: config('dead-bridge.js', { bootTimeoutMs: 1500 }), seed: 1 }), /не загрузилась/);
  assert.ok(Date.now() - started < 15000);
});
```

Run: `node --test plugins/verify-cocos/tests/`
Expected: FAIL — `session.mjs` не найден.

- [ ] **Step 2: Реализация**

`plugins/verify-cocos/scripts/lib/session.mjs`:
```js
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

export async function openSession({ root, config, seed }) {
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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: shimSource({ seed, fps: config.fps }) });
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

  const call = (expression) => cdp.evaluate(expression);
  const json = (value) => JSON.stringify(value ?? null);

  return {
    async start(params) {
      await call(`window.__bot.preload(${json(params)})`);
      await call(`window.__botShim.freeze(); window.__botShim.reseed(${seed >>> 0}); true`);
      await call(`window.__bot.start(${json(params)})`);
      for (let i = 0; i < config.limits.startFrames; i++) {
        if (await call('window.__bot.ready()')) {
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
    errors: () => cdp.errors.slice(),
    async screenshot(file) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(file, Buffer.from(data, 'base64'));
    },
    close,
  };
}
```

- [ ] **Step 3: Тесты проходят**

Run: `node --test tests/ && node --test plugins/verify-cocos/tests/`
Expected: PASS; тесты `session.chrome` выполняются (не `skipped`), если Chrome установлен.

- [ ] **Step 4: Commit**

```bash
git add plugins/verify-cocos tools tests
git commit -m "feat(verify-cocos): сессия игры в Chrome с мостом и прокруткой кадров"
```

---

### Task 6: Раннер — run, soak, replay, probe и отчёт

**Files:**
- Create: `plugins/verify-cocos/scripts/lib/report.mjs`
- Create: `plugins/verify-cocos/scripts/lib/project.mjs`
- Create: `plugins/verify-cocos/scripts/lib/execute.mjs`
- Create: `plugins/verify-cocos/scripts/verify-cocos.mjs`
- Test: `plugins/verify-cocos/tests/report.test.mjs`, `plugins/verify-cocos/tests/project.test.mjs`

**Interfaces:**
- Consumes: `runAgent` (3), `createTrace`, `saveTrace`, `readTraceLines` (3), `openSession` (5), `createPolicy`, `parsePattern`, `policySlug` (2), `mulberry32`, `botSeed` (2), `zonesForFiles`, `selectScenarios` из `vendor/cdp/zones.mjs`.
- Produces: `report.mjs` → `expectMatches(result, expect) → boolean`, `verdictClass(verdict) → 'игра' | 'бот' | 'среда' | '—'`, `formatRunLine(result) → string`, `summarizeSoak(results) → { byVerdict, bugs: [{ oracle, count, runs }] }`, `formatSoakSummary(summary) → string`, `exitCodeRun(results)`, `exitCodeSoak(results)`, `compareTraces(expected, actual, { prefix }) → null | { line, expected, actual }`.
- Produces: `project.mjs` → `loadConfig(root, override?) → config` (пути `build`, `bridge`, `bot`, `runs`, `out` остаются относительными к `root`), `loadAdapter(root, config) → Promise<{ adapter, hash }>`, `adapterHash(root, config) → Promise<string>`, `loadRuns(root, config) → Promise<run[]>` (`run = { name, title, zone, level, seed, mission, policy, expect }`).
- Produces: `execute.mjs` → `executeRun({ root, config, adapter, hash, spec, outDir, stopAt }) → Promise<result>`, `result = { name, verdict, frame, goals, violation, summary, dir }`.
- Вердикт `error` — сбой среды (нет сборки, игра не загрузилась).

- [ ] **Step 1: Падающие тесты отчёта и загрузки проекта**

`plugins/verify-cocos/tests/report.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectMatches, verdictClass, summarizeSoak, exitCodeRun, exitCodeSoak, compareTraces, formatRunLine } from '../scripts/lib/report.mjs';

test('expect: точный вердикт, список допустимых, лимит кадров', () => {
  assert.ok(expectMatches({ verdict: 'pass', frame: 100 }, { verdict: 'pass' }));
  assert.ok(!expectMatches({ verdict: 'lose', frame: 100 }, { verdict: 'pass' }));
  assert.ok(expectMatches({ verdict: 'lose', frame: 1 }, { verdictIn: ['lose', 'timeout'] }));
  assert.ok(!expectMatches({ verdict: 'pass', frame: 500 }, { verdict: 'pass', maxFrames: 400 }));
});

test('классы вердиктов разделяют игру, бота и среду', () => {
  assert.equal(verdictClass('bug'), 'игра');
  assert.equal(verdictClass('bot-stuck'), 'бот');
  assert.equal(verdictClass('bot-error'), 'бот');
  assert.equal(verdictClass('timeout'), 'бот');
  assert.equal(verdictClass('error'), 'среда');
  assert.equal(verdictClass('pass'), '—');
});

test('soak группирует баги по оракулу', () => {
  const results = [
    { name: 'a', verdict: 'bug', violation: { id: 'x' } },
    { name: 'b', verdict: 'bug', violation: { id: 'x' } },
    { name: 'c', verdict: 'bug', violation: { id: 'y' } },
    { name: 'd', verdict: 'lose' },
  ];
  const summary = summarizeSoak(results);
  assert.deepEqual(summary.byVerdict, { bug: 3, lose: 1 });
  assert.deepEqual(summary.bugs, [{ oracle: 'x', count: 2, runs: ['a', 'b'] }, { oracle: 'y', count: 1, runs: ['c'] }]);
});

test('коды возврата: run — по expect, soak — по багам и среде', () => {
  assert.equal(exitCodeRun([{ ok: true }, { ok: true }]), 0);
  assert.equal(exitCodeRun([{ ok: true }, { ok: false }]), 1);
  assert.equal(exitCodeSoak([{ verdict: 'lose' }, { verdict: 'bot-stuck' }]), 0);
  assert.equal(exitCodeSoak([{ verdict: 'bug' }]), 1);
  assert.equal(exitCodeSoak([{ verdict: 'error' }]), 1);
});

test('сравнение журналов находит первую расходящуюся строку', () => {
  assert.equal(compareTraces(['a', 'b'], ['a', 'b']), null);
  assert.deepEqual(compareTraces(['a', 'b', 'c'], ['a', 'x', 'c']), { line: 2, expected: 'b', actual: 'x' });
  assert.deepEqual(compareTraces(['a', 'b'], ['a']), { line: 2, expected: 'b', actual: '(конец)' });
});

test('prefix: остановленный replay сверяется без своей последней строки', () => {
  const stopped = ['a', 'b', '{"t":"end","verdict":"stopped"}'];
  assert.equal(compareTraces(['a', 'b', 'c', 'd'], stopped, { prefix: true }), null);
});

test('строка отчёта содержит вердикт, имя, нарушение и каталог', () => {
  const line = formatRunLine({ ok: false, name: 'r1', verdict: 'bug', frame: 10, goals: 2, summary: 'захват 12%', violation: { id: 'x', message: 'плохо' }, dir: 'tmp/bot/r1' });
  assert.match(line, /bug/); assert.match(line, /r1/); assert.match(line, /x: плохо/); assert.match(line, /tmp\/bot\/r1/);
});
```

`plugins/verify-cocos/tests/project.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, loadRuns, adapterHash } from '../scripts/lib/project.mjs';

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vc-proj-'));
  await mkdir(path.join(root, 'verify', 'bot'), { recursive: true });
  await mkdir(path.join(root, 'verify', 'runs'), { recursive: true });
  await writeFile(path.join(root, 'verify', 'cocos.json'), JSON.stringify({ build: 'b', limits: { maxFrames: 5 } }));
  await writeFile(path.join(root, 'verify', 'bot', 'bridge.js'), '1');
  await writeFile(path.join(root, 'verify', 'bot', 'model.mjs'), 'export const a = 1;');
  return root;
}

test('конфиг сливается с умолчаниями, вложенные лимиты — по ключам', async () => {
  const root = await project();
  const config = await loadConfig(root);
  assert.equal(config.build, 'b');
  assert.equal(config.limits.maxFrames, 5);
  assert.equal(config.limits.stallFrames, 1800);
  assert.equal(config.fps, 60);
});

test('нет verify/cocos.json — понятная ошибка', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vc-empty-'));
  await assert.rejects(loadConfig(root), /verify\/cocos\.json/);
});

test('прогон без обязательного поля отклоняется с именем файла', async () => {
  const root = await project();
  await writeFile(path.join(root, 'verify', 'runs', 'bad.json'), JSON.stringify({ zone: 'z', level: 0, seed: 1 }));
  await assert.rejects(loadRuns(root, await loadConfig(root)), /bad\.json.*mission/);
});

test('прогон с опечаткой в политике отклоняется до запуска', async () => {
  const root = await project();
  await writeFile(path.join(root, 'verify', 'runs', 'p.json'), JSON.stringify({ zone: 'z', level: 0, seed: 1, mission: 'm', policy: 'evry:2', expect: { verdict: 'pass' } }));
  await assert.rejects(loadRuns(root, await loadConfig(root)), /evry:2/);
});

test('хэш адаптера меняется при правке модуля', async () => {
  const root = await project();
  const config = await loadConfig(root);
  const before = await adapterHash(root, config);
  await writeFile(path.join(root, 'verify', 'bot', 'model.mjs'), 'export const a = 2;');
  assert.notEqual(await adapterHash(root, config), before);
});
```

Run: `node --test plugins/verify-cocos/tests/`
Expected: FAIL — `report.mjs`, `project.mjs` не найдены.

- [ ] **Step 2: Реализация отчёта**

`plugins/verify-cocos/scripts/lib/report.mjs`:
```js
// Вердикты, сводки и коды возврата.
//
// Класс вердикта говорит, что чинить: «игра» — баг игры, «бот» — тактику или
// лимиты, «среда» — сборку, Chrome, мост.
const CLASSES = {
  pass: '—', lose: '—', stopped: '—',
  bug: 'игра',
  'bot-stuck': 'бот', 'bot-error': 'бот', timeout: 'бот',
  error: 'среда',
};

export const verdictClass = (verdict) => CLASSES[verdict] ?? 'среда';

export function expectMatches(result, expect = {}) {
  if (expect.verdict && result.verdict !== expect.verdict) return false;
  if (expect.verdictIn && !expect.verdictIn.includes(result.verdict)) return false;
  if (expect.maxFrames != null && result.frame > expect.maxFrames) return false;
  return true;
}

export function formatRunLine(result) {
  const mark = result.ok === true ? '✓' : result.ok === false ? '✗' : ' ';
  const head = `${mark} ${result.verdict.padEnd(9)} ${result.name}  кадров ${result.frame}  целей ${result.goals ?? 0}`;
  const summary = result.summary ? `  ${result.summary}` : '';
  const violation = result.violation ? `\n    ${result.violation.id}: ${result.violation.message}` : '';
  return `${head}${summary}  [${verdictClass(result.verdict)}]${violation}\n    ${result.dir}`;
}

export function summarizeSoak(results) {
  const byVerdict = {};
  const groups = new Map();
  for (const result of results) {
    byVerdict[result.verdict] = (byVerdict[result.verdict] ?? 0) + 1;
    if (result.verdict !== 'bug') continue;
    const oracle = result.violation?.id ?? '?';
    if (!groups.has(oracle)) groups.set(oracle, { oracle, count: 0, runs: [] });
    const group = groups.get(oracle);
    group.count++;
    group.runs.push(result.name);
  }
  return { byVerdict, bugs: [...groups.values()] };
}

export function formatSoakSummary(summary) {
  const verdicts = Object.entries(summary.byVerdict).map(([v, n]) => `${v} ${n}`).join(', ');
  const bugs = summary.bugs.map((b) => `  ${b.oracle}: ${b.count} прогон(ов), например ${b.runs[0]}`).join('\n');
  return `Итого: ${verdicts}${bugs ? `\nНаходки (по оракулу):\n${bugs}` : '\nНаходок нет.'}`;
}

export const exitCodeRun = (results) => (results.every((result) => result.ok) ? 0 : 1);

export const exitCodeSoak = (results) => (results.some((r) => r.verdict === 'bug' || r.verdict === 'error') ? 1 : 0);

export function compareTraces(expected, actual, { prefix = false } = {}) {
  const compared = prefix ? actual.slice(0, -1) : actual;
  const n = prefix ? compared.length : Math.max(expected.length, compared.length);
  for (let i = 0; i < n; i++) {
    if (expected[i] !== compared[i]) {
      return { line: i + 1, expected: expected[i] ?? '(конец)', actual: compared[i] ?? '(конец)' };
    }
  }
  return null;
}
```

- [ ] **Step 3: Реализация загрузки проекта**

`plugins/verify-cocos/scripts/lib/project.mjs`:
```js
// Данные проекта: конфиг, модули адаптера, прогоны.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePattern } from './policy.mjs';

export const DEFAULTS = {
  build: 'build/web-mobile',
  fps: 60,
  bridge: 'verify/bot/bridge.js',
  bot: 'verify/bot',
  runs: 'verify/runs',
  out: 'tmp/bot',
  viewport: { width: 1280, height: 720 },
  start: { level: 0 },
  limits: {
    maxFrames: 36000, stallFrames: 1800, goalTimeoutFrames: 1200, maxGoalFailures: 5,
    randomActionFrames: 30, startFrames: 3000, settleMs: 10, bootTimeoutMs: 60000, traceTail: 200,
  },
  policy: 'planned',
  soak: { seeds: 20, mission: 'capture-80', policies: ['planned', 'every:2', 'burst:30/10', 'random'] },
  zones: {},
};

const MODULES = ['model', 'missions', 'goals', 'tactics', 'oracles'];

export async function loadConfig(root, override) {
  const file = override ? path.resolve(override) : path.join(root, 'verify', 'cocos.json');
  if (!existsSync(file)) throw new Error(`Не найден ${file}. Создайте verify/cocos.json — см. README плагина.`);
  const user = JSON.parse(await readFile(file, 'utf8'));
  return {
    ...DEFAULTS,
    ...user,
    viewport: { ...DEFAULTS.viewport, ...user.viewport },
    start: { ...DEFAULTS.start, ...user.start },
    limits: { ...DEFAULTS.limits, ...user.limits },
    soak: { ...DEFAULTS.soak, ...user.soak },
  };
}

export async function adapterHash(root, config) {
  const dir = path.resolve(root, config.bot);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.mjs')).sort();
  const hash = createHash('sha1');
  for (const file of files) hash.update(file).update(await readFile(path.join(dir, file)));
  hash.update(await readFile(path.resolve(root, config.bridge)));
  return hash.digest('hex').slice(0, 12);
}

export async function loadAdapter(root, config) {
  const dir = path.resolve(root, config.bot);
  const load = async (name) => {
    const file = path.join(dir, `${name}.mjs`);
    if (!existsSync(file)) throw new Error(`Нет модуля адаптера ${file}`);
    return import(pathToFileURL(file).href);
  };
  const [model, missions, goals, tactics, oracles] = await Promise.all(MODULES.map(load));
  const adapter = {
    toModel: model.toModel,
    progress: model.progress,
    summary: model.summary,
    missions: missions.missions,
    candidates: goals.candidates,
    replanOn: goals.replanOn ?? [],
    tactics: tactics.tactics,
    oracles: oracles.oracles ?? [],
  };
  for (const key of ['toModel', 'progress', 'missions', 'candidates', 'tactics']) {
    if (!adapter[key]) throw new Error(`Адаптер не экспортирует ${key} (см. README verify-cocos)`);
  }
  return { adapter, hash: await adapterHash(root, config) };
}

export async function loadRuns(root, config) {
  const dir = path.resolve(root, config.runs);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const runs = [];
  for (const file of files) {
    const run = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    for (const key of ['zone', 'level', 'seed', 'mission', 'expect']) {
      if (run[key] === undefined) throw new Error(`Прогон ${file}: нет поля ${key}`);
    }
    const policy = run.policy ?? config.policy;
    const parts = typeof policy === 'object' && ('goal' in policy || 'action' in policy) ? [policy.goal, policy.action] : [policy];
    for (const part of parts) {
      try { parsePattern(part ?? 'planned'); } catch (error) { throw new Error(`Прогон ${file}: ${error.message}`); }
    }
    runs.push({ name: file.replace(/[.]json$/, ''), ...run, policy });
  }
  return runs;
}
```

- [ ] **Step 4: Реализация исполнения прогона и CLI**

`plugins/verify-cocos/scripts/lib/execute.mjs`:
```js
// Один прогон целиком: сессия, старт уровня, агент, снимки, журнал.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openSession } from './session.mjs';
import { runAgent } from './agent.mjs';
import { createTrace, saveTrace } from './trace.mjs';
import { createPolicy } from './policy.mjs';
import { mulberry32, botSeed } from './rng.mjs';

export async function executeRun({ root, config, adapter, hash, spec, outDir, stopAt = null }) {
  await mkdir(outDir, { recursive: true });
  const trace = createTrace();
  trace.write({
    f: 0, t: 'start', name: spec.name, seed: spec.seed, level: spec.level,
    mission: spec.mission, policy: spec.policy, adapter: hash,
  });

  let game = null;
  let result;
  try {
    game = await openSession({ root, config, seed: spec.seed });
    await game.start({ level: spec.level });
    const rng = mulberry32(botSeed(spec.seed));
    result = await runAgent({
      game, adapter, missionName: spec.mission, policy: createPolicy(spec.policy, rng), rng,
      limits: { ...config.limits, stopAt }, trace,
    });
    // Страница стоит на кадре, где прогон закончился: при нарушении это и
    // есть снимок момента бага.
    await game.screenshot(path.join(outDir, 'final.png'));
    await writeFile(path.join(outDir, 'state.json'), JSON.stringify(result.lastRaw, null, 2));
  } catch (error) {
    trace.write({ f: -1, t: 'end', verdict: 'error', message: error.message });
    result = { verdict: 'error', frame: 0, goals: 0, violation: { id: 'environment', message: error.message }, lastModel: null };
  } finally {
    await saveTrace(outDir, trace, config.limits.traceTail);
    await game?.close();
  }

  return {
    name: spec.name,
    verdict: result.verdict,
    frame: result.frame,
    goals: result.goals,
    violation: result.violation,
    summary: result.lastModel && adapter.summary ? adapter.summary(result.lastModel) : '',
    dir: path.relative(root, outDir).split(path.sep).join('/'),
  };
}
```

`plugins/verify-cocos/scripts/verify-cocos.mjs`:
```js
#!/usr/bin/env node
// Бот-тестировщик для игры на Cocos Creator.
//
//   node verify-cocos.mjs run                          все прогоны verify/runs
//   node verify-cocos.mjs run --run capture-level-1    по имени (через запятую)
//   node verify-cocos.mjs run --zone gameplay          по зоне
//   node verify-cocos.mjs run --since HEAD             только задетое изменениями
//   node verify-cocos.mjs run --changed a.ts,b.ts
//   node verify-cocos.mjs soak [--seeds 50] [--policies planned,random]
//   node verify-cocos.mjs replay tmp/bot/<прогон> [--until 1200]
//   node verify-cocos.mjs probe [--level 0] [--seed 1]  состояние и действия после старта
//
// Общие флаги: --root <каталог проекта>, --config <файл>, --json.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadConfig, loadAdapter, loadRuns } from './lib/project.mjs';
import { executeRun } from './lib/execute.mjs';
import { openSession } from './lib/session.mjs';
import { readTraceLines } from './lib/trace.mjs';
import { parsePattern, policySlug } from './lib/policy.mjs';
import { zonesForFiles, selectScenarios } from './vendor/cdp/zones.mjs';
import {
  expectMatches, formatRunLine, summarizeSoak, formatSoakSummary,
  exitCodeRun, exitCodeSoak, compareTraces,
} from './lib/report.mjs';

function parseArgs(argv) {
  const args = { positional: [], flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { args.positional.push(token); continue; }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { args.values[key] = next; i++; } else { args.flags.add(key); }
  }
  return args;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const list = (value) => value.split(',').map((s) => s.trim()).filter(Boolean);

const args = parseArgs(process.argv.slice(2));
const command = args.positional[0];
const root = path.resolve(args.values.root ?? process.cwd());
const json = args.flags.has('json');
const log = json ? () => {} : (message) => console.log(message);
const config = await loadConfig(root, args.values.config);
const outRoot = path.resolve(root, config.out);

async function commandRun() {
  const all = await loadRuns(root, config);
  let selected = all;
  let reason = 'весь набор';
  if (args.values.run) {
    const wanted = list(args.values.run);
    const missing = wanted.filter((w) => !all.some((r) => r.name === w));
    if (missing.length > 0) throw new Error(`Нет таких прогонов: ${missing.join(', ')}`);
    selected = all.filter((r) => wanted.includes(r.name));
    reason = `по имени: ${wanted.join(', ')}`;
  } else if (args.values.zone) {
    const zones = list(args.values.zone);
    selected = all.filter((r) => zones.includes(r.zone));
    reason = `зоны: ${zones.join(', ')}`;
  } else if (args.values.changed || args.values.since) {
    const changed = args.values.changed
      ? list(args.values.changed)
      : execFileSync('git', ['diff', '--name-only', args.values.since], { cwd: root, encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
    ({ selected, reason } = selectScenarios(all, zonesForFiles(changed, config.zones)));
  }
  if (selected.length === 0) { log(`Нечего прогонять (${reason}).`); return 0; }

  const { adapter, hash } = await loadAdapter(root, config);
  log(`Прогонов: ${selected.length} (${reason}), адаптер ${hash}`);
  const results = [];
  for (const spec of selected) {
    const result = await executeRun({ root, config, adapter, hash, spec, outDir: path.join(outRoot, `${spec.name}-${stamp()}`) });
    result.ok = expectMatches(result, spec.expect);
    result.expect = spec.expect;
    results.push(result);
    log(formatRunLine(result));
  }
  if (json) console.log(JSON.stringify({ reason, results }, null, 2));
  return exitCodeRun(results);
}

async function commandSoak() {
  const seeds = Number(args.values.seeds ?? config.soak.seeds);
  const policies = args.values.policies ? list(args.values.policies) : config.soak.policies;
  // Опечатка в паттерне должна всплыть до запуска десятков Chrome.
  for (const policy of policies) parsePattern(policy);
  const { adapter, hash } = await loadAdapter(root, config);
  const batch = path.join(outRoot, `soak-${stamp()}`);
  log(`Soak: ${seeds} seed × ${policies.length} политик, адаптер ${hash}`);
  const results = [];
  for (let seed = 1; seed <= seeds; seed++) {
    for (const policy of policies) {
      const name = `s${seed}-${policySlug(policy)}`;
      const spec = { name, level: config.start.level, seed, mission: config.soak.mission, policy };
      const result = await executeRun({ root, config, adapter, hash, spec, outDir: path.join(batch, name) });
      results.push(result);
      log(formatRunLine(result));
    }
  }
  const summary = summarizeSoak(results);
  log(formatSoakSummary(summary));
  if (json) console.log(JSON.stringify({ summary, results }, null, 2));
  return exitCodeSoak(results);
}

async function commandReplay() {
  const dir = path.resolve(root, args.positional[1] ?? '');
  const original = await readTraceLines(path.join(dir, 'trace.jsonl'));
  const start = JSON.parse(original[0]);
  if (start.t !== 'start') throw new Error(`Первая строка журнала — не start: ${original[0]}`);
  const { adapter, hash } = await loadAdapter(root, config);
  if (hash !== start.adapter) {
    log(`ВНИМАНИЕ: адаптер изменился (${start.adapter} → ${hash}). Расхождение журналов ожидаемо и не говорит о недетерминизме игры.`);
  }
  const stopAt = args.values.until != null ? Number(args.values.until) : null;
  const outDir = path.join(dir, `replay-${stamp()}`);
  const spec = { name: start.name, level: start.level, seed: start.seed, mission: start.mission, policy: start.policy };
  const result = await executeRun({ root, config, adapter, hash, spec, outDir, stopAt });
  log(formatRunLine(result));
  const replayed = await readTraceLines(path.join(outDir, 'trace.jsonl'));
  const diff = compareTraces(original, replayed, { prefix: stopAt != null });
  if (!diff) { log('Журнал воспроизведён без расхождений.'); return 0; }
  log(`Расхождение на строке ${diff.line}:\n  было:  ${diff.expected}\n  стало: ${diff.actual}`);
  return 1;
}

async function commandProbe() {
  const level = Number(args.values.level ?? config.start.level);
  const seed = Number(args.values.seed ?? 1);
  const game = await openSession({ root, config, seed });
  try {
    await game.start({ level });
    const state = await game.observe();
    if (state?.grid?.cells) state.grid.cells = `<base64, ${state.grid.cells.length} символов>`;
    console.log(JSON.stringify({ state, actions: await game.actions(), errors: game.errors() }, null, 2));
    return 0;
  } finally {
    await game.close();
  }
}

const COMMANDS = { run: commandRun, soak: commandSoak, replay: commandReplay, probe: commandProbe };
if (!COMMANDS[command]) {
  console.error(`Команда: ${Object.keys(COMMANDS).join(' | ')}. См. шапку verify-cocos.mjs.`);
  process.exit(2);
}
process.exit(await COMMANDS[command]());
```

- [ ] **Step 5: Тесты проходят**

Run: `node --test tests/ && node --test plugins/verify-cocos/tests/`
Expected: PASS.
Run: `node plugins/verify-cocos/scripts/verify-cocos.mjs 2>&1 | head -2`
Expected: `Не найден …verify/cocos.json` (модуль грузится, конфига в корне marketplace нет).

- [ ] **Step 6: Commit**

```bash
git add plugins/verify-cocos
git commit -m "feat(verify-cocos): раннер run/soak/replay/probe и отчёт с классами вердиктов"
```

---

### Task 7: Поверхность плагина — команда, скилл, README, связь с acceptance

**Files:**
- Create: `plugins/verify-cocos/commands/verify-cocos.md`
- Create: `plugins/verify-cocos/skills/verify-cocos/SKILL.md`
- Create: `plugins/verify-cocos/README.md`
- Modify: `plugins/acceptance/skills/acceptance/SKILL.md` (строка про `[scenario]`)
- Modify: `README.md` (таблица плагинов)

**Interfaces:**
- Consumes: CLI задачи 6, контракты задач 3 и 5.
- Produces: документация, по которой адаптер пишется без чтения кода плагина.

- [ ] **Step 1: Команда**

`plugins/verify-cocos/commands/verify-cocos.md`:
````markdown
---
description: Прогнать бота-тестировщика игры на Cocos и разобрать результат
---

Запусти бота командой:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/verify-cocos.mjs $ARGUMENTS
```

Без аргументов подставь `run`. Сборка должна лежать по пути `build` из
`verify/cocos.json`; если её нет или она старше изменённого кода игры —
пересобери по документации проекта, прежде чем запускать.

После прогона разбирай по классу вердикта:

1. **`игра` (`bug`)** — открой `tail.jsonl`, `state.json` и `final.png` из
   каталога прогона. Найди в журнале решение, после которого сработал оракул
   (поле `by` говорит, план это был или случайность). Воспроизведи:
   `replay <каталог>`. Это баг игры — чини игру, а не оракул. Оракул правится,
   только если ты доказал, что он ошибается, и это пишется в отчёт.
2. **`бот` (`bot-stuck`, `bot-error`, `timeout`)** — чинится адаптер в
   `verify/bot/`, игра не виновата.
3. **`среда` (`error`)** — сборка, Chrome, мост. Прогон ничего не проверил.
4. Расхождение `replay` с журналом при том же хэше адаптера — недетерминизм в
   игре. Это находка, доложи её.

Прогон зелёный, только если вердикт совпал с `expect` прогона.
````

- [ ] **Step 2: README плагина**

`plugins/verify-cocos/README.md`:
````markdown
# verify-cocos

Бот-тестировщик для игр на Cocos Creator. Играет в продовую web-сборку,
детерминированно по seed, пишет журнал решений, проверяет оракулы, умеет
воспроизводить прогон. Плагин везёт движок, проект владеет адаптером.

Дизайн — `docs/superpowers/specs/2026-09-29-verify-cocos-design.md` в marketplace.

## Как это устроено

```
Node: агент ── цель → тактика → действие ──► CDP: клавиши
        ▲                                         │
        └── модель ◄── observe() ◄── мост ◄── кадры (shim) ◄┘
```

- **shim** (плагин) внедряется до игры: `Math.random` с seed, виртуальное время,
  своя очередь `requestAnimationFrame`. После старта уровня кадры идут только
  по команде: один шаг — один кадр движка.
- **мост** (проект, `verify/bot/bridge.js`) внедряется туда же. Знает механику
  игры, ничего не знает о целях. В сборку игры не попадает.
- **адаптер** (проект, `verify/bot/*.mjs`) — модель, миссии, цели, тактики,
  оракулы. Работает в Node на JSON-снимках.

## Что нужно проекту

```
verify/
├── cocos.json
├── bot/
│   ├── bridge.js     мост в странице
│   ├── model.mjs     toModel(raw), progress(model), summary?(model)
│   ├── missions.mjs  missions: { имя: { done(model, events) } }
│   ├── goals.mjs     candidates(model, mission), replanOn
│   ├── tactics.mjs   tactics: { kind: { next(model, goal) → { action, frames } } }
│   └── oracles.mjs   oracles: [{ id, check(prev, cur, events, { frame }) }]
└── runs/*.json
```

### `verify/cocos.json`

```json
{
  "build": "build/web-mobile",
  "fps": 60,
  "viewport": { "width": 1280, "height": 720 },
  "start": { "level": 0 },
  "limits": { "maxFrames": 36000, "stallFrames": 1800, "goalTimeoutFrames": 1200,
              "maxGoalFailures": 5, "randomActionFrames": 30,
              "startFrames": 3000, "settleMs": 10, "bootTimeoutMs": 60000, "traceTail": 200 },
  "policy": "planned",
  "soak": { "seeds": 20, "mission": "capture-80",
            "policies": ["planned", "every:2", "burst:30/10", "random"] },
  "zones": { "assets/scripts/**": ["gameplay"] }
}
```

### Мост (`window.__bot`)

| Метод | Что делает |
|---|---|
| `whenBooted()` | Promise: движок загружен, первая сцена есть |
| `preload(params)` | Promise: предзагрузка ресурсов уровня (свободный режим) |
| `start(params)` | запустить уровень; возвращается сразу |
| `ready()` | уровень готов принимать ввод |
| `observe()` | полное состояние, JSON (`game` + `view`) |
| `actions()` | доступные действия |
| `act(action)` | список операций ввода `[{ type: 'keyDown'|'keyUp'|'press', key }]` — их исполняет плагин через CDP |
| `frameEvents()` | события за последний кадр; вызывается shim'ом после каждого кадра |

Клавиши: `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Space`, `Enter`, `Escape`.

### Цель (что возвращает `candidates`)

`{ kind, id, score, params, done(model, events), failed(model, events) }`.
Оценку считает проект; движок сравнивает числа. `kind` выбирает тактику.

### Прогон (`verify/runs/<имя>.json`)

```json
{ "title": "Бот проходит уровень 1 без нарушений", "zone": "gameplay",
  "level": 0, "seed": 1, "mission": "capture-80",
  "policy": { "goal": "planned", "action": "planned" },
  "expect": { "verdict": "pass" } }
```

`expect`: `verdict`, `verdictIn: [...]`, `maxFrames`.

### Паттерны случайности

`planned`, `random`, `every:N` (каждый N-й выбор случайный), `burst:K/M`
(K по плану, M случайно, по кругу), `chance:P`. Строка — для цели и действия
сразу; `{ "goal": …, "action": … }` — раздельно.

## Команды

```
node scripts/verify-cocos.mjs run [--run a,b | --zone z | --since REF | --changed f1,f2]
node scripts/verify-cocos.mjs soak [--seeds N] [--policies p1,p2]
node scripts/verify-cocos.mjs replay tmp/bot/<прогон> [--until КАДР]
node scripts/verify-cocos.mjs probe [--level N] [--seed S]
```

## Вердикты

| Вердикт | Класс | Значение |
|---|---|---|
| `pass` | — | миссия выполнена |
| `lose` | — | жизни кончились без нарушений |
| `stopped` | — | replay остановлен на `--until` |
| `bug` | игра | сработал оракул, ошибка консоли или исключение моста |
| `bot-stuck` | бот | цели проваливаются подряд |
| `bot-error` | бот | исключение в модуле адаптера |
| `timeout` | бот | превышен `maxFrames` |
| `error` | среда | сборка, Chrome, мост не загрузились |

`run` завершается с ненулевым кодом, если вердикт не совпал с `expect`;
`soak` — если есть `bug` или `error`.

## Журнал

`tmp/bot/<прогон>/trace.jsonl` — по строке на решение и событие. Поле `by`:
`score` / `tactic` — по плану, `random` — случайный выбор, `no-goal` —
целей не нашлось. Рядом `tail.jsonl`, `state.json`, `final.png`.

## Требования

Установленный Chrome (`CHROME_PATH` переопределяет путь) и готовая web-сборка.
Зависимостей нет.
````

- [ ] **Step 3: Скилл**

`plugins/verify-cocos/skills/verify-cocos/SKILL.md`:
````markdown
---
name: verify-cocos
description: Use when writing or tuning a verify-cocos bot adapter for a Cocos Creator game (bridge, model, missions, goals, tactics, oracles), or when a verify-cocos run returns bug / bot-stuck / bot-error and needs diagnosis.
---

# Адаптер бота verify-cocos

Контракты и конфиг — в `${CLAUDE_PLUGIN_ROOT}/README.md`. Здесь — как писать
адаптер, чтобы бот находил баги игры, а не свои.

## Порядок работы

1. **Мост первым, и только механика.** Мост находит компоненты по имени
   `@ccclass`: `cc.js.getClassByName('PlayerTag')`. Ни целей, ни оценок в мосте
   нет. Проверь его командой `probe` — состояние должно читаться глазами.
2. **Ввод — через клавиши, не через компоненты.** `act` возвращает операции
   ввода, плагин шлёт их через CDP. Запись в компонент ввода в обход клавиш
   пропустит баги обработки ввода и блокировок.
3. **События — из разницы кадров.** Компоненты-события ECS живут долю кадра;
   мост сравнивает снимок прошлого кадра с текущим (счётчики, флаги).
4. **Модель — чистые функции на JSON.** Вся тяжёлая логика (регионы, пути,
   предсказание врагов) — в `model.mjs` / `goals.mjs`, под `node:test`.
5. **Оракул — наблюдаемое правило игры, не пересказ моста.** «Жизни убывают
   только с событием lifeLost», когда lifeLost и есть убыль жизней, — тавтология.
   Хороший оракул сверяет две независимые величины: убыль жизней и исчезновение
   следа, рост захвата и победу на пороге.

## Разбор вердиктов

- `bug` — баг игры, пока не доказано обратное. Журнал → решение перед
  нарушением → `replay`. Ослаблять оракул, чтобы стало зелёно, нельзя; если
  оракул неверен — это отдельный вывод с доказательством.
- `bot-stuck` — тактика не доводит цель: смотри `goal-end` с `timeout`.
- `bot-error` — исключение в адаптере, текст в `violation.message`.
- `replay` разошёлся при том же хэше адаптера — недетерминизм в игре.
````

- [ ] **Step 4: Связь с acceptance и README marketplace**

В `plugins/acceptance/skills/acceptance/SKILL.md` заменить строку
`- `[scenario]` — прогон в браузере, вердикт выносит машина`
на:
```markdown
- `[scenario]` — прогон, вердикт выносит машина: сценарий `verify-web` в браузере
  или, для игры на Cocos, прогон бота `bot:<имя>` из `verify/runs/<имя>.json`
  через `/verify-cocos run --run <имя>`
```

В `README.md` marketplace дополнить таблицу плагинов строками (verify-web и acceptance в таблице тоже отсутствуют — добавить все три):
```markdown
| [acceptance](plugins/acceptance/) | Acceptance criteria as a first-class artefact: lifecycle, freeze hook, sign-off rules. |
| [verify-web](plugins/verify-web/) | Browser verification over raw CDP: scenarios, snapshot diffs, screenshots for visual judgement. |
| [verify-cocos](plugins/verify-cocos/) | Game-playing QA bot for Cocos Creator web builds: seeded deterministic runs, goal/tactic agent with configurable randomness, oracles, decision trace, replay. |
```

- [ ] **Step 5: Проверка плагина и тестов**

Run: `claude plugin validate plugins/verify-cocos`
Expected: `Validation passed` (предупреждения допустимы, ошибки — нет).
Run: `node --test tests/ && node --test plugins/verify-cocos/tests/ && node --test plugins/acceptance/tests/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/verify-cocos plugins/acceptance/skills README.md
git commit -m "docs(verify-cocos): команда, скилл, README; бот как способ проверки [scenario]"
```

---

### Task 8: ImageUncovered — конфиг и мост

**Files (репозиторий `E:/projects/ImageUncovered`):**
- Create: `verify/cocos.json`
- Create: `verify/bot/bridge.js`
- Create (заглушки, заменяются в задачах 9–11): `verify/bot/model.mjs`, `verify/bot/missions.mjs`, `verify/bot/goals.mjs`, `verify/bot/tactics.mjs`, `verify/bot/oracles.mjs`

**Interfaces:**
- Consumes: контракт моста (задача 5), факты спайка (задача 0): как получен `cc`.
- Produces: `observe()` возвращает
  ```
  { fps, level,
    grid: { cols, rows, cellSize, originX, originY, cells: base64 },
    player: { x, y, col, row, dirX, dirY, trailActive, speed } | null,
    enemies: [{ x, y, col, row, vx, vy }],          // vx, vy — px/с
    bonuses: [{ type, x, y, col, row }],            // только несобранные
    activeBonuses: number[],
    lives, captured, total, win, gameOver, inputGated,
    view: { playerVisible } }
  ```
  `actions()` → `{ type: 'move', dir: 'up'|'down'|'left'|'right'|'none' }` и `{ type: 'useBonus' }` (если стек бонусов не пуст); пусто при победе/поражении.
  События `frameEvents()`: `{ type: 'capture', cells, pct }`, `{ type: 'lifeLost', lives }`, `{ type: 'win' }`, `{ type: 'gameOver' }`.
  Строки клеток: `row` растёт вверх (Y вверх в Cocos), `col` — вправо.

- [ ] **Step 1: Конфиг**

`verify/cocos.json`:
```json
{
  "build": "build/web-mobile-vk",
  "fps": 60,
  "viewport": { "width": 1280, "height": 720 },
  "start": { "level": 0 },
  "limits": { "maxFrames": 36000, "stallFrames": 1800, "goalTimeoutFrames": 1200, "maxGoalFailures": 5 },
  "policy": "planned",
  "soak": { "seeds": 20, "mission": "capture-80", "policies": ["planned", "every:2", "burst:30/10", "random"] },
  "zones": {
    "assets/**": ["gameplay"],
    "verify/**": ["gameplay"]
  }
}
```

- [ ] **Step 2: Мост**

`verify/bot/bridge.js`:
```js
// Мост бота ImageUncovered. Внедряется раннером verify-cocos в продовую
// web-сборку до загрузки игры; в сборку игры не попадает.
//
// Знает механику игры — компоненты ECS по именам @ccclass, — и ничего не
// знает о целях. Ввод не пишет в компоненты: act() возвращает клавиши, их
// нажимает плагин через CDP, и игра получает их настоящим путём.
(() => {
  const LEVEL_PATH = (index) => `levels/level-${String(index + 1).padStart(2, '0')}`;
  const ARROWS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  const CAPTURED_SAFE = 2;
  const READY_FRAMES = 2;

  let pendingLevel = null;
  let transitionRequested = false;
  let held = [];
  let last = null;
  let importing = false;

  const cls = (name) => window.cc.js.getClassByName(name);
  const scene = () => window.cc.director.getScene();
  const all = (name) => {
    const s = scene();
    const C = cls(name);
    return s && C ? s.getComponentsInChildren(C) : [];
  };
  const one = (name) => all(name)[0] ?? null;
  const world = () => one('World');

  function cellOf(grid, x, y) {
    const col = Math.floor((x - grid.originX) / grid.cellSize);
    const row = Math.floor((y - grid.originY) / grid.cellSize);
    return {
      col: Math.max(0, Math.min(grid.cols - 1, col)),
      row: Math.max(0, Math.min(grid.rows - 1, row)),
    };
  }

  function base64(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 4096) {
      text += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    }
    return btoa(text);
  }

  function flags() {
    const w = world();
    const grid = one('TerritoryGrid');
    const player = one('PlayerTag');
    const lives = player ? player.getComponent(cls('Lives')) : null;
    const gameOver = all('GameOverEvent').length > 0;
    let captured = 0;
    if (grid) for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === CAPTURED_SAFE) captured++;
    return {
      captured,
      total: grid ? grid.cells.length : 0,
      lives: gameOver ? 0 : (lives ? lives.current : 0),
      win: all('WinEvent').length > 0 || !!(w && w.winAnimating),
      gameOver,
    };
  }

  window.__bot = {
    whenBooted() {
      return new Promise((resolve) => {
        const tick = () => {
          // В релизной сборке движок может не лежать в window.cc — тогда он
          // берётся из реестра SystemJS (см. результаты спайка в спеке).
          if (!window.cc && window.System && window.System.import && !importing) {
            importing = true;
            window.System.import('cc').then((m) => { window.cc = m; }).catch(() => { importing = false; });
          }
          if (window.cc && window.cc.director && window.cc.director.getScene()) resolve(true);
          else setTimeout(tick, 50);
        };
        tick();
      });
    },

    preload({ level }) {
      return new Promise((resolve, reject) => {
        window.cc.director.preloadScene('Main', (error) => {
          if (error) { reject(new Error(`preloadScene Main: ${error}`)); return; }
          const paths = [LEVEL_PATH(0), LEVEL_PATH(level)];
          window.cc.resources.preload(paths, (err) => (err ? reject(new Error(`preload ${paths}: ${err}`)) : resolve(true)));
        });
      });
    },

    start({ level }) {
      held = [];
      last = null;
      pendingLevel = level;
      transitionRequested = false;
      window.cc.director.loadScene('Main');
      return true;
    },

    ready() {
      const ls = one('LevelState');
      const w = world();
      const grid = one('TerritoryGrid');
      if (!ls || !w || !ls.loaded || ls.transitioning) return false;
      if (pendingLevel !== null && ls.currentLevelIndex !== pendingLevel) {
        // Уровень, отличный от первого, запускается тем же путём, что и
        // переход после победы: событием LevelTransitionEvent на World.
        if (!transitionRequested && ls.readyFrames >= 1) {
          const event = w.node.addComponent(cls('LevelTransitionEvent'));
          event.targetLevelIndex = pendingLevel;
          transitionRequested = true;
        }
        return false;
      }
      if (ls.readyFrames < READY_FRAMES || !one('PlayerTag') || !grid || !grid.initialized) return false;
      pendingLevel = null;
      last = flags();
      return true;
    },

    observe() {
      const w = world();
      const grid = one('TerritoryGrid');
      const ls = one('LevelState');
      const player = one('PlayerTag');
      const f = flags();
      const at = (node) => {
        const x = node.position.x;
        const y = node.position.y;
        return { x, y, ...cellOf(grid, x, y) };
      };
      let playerState = null;
      if (player) {
        const snap = player.getComponent(cls('GridSnap'));
        const trail = player.getComponent(cls('CaptureTrail'));
        const speed = player.getComponent(cls('MoveSpeed'));
        playerState = {
          ...at(player.node),
          dirX: snap ? snap.committedDirX : 0,
          dirY: snap ? snap.committedDirY : 0,
          trailActive: !!(trail && trail.active),
          speed: speed ? speed.value : 0,
        };
      }
      const stack = one('ActiveBonusStack');
      return {
        fps: window.__botShim.fps,
        level: ls ? ls.currentLevelIndex : -1,
        grid: {
          cols: grid.cols, rows: grid.rows, cellSize: grid.cellSize,
          originX: grid.originX, originY: grid.originY, cells: base64(grid.cells),
        },
        player: playerState,
        enemies: all('EnemyTag').map((enemy) => {
          const v = enemy.getComponent(cls('Velocity'));
          return { ...at(enemy.node), vx: v ? v.vx : 0, vy: v ? v.vy : 0 };
        }),
        bonuses: all('BonusPickup').filter((b) => !b.collected).map((b) => ({ type: b.bonusType, ...at(b.node) })),
        activeBonuses: stack ? [...stack.stack] : [],
        lives: f.lives,
        captured: f.captured,
        total: f.total,
        win: f.win,
        gameOver: f.gameOver,
        inputGated: !!(w && w.inputSystem && w.inputSystem.gated),
        view: { playerVisible: !!(player && player.node.activeInHierarchy) },
      };
    },

    actions() {
      const f = flags();
      if (f.win || f.gameOver || !one('PlayerTag')) return [];
      const list = Object.keys(ARROWS).map((dir) => ({ type: 'move', dir }));
      list.push({ type: 'move', dir: 'none' });
      const stack = one('ActiveBonusStack');
      if (stack && stack.stack.length > 0) list.push({ type: 'useBonus' });
      return list;
    },

    act(action) {
      if (!action) return [];
      const ops = [];
      if (action.type === 'move') {
        const want = action.dir === 'none' ? null : ARROWS[action.dir];
        const w = world();
        // После потери жизни игра ждёт, пока все стрелки будут отпущены.
        // Нажатие в тот же кадр держало бы блокировку вечно — поэтому только
        // отпускаем, а направление бот повторит следующим решением.
        const gated = !!(w && w.inputSystem && w.inputSystem.gated);
        for (const key of held) {
          if (key !== want || gated) ops.push({ type: 'keyUp', key });
        }
        held = held.filter((key) => key === want && !gated);
        if (want && !gated && !held.includes(want)) {
          ops.push({ type: 'keyDown', key: want });
          held.push(want);
        }
      } else if (action.type === 'useBonus') {
        ops.push({ type: 'press', key: 'Space' });
      }
      return ops;
    },

    frameEvents() {
      if (!last) return [];
      const now = flags();
      const events = [];
      if (now.captured > last.captured) {
        events.push({ type: 'capture', cells: now.captured - last.captured, pct: Math.round((now.captured / now.total) * 1000) / 10 });
      }
      if (now.lives < last.lives) events.push({ type: 'lifeLost', lives: now.lives });
      if (now.win && !last.win) events.push({ type: 'win' });
      if (now.gameOver && !last.gameOver) events.push({ type: 'gameOver' });
      last = now;
      return events;
    },
  };
})();
```

- [ ] **Step 3: Заглушки адаптера**

Чтобы `loadAdapter` загрузился до задач 9–11 (они заменят файлы целиком):

`verify/bot/model.mjs`:
```js
export const toModel = (raw) => raw;
export const progress = (model) => model.captured;
```
`verify/bot/missions.mjs`:
```js
export const missions = { 'capture-80': { done: (model) => model.win } };
```
`verify/bot/goals.mjs`:
```js
export const replanOn = ['capture', 'lifeLost'];
export const candidates = () => [];
```
`verify/bot/tactics.mjs`:
```js
export const tactics = {};
```
`verify/bot/oracles.mjs`:
```js
export const oracles = [];
```

- [ ] **Step 4: probe на уровнях 1 и 3**

Run (из `E:/projects/ImageUncovered`): `node VC probe --root . --level 0`
Expected: JSON, где `state.player` не `null`, `state.enemies` не пуст, `state.grid.cols` = 128, `state.grid.rows` = 72 (или фактические размеры поля), `state.lives` = 5, `state.captured` = 0, `actions` — 5 движений, `errors` = `[]`.

Run: `node VC probe --root . --level 2`
Expected: `state.level` = 2, остальное как выше. Если зависает до `Уровень не стал готов за 3000 кадров` — прочитать `assets/scripts/systems/LevelLoadSystem.ts` (сброс `transitioning`, `readyFrames`) и поправить условие `ready()` в мосте; игру не менять.

Run: `node VC probe --root . --level 0 --seed 7` дважды подряд
Expected: одинаковые `state.enemies` в обоих выводах.

- [ ] **Step 5: Commit**

```bash
cd E:/projects/ImageUncovered
git add verify
git commit -m "feat(verify): мост бота verify-cocos и конфиг прогонов"
```

---

### Task 9: ImageUncovered — модель состояния

**Files:**
- Modify (заменить заглушку): `verify/bot/model.mjs`
- Test: `verify/bot/tests/helpers.mjs`, `verify/bot/tests/model.test.mjs`

**Interfaces:**
- Consumes: формат `observe()` (задача 8).
- Produces: `Cell = { Danger: 0, BaseSafe: 1, CapturedSafe: 2, Trail: 3 }`, `DIR = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] }`, `isSafeCell(v)`, `index(model, col, row)`, `inside(model, col, row)`, `cellAt(model, col, row)`, `cellOfPoint(model, x, y) → { col, row }`, `labelRegions(cells, cols, rows) → { labels: Int32Array, count }` (метки только у `Danger`, остальное `-1`), `toModel(raw) → model`, `progress(model)`, `summary(model)`.
  `model = { raw, fps, cols, rows, cellSize, originX, originY, cells: Uint8Array, regions, player, enemies, bonuses, activeBonuses, lives, captured, total, coverage, win, gameOver, inputGated, level, framesPerCell }`.

- [ ] **Step 1: Помощник тестов и падающий тест**

`verify/bot/tests/helpers.mjs`:
```js
// Синтетическое состояние в формате observe() моста.
export function makeRaw({ cols = 20, rows = 20, cellSize = 10, player = { col: 0, row: 0 }, enemies = [], bonuses = [], captured = [], trail = [], safe = [], lives = 5, activeBonuses = [], trailActive = false, inputGated = false } = {}) {
  const cells = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) cells[r * cols + c] = 1;
  }
  for (const [c, r] of captured) cells[r * cols + c] = 2;
  for (const [c, r] of safe) cells[r * cols + c] = 1;
  for (const [c, r] of trail) cells[r * cols + c] = 3;
  const center = (col, row) => ({ x: (col + 0.5) * cellSize, y: (row + 0.5) * cellSize, col, row });
  const count = cells.filter((v) => v === 2).length;
  return {
    fps: 60, level: 0,
    grid: { cols, rows, cellSize, originX: 0, originY: 0, cells: Buffer.from(cells).toString('base64') },
    player: player && { ...center(player.col, player.row), dirX: 0, dirY: 0, trailActive, speed: 300 },
    enemies: enemies.map((e) => ({ ...center(e.col, e.row), vx: e.vx ?? 600, vy: e.vy ?? 600 })),
    bonuses: bonuses.map((b) => ({ type: b.type ?? 0, ...center(b.col, b.row) })),
    activeBonuses, lives, captured: count, total: cols * rows,
    win: false, gameOver: false, inputGated, view: { playerVisible: true },
  };
}
```

`verify/bot/tests/model.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toModel, labelRegions, Cell, cellAt, cellOfPoint, progress, summary } from '../model.mjs';
import { makeRaw } from './helpers.mjs';

test('сетка раскодирована, кольцо по краю безопасно', () => {
  const m = toModel(makeRaw());
  assert.equal(m.cols, 20);
  assert.equal(cellAt(m, 0, 5), Cell.BaseSafe);
  assert.equal(cellAt(m, 5, 5), Cell.Danger);
});

test('захват и доля считаются из состояния', () => {
  const m = toModel(makeRaw({ captured: [[5, 5], [6, 5]] }));
  assert.equal(m.captured, 2);
  assert.equal(m.coverage, 2 / 400);
  assert.equal(progress(m), 2);
  assert.match(summary(m), /захват 0\.5%/);
});

test('кадров на клетку — из скорости игрока и fps', () => {
  assert.equal(toModel(makeRaw()).framesPerCell, 2);
});

test('регионы: безопасная стена делит опасную зону надвое', () => {
  const wall = Array.from({ length: 18 }, (_, i) => [10, i + 1]);
  const m = toModel(makeRaw({ safe: wall }));
  assert.equal(m.regions.count, 2);
  assert.notEqual(m.regions.labels[5 * 20 + 5], m.regions.labels[5 * 20 + 15]);
  assert.equal(m.regions.labels[0], -1);
});

test('labelRegions не метит клетки следа', () => {
  const cells = new Uint8Array([0, 3, 0]);
  const { labels, count } = labelRegions(cells, 3, 1);
  assert.equal(count, 2);
  assert.equal(labels[1], -1);
});

test('точка → клетка с зажимом в границы', () => {
  const m = toModel(makeRaw());
  assert.deepEqual(cellOfPoint(m, 55, 15), { col: 5, row: 1 });
  assert.deepEqual(cellOfPoint(m, -5, 999), { col: 0, row: 19 });
});
```

Run (из `E:/projects/ImageUncovered`): `node --test verify/bot/tests/`
Expected: FAIL — нет экспорта `labelRegions` и др.

- [ ] **Step 2: Реализация**

`verify/bot/model.mjs`:
```js
// Модель состояния ImageUncovered для бота: JSON моста → удобные структуры.
//
// Клетки — как в TerritoryGrid игры. Строка растёт вверх (ось Y Cocos),
// столбец — вправо.
export const Cell = { Danger: 0, BaseSafe: 1, CapturedSafe: 2, Trail: 3 };
export const DIR = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };
const DIRS4 = Object.values(DIR);

export const isSafeCell = (v) => v === Cell.BaseSafe || v === Cell.CapturedSafe;
export const index = (m, col, row) => row * m.cols + col;
export const inside = (m, col, row) => col >= 0 && row >= 0 && col < m.cols && row < m.rows;
export const cellAt = (m, col, row) => (inside(m, col, row) ? m.cells[index(m, col, row)] : Cell.Danger);

export function cellOfPoint(m, x, y) {
  const col = Math.floor((x - m.originX) / m.cellSize);
  const row = Math.floor((y - m.originY) / m.cellSize);
  return { col: Math.max(0, Math.min(m.cols - 1, col)), row: Math.max(0, Math.min(m.rows - 1, row)) };
}

// Связные области опасных клеток (4-соседство) — как floodFillRegions игры.
export function labelRegions(cells, cols, rows) {
  const labels = new Int32Array(cells.length).fill(-1);
  const stack = [];
  let count = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== Cell.Danger || labels[i] !== -1) continue;
    labels[i] = count;
    stack.push(i);
    while (stack.length > 0) {
      const k = stack.pop();
      const c = k % cols;
      const r = (k - c) / cols;
      for (const [dc, dr] of DIRS4) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const n = nr * cols + nc;
        if (cells[n] === Cell.Danger && labels[n] === -1) {
          labels[n] = count;
          stack.push(n);
        }
      }
    }
    count++;
  }
  return { labels, count };
}

export function toModel(raw) {
  const { grid } = raw;
  const cells = new Uint8Array(Buffer.from(grid.cells, 'base64'));
  const speed = raw.player?.speed ?? 0;
  return {
    raw,
    fps: raw.fps,
    level: raw.level,
    cols: grid.cols,
    rows: grid.rows,
    cellSize: grid.cellSize,
    originX: grid.originX,
    originY: grid.originY,
    cells,
    regions: labelRegions(cells, grid.cols, grid.rows),
    player: raw.player,
    enemies: raw.enemies,
    bonuses: raw.bonuses,
    activeBonuses: raw.activeBonuses,
    lives: raw.lives,
    captured: raw.captured,
    total: raw.total,
    coverage: raw.total > 0 ? raw.captured / raw.total : 0,
    win: raw.win,
    gameOver: raw.gameOver,
    inputGated: raw.inputGated,
    framesPerCell: speed > 0 ? grid.cellSize / (speed / raw.fps) : Infinity,
  };
}

export const progress = (m) => m.captured;

export const summary = (m) => `захват ${(m.coverage * 100).toFixed(1)}%, жизни ${m.lives}`;
```

- [ ] **Step 3: Тесты проходят**

Run: `node --test verify/bot/tests/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add verify/bot
git commit -m "feat(verify): модель состояния бота — сетка, регионы, доля захвата"
```

---

### Task 10: ImageUncovered — миссия, цели, тактики

**Files:**
- Modify (заменить заглушки): `verify/bot/missions.mjs`, `verify/bot/goals.mjs`, `verify/bot/tactics.mjs`
- Test: `verify/bot/tests/goals.test.mjs`, `verify/bot/tests/tactics.test.mjs`

**Interfaces:**
- Consumes: всё из `model.mjs` (задача 9); `makeRaw` (тесты).
- Produces: `missions['capture-80'] = { done(model, events) }`.
- Produces: `goals.mjs` → `replanOn = ['capture', 'lifeLost']`, `candidates(model, mission) → goal[]`, `estimateCapture(model, trailCells) → { count, isCaptured(k) }`, `isSafeRoute(model, trailCells, travelFrames) → boolean`, `compress(path) → waypoint[]`.
  Цели: `kind: 'excursion'`, `params: { route: [{ col, row }], safe, captured, bonus }`; `kind: 'use-bonus'`, `params: { count }`.
  `id` вылазки: `cut:r<регион>:e<враг>:<col>,<row>:<dir><depth><сторона><length>` или с префиксом `bonus:`, если захват накрывает бонус; `return` — вернуться в безопасную зону с активным следом.
- Produces: `tactics = { excursion: { next }, 'use-bonus': { next } }`.

- [ ] **Step 1: Падающие тесты**

`verify/bot/tests/goals.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toModel, isSafeCell, cellAt, index } from '../model.mjs';
import { candidates, estimateCapture, isSafeRoute, compress } from '../goals.mjs';
import { missions } from '../missions.mjs';
import { makeRaw } from './helpers.mjs';

const mission = missions['capture-80'];

test('вылазки начинаются в безопасной зоне и там же заканчиваются', () => {
  const m = toModel(makeRaw({ enemies: [{ col: 15, row: 15 }] }));
  const list = candidates(m, mission).filter((g) => g.kind === 'excursion');
  assert.ok(list.length > 0);
  for (const goal of list) {
    const end = goal.params.route.at(-1);
    assert.ok(isSafeCell(cellAt(m, end.col, end.row)), `${goal.id} кончается в опасной клетке`);
    assert.ok(goal.score > 0);
  }
});

test('захват: отрезанный угол без врага захватывается, сторона с врагом — нет', () => {
  const m = toModel(makeRaw({ enemies: [{ col: 15, row: 15 }] }));
  // Горизонтальная линия по row 5 через всё поле отрезает низ (rows 1..4) от врага.
  const trail = Array.from({ length: 18 }, (_, i) => index(m, i + 1, 5));
  const result = estimateCapture(m, trail);
  assert.equal(result.count, 18 + 18 * 4);
  assert.ok(result.isCaptured(index(m, 3, 2)));
  assert.ok(!result.isCaptured(index(m, 15, 15)));
});

test('маршрут у врага на пути небезопасен, вдали — безопасен', () => {
  const m = toModel(makeRaw({ enemies: [{ col: 5, row: 10, vx: 0, vy: -600 }] }));
  const across = Array.from({ length: 5 }, (_, i) => index(m, 3 + i, 5));
  assert.equal(isSafeRoute(m, across, 0), false);
  const far = toModel(makeRaw({ enemies: [{ col: 17, row: 17, vx: 0, vy: 0 }] }));
  assert.equal(isSafeRoute(far, across, 0), true);
});

test('бонус в захватываемой области поднимает оценку и помечает цель', () => {
  const m = toModel(makeRaw({ enemies: [{ col: 15, row: 15, vx: 0, vy: 0 }], bonuses: [{ col: 2, row: 2 }] }));
  const list = candidates(m, mission);
  assert.ok(list.some((g) => g.id.startsWith('bonus:') && g.params.bonus === 1));
});

test('в стеке есть бонус — цель использовать его с наивысшей оценкой', () => {
  const m = toModel(makeRaw({ enemies: [{ col: 15, row: 15 }], activeBonuses: [1] }));
  const list = candidates(m, mission);
  const best = list.reduce((a, b) => (b.score > a.score ? b : a));
  assert.equal(best.kind, 'use-bonus');
  assert.ok(best.done(toModel(makeRaw({ activeBonuses: [] })), []));
});

test('след активен — единственная вылазка ведёт назад в безопасную зону', () => {
  const m = toModel(makeRaw({ player: { col: 3, row: 4 }, trail: [[3, 1], [3, 2], [3, 3], [3, 4]], trailActive: true, enemies: [{ col: 15, row: 15 }] }));
  const list = candidates(m, mission).filter((g) => g.kind === 'excursion');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'return');
  const end = list[0].params.route.at(-1);
  assert.ok(isSafeCell(cellAt(m, end.col, end.row)));
});

test('цель-вылазка завершается захватом и проваливается потерей жизни', () => {
  const m = toModel(makeRaw({ enemies: [{ col: 15, row: 15 }] }));
  const goal = candidates(m, mission).find((g) => g.kind === 'excursion');
  assert.ok(goal.done(m, [{ type: 'capture', cells: 3 }]));
  assert.ok(goal.failed(m, [{ type: 'lifeLost', lives: 4 }]));
});

test('compress оставляет только точки поворота и конец', () => {
  const path = [[1, 0], [2, 0], [3, 0], [3, 1], [3, 2]].map(([col, row]) => ({ col, row }));
  assert.deepEqual(compress(path), [{ col: 3, row: 0 }, { col: 3, row: 2 }]);
});

test('миссия capture-80 — по событию или флагу победы', () => {
  const m = toModel(makeRaw());
  assert.ok(!mission.done(m, []));
  assert.ok(mission.done(m, [{ type: 'win' }]));
  assert.ok(mission.done({ ...m, win: true }, []));
});
```

`verify/bot/tests/tactics.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toModel } from '../model.mjs';
import { tactics } from '../tactics.mjs';
import { makeRaw } from './helpers.mjs';

const goal = (route) => ({ kind: 'excursion', params: { route }, memo: {} });

test('идёт к точке маршрута и останавливает шаг за клетку до неё', () => {
  const m = toModel(makeRaw({ player: { col: 1, row: 0 } }));
  assert.deepEqual(tactics.excursion.next(m, goal([{ col: 5, row: 0 }])), { action: { type: 'move', dir: 'right' }, frames: 6 });
});

test('в точке маршрута переходит к следующей', () => {
  const m = toModel(makeRaw({ player: { col: 5, row: 0 } }));
  const g = goal([{ col: 5, row: 0 }, { col: 5, row: 3 }]);
  assert.deepEqual(tactics.excursion.next(m, g).action, { type: 'move', dir: 'up' });
  assert.equal(g.memo.i, 1);
});

test('рядом с точкой — по кадру, чтобы не проскочить поворот', () => {
  const m = toModel(makeRaw({ player: { col: 4, row: 0 } }));
  assert.equal(tactics.excursion.next(m, goal([{ col: 5, row: 0 }])).frames, 1);
});

test('ввод заблокирован — отпустить клавиши на кадр', () => {
  const m = toModel(makeRaw({ player: { col: 1, row: 0 }, inputGated: true }));
  assert.deepEqual(tactics.excursion.next(m, goal([{ col: 5, row: 0 }])), { action: { type: 'move', dir: 'none' }, frames: 1 });
});

test('бонус — нажатие пробела', () => {
  assert.deepEqual(tactics['use-bonus'].next(), { action: { type: 'useBonus' }, frames: 1 });
});
```

Run: `node --test verify/bot/tests/`
Expected: FAIL — нет экспортов `candidates`, `tactics` и др.

- [ ] **Step 2: Миссия**

`verify/bot/missions.mjs`:
```js
// Долгосрочные цели. Миссию выбирает файл прогона.
export const missions = {
  // Порог победы игры — 80% поля (WinSystem). Миссия опирается на победу
  // игры, а не на свой подсчёт: иначе бот «побеждал» бы при сломанной победе.
  'capture-80': {
    done: (model, events) => model.win || events.some((event) => event.type === 'win'),
  },
};
```

- [ ] **Step 3: Цели**

`verify/bot/goals.mjs`:
```js
// Краткосрочные цели бота ImageUncovered и их оценка.
//
// Основная цель — вылазка: из безопасной клетки на границе уйти в опасную зону
// прямоугольной петлёй и вернуться в безопасную. Игра захватывает опасные
// области, где не осталось врагов (CaptureResolveSystem), — оценка повторяет
// это правило на копии сетки и прогнозирует врагов по кадрам, чтобы след не
// попал под удар.
import { Cell, DIR, isSafeCell, index, inside, cellAt, cellOfPoint, labelRegions } from './model.mjs';

const DEPTHS = [3, 6, 10];
const LENGTHS = [4, 8, 16];
const MAX_STARTS = 16;
const SAFETY_MARGIN = 1;          // клеток вокруг следа, куда враг не должен попасть
const UNSAFE_FACTOR = 0.001;      // опасная вылазка остаётся в списке, но в самом конце
const BONUS_WEIGHT = 300;         // бонус ценится как 300 захваченных клеток
const TRAVEL_SCALE = 600;         // кадров пути, за которые ценность падает вдвое
const USE_BONUS_SCORE = 1e9;

export const replanOn = ['capture', 'lifeLost'];

const PERP = { up: ['left', 'right'], down: ['left', 'right'], left: ['up', 'down'], right: ['up', 'down'] };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

const excursionDone = (m, events) => events.some((e) => e.type === 'capture');
const excursionFailed = (m, events) => m.gameOver || events.some((e) => e.type === 'lifeLost');

export function compress(path) {
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const prev = path[i - 1];
    const cur = path[i];
    const next = path[i + 1];
    if (!next) { out.push(cur); break; }
    if (!prev) continue;
    const turns = (cur.col - prev.col !== next.col - cur.col) || (cur.row - prev.row !== next.row - cur.row);
    if (turns) out.push(cur);
  }
  return out;
}

// BFS по клеткам, где allowed(v) истинно. Возвращает расстояния и предков.
function bfs(m, from, allowed) {
  const dist = new Int32Array(m.cells.length).fill(-1);
  const prev = new Int32Array(m.cells.length).fill(-1);
  const start = index(m, from.col, from.row);
  dist[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    const c = k % m.cols;
    const r = (k - c) / m.cols;
    for (const [dc, dr] of Object.values(DIR)) {
      const nc = c + dc;
      const nr = r + dr;
      if (!inside(m, nc, nr)) continue;
      const n = index(m, nc, nr);
      if (dist[n] !== -1 || !allowed(m.cells[n])) continue;
      dist[n] = dist[k] + 1;
      prev[n] = k;
      queue.push(n);
    }
  }
  return { dist, prev };
}

function pathTo(m, search, target) {
  const path = [];
  for (let k = target; k !== -1 && search.dist[k] > 0; k = search.prev[k]) {
    path.push({ col: k % m.cols, row: Math.floor(k / m.cols) });
  }
  return path.reverse();
}

function boundaryStarts(m, search) {
  const starts = [];
  for (let k = 0; k < m.cells.length; k++) {
    if (!isSafeCell(m.cells[k]) || search.dist[k] < 0) continue;
    const c = k % m.cols;
    const r = (k - c) / m.cols;
    if (Object.values(DIR).some(([dc, dr]) => cellAt(m, c + dc, r + dr) === Cell.Danger && inside(m, c + dc, r + dr))) {
      starts.push({ col: c, row: r });
    }
  }
  const step = Math.max(1, Math.ceil(starts.length / MAX_STARTS));
  return starts.filter((_, i) => i % step === 0);
}

function excursion(m, start, dir, side, depth, length) {
  const cells = [];
  let c = start.col;
  let r = start.row;
  const walk = (d, n) => {
    const [dc, dr] = DIR[d];
    for (let i = 0; i < n; i++) {
      c += dc; r += dr;
      if (!inside(m, c, r) || m.cells[index(m, c, r)] !== Cell.Danger) return false;
      cells.push(index(m, c, r));
    }
    return true;
  };
  if (!walk(dir, depth)) return null;
  const corner1 = { col: c, row: r };
  if (!walk(side, length)) return null;
  const corner2 = { col: c, row: r };
  const [bc, br] = DIR[OPP[dir]];
  for (let i = 0; i < depth + 2; i++) {
    c += bc; r += br;
    if (!inside(m, c, r)) return null;
    const v = m.cells[index(m, c, r)];
    if (isSafeCell(v)) return { cells, waypoints: [corner1, corner2, { col: c, row: r }] };
    if (v !== Cell.Danger) return null;
    cells.push(index(m, c, r));
  }
  return null;
}

export function estimateCapture(m, trailCells) {
  const cells = m.cells.slice();
  for (const k of trailCells) cells[k] = Cell.CapturedSafe;
  const { labels, count } = labelRegions(cells, m.cols, m.rows);
  const withEnemy = new Uint8Array(count);
  for (const e of m.enemies) {
    const label = labels[index(m, e.col, e.row)];
    if (label >= 0) withEnemy[label] = 1;
  }
  const trail = new Set(trailCells);
  const isCaptured = (k) => trail.has(k) || (labels[k] >= 0 && !withEnemy[labels[k]]);
  let total = 0;
  for (let k = 0; k < cells.length; k++) if (isCaptured(k)) total++;
  return { count: total, isCaptured };
}

// Прогноз врагов по кадрам: прямолинейно, с отражением от безопасных клеток
// по каждой оси отдельно. Приближение отскоков TerritoryBounceSystem; хватает,
// чтобы не вести след поперёк траектории.
export function isSafeRoute(m, trailCells, travelFrames) {
  const fpc = m.framesPerCell;
  const total = Math.ceil(travelFrames + trailCells.length * fpc);
  const laidAt = new Map();
  trailCells.forEach((k, i) => laidAt.set(k, travelFrames + (i + 1) * fpc));
  for (const enemy of m.enemies) {
    let { x, y } = enemy;
    let vx = enemy.vx / m.fps;
    let vy = enemy.vy / m.fps;
    for (let t = 1; t <= total; t++) {
      let cell = cellOfPoint(m, x + vx, y);
      if (isSafeCell(cellAt(m, cell.col, cell.row))) vx = -vx; else x += vx;
      cell = cellOfPoint(m, x, y + vy);
      if (isSafeCell(cellAt(m, cell.col, cell.row))) vy = -vy; else y += vy;
      const { col, row } = cellOfPoint(m, x, y);
      for (let dc = -SAFETY_MARGIN; dc <= SAFETY_MARGIN; dc++) {
        for (let dr = -SAFETY_MARGIN; dr <= SAFETY_MARGIN; dr++) {
          if (!inside(m, col + dc, row + dr)) continue;
          const at = laidAt.get(index(m, col + dc, row + dr));
          if (at !== undefined && at <= t) return false;
        }
      }
    }
  }
  return true;
}

function returnGoal(m) {
  const search = bfs(m, m.player, (v) => v === Cell.Danger || isSafeCell(v));
  let best = -1;
  for (let k = 0; k < m.cells.length; k++) {
    if (search.dist[k] > 0 && isSafeCell(m.cells[k]) && (best === -1 || search.dist[k] < search.dist[best])) best = k;
  }
  if (best === -1) return null;
  return {
    kind: 'excursion', id: 'return', score: 1,
    params: { route: compress([m.player, ...pathTo(m, search, best)]), safe: true, captured: 0, bonus: 0 },
    done: excursionDone, failed: excursionFailed,
  };
}

function useBonusGoal(m) {
  const count = m.activeBonuses.length;
  return {
    kind: 'use-bonus', id: 'use-bonus', score: USE_BONUS_SCORE, params: { count },
    done: (model) => model.activeBonuses.length < count,
    failed: (model, events) => events.some((e) => e.type === 'lifeLost'),
  };
}

export function candidates(m) {
  if (!m.player || m.gameOver || m.win) return [];
  const out = [];
  if (m.activeBonuses.length > 0) out.push(useBonusGoal(m));
  if (m.player.trailActive) {
    const back = returnGoal(m);
    if (back) out.push(back);
    return out;
  }

  const search = bfs(m, m.player, isSafeCell);
  for (const start of boundaryStarts(m, search)) {
    const travel = pathTo(m, search, index(m, start.col, start.row));
    const travelFrames = travel.length * m.framesPerCell;
    for (const dir of Object.keys(DIR)) {
      const [dc, dr] = DIR[dir];
      if (!inside(m, start.col + dc, start.row + dr)) continue;
      if (m.cells[index(m, start.col + dc, start.row + dr)] !== Cell.Danger) continue;
      for (const depth of DEPTHS) {
        for (const side of PERP[dir]) {
          for (const length of LENGTHS) {
            const exc = excursion(m, start, dir, side, depth, length);
            if (!exc) continue;
            const captured = estimateCapture(m, exc.cells);
            const bonus = m.bonuses.filter((b) => captured.isCaptured(index(m, b.col, b.row))).length;
            const safe = isSafeRoute(m, exc.cells, travelFrames);
            const frames = travelFrames + exc.cells.length * m.framesPerCell;
            const score = (safe ? 1 : UNSAFE_FACTOR) * (captured.count + bonus * BONUS_WEIGHT) / (1 + frames / TRAVEL_SCALE);
            const region = m.regions.labels[exc.cells[0]];
            const enemy = m.enemies.findIndex((e) => m.regions.labels[index(m, e.col, e.row)] === region);
            out.push({
              kind: 'excursion',
              id: `${bonus > 0 ? 'bonus' : 'cut'}:r${region}:e${enemy}:${start.col},${start.row}:${dir}${depth}${side[0]}${length}`,
              score,
              params: { route: [...compress([m.player, ...travel]), ...exc.waypoints], safe, captured: captured.count, bonus },
              done: excursionDone,
              failed: excursionFailed,
            });
          }
        }
      }
    }
  }
  return out;
}
```

Примечание к `compress([m.player, ...travel])`: если игрок уже стоит на `start`, `travel` пуст и `compress` вернёт `[m.player]` — тактика пропустит эту точку как достигнутую.

- [ ] **Step 4: Тактики**

`verify/bot/tactics.mjs`:
```js
// Как идти к краткосрочной цели.
//
// Вылазка — маршрут из точек поворота. Тактика замкнута по обратной связи:
// каждый вызов смотрит, где игрок сейчас, а не где он «должен» быть. Шаг
// останавливается за клетку до поворота и дальше идёт по кадру — игрок
// поворачивает в центре клетки (GridSnap), и длинный шаг проскочил бы поворот.
const hold = (frames = 1) => ({ action: { type: 'move', dir: 'none' }, frames });

export const tactics = {
  excursion: {
    next(model, goal) {
      const memo = goal.memo;
      memo.i ??= 0;
      const route = goal.params.route;
      const p = model.player;
      if (!p) return hold();
      if (model.inputGated) return hold();
      while (memo.i < route.length && route[memo.i].col === p.col && route[memo.i].row === p.row) memo.i++;
      if (memo.i >= route.length) return hold();
      const target = route[memo.i];
      const dc = target.col - p.col;
      const dr = target.row - p.row;
      const dir = dc > 0 ? 'right' : dc < 0 ? 'left' : dr > 0 ? 'up' : 'down';
      const distance = dc !== 0 ? Math.abs(dc) : Math.abs(dr);
      const frames = distance > 1 ? Math.max(1, Math.floor((distance - 1) * model.framesPerCell)) : 1;
      return { action: { type: 'move', dir }, frames };
    },
  },
  'use-bonus': {
    next: () => ({ action: { type: 'useBonus' }, frames: 1 }),
  },
};
```

- [ ] **Step 5: Тесты проходят**

Run: `node --test verify/bot/tests/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add verify/bot
git commit -m "feat(verify): цели и тактики бота — вылазки с прогнозом врагов, бонусы"
```

---

### Task 11: ImageUncovered — оракулы, прогоны, первый настоящий прогон, документация

**Files:**
- Modify (заменить заглушку): `verify/bot/oracles.mjs`
- Test: `verify/bot/tests/oracles.test.mjs`
- Create: `verify/runs/capture-level-1.json`, `verify/runs/random-level-1.json`
- Create: `docs/verification/bot.md`
- Modify: `CLAUDE.md` (раздел Feature documentation)

**Interfaces:**
- Consumes: `model` (задача 9), CLI (задача 6).
- Produces: `oracles: [{ id, check(prev, cur, events) }]`.

- [ ] **Step 1: Падающие тесты оракулов**

`verify/bot/tests/oracles.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toModel } from '../model.mjs';
import { oracles } from '../oracles.mjs';
import { makeRaw } from './helpers.mjs';

const byId = Object.fromEntries(oracles.map((o) => [o.id, o]));
const m = (opts) => toModel(makeRaw(opts));

test('захват не убывает', () => {
  const prev = m({ captured: [[5, 5], [6, 5]] });
  assert.equal(byId['coverage-monotonic'].check(prev, prev, []), null);
  assert.ok(byId['coverage-monotonic'].check(prev, m({ captured: [[5, 5]] }), []));
});

test('жизни не растут и не падают больше чем на одну за шаг', () => {
  assert.ok(byId['lives-monotonic'].check(m({ lives: 3 }), m({ lives: 4 }), []));
  assert.ok(byId['lives-monotonic'].check(m({ lives: 5 }), m({ lives: 3 }), []));
  assert.equal(byId['lives-monotonic'].check(m({ lives: 5 }), m({ lives: 4 }), []), null);
});

test('враг не стоит в захваченной клетке', () => {
  assert.ok(byId['enemy-in-safe'].check(null, m({ captured: [[5, 5]], enemies: [{ col: 5, row: 5 }] }), []));
  assert.equal(byId['enemy-in-safe'].check(null, m({ enemies: [{ col: 7, row: 7 }] }), []), null);
});

test('после потери жизни следа на поле нет', () => {
  const withTrail = m({ trail: [[3, 1], [3, 2]], trailActive: true });
  assert.ok(byId['trail-cleared-on-life-lost'].check(null, withTrail, [{ type: 'lifeLost', lives: 4 }]));
  assert.equal(byId['trail-cleared-on-life-lost'].check(null, m(), [{ type: 'lifeLost', lives: 4 }]), null);
});

test('клетки следа есть тогда и только тогда, когда след активен', () => {
  assert.ok(byId['trail-matches-flag'].check(null, m({ trail: [[3, 1]], trailActive: false }), []));
  assert.ok(byId['trail-matches-flag'].check(null, m({ trailActive: true }), []));
  assert.equal(byId['trail-matches-flag'].check(null, m({ trail: [[3, 1]], trailActive: true }), []), null);
});

test('80% держится два наблюдения подряд без победы — нарушение', () => {
  const all = [];
  for (let c = 1; c < 19; c++) for (let r = 1; r < 19; r++) all.push([c, r]);
  const full = m({ captured: all });
  assert.ok(full.coverage >= 0.8);
  assert.ok(byId['win-at-threshold'].check(full, full, []));
  assert.equal(byId['win-at-threshold'].check(full, { ...full, win: true }, []), null);
  assert.equal(byId['win-at-threshold'].check(m(), full, []), null);
});
```

Run: `node --test verify/bot/tests/`
Expected: FAIL — `oracles` пуст (заглушка).

- [ ] **Step 2: Оракулы**

`verify/bot/oracles.mjs`:
```js
// Правила ImageUncovered, которые должны выполняться всегда.
//
// Каждый оракул сверяет две независимые величины. «Жизни убывают с событием
// lifeLost» здесь был бы тавтологией: мост выводит lifeLost из убыли жизней.
import { Cell, isSafeCell, cellAt } from './model.mjs';

const WIN_THRESHOLD = 0.8; // WinSystem: победа при доле захвата >= 80%

const hasTrail = (m) => m.cells.includes(Cell.Trail);

export const oracles = [
  {
    id: 'coverage-monotonic',
    check: (prev, cur) => (cur.level === prev.level && cur.captured < prev.captured
      ? { message: `захват уменьшился: ${prev.captured} → ${cur.captured}`, data: { prev: prev.captured, cur: cur.captured } }
      : null),
  },
  {
    id: 'lives-monotonic',
    check: (prev, cur) => {
      if (cur.lives > prev.lives) return { message: `жизни выросли: ${prev.lives} → ${cur.lives}`, data: { prev: prev.lives, cur: cur.lives } };
      if (prev.lives - cur.lives > 1) return { message: `за шаг потеряно ${prev.lives - cur.lives} жизни`, data: { prev: prev.lives, cur: cur.lives } };
      return null;
    },
  },
  {
    id: 'enemy-in-safe',
    check: (prev, cur) => {
      const enemy = cur.enemies.find((e) => cellAt(cur, e.col, e.row) === Cell.CapturedSafe);
      return enemy ? { message: `враг в захваченной клетке ${enemy.col},${enemy.row}`, data: enemy } : null;
    },
  },
  {
    id: 'trail-cleared-on-life-lost',
    check: (prev, cur, events) => (events.some((e) => e.type === 'lifeLost') && hasTrail(cur)
      ? { message: 'после потери жизни на поле остался след', data: null }
      : null),
  },
  {
    id: 'trail-matches-flag',
    check: (prev, cur) => {
      if (!cur.player) return null;
      const trail = hasTrail(cur);
      return trail !== cur.player.trailActive
        ? { message: `клетки следа: ${trail}, флаг следа игрока: ${cur.player.trailActive}`, data: null }
        : null;
    },
  },
  {
    id: 'win-at-threshold',
    check: (prev, cur) => (prev.coverage >= WIN_THRESHOLD && cur.coverage >= WIN_THRESHOLD && !cur.win && !cur.gameOver
      ? { message: `захват ${(cur.coverage * 100).toFixed(1)}% два наблюдения подряд, победы нет`, data: { coverage: cur.coverage } }
      : null),
  },
];
```

Run: `node --test verify/bot/tests/`
Expected: PASS.

- [ ] **Step 3: Прогоны**

`verify/runs/capture-level-1.json`:
```json
{
  "title": "Бот проходит уровень 1 без нарушений",
  "zone": "gameplay",
  "level": 0,
  "seed": 1,
  "mission": "capture-80",
  "policy": { "goal": "planned", "action": "planned" },
  "expect": { "verdict": "pass" }
}
```

`verify/runs/random-level-1.json`:
```json
{
  "title": "Случайная игра на уровне 1 не нарушает правил игры",
  "zone": "gameplay",
  "level": 0,
  "seed": 1,
  "mission": "capture-80",
  "policy": "random",
  "expect": { "verdictIn": ["pass", "lose", "timeout"] }
}
```

- [ ] **Step 4: Первый настоящий прогон и настройка**

Run (из `E:/projects/ImageUncovered`): `node VC run --root . --run capture-level-1`

Разбор по вердикту (команда `/verify-cocos` описывает то же):
- `pass` — дальше.
- `bot-stuck` / `timeout` — открыть `tmp/bot/<прогон>/trace.jsonl`, найти `goal-end` с `timeout`/`failed`. Типичные причины и где править (только `verify/bot/`):
  - игрок проскакивает повороты → в `tactics.mjs` уменьшить шаг (`distance - 2` вместо `distance - 1`);
  - вылазки гибнут под врагами → в `goals.mjs` увеличить `SAFETY_MARGIN` до 2;
  - нет кандидатов (`plan` с `count: 0`) → проверить `boundaryStarts` на реальной сетке через `probe`.
  После каждой правки — `node --test verify/bot/tests/`, затем прогон снова.
- `bug` — **не править оракул, чтобы позеленело.** Открыть `tail.jsonl`, `state.json`, `final.png`, воспроизвести `node VC replay --root . tmp/bot/<прогон>`. Если это баг игры — остановиться и доложить инженеру с журналом и снимком: в этой задаче игра не меняется. Если оракул ошибается (например, `enemy-in-safe` срабатывает на кадре отскока) — доложить с доказательством из `state.json`, решение об ослаблении — за инженером.
- `error` — сборка/Chrome/мост; прогон ничего не проверил, разобрать и повторить.

Run: `node VC run --root . --run random-level-1`
Expected: вердикт из `verdictIn`; `bug` разбирается как выше.

- [ ] **Step 5: Детерминизм на реальной игре**

Run: `node VC replay --root . tmp/bot/<каталог capture-level-1>`
Expected: `Журнал воспроизведён без расхождений.` Если расхождение при том же хэше адаптера — это находка о недетерминизме игры: доложить инженеру строку расхождения.

- [ ] **Step 6: Короткий soak**

Run: `node VC soak --root . --seeds 3`
Expected: 12 прогонов, сводка по вердиктам. `bug` группы — доложить инженеру списком (оракул, число, пример каталога). Код возврата при `bug` ненулевой — это ожидаемо для находки, а не ошибка шага.

- [ ] **Step 7: Документация адаптера**

`docs/verification/bot.md`:
```markdown
# Бот-тестировщик (verify-cocos)

Бот играет в продовую web-сборку (`build/web-mobile-vk`) через плагин
`verify-cocos` из claude-marketplace. Сборка игры бота не содержит: мост
`verify/bot/bridge.js` внедряется в страницу при прогоне.

## Запуск

```
node <marketplace>/plugins/verify-cocos/scripts/verify-cocos.mjs run --root .
node <marketplace>/plugins/verify-cocos/scripts/verify-cocos.mjs soak --root . --seeds 20
node <marketplace>/plugins/verify-cocos/scripts/verify-cocos.mjs replay --root . tmp/bot/<прогон>
node <marketplace>/plugins/verify-cocos/scripts/verify-cocos.mjs probe --root . --level 0
```

Перед прогоном сборка должна быть свежей — см. [platforms/vk.md](../platforms/vk.md).

## Модель

- Сетка `TerritoryGrid` (клетка 10 px), регионы — связные опасные области.
- Враги с координатами и скоростью (px/с), несобранные бонусы, стек активных
  бонусов, жизни, доля захвата.
- События моста — из разницы кадров: `capture`, `lifeLost`, `win`, `gameOver`.

## Миссии

| Миссия | Выполнена, когда |
|---|---|
| `capture-80` | игра объявила победу (порог WinSystem — 80%) |

## Цели и оценка

- **Вылазка** (`cut:…` / `bonus:…`): из безопасной клетки на границе —
  прямоугольная петля глубиной 3/6/10 и длиной 4/8/16 клеток, обратно до
  безопасной клетки. Оценка = захваченные клетки (по правилу игры: области без
  врагов) + 300 за каждый накрытый бонус, делённые на `1 + кадры/600`.
  Опасная по прогнозу врагов вылазка получает множитель 0.001.
- **Возврат** (`return`): след активен — кратчайший путь в безопасную зону.
- **Бонус** (`use-bonus`): в стеке есть бонус — нажать пробел.

Пересмотр целей — после `capture` и `lifeLost`.

## Оракулы

| Оракул | Правило |
|---|---|
| `coverage-monotonic` | захват в пределах уровня не убывает |
| `lives-monotonic` | жизни не растут и не падают больше чем на одну за шаг |
| `enemy-in-safe` | враг не стоит в захваченной клетке |
| `trail-cleared-on-life-lost` | после потери жизни следа на поле нет |
| `trail-matches-flag` | клетки следа есть ⇔ `CaptureTrail.active` |
| `win-at-threshold` | захват ≥ 80% два наблюдения подряд ⇒ победа |

## Прогоны

| Прогон | Что проверяет | Ожидание |
|---|---|---|
| `capture-level-1` | план проходит уровень 1 | `pass` |
| `random-level-1` | случайная игра не нарушает правил | `pass` / `lose` / `timeout` |
```

В `CLAUDE.md` в раздел «Feature documentation» после строки про Themes добавить:
```markdown
- **Verification bot** (verify-cocos: bridge, model, goals, oracles, runs) — [docs/verification/bot.md](docs/verification/bot.md).
```

- [ ] **Step 8: Commit**

```bash
git add verify docs/verification CLAUDE.md
git commit -m "feat(verify): оракулы и прогоны бота, документация адаптера"
```
Правки настройки из шага 4 (если были) — отдельными коммитами до этого: `fix(verify): <что поправлено в тактике/целях>`.

---

## Итог фазы 1

- `node --test tests/ && node --test plugins/verify-cocos/tests/` в marketplace — зелёные.
- `node --test verify/bot/tests/` в ImageUncovered — зелёные.
- `run` на ImageUncovered: `capture-level-1` — `pass` (или доложенная находка), `random-level-1` — в `verdictIn`.
- `replay` воспроизводит прогон без расхождений.
- Результаты `soak --seeds 3` доложены инженеру.
