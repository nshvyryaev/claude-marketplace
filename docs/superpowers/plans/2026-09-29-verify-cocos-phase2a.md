# verify-cocos, фаза 2а — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Проверки внутри прогона (инварианты и ожидания «когда X — в течение N кадров Y» на уровнях fact / pixel / agent), миссии-сценарии, покрытие; затем каталог правил ImageUncovered, закрытый проверками, с зелёными прогонами на неоне.

**Architecture:** Плагин получает исполнитель проверок (`checks.mjs`), помощник чтения дерева узлов в странице (`view.mjs`), вырезки снимков и пиксельные эталоны (`baseline.mjs`), параметры прогона в странице (`window.__botRun`). Агент вызывает исполнитель после каждого шага, урезает шаг до ближайшего срока ожидания, снимает вырезки. Проект описывает проверки в `verify/bot/checks.mjs`, факты вида — в мосте.

**Tech Stack:** Node 24 (ESM, `node:test`), Chrome по CDP, Cocos Creator 3.8.8 web-сборка. Без npm-зависимостей.

**Spec:** `docs/superpowers/specs/2026-09-29-verify-cocos-phase2a-design.md` (+ фаза 1: `2026-09-29-verify-cocos-design.md`).

## Репозитории и пути

- Marketplace `E:/projects/claude-marketplace` — задачи 1–6, ветка `verify-cocos-2a`.
- Игра `E:/projects/ImageUncovered` — задачи 7–11, ветка `verify-cocos-2a`.
- `VC` = `node E:/projects/claude-marketplace/plugins/verify-cocos/scripts/verify-cocos.mjs` (в командах — полный путь).
- Тесты: marketplace — `node --test --test-timeout=60000 "tests/**/*.test.mjs" "plugins/*/tests/**/*.test.mjs"`; игра — `node --test "verify/bot/tests/**/*.test.mjs"`.

## Global Constraints

- Ноль npm-зависимостей; игра ради бота не меняется (в `assets/` ничего).
- Тема прогонов — `minimal` (неон); painterly не проверяется.
- Детерминизм: seed, уровень, тема, миссия, политика, хэш адаптера, окружение (`env`) определяют прогон; в журнале нет стенного времени и портов.
- Проверки проекта — код адаптера: их исключения — `bot-error`, не `bug`.
- Комментарии и сообщения — по-русски; пути в исходниках — с прямыми слэшами.
- Временные файлы — `./tmp` проекта.
- Коммит после зелёных тестов задачи; переделка — отдельным коммитом; сообщение заканчивается `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Прогон кончился, пока ожидание взведено** → «не дождался», не нарушение и не подтверждение; `requires` с таким ожиданием — «не проверено». Тест — задача 2.
2. **Длинный шаг тактики перескакивает срок ожидания** → шаг урезается до ближайшего срока, `then` проверяется вовремя. Тест — задача 3.
3. **Вырезка за пределами канваса или нулевого размера** → ошибка адаптера (`bot-error`), не падение Chrome. Тест — задача 4.
4. **Эталона нет** → прогон `needs-review`, не зелёный и не `bug`; `--update-baseline` принимает. Тест — задача 5.
5. **Миссия с параметрами без обязательного параметра** → ошибка до запуска Chrome. Тест — задача 5.

---

### Task 1: `png.mjs` → `shared/cdp`

**Files:**
- Move: `plugins/verify-web/scripts/lib/png.mjs` → `shared/cdp/png.mjs`
- Move: `plugins/verify-web/tests/png.test.mjs` → `tests/png.test.mjs`; `plugins/verify-web/tests/__fixtures__/` → `tests/__fixtures__/`
- Modify: `plugins/verify-web/scripts/lib/run.mjs` (импорт `diffPng`)
- Generated: `plugins/*/scripts/vendor/cdp/png.mjs`

**Interfaces:**
- Produces: `vendor/cdp/png.mjs` → `decodePng(buffer)`, `encodePng({ width, height, pixels })`, `diffPng(baseline, current, { threshold }) → { sameSize, ratio, image, baselineSize, currentSize }`.

- [ ] **Step 1: Перенести и переключить импорты**

```bash
cd E:/projects/claude-marketplace
git switch -c verify-cocos-2a
git mv plugins/verify-web/scripts/lib/png.mjs shared/cdp/png.mjs
git mv plugins/verify-web/tests/png.test.mjs tests/png.test.mjs
git mv plugins/verify-web/tests/__fixtures__ tests/__fixtures__
sed -i "s#from '../scripts/lib/png.mjs'#from '../shared/cdp/png.mjs'#" tests/png.test.mjs
sed -i "s#from './png.mjs'#from '../vendor/cdp/png.mjs'#" plugins/verify-web/scripts/lib/run.mjs
node tools/sync-shared.mjs
```

- [ ] **Step 2: Тесты**

Run: `node --test --test-timeout=60000 "tests/**/*.test.mjs" "plugins/*/tests/**/*.test.mjs"`
Expected: PASS; `png.test.mjs` находит фикстуры (путь к `__fixtures__` в тесте относительный к файлу теста — если сломан, поправить на `new URL('./__fixtures__/…', import.meta.url)`).
Run: `node plugins/verify-web/scripts/verify.mjs 2>&1 | grep -m1 "Не найден"` — модуль грузится.

- [ ] **Step 3: Commit**

```bash
git add shared tests plugins/verify-web plugins/verify-cocos/scripts/vendor
git commit -m "refactor(shared): png.mjs в shared/cdp для пиксельных эталонов verify-cocos"
```

---

### Task 2: Исполнитель проверок

**Files:**
- Create: `plugins/verify-cocos/scripts/lib/checks.mjs`
- Test: `plugins/verify-cocos/tests/checks.test.mjs`

**Interfaces:**
- Produces: `createCheckRunner(checks) → runner`:
  - `runner.observe(prev, cur, events, { frame }) → { violation: null | { id, message, data }, shots: [{ id, n, level, region, criterion, trigger }], log: [{ t: 'arm'|'confirm'|'miss', check, n, trigger? }] }`;
  - `runner.nextDeadline(frame) → число кадров до ближайшего срока взведённого ожидания (Infinity, если нет)`;
  - `runner.resolveShot(id, outcome)` — `outcome`: `'match' | 'mismatch' | 'new' | 'review'`; `match` → confirmed, `mismatch` → missed, `new`/`review` → `pendingReview`;
  - `runner.finish() → coverage`;
  - `coverage = [{ id, kind, level, steps, armed, confirmed, missed, unfinished, pendingReview }]`.
- Produces: `unmetRequires(coverage, requires) → string[]` — id из `requires`, у которых `confirmed === 0` (для `pixel`/`agent` — `confirmed + pendingReview === 0`).
- Проверка — объект по спеке §3. `validateChecks(checks)` бросает `Error` с id при неверной форме (дубликат id, неизвестный `kind`/`level`, нет `check`/`when`, `fact` без `then`, `pixel`/`agent` без `region`, `within` не целое ≥ 0).

- [ ] **Step 1: Падающие тесты**

`plugins/verify-cocos/tests/checks.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCheckRunner, unmetRequires, validateChecks } from '../scripts/lib/checks.mjs';

const at = (frame) => ({ frame });
const byId = (cov, id) => cov.find((c) => c.id === id);

test('инвариант считается на каждом шаге и даёт нарушение', () => {
  const r = createCheckRunner([{ id: 'x', kind: 'invariant', level: 'fact', check: (p, c) => (c.v < 0 ? { message: 'минус' } : null) }]);
  assert.equal(r.observe({ v: 1 }, { v: 1 }, [], at(1)).violation, null);
  const out = r.observe({ v: 1 }, { v: -1 }, [], at(2));
  assert.deepEqual(out.violation, { id: 'x', message: 'минус', data: null });
  assert.equal(byId(r.finish(), 'x').steps, 2);
});

test('fact: взведено → подтверждено в пределах within', () => {
  const r = createCheckRunner([{ id: 'e', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? { at: c.f } : null), then: (c) => c.b, within: 3 }]);
  const arm = r.observe({}, { a: true, f: 1 }, [], at(1));
  assert.deepEqual(arm.log.map((l) => l.t), ['arm']);
  assert.equal(r.observe({}, { b: false }, [], at(2)).violation, null);
  const ok = r.observe({}, { b: true }, [], at(3));
  assert.deepEqual(ok.log.map((l) => l.t), ['confirm']);
  assert.deepEqual(byId(r.finish(), 'e'), { id: 'e', kind: 'expectation', level: 'fact', steps: 0, armed: 1, confirmed: 1, missed: 0, unfinished: 0, pendingReview: 0 });
});

test('fact: подтверждение в том же наблюдении, где взведено', () => {
  const r = createCheckRunner([{ id: 'e', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? {} : null), then: (c) => c.a, within: 0 }]);
  r.observe({}, { a: true }, [], at(5));
  assert.equal(byId(r.finish(), 'e').confirmed, 1);
});

test('fact: не наступило за within — нарушение с данными триггера', () => {
  const r = createCheckRunner([{ id: 'e', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? { k: 7 } : null), then: () => false, within: 2 }]);
  r.observe({}, { a: true }, [], at(10));
  assert.equal(r.observe({}, {}, [], at(11)).violation, null);
  const out = r.observe({}, {}, [], at(12));
  assert.equal(out.violation.id, 'e');
  assert.match(out.violation.message, /2 кадр/);
  assert.deepEqual(out.violation.data, { k: 7 });
});

test('несколько экземпляров одного ожидания живут отдельно', () => {
  let n = 0;
  const r = createCheckRunner([{ id: 'e', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? { n: ++n } : null), then: (c, ev, t) => c.ok === t.n, within: 10 }]);
  r.observe({}, { a: true }, [], at(1));
  r.observe({}, { a: true }, [], at(2));
  r.observe({}, { ok: 2 }, [], at(3));
  r.observe({}, { ok: 1 }, [], at(4));
  assert.equal(byId(r.finish(), 'e').confirmed, 2);
});

test('прогон кончился до срока — «не дождался», не нарушение', () => {
  const r = createCheckRunner([{ id: 'e', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? {} : null), then: () => false, within: 50 }]);
  r.observe({}, { a: true }, [], at(1));
  const cov = byId(r.finish(), 'e');
  assert.equal(cov.unfinished, 1);
  assert.equal(cov.missed, 0);
  assert.deepEqual(unmetRequires([cov], ['e']), ['e']);
});

test('nextDeadline — кадры до ближайшего срока', () => {
  const r = createCheckRunner([
    { id: 'a', kind: 'expectation', level: 'fact', when: (p, c) => (c.a ? {} : null), then: () => false, within: 8 },
    { id: 'b', kind: 'expectation', level: 'pixel', when: (p, c) => (c.b ? {} : null), region: () => ({ x: 0, y: 0, w: 1, h: 1 }), within: 3 },
  ]);
  assert.equal(r.nextDeadline(0), Infinity);
  r.observe({}, { a: true, b: true }, [], at(10));
  assert.equal(r.nextDeadline(10), 3);
  assert.equal(r.nextDeadline(12), 1);
});

test('pixel и agent: по сроку — запрос вырезки; исход решает resolveShot', () => {
  const r = createCheckRunner([
    { id: 'p', kind: 'expectation', level: 'pixel', when: (p, c) => (c.go ? { at: 1 } : null), region: (c, t) => ({ x: 1, y: 2, w: 3, h: 4 }), within: 2 },
    { id: 'g', kind: 'expectation', level: 'agent', when: (p, c) => (c.go ? {} : null), region: () => ({ x: 0, y: 0, w: 5, h: 5 }), within: 0, criterion: 'смотрится' },
  ]);
  const first = r.observe({}, { go: true }, [], at(1));
  assert.deepEqual(first.shots.map((s) => s.id), ['g']);
  assert.equal(first.shots[0].criterion, 'смотрится');
  assert.deepEqual(r.observe({}, {}, [], at(2)).shots, []);
  const later = r.observe({}, {}, [], at(3));
  assert.deepEqual(later.shots, [{ id: 'p', n: 1, level: 'pixel', region: { x: 1, y: 2, w: 3, h: 4 }, criterion: null, trigger: { at: 1 } }]);
  r.resolveShot('p', 'match');
  r.resolveShot('g', 'review');
  const cov = r.finish();
  assert.equal(byId(cov, 'p').confirmed, 1);
  assert.equal(byId(cov, 'g').pendingReview, 1);
  assert.deepEqual(unmetRequires(cov, ['p', 'g']), []);
});

test('mismatch засчитывается как промах', () => {
  const r = createCheckRunner([{ id: 'p', kind: 'expectation', level: 'pixel', when: (p, c) => (c.go ? {} : null), region: () => ({ x: 0, y: 0, w: 1, h: 1 }), within: 0 }]);
  r.observe({}, { go: true }, [], at(1));
  r.resolveShot('p', 'mismatch');
  assert.equal(byId(r.finish(), 'p').missed, 1);
});

test('неверная форма проверки — ошибка с id', () => {
  assert.throws(() => validateChecks([{ id: 'a', kind: 'invariant', level: 'fact', check: () => null }, { id: 'a', kind: 'invariant', level: 'fact', check: () => null }]), /a.*дважды/);
  assert.throws(() => validateChecks([{ id: 'b', kind: 'expectation', level: 'fact', when: () => null, within: 1 }]), /b.*then/);
  assert.throws(() => validateChecks([{ id: 'c', kind: 'expectation', level: 'pixel', when: () => null, within: 1 }]), /c.*region/);
  assert.throws(() => validateChecks([{ id: 'd', kind: 'expectation', level: 'fact', when: () => null, then: () => true, within: -1 }]), /d.*within/);
  assert.throws(() => validateChecks([{ id: 'e', kind: 'rule', level: 'fact' }]), /e.*kind/);
});
```

Run: `node --test "plugins/verify-cocos/tests/checks.test.mjs"`
Expected: FAIL — модуль не найден.

- [ ] **Step 2: Реализация**

`plugins/verify-cocos/scripts/lib/checks.mjs`:
```js
// Исполнитель проверок: инварианты и ожидания «когда X — в течение N кадров Y».
//
// Ожидание fact подтверждает сам исполнитель по then; pixel и agent по сроку
// просят вырезку, а исход вырезки сообщает вызывающий (resolveShot): сравнение
// с эталоном и снимки для агента — дело execute.mjs, не исполнителя.
const KINDS = new Set(['invariant', 'expectation']);
const LEVELS = new Set(['fact', 'pixel', 'agent']);

export function validateChecks(checks) {
  const seen = new Set();
  for (const c of checks) {
    const id = c?.id ?? '?';
    const bad = (what) => new Error(`Проверка ${id}: ${what}`);
    if (seen.has(id)) throw bad('id встречается дважды');
    seen.add(id);
    if (!KINDS.has(c.kind)) throw bad(`неизвестный kind ${c.kind}`);
    if (!LEVELS.has(c.level)) throw bad(`неизвестный level ${c.level}`);
    if (c.kind === 'invariant') {
      if (typeof c.check !== 'function') throw bad('у инварианта нет check');
      continue;
    }
    if (typeof c.when !== 'function') throw bad('у ожидания нет when');
    if (!Number.isInteger(c.within) || c.within < 0) throw bad(`within должен быть целым >= 0, получено ${c.within}`);
    if (c.level === 'fact' && typeof c.then !== 'function') throw bad('у ожидания fact нет then');
    if (c.level !== 'fact' && typeof c.region !== 'function') throw bad(`у ожидания ${c.level} нет region`);
  }
}

export function createCheckRunner(checks) {
  validateChecks(checks);
  const stats = new Map(checks.map((c) => [c.id, {
    id: c.id, kind: c.kind, level: c.level, steps: 0, armed: 0, confirmed: 0, missed: 0, unfinished: 0, pendingReview: 0,
  }]));
  let pending = [];

  return {
    observe(prev, cur, events, ctx) {
      const log = [];
      const shots = [];
      let violation = null;
      const fail = (v) => { violation ??= v; };

      for (const c of checks) {
        if (c.kind !== 'invariant') continue;
        stats.get(c.id).steps++;
        const v = c.check(prev, cur, events, ctx);
        if (v) fail({ id: c.id, message: v.message, data: v.data ?? null });
      }

      for (const c of checks) {
        if (c.kind !== 'expectation') continue;
        const trigger = c.when(prev, cur, events, ctx);
        if (trigger == null) continue;
        const s = stats.get(c.id);
        s.armed++;
        pending.push({ check: c, n: s.armed, deadline: ctx.frame + c.within, trigger });
        log.push({ t: 'arm', check: c.id, n: s.armed, trigger });
      }

      const still = [];
      for (const p of pending) {
        const s = stats.get(p.check.id);
        if (p.check.level === 'fact') {
          if (p.check.then(cur, events, p.trigger)) {
            s.confirmed++;
            log.push({ t: 'confirm', check: p.check.id, n: p.n });
          } else if (ctx.frame >= p.deadline) {
            s.missed++;
            log.push({ t: 'miss', check: p.check.id, n: p.n });
            fail({ id: p.check.id, message: `ожидание не выполнено за ${p.check.within} кадр(ов)`, data: p.trigger });
          } else {
            still.push(p);
          }
        } else if (ctx.frame >= p.deadline) {
          shots.push({
            id: p.check.id, n: p.n, level: p.check.level,
            region: p.check.region(cur, p.trigger), criterion: p.check.criterion ?? null, trigger: p.trigger,
          });
        } else {
          still.push(p);
        }
      }
      pending = still;
      return { violation, shots, log };
    },

    nextDeadline(frame) {
      let best = Infinity;
      for (const p of pending) best = Math.min(best, p.deadline - frame);
      return best;
    },

    resolveShot(id, outcome) {
      const s = stats.get(id);
      if (outcome === 'match') s.confirmed++;
      else if (outcome === 'mismatch') s.missed++;
      else s.pendingReview++;
    },

    finish() {
      for (const p of pending) stats.get(p.check.id).unfinished++;
      pending = [];
      return [...stats.values()];
    },
  };
}

export function unmetRequires(coverage, requires = []) {
  return requires.filter((id) => {
    const c = coverage.find((x) => x.id === id);
    if (!c) return true;
    return c.level === 'fact' ? c.confirmed === 0 : c.confirmed + c.pendingReview === 0;
  });
}
```

- [ ] **Step 3: Тесты зелёные, коммит**

Run: `node --test "plugins/verify-cocos/tests/checks.test.mjs"` → PASS.
```bash
git add plugins/verify-cocos
git commit -m "feat(verify-cocos): исполнитель проверок — инварианты и ожидания fact/pixel/agent"
```

---

### Task 3: Агент на проверках, миссии с целями и параметрами

**Files:**
- Modify: `plugins/verify-cocos/scripts/lib/agent.mjs`
- Delete: `plugins/verify-cocos/scripts/lib/oracles.mjs` → базовый инвариант `stall` переезжает в `checks.mjs` (`createStallCheck`)
- Modify: `plugins/verify-cocos/tests/helpers/toy.mjs` (`oracles` → `checks`), `plugins/verify-cocos/tests/agent.test.mjs`

**Interfaces:**
- Consumes: `createCheckRunner`, `unmetRequires` (задача 2).
- Produces: `checks.mjs` → `createStallCheck(stallFrames, progress) → invariant { id: 'stall', kind, level: 'fact', check }` (логика прежней `createStallOracle`).
- Produces: `runAgent({ game, adapter, mission: { name, params }, policy, rng, limits, trace, onShot }) → { verdict, frame, goals, violation, coverage, lastRaw, lastModel }`:
  - `adapter.checks` вместо `adapter.oracles`;
  - `adapter.missions[name]` — объект или фабрика `(params) => объект`; у объекта необязательное `goals: string[]` — `candidates` фильтруются по `kind ∈ goals`;
  - `onShot(shot) → Promise<{ outcome, violation? }>` — вызывается для каждой вырезки; `violation` → вердикт `bug`; по умолчанию `{ outcome: 'review' }`;
  - шаг урезается до `runner.nextDeadline(frame)` (не меньше 1);
  - журнал: `arm` / `confirm` / `miss` / `shot` (`{ f, t: 'shot', check, n, outcome }`).
- `game.shot(region) → Promise<Buffer>` — используется в `execute.mjs` (задача 5), агент её не вызывает.

- [ ] **Step 1: Перевести игрушечный адаптер и тесты на проверки, добавить новые тесты**

В `tests/helpers/toy.mjs` заменить строку оракулов:
```js
    checks: [{ id: 'x-nonneg', kind: 'invariant', level: 'fact', check: (prev, cur) => (cur.x < 0 ? { message: `x=${cur.x}`, data: { x: cur.x } } : null) }],
```
В `tests/agent.test.mjs`: вызов `runAgent` в помощнике `run` — `mission: { name: mission, params: {} }` вместо `missionName: mission`. Добавить:
```js
test('ожидание подтверждается и попадает в покрытие', async () => {
  const adapter = toyAdapter({
    checks: [{ id: 'bump-then-moved', kind: 'expectation', level: 'fact', within: 4,
      when: (p, c, ev) => (ev.some((e) => e.type === 'bump') ? { x: c.x } : null),
      then: (c, ev, t) => c.x !== t.x }],
  });
  const { result, trace } = await run({ adapter });
  const cov = result.coverage.find((c) => c.id === 'bump-then-moved');
  assert.ok(cov.armed >= 1 && cov.confirmed >= 1, JSON.stringify(cov));
  assert.ok(trace.entries.some((e) => e.t === 'arm') && trace.entries.some((e) => e.t === 'confirm'));
});

test('шаг урезается до срока ожидания', async () => {
  const adapter = toyAdapter({
    tactics: { right: { next: () => ({ action: { dir: 1 }, frames: 50 }) }, left: { next: () => ({ action: { dir: -1 }, frames: 1 }) } },
    checks: [{ id: 'soon', kind: 'expectation', level: 'fact', within: 2, when: (p, c) => (c.x === 0 ? {} : null), then: () => true }],
  });
  const game = toyGame({ target: 5 }); const steps = []; const step = game.step; game.step = (n) => { steps.push(n); return step(n); };
  await run({ game, adapter });
  assert.ok(steps[0] <= 2, `первый шаг ${steps[0]}`);
});

test('миссия фильтрует цели по goals', async () => {
  const adapter = toyAdapter({ missions: { reach: { done: (m) => m.x === m.target, goals: ['left'] } } });
  const { trace } = await run({ adapter, limits: { maxFrames: 20, stallFrames: 1000 } });
  assert.equal(trace.entries.find((e) => e.t === 'plan').chosen, 'go-left');
});

test('миссия-фабрика получает параметры', async () => {
  const adapter = toyAdapter({ missions: { reachAt: (params) => ({ done: (m) => m.x === params.at }) } });
  const trace = createTrace();
  const rng = mulberry32(1);
  const result = await runAgent({ game: toyGame({ target: 50 }), adapter, mission: { name: 'reachAt', params: { at: 2 } }, policy: createPolicy('planned', rng), rng, limits: LIMITS, trace });
  assert.equal(result.verdict, 'pass');
  assert.equal(result.frame, 2);
});

test('вырезка с нарушением от onShot — bug', async () => {
  const adapter = toyAdapter({ checks: [{ id: 'look', kind: 'expectation', level: 'pixel', within: 0, when: (p, c) => (c.x === 2 ? {} : null), region: () => ({ x: 0, y: 0, w: 1, h: 1 }) }] });
  const trace = createTrace();
  const rng = mulberry32(1);
  const result = await runAgent({ game: toyGame(), adapter, mission: { name: 'reach', params: {} }, policy: createPolicy('planned', rng), rng, limits: LIMITS, trace,
    onShot: async () => ({ outcome: 'mismatch', violation: { id: 'look', message: 'пиксели разошлись', data: null } }) });
  assert.equal(result.verdict, 'bug');
  assert.equal(result.violation.id, 'look');
  assert.ok(trace.entries.some((e) => e.t === 'shot' && e.outcome === 'mismatch'));
});

test('исключение в проверке проекта — bot-error', async () => {
  const adapter = toyAdapter({ checks: [{ id: 'boom', kind: 'invariant', level: 'fact', check: () => { throw new Error('опечатка'); } }] });
  const { result } = await run({ adapter });
  assert.equal(result.verdict, 'bot-error');
  assert.match(result.violation.message, /опечатка/);
});
```

Run: `node --test --test-timeout=10000 "plugins/verify-cocos/tests/agent.test.mjs"` → FAIL (нет `coverage`, `mission` не объект и т. п.).

- [ ] **Step 2: Реализация**

В `checks.mjs` дописать (перенос из `oracles.mjs`):
```js
// Базовая проверка плагина — «игра замерла»: наблюдаемое состояние
// (adapter.progress, сравнивается через JSON) не меняется stallFrames кадров.
export function createStallCheck(stallFrames, progress) {
  let last;
  let since = 0;
  return {
    id: 'stall', kind: 'invariant', level: 'fact',
    check(prev, cur, events, { frame }) {
      const value = JSON.stringify(progress(cur));
      if (value !== last || events.length > 0) {
        last = value;
        since = frame;
        return null;
      }
      if (frame - since >= stallFrames) return { message: `состояние не менялось ${frame - since} кадров`, data: { since } };
      return null;
    },
  };
}
```
`git rm plugins/verify-cocos/scripts/lib/oracles.mjs`.

В `agent.mjs`:
- импорт: `import { createCheckRunner, createStallCheck } from './checks.mjs';` вместо oracles;
- сигнатура: `export async function runAgent({ game, adapter, mission: missionSpec, policy, rng, limits, trace, onShot = async () => ({ outcome: 'review' }) })`;
- миссия:
```js
  const def = adapter.missions[missionSpec.name];
  if (!def) throw new Error(`Нет миссии ${missionSpec.name}; есть: ${Object.keys(adapter.missions).join(', ')}`);
  const mission = guard(() => (typeof def === 'function' ? def(missionSpec.params ?? {}) : def), 'missions');
  const runner = guard(() => createCheckRunner([createStallCheck(limits.stallFrames, adapter.progress), ...(adapter.checks ?? [])]), 'checks');
```
  (создание `mission` и `runner` — внутри `try` агента, чтобы ошибка адаптера дала `bot-error`; `end` до создания `runner` отдаёт `coverage: []`; запись в журнал — `{ f: 0, t: 'mission', mission: missionSpec.name, params: missionSpec.params ?? {} }`);
- `end` возвращает `coverage: runner.finish()` (вызывать один раз: `const coverage = runner.finish();` внутри `end`);
- после `candidates`: `const allowed = mission.goals ? list.filter((c) => mission.goals.includes(c.kind)) : list;` — дальше работать с `allowed` (внутри того же `guard`, возвращать `allowed`);
- `room` дополнить `runner.nextDeadline(frame)`;
- вместо блока оракулов после `observe`:
```js
      const errors = game.errors();
      if (errors.length > 0) {
        const violation = { id: 'console-error', message: errors.map((e) => e.text).join(' | '), data: errors };
        trace.write({ f: frame, t: 'violation', oracle: violation.id, message: violation.message, data: violation.data });
        return end('bug', violation);
      }
      const checked = guard(() => runner.observe(prev, model, events, { frame }), 'checks');
      for (const entry of checked.log) trace.write({ f: frame, ...entry });
      let violation = checked.violation;
      for (const shot of checked.shots) {
        const { outcome, violation: shotViolation } = await onShot({ ...shot, frame });
        runner.resolveShot(shot.id, outcome);
        trace.write({ f: frame, t: 'shot', check: shot.id, n: shot.n, outcome });
        violation ??= shotViolation ?? null;
      }
      if (violation) {
        trace.write({ f: frame, t: 'violation', oracle: violation.id, message: violation.message, data: violation.data });
        return end('bug', violation);
      }
```

- [ ] **Step 3: Тесты, коммит**

Run: `node --test --test-timeout=60000 "tests/**/*.test.mjs" "plugins/*/tests/**/*.test.mjs"` → PASS.
```bash
git add -A plugins/verify-cocos
git commit -m "feat(verify-cocos): агент на проверках, покрытие, миссии с целями и параметрами"
```

---

### Task 4: Факты дерева узлов и вырезки в странице

**Files:**
- Create: `plugins/verify-cocos/scripts/lib/view.mjs`
- Modify: `plugins/verify-cocos/scripts/lib/session.mjs`
- Create: `plugins/verify-cocos/tests/fixtures/shot-bridge.js`
- Test: `plugins/verify-cocos/tests/view.test.mjs`, `plugins/verify-cocos/tests/session.chrome.test.mjs`

**Interfaces:**
- Produces: `view.mjs` → `viewSource() → string` (внедряется после shim, до моста), `mapRect(rect, canvasWorld, element) → { x, y, width, height }` (чистая функция, та же внутри страницы). В странице:
  - `__botView.node(path) → null | { active, worldRect: { x, y, w, h }, opacity, color: [r,g,b,a] | null, children }` — путь от корня сцены через `/`; `opacity` — произведение `UIOpacity` по предкам (0–255);
  - `__botView.find(className) → [{ path, active, worldRect, opacity }]`;
  - `__botView.pageRect(worldRect) → { x, y, width, height }` — CSS px страницы по мировому прямоугольнику узла `Canvas` и `getBoundingClientRect()` элемента `#GameCanvas`.
- Produces: `openSession({ root, config, seed, run })` — `run` (объект, например `{ theme }`) внедряется как `window.__botRun` до моста; `game.shot(region) → Promise<Buffer>` PNG вырезки; вырезка нулевого размера или вне страницы → `Error` с `adapterFault = true`.

- [ ] **Step 1: Падающие тесты**

`plugins/verify-cocos/tests/view.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRect } from '../scripts/lib/view.mjs';

const canvas = { x: 0, y: 0, w: 1280, h: 720 };

test('мировой прямоугольник → CSS px: Y переворачивается, масштаб по элементу', () => {
  assert.deepEqual(mapRect({ x: 0, y: 700, w: 100, h: 20 }, canvas, { left: 0, top: 0, width: 1280, height: 720 }), { x: 0, y: 0, width: 100, height: 20 });
  assert.deepEqual(mapRect({ x: 640, y: 0, w: 64, h: 36 }, canvas, { left: 10, top: 20, width: 640, height: 360 }), { x: 330, y: 362, width: 32, height: 18 });
});

test('канвас со смещённым началом мировых координат', () => {
  assert.deepEqual(mapRect({ x: -640, y: -360, w: 1280, h: 720 }, { x: -640, y: -360, w: 1280, h: 720 }, { left: 0, top: 0, width: 1280, height: 720 }), { x: 0, y: 0, width: 1280, height: 720 });
});
```

`plugins/verify-cocos/tests/fixtures/shot-bridge.js` (мост игрушки с тождественным `pageRect`: в игрушке нет `cc`):
```js
(() => {
  window.__bot = {
    whenBooted: () => new Promise((resolve) => { const tick = () => (window.toy ? resolve(true) : setTimeout(tick, 20)); tick(); }),
    preload: async () => true,
    start: () => true,
    ready: () => true,
    observe: () => ({ run: window.__botRun }),
    actions: () => [],
    act: () => [],
    frameEvents: () => [],
  };
  window.__botView.pageRect = (r) => ({ x: r.x, y: r.y, width: r.w, height: r.h });
})();
```

В `session.chrome.test.mjs` добавить:
```js
import { decodePng } from '../scripts/vendor/cdp/png.mjs';

test('параметры прогона видны в странице, вырезка — PNG нужного размера', { skip: !hasChrome }, async () => {
  const game = await openSession({ root, config: config('shot-bridge.js'), seed: 1, run: { theme: 'minimal' } });
  try {
    await game.start({});
    assert.deepEqual((await game.observe()).run, { theme: 'minimal' });
    const png = decodePng(await game.shot({ x: 0, y: 0, w: 32, h: 16 }));
    assert.equal(png.width, 32);
    assert.equal(png.height, 16);
    await assert.rejects(game.shot({ x: 0, y: 0, w: 0, h: 10 }), (e) => e.adapterFault === true);
  } finally { await game.close(); }
});
```

Run: `node --test --test-timeout=60000 "plugins/verify-cocos/tests/view.test.mjs" "plugins/verify-cocos/tests/session.chrome.test.mjs"` → FAIL.

- [ ] **Step 2: Реализация `view.mjs`**

```js
// Факты дерева узлов Cocos и перевод мировых координат в координаты страницы.
//
// Внедряется в страницу после shim и до моста. К движку обращается лениво, в
// момент вызова: при внедрении его ещё нет.
export function mapRect(rect, canvasWorld, element) {
  const sx = element.width / canvasWorld.w;
  const sy = element.height / canvasWorld.h;
  return {
    x: element.left + (rect.x - canvasWorld.x) * sx,
    y: element.top + (canvasWorld.y + canvasWorld.h - (rect.y + rect.h)) * sy,
    width: rect.w * sx,
    height: rect.h * sy,
  };
}

function viewMain(mapRectFn) {
  const cls = (name) => window.cc.js.getClassByName(name);
  const scene = () => window.cc.director.getScene();

  function worldRect(node) {
    const ut = node.getComponent(cls('cc.UITransform'));
    if (!ut) return null;
    const b = ut.getBoundingBoxToWorld();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  function opacity(node) {
    let value = 255;
    for (let n = node; n; n = n.parent) {
      const o = n.getComponent(cls('cc.UIOpacity'));
      if (o) value = (value * o.opacity) / 255;
    }
    return Math.round(value);
  }

  function color(node) {
    const r = node.getComponent(cls('cc.Sprite')) || node.getComponent(cls('cc.Label'));
    return r ? [r.color.r, r.color.g, r.color.b, r.color.a] : null;
  }

  function pathOf(node) {
    const parts = [];
    for (let n = node; n && n.parent; n = n.parent) parts.unshift(n.name);
    return parts.join('/');
  }

  function describe(node) {
    return { active: node.activeInHierarchy, worldRect: worldRect(node), opacity: opacity(node), color: color(node), children: node.children.length };
  }

  window.__botView = {
    node(path) {
      let n = scene();
      for (const name of path.split('/')) {
        n = n && n.getChildByName(name);
        if (!n) return null;
      }
      return describe(n);
    },
    find(className) {
      const C = cls(className);
      const s = scene();
      if (!C || !s) return [];
      return s.getComponentsInChildren(C).map((c) => ({ path: pathOf(c.node), active: c.node.activeInHierarchy, worldRect: worldRect(c.node), opacity: opacity(c.node) }));
    },
    pageRect(rect) {
      const canvasNode = scene().getChildByName('Canvas');
      const canvasWorld = worldRect(canvasNode);
      const element = document.getElementById('GameCanvas').getBoundingClientRect();
      return mapRectFn(rect, canvasWorld, element);
    },
  };
}

export function viewSource() {
  return `(${viewMain.toString()})(${mapRect.toString()});`;
}
```

- [ ] **Step 3: Сессия — параметры прогона и вырезки**

В `session.mjs`:
- `import { viewSource } from './view.mjs';`
- сигнатура `openSession({ root, config, seed, run = {} })`;
- после внедрения shim и до моста:
```js
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: viewSource() });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__botRun = ${JSON.stringify(run)};` });
```
- метод игры:
```js
    async shot(region) {
      const page = await call(`window.__botView.pageRect(${json(region)})`, 'pageRect');
      const clip = {
        x: Math.floor(page.x), y: Math.floor(page.y),
        width: Math.ceil(page.width), height: Math.ceil(page.height), scale: 1,
      };
      const size = await call('({ w: innerWidth, h: innerHeight })', 'viewport');
      if (!(clip.width > 0 && clip.height > 0) || clip.x < 0 || clip.y < 0 || clip.x + clip.width > size.w || clip.y + clip.height > size.h) {
        const error = new Error(`вырезка вне страницы или пустая: ${JSON.stringify(clip)}`);
        error.adapterFault = true;
        throw error;
      }
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
      return Buffer.from(data, 'base64');
    },
```

- [ ] **Step 4: Тесты, коммит**

Run: `node --test --test-timeout=60000 "tests/**/*.test.mjs" "plugins/*/tests/**/*.test.mjs"` → PASS.
```bash
git add plugins/verify-cocos
git commit -m "feat(verify-cocos): факты дерева узлов, параметры прогона в странице, вырезки"
```

---

### Task 5: Эталоны, прогон с требованиями, отчёт покрытия, команды

**Files:**
- Create: `plugins/verify-cocos/scripts/lib/baseline.mjs`
- Modify: `plugins/verify-cocos/scripts/lib/execute.mjs`, `project.mjs`, `report.mjs`, `scripts/verify-cocos.mjs`
- Test: `plugins/verify-cocos/tests/baseline.test.mjs`, `report.test.mjs`, `project.test.mjs`

**Interfaces:**
- Produces: `compareShot({ png, name, baselineDir, newDir, update, threshold, tolerance }) → Promise<{ outcome: 'match'|'mismatch'|'new'|'updated', ratio? }>`; `mismatch` пишет `newDir/<name>.png` и `<name>.diff.png`; `new` пишет `newDir/<name>.png`; `updated` пишет эталон.
- Produces: `loadRuns` нормализует `mission` в `{ name, params }`, `theme` (по умолчанию `config.theme`), `requires` (по умолчанию `[]`); `checkMissions(runs, adapter)` проверяет имя и, если миссия — фабрика с `required: string[]` (свойство функции), наличие параметров.
- Produces: `executeRun({ …, spec, update })` → результат `{ name, verdict, frame, goals, violation, summary, dir, coverage, unmet, needsReview, review }`; `review` — `[{ id, n, criterion, file }]`; пишет `review.json`, если есть снимки для агента.
- Produces: `report.mjs` → `runOk(result, expect) → boolean` (вердикт по `expect`, `unmet` пуст, `needsReview` = 0), `formatCoverage(result) → string[]`; `formatRunLine` печатает строки покрытия, «не проверено», «на осмотр».
- CLI: `run [--update-baseline] [--theme id]`, `coverage` — читает `tmp/bot/coverage.json` (пишется `run`: по каждой проверке — прогоны, где она подтверждена) и список проверок адаптера, печатает подтверждённые и «ни одним прогоном».
- Конфиг: `theme` (по умолчанию `null`), `pixel: { threshold: 12, tolerance: 0.002 }`, `baseline: 'verify/baseline'`.

- [ ] **Step 1: Падающие тесты**

`plugins/verify-cocos/tests/baseline.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compareShot } from '../scripts/lib/baseline.mjs';
import { encodePng } from '../scripts/vendor/cdp/png.mjs';

const solid = (v) => encodePng({ width: 4, height: 4, pixels: new Uint8Array(4 * 4 * 4).fill(v) });

async function dirs() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vc-base-'));
  return { baselineDir: path.join(root, 'base'), newDir: path.join(root, 'new') };
}

test('эталона нет — вырезка в new, исход new', async () => {
  const d = await dirs();
  const r = await compareShot({ png: solid(10), name: 'look-1', ...d, update: false, threshold: 12, tolerance: 0 });
  assert.equal(r.outcome, 'new');
  assert.deepEqual(await readdir(d.newDir), ['look-1.png']);
});

test('update пишет эталон, повтор совпадает', async () => {
  const d = await dirs();
  assert.equal((await compareShot({ png: solid(10), name: 'a', ...d, update: true, threshold: 12, tolerance: 0 })).outcome, 'updated');
  assert.equal((await compareShot({ png: solid(10), name: 'a', ...d, update: false, threshold: 12, tolerance: 0 })).outcome, 'match');
});

test('расхождение — mismatch с долей и diff-файлом', async () => {
  const d = await dirs();
  await compareShot({ png: solid(10), name: 'a', ...d, update: true, threshold: 12, tolerance: 0 });
  const r = await compareShot({ png: solid(200), name: 'a', ...d, update: false, threshold: 12, tolerance: 0 });
  assert.equal(r.outcome, 'mismatch');
  assert.equal(r.ratio, 1);
  assert.deepEqual((await readdir(d.newDir)).sort(), ['a.diff.png', 'a.png']);
});
```

В `report.test.mjs` добавить:
```js
import { runOk, formatCoverage } from '../scripts/lib/report.mjs';

test('зелёный — только вердикт по expect, требования подтверждены и нечего осматривать', () => {
  const base = { verdict: 'pass', frame: 10, unmet: [], needsReview: 0 };
  assert.equal(runOk(base, { verdict: 'pass' }), true);
  assert.equal(runOk({ ...base, unmet: ['x'] }, { verdict: 'pass' }), false);
  assert.equal(runOk({ ...base, needsReview: 1 }, { verdict: 'pass' }), false);
});

test('покрытие печатает ожидания, требования и осмотр', () => {
  const lines = formatCoverage({
    coverage: [
      { id: 'a', kind: 'expectation', level: 'fact', armed: 2, confirmed: 2, missed: 0, unfinished: 0, pendingReview: 0 },
      { id: 'b', kind: 'expectation', level: 'pixel', armed: 1, confirmed: 0, missed: 0, unfinished: 0, pendingReview: 1 },
      { id: 'inv', kind: 'invariant', level: 'fact', steps: 30 },
    ],
    unmet: ['c'], needsReview: 1, review: [{ id: 'g', n: 1, file: 'review/g-1.png' }], dir: 'tmp/bot/r',
  });
  const text = lines.join('\n');
  assert.match(text, /a 2\/2/);
  assert.match(text, /b 0\/1.*pixel/);
  assert.match(text, /не проверено: c/);
  assert.match(text, /на осмотр/);
});
```

В `project.test.mjs` добавить:
```js
test('mission строкой и объектом нормализуется, тема и requires по умолчанию', async () => {
  const root = await project();
  await writeFile(path.join(root, 'verify', 'runs', 'a.json'), JSON.stringify({ zone: 'z', level: 0, seed: 1, mission: 'm', expect: {} }));
  await writeFile(path.join(root, 'verify', 'runs', 'b.json'), JSON.stringify({ zone: 'z', level: 0, seed: 1, mission: { name: 'use', type: 2 }, theme: 'minimal', requires: ['x'], expect: {} }));
  const [a, b] = await loadRuns(root, await loadConfig(root));
  assert.deepEqual(a.mission, { name: 'm', params: {} });
  assert.deepEqual(a.requires, []);
  assert.deepEqual(b.mission, { name: 'use', params: { type: 2 } });
  assert.equal(b.theme, 'minimal');
});

test('миссия-фабрика без обязательного параметра — ошибка до запуска', () => {
  const use = (params) => ({ done: () => false });
  use.required = ['type'];
  assert.throws(() => checkMissions([{ name: 'r', mission: { name: 'use', params: {} } }], { missions: { use } }), /r.*type/);
  assert.doesNotThrow(() => checkMissions([{ name: 'r', mission: { name: 'use', params: { type: 2 } } }], { missions: { use } }));
});
```
Заменить существующий тест `checkMissions` на формат `mission: { name, params }`:
```js
  assert.doesNotThrow(() => checkMissions([{ name: 'a', mission: { name: 'capture-80', params: {} } }], adapter));
  assert.throws(() => checkMissions([{ name: 'b', mission: { name: 'capture-90', params: {} } }], adapter), /b.*capture-90.*capture-80/);
```

Run: `node --test --test-timeout=60000 "plugins/verify-cocos/tests/**/*.test.mjs"` → FAIL.

- [ ] **Step 2: `baseline.mjs`**

```js
// Пиксельные эталоны вырезок: verify/baseline/<прогон>/<проверка>-<n>.png.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { diffPng } from '../vendor/cdp/png.mjs';

export async function compareShot({ png, name, baselineDir, newDir, update, threshold, tolerance }) {
  const file = path.join(baselineDir, `${name}.png`);
  if (update) {
    await mkdir(baselineDir, { recursive: true });
    await writeFile(file, png);
    return { outcome: 'updated' };
  }
  if (!existsSync(file)) {
    await mkdir(newDir, { recursive: true });
    await writeFile(path.join(newDir, `${name}.png`), png);
    return { outcome: 'new' };
  }
  const result = diffPng(await readFile(file), png, { threshold });
  if (result.sameSize && result.ratio <= tolerance) return { outcome: 'match' };
  await mkdir(newDir, { recursive: true });
  await writeFile(path.join(newDir, `${name}.png`), png);
  if (result.image) await writeFile(path.join(newDir, `${name}.diff.png`), result.image);
  return { outcome: 'mismatch', ratio: result.sameSize ? result.ratio : 1 };
}
```

(Если `diffPng` при разных размерах не отдаёт `image` — `diff.png` не пишется; тест расхождения — одинакового размера.)

- [ ] **Step 3: `project.mjs` — нормализация прогонов и миссий**

- `DEFAULTS` + `theme: null`, `pixel: { threshold: 12, tolerance: 0.002 }`, `baseline: 'verify/baseline'`; в `loadConfig` слить `pixel` по ключам.
- В `loadRuns` после проверки полей:
```js
    const mission = typeof run.mission === 'string'
      ? { name: run.mission, params: {} }
      : (({ name, ...params }) => ({ name, params }))(run.mission);
    runs.push({ name: file.replace(/[.]json$/, ''), ...run, policy, mission, theme: run.theme ?? config.theme, requires: run.requires ?? [] });
```
- `checkMissions`:
```js
export function checkMissions(runs, adapter) {
  const problems = [];
  for (const run of runs) {
    const def = adapter.missions[run.mission.name];
    if (!def) { problems.push(`${run.name} → ${run.mission.name}`); continue; }
    const missing = (def.required ?? []).filter((key) => run.mission.params[key] === undefined);
    if (missing.length > 0) problems.push(`${run.name} → ${run.mission.name}: нет параметров ${missing.join(', ')}`);
  }
  if (problems.length > 0) {
    throw new Error(`Миссии: ${problems.join('; ')}; есть: ${Object.keys(adapter.missions).join(', ')}`);
  }
}
```
- `loadAdapter`: `MODULES` — `oracles` → `checks`; `adapter.checks = checks.checks ?? []`.
- CLI `soak`: `checkMissions([{ name: 'soak', mission: { name: config.soak.mission, params: {} } }], adapter)`; spec soak-прогона — `mission: { name: config.soak.mission, params: {} }`, `theme: config.theme`, `requires: []`.

- [ ] **Step 4: `execute.mjs` — вырезки, осмотр, покрытие**

```js
export async function executeRun({ root, config, adapter, hash, spec, outDir, stopAt = null, update = false }) {
  // … как было, плюс:
  const review = [];
  let needsReview = 0;
  const baselineDir = path.resolve(root, config.baseline, spec.name);
  const onShot = async (shot) => {
    const png = await game.shot(shot.region);
    const name = `${shot.id}-${shot.n}`;
    if (shot.level === 'agent') {
      await mkdir(path.join(outDir, 'review'), { recursive: true });
      const file = path.join(outDir, 'review', `${name}.png`);
      await writeFile(file, png);
      review.push({ id: shot.id, n: shot.n, criterion: shot.criterion, frame: shot.frame, trigger: shot.trigger, file: path.relative(root, file).split(path.sep).join('/') });
      return { outcome: 'review' };
    }
    const r = await compareShot({ png, name, baselineDir, newDir: path.join(outDir, 'baseline-new'), update, ...config.pixel });
    if (r.outcome === 'new') needsReview++;
    if (r.outcome === 'mismatch') {
      return { outcome: 'mismatch', violation: { id: shot.id, message: `пиксели разошлись с эталоном ${name}: доля ${r.ratio}`, data: { name } } };
    }
    return { outcome: r.outcome === 'updated' ? 'match' : r.outcome };
  };
```
- `openSession({ root, config, seed: spec.seed, run: { theme: spec.theme } })`;
- `runAgent({ …, mission: spec.mission, onShot })`;
- строка `start` + `theme: spec.theme`;
- после агента: если `review.length` — `writeFile(outDir/review/review.json, JSON.stringify(review, null, 2))`;
- результат дополнить: `coverage: result.coverage ?? []`, `unmet: unmetRequires(result.coverage ?? [], spec.requires ?? [])`, `needsReview`, `review`.
- В ветке `catch` (ошибка среды) — `coverage: []`, `unmet: spec.requires ?? []`.

- [ ] **Step 5: `report.mjs` и CLI**

`report.mjs`:
```js
export function runOk(result, expect) {
  return expectMatches(result, expect) && (result.unmet ?? []).length === 0 && (result.needsReview ?? 0) === 0;
}

export function formatCoverage(result) {
  const lines = [];
  const expectations = (result.coverage ?? []).filter((c) => c.kind === 'expectation' && (c.armed > 0 || (result.requires ?? []).includes(c.id)));
  if (expectations.length > 0) {
    const cells = expectations.map((c) => {
      const ok = c.missed === 0 && (c.confirmed > 0 || c.pendingReview > 0);
      const extra = [c.level !== 'fact' ? c.level : null, c.unfinished ? `не дождался ${c.unfinished}` : null].filter(Boolean).join(', ');
      return `${c.id} ${c.confirmed}/${c.armed} ${ok ? '✓' : '✗'}${extra ? ` (${extra})` : ''}`;
    });
    lines.push(`покрытие: ${cells.join(', ')}`);
  }
  if ((result.unmet ?? []).length > 0) lines.push(`не проверено: ${result.unmet.join(', ')}`);
  if (result.needsReview > 0) lines.push(`новых вырезок без эталона: ${result.needsReview} → ${result.dir}/baseline-new/ (--update-baseline после осмотра)`);
  if ((result.review ?? []).length > 0) lines.push(`на осмотр агентом: ${result.review.length} → ${result.dir}/review/`);
  return lines;
}
```
В `formatRunLine` после строки с вердиктом и нарушением добавить `formatCoverage(result).map((l) => \`\n    ${l}\`).join('')`.

CLI `verify-cocos.mjs`:
- `commandRun`: `spec.theme = args.values.theme ?? spec.theme`; `executeRun({ …, update: args.flags.has('update-baseline') })`; `result.ok = runOk(result, spec.expect)`; `result.requires = spec.requires`; после цикла — записать `tmp/bot/coverage.json`: объединить с существующим файлом `{ [checkId]: { [runName]: confirmed } }` для всех `result.coverage`.
- `commandCoverage`: загрузить адаптер, прочитать `coverage.json` (нет — сообщить «сначала run»), напечатать по каждой проверке адаптера `id (kind/level): прогоны где confirmed>0` или `— ни одним прогоном`; код 1, если есть ожидания без подтверждения.
- `COMMANDS` + `coverage`.

- [ ] **Step 6: Тесты, коммит**

Run: `node --test --test-timeout=60000 "tests/**/*.test.mjs" "plugins/*/tests/**/*.test.mjs"` → PASS.
```bash
git add plugins/verify-cocos
git commit -m "feat(verify-cocos): пиксельные эталоны, осмотр агентом, требования и покрытие прогона"
```

---

### Task 6: Документация плагина — проверки, лестница уровней, осмотр

**Files:**
- Modify: `plugins/verify-cocos/README.md`, `skills/verify-cocos/SKILL.md`, `commands/verify-cocos.md`, `.claude-plugin/plugin.json` (версия `0.2.0`), `plugins/verify-web/.claude-plugin/plugin.json` (версия `0.1.1` — раскладка vendor сменилась в фазе 1)

- [ ] **Step 1: README** — заменить `oracles.mjs` на `checks.mjs` в раскладке проекта; добавить разделы:
  - «Проверки» — форма инварианта и ожидания (из спеки §3), жизненный цикл, покрытие, `requires`;
  - «Вид» — `__botView.node/find/pageRect`, `window.__botRun`, поле `theme`;
  - «Эталоны» — раскладка `verify/baseline/<прогон>/<проверка>-<n>.png`, `needs-review`, `--update-baseline`, конфиг `pixel`;
  - «Миссии» — объект или фабрика `(params) => …` с `required`, `goals`;
  - команды `run --update-baseline`, `run --theme`, `coverage`;
  - условие зелёного прогона (спека §8).
- [ ] **Step 2: SKILL.md** — раздел «Уровень проверки» с таблицей лестницы (спека §3) и правилом пирамиды; «Смена эталона»: разошёлся после изменения адаптера/сборки → открыть эталон, снимок и diff, решить «принять (`--update-baseline --run`) или баг», записать решение в `history` проверки; «Проверка — сверка независимых величин» (из фазы 1).
- [ ] **Step 3: команда** — пункт: «Снимки из `review/` открой все, по каждому вынеси вердикт по `criterion` из `review.json`; `needs-review` — осмотри `baseline-new/`, прими или зафиксируй баг; прогон с `не проверено` — не зелёный: сценарий не взвёл проверку, чини миссию или тактику».
- [ ] **Step 4: Проверка и коммит**

Run: `claude plugin validate plugins/verify-cocos` → `Validation passed`.
```bash
git add plugins/verify-cocos plugins/verify-web/.claude-plugin/plugin.json
git commit -m "docs(verify-cocos): проверки, лестница уровней, эталоны, осмотр агентом"
```

---

### Task 7: ImageUncovered — `checks.mjs` вместо `oracles.mjs`

**Files:**
- Move: `verify/bot/oracles.mjs` → `verify/bot/checks.mjs`; `verify/bot/tests/oracles.test.mjs` → `verify/bot/tests/checks.test.mjs`

**Interfaces:**
- Produces: `checks: check[]` — прежние оракулы как `{ id, kind: 'invariant', level: 'fact', check }`; `lives-monotonic` учитывает уровень.

- [ ] **Step 1: Тест на уровень у `lives-monotonic` (падающий)**

```bash
cd E:/projects/ImageUncovered && git switch -c verify-cocos-2a
git mv verify/bot/oracles.mjs verify/bot/checks.mjs
git mv verify/bot/tests/oracles.test.mjs verify/bot/tests/checks.test.mjs
```
В тесте: импорт `import { checks as oracles } from '../checks.mjs';` и добавить:
```js
test('жизни при смене уровня не проверяются', () => {
  const prev = m({ lives: 2 });
  const next = { ...m({ lives: 5 }), level: 1 };
  assert.equal(byId['lives-monotonic'].check(prev, next, []), null);
});
```
Run: `node --test "verify/bot/tests/**/*.test.mjs"` → FAIL.

- [ ] **Step 2: Реализация** — в `checks.mjs` `export const oracles` → `export const checks`, каждой записи добавить `kind: 'invariant', level: 'fact'`, в `lives-monotonic` первой строкой `if (cur.level !== prev.level) return null;`.

- [ ] **Step 3: Тесты, живой прогон, коммит**

Run: `node --test "verify/bot/tests/**/*.test.mjs"` → PASS.
Run: `VC run --root . --run capture-level-1` → `✓ pass` (адаптер прежний по логике).
```bash
git add verify
git commit -m "refactor(verify): оракулы → checks.mjs для исполнителя проверок фазы 2а"
```

---

### Task 8: ImageUncovered — тема прогона и факты вида неона

**Files:**
- Modify: `verify/bot/bridge.js`, `verify/bot/model.mjs`, `verify/cocos.json`, `verify/runs/*.json`
- Test: `verify/bot/tests/model.test.mjs`

**Interfaces:**
- Produces: мост при загрузке, если `window.__botRun.theme` задан, пишет в `localStorage['imageuncovered.settings']` JSON настроек с этой темой (слияние с существующим, если есть).
- Produces: `observe().view` (неон):
  - `player: { look: 'safe' | 'danger' | 'mixed' | null, rect }` — `look` по `UIOpacity` детей `NeonPlayerPassive` (safe) / `NeonPlayerActive` (danger): ≥ 250 у одного → он, иначе `mixed`; `rect` — мировой прямоугольник узла игрока;
  - `lives: { icons: n, lost: n, pops: n, rects: [rect…] }` — узлы `Canvas/StatusBar/LivesLayout/Life_i`; мост запоминает цвет `Life_i/NeonLifeSquare` в `ready()` и считает `lost` — число иконок, чей цвет с тех пор изменился (потерянная иконка перекрашивается в `lostColor`); `pops` — `__botView.find('MinimalPopAnimator').length`;
  - `progressBar: rect | null`, `statusBar: rect | null` — `Canvas/StatusBar` и его первый ребёнок-экземпляр префаба полосы (имя выяснить `probe`: ребёнок `StatusBar`, не `LivesLayout` и не `ScoreLabel`);
  - `canvas: rect` — мировой прямоугольник `Canvas`.
  - Раскладка — таблица `VIEW = { minimal: {…}, painterly: null }` в мосте; при `painterly` `view` = `{ theme: 'painterly' }` без фактов.
- Produces: `observe().player.trailStart: { x, y, col, row }` из `CaptureTrail.startX/startY`.
- Produces: `model` пробрасывает `view` и `player.trailStart` как есть.
- Конфиг: `"theme": "minimal"`; прогоны `capture-level-1`, `random-level-1` — `"theme": "minimal"`.

- [ ] **Step 1:** реализовать в мосте (таблица `VIEW`, чтение через `window.__botView`, запись темы в самом начале IIFE):
```js
  const SETTINGS_KEY = 'imageuncovered.settings';
  if (window.__botRun && window.__botRun.theme) {
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { settings = {}; }
    settings.theme = window.__botRun.theme;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
```
- [ ] **Step 2:** `probe --level 0` → в `state.view` видны `player.look: 'safe'`, `lives.icons: 5`, `lost: 0`, `pops: 0`, `progressBar` с непустым прямоугольником внутри `statusBar`; тема неон (проверить `view.theme`/факт наличия `NeonPlayerPassive`). Если имени ребёнка-полосы не угадать — вывести `__botView.node('Canvas/StatusBar')` и детей через временный `probe` с `--level 0` и дописать имя в `VIEW`.
- [ ] **Step 3:** проверить `pageRect`: временно добавить в конфиг прогон с pixel-ожиданием на рамку игрока (задача 10 делает это постоянно) — либо `probe` + `game.shot(view.player.rect)` через одноразовый скрипт `tmp/shot-probe.mjs`, открыть PNG и убедиться, что в нём игрок. Скрипт одноразовый, не коммитится.
- [ ] **Step 4:** тест модели: `toModel` сохраняет `view` и `trailStart` (добавить в `makeRaw` параметр `view`, `trailStart`).
- [ ] **Step 5:** `run --run capture-level-1` на неоне — вердикт записать (неон — другая тема: траектория может отличаться от painterly; если `lose`/`bot-stuck` — это задача настройки в задаче 10, записать факт в ledger).
- [ ] **Step 6:** коммит `feat(verify): тема прогона и факты вида неона в мосте`.

---

### Task 9: ImageUncovered — миссии-сценарии и тактики провокации

**Files:**
- Modify: `verify/bot/missions.mjs`, `verify/bot/goals.mjs`, `verify/bot/tactics.mjs`
- Test: `verify/bot/tests/goals.test.mjs`, `tactics.test.mjs`

**Interfaces:**
- Produces: `missions`:
  - `capture-80` — `{ done: win, goals: ['excursion', 'use-bonus'] }`;
  - `lose-all-lives` — `{ done: gameOver, goals: ['trail-bait', 'body-hit', 'excursion'] }`;
  - `lose-life-trail` — `{ done: событие lifeLost при активном следе, goals: ['trail-bait', 'excursion'] }`;
  - `lose-life-body` — `{ done: lifeLost, goals: ['body-hit', 'excursion'] }`;
  - `collect-bonus` — фабрика `(params) => ({ done: бонус типа params.type исчез из bonuses, goals: ['excursion'], bonusType: params.type })`, `required: ['type']`;
  - `use-bonus` — фабрика, `done`: длина `activeBonuses` уменьшилась после того, как бонус был в стеке, `goals: ['excursion', 'use-bonus']`, `required: ['type']`.
  - Миссии с состоянием («после того, как был в стеке») держат его в замыкании фабрики.
- Produces: `candidates(model, mission)`:
  - `excursion` — прежние; для `mission.bonusType !== undefined` бонус этого типа весит `TARGET_BONUS_WEIGHT = 100000`, остальные бонусы — как прежде;
  - `trail-bait` — `{ kind: 'trail-bait', id: 'bait:<enemy>:<col>,<row>:<dir><depth>', params: { route, hold } }`: вылазка перпендикулярно от безопасной клетки на глубину 3–6 клеток, пересекающая прогнозную траекторию врага в ближайшие 120 кадров (прогноз — `predictPath` из `isSafeRoute`, вынесенный в функцию); `hold` — сколько кадров стоять в конце вылазки; оценка — `1000 / (1 + кадры до пересечения)`;
  - `body-hit` — `{ kind: 'body-hit', params: { enemy } }`, оценка 1: тактика ведёт игрока к ближайшей клетке прогнозной траектории врага.
- Produces: `tactics['trail-bait']` — идёт по `route` как `excursion`, в конце маршрута — `{ action: { type: 'move', dir: 'none' }, frames: 1 }` до `hold` кадров; `tactics['body-hit']` — направление к текущей клетке врага по большей оси разности, шаг 1 кадр.
- Цель `trail-bait`/`body-hit` завершается (`done`) событием `lifeLost`, проваливается при `capture` (след ушёл в захват — приманка не сработала).

- [ ] **Step 1:** падающие тесты:
  - `candidates` для `lose-life-trail` содержит цели `trail-bait`, их маршрут начинается в безопасной клетке и заходит в опасную;
  - `body-hit` целится в ближайшего врага;
  - `collect-bonus { type: 2 }` — лучшая цель — вылазка, накрывающая бонус типа 2, даже если другая вылазка захватывает больше клеток;
  - `use-bonus` — фабрика с `required: ['type']`;
  - тактика `trail-bait` в конце маршрута стоит (`dir: 'none'`);
  - тактика `body-hit` двигается к врагу по большей оси.
- [ ] **Step 2:** реализация; вынести прогноз врага в `predictEnemy(m, enemy, frames) → [{ col, row, t }]`, `isSafeRoute` переписать через него (тесты `isSafeRoute` остаются зелёными).
- [ ] **Step 3:** тесты зелёные; коммит `feat(verify): миссии-сценарии и тактики провокации столкновений`.

---

### Task 10: ImageUncovered — проверки сценариев и прогоны

**Files:**
- Modify: `verify/bot/checks.mjs`, `verify/bot/tests/checks.test.mjs`
- Create: `verify/runs/lose-life-trail.json`, `lose-life-body.json`, `lose-all-lives.json`, `hud-layout.json`
- Create: `verify/baseline/<прогон>/…` — через `--update-baseline` после осмотра

**Interfaces — проверки (неон):**

| id | kind / level | when | then / region | within |
|---|---|---|---|---|
| `life-loss-has-cause` | invariant / fact | — | `lifeLost` ⇒ в `prev` игрок был вне безопасной клетки или след активен (безопасная зона защищает) | — |
| `life-lost-on-trail-hit` | expectation / fact | в `prev` след активен и какой-то враг через 1 кадр (прогноз `predictEnemy`) окажется центром на клетке следа | событие `lifeLost` или `cur.lives < trigger.lives` | 2 |
| `trail-ends-with-capture` | expectation / fact | `prev.player.trailActive && !cur.player.trailActive` и нет `lifeLost` | в событиях шага был `capture` (проверяется в том же наблюдении) | 0 |
| `player-reset-to-trail-start` | expectation / fact | `lifeLost`, не `gameOver`, в `prev` след активен | клетка игрока = клетка `trigger.trailStart` | 3 |
| `player-look-follows-zone` | expectation / fact | безопасность клетки игрока в `cur` отличается от `prev` | `view.player.look === (safe ? 'safe' : 'danger')` | `ceil(PLAYER_SAFE_FADE_SEC · 60) + 2` = 20 |
| `life-icon-loss-animates` | expectation / fact | `lifeLost` | `view.lives.pops > 0` и `view.lives.lost` вырос на 1 | 5 |
| `life-icon-lost-look` | expectation / pixel | `lifeLost` | region — прямоугольник иконки `Life_<lives>` (потерянной) с полем 4 px | 60 |
| `progress-bar-in-status-bar` | invariant / fact | — | `view.progressBar` внутри `view.statusBar`, оба внутри `view.canvas` | — |
| `hud-look` | expectation / pixel | первое наблюдение (`ctx.frame` первого шага; флаг в замыкании) | region — `view.statusBar` | 0 |
| `player-look-danger` | expectation / pixel | игрок перешёл из безопасной клетки в опасную | region — `view.player.rect` с полем 6 px | 20 |

Все с `history: ['2026-09-29 <level>: первоначальный уровень — <почему>']`.

Прогоны (`theme: minimal`, `seed: 1`, `level: 0`):
- `lose-life-trail` — `mission: lose-life-trail`, `requires: [life-lost-on-trail-hit, player-reset-to-trail-start, life-icon-loss-animates, life-icon-lost-look]`, `expect: pass`;
- `lose-life-body` — `mission: lose-life-body`, `requires: [life-icon-loss-animates]`, `expect: pass`;
- `lose-all-lives` — `mission: lose-all-lives`, `requires: [life-icon-loss-animates]`, `expect: pass` (миссия выполнена = `gameOver`; вердикт `pass`, не `lose`: агент сначала проверяет `mission.done`);
- `hud-layout` — `mission: capture-80`, `maxFrames` не трогать, `requires: [hud-look, progress-bar-in-status-bar]`; `expect: { verdictIn: [pass, lose] }`;
- `capture-level-1` — добавить `requires: [trail-ends-with-capture, player-look-follows-zone, player-look-danger]`.

- [ ] **Step 1:** тесты проверок на синтетических моделях (`makeRaw` + `view`): каждая fact-проверка — случай срабатывания и случай нарушения; pixel — `region` возвращает прямоугольник нужной иконки.
- [ ] **Step 2:** реализация проверок; тесты зелёные.
- [ ] **Step 3:** `VC run --root .` — ожидаемо `needs-review` для pixel. Открыть каждую вырезку в `baseline-new/` (Read PNG): игрок, потерянная иконка, полоса статуса — то, что задумано. Принять: `VC run --root . --update-baseline`. Повторить `run` — зелёный.
- [ ] **Step 4:** `bug` — разбирать по журналу (класс «игра»): доложить инженеру, игру не менять. `не проверено` / `bot-stuck` — настройка миссии или тактики (задача 9), каждая правка — отдельный коммит `fix(verify): …` и строка `Ruling:` в ledger.
- [ ] **Step 5:** `VC replay` одного сценарного прогона — без расхождений; повторный `run` — эталоны совпадают.
- [ ] **Step 6:** коммит `feat(verify): проверки сценариев потери жизни, вида игрока и HUD`.

---

### Task 11: Этап 1а — каталог правил и полное покрытие

**Files:**
- Create: `docs/verification/rules.md`
- Modify: `verify/bot/checks.mjs`, `verify/bot/missions.mjs`/`goals.mjs`/`tactics.mjs` (по необходимости), `verify/runs/*.json`, `docs/verification/bot.md`, `CLAUDE.md` (ссылка на rules.md рядом с bot.md)

**Процесс** (содержание каталога — результат чтения источников, поэтому код проверок задаётся по ходу, по образцу задачи 10):

- [ ] **Step 1: Выписать правила.** Прочитать полностью: `docs/bonuses/*.md`, `docs/controls/*.md`, `docs/themes/index.md` и `minimal.md`, `docs/levels.md`, `docs/ui/win.md`, `docs/ui/pause.md`, `docs/superpowers/specs/*.md` (только игровой процесс уровня), и системы `assets/scripts/systems/*.ts`, влияющие на уровень (Trail, CaptureResolve, TerritoryCollision, TerritoryBounce, BonusCollect, ActiveBonusUse, EnemySlowdown, VirtualWall, Tunnel, Win, GameOver, Score, GridSnap, BoundsClamp, PauseSafeZone). Каждое проверяемое утверждение о поведении внутри уровня — строка таблицы:

```markdown
| # | Правило | Источник | Проверка | Уровень | Прогон | Статус |
|---|---|---|---|---|---|---|
| 1 | Потеря жизни только вне безопасной зоны | systems/TerritoryCollisionSystem.ts:21-40 | life-loss-has-cause | fact | все | ✓ |
```
Статусы: `✓` — проверка подтверждена прогоном; `—` с причиной — вне фазы (меню, переходы уровней, мобильное управление — ввод касаниями вне CDP-клавиш, haptics — нет наблюдаемого в браузере); `⚠` — документация расходится с кодом (что говорит каждый).

- [ ] **Step 2: Закрыть правила проверками.** Для каждой строки без проверки — проверка по лестнице (сначала fact), при необходимости — миссия (например `use-bonus` с `type` для Hardener, `collect-bonus` для Slowdown/Wall/RandomZone — какой уровень содержит бонус какого типа, взять из `assets/resources/levels/*.json` через `probe --level N`), тактика и прогон с `requires`. Проверка — тест на синтетической модели, потом прогон. Каждая группа правил (бонусы, туннели, счёт, победа, пауза-safe-zone …) — отдельный коммит `feat(verify): проверки <группа>`.

- [ ] **Step 3: Покрытие.** `VC run --root .` — все прогоны зелёные (новые эталоны — осмотр и `--update-baseline`); `VC coverage --root .` — каждая проверка подтверждена хотя бы одним прогоном (код 0). Снимки `agent`, если появились, — осмотреть и вынести вердикт.

- [ ] **Step 4: Доложить `⚠`.** Строки с расхождением документации и кода — списком инженеру в итоговом отчёте; проверка в таких местах следует коду, и это помечено в `rules.md`.

- [ ] **Step 5: Документация.** `docs/verification/bot.md` — разделы «Проверки» (ссылка на `rules.md`), «Эталоны», «Миссии»; `CLAUDE.md` — ссылка на `rules.md` в строке Verification bot. Коммит `docs(verify): каталог правил игры и покрытие проверками`.

## Итог фазы 2а

- Тесты marketplace и адаптера зелёные.
- `VC run --root .` — все прогоны зелёные на неоне; `VC coverage --root .` — код 0.
- `docs/verification/rules.md` — каждое правило игрового процесса уровня со статусом; `⚠` доложены.
- Ветки `verify-cocos-2a` в обоих репозиториях.
