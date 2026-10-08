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
│   │                 progress — отпечаток наблюдаемого состояния: не меняется
│   │                 stallFrames кадров → bug stall («игра замерла»)
│   ├── missions.mjs  missions: { имя: объект | (params) => объект }
│   ├── goals.mjs     candidates(model, mission), replanOn
│   ├── tactics.mjs   tactics: { kind: { next(model, goal) → { action, frames } } }
│   └── checks.mjs    checks: [инвариант | ожидание] — см. «Проверки»
├── runs/*.json
└── baseline/<прогон>/<проверка>-<n>.png   пиксельные эталоны
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
  "zones": { "assets/scripts/**": ["gameplay"] },
  "theme": "minimal",
  "pixel": { "threshold": 12, "tolerance": 0.002 },
  "baseline": "verify/baseline"
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
| `act(action)` | список операций ввода `[{ type: 'keyDown'|'keyUp'|'press', key }]` и `[{ type: 'touchStart'|'touchMove', x, y }, { type: 'touchEnd' }]` (CSS px страницы) — их исполняет плагин через CDP; плюс операции окружения `network`, `viewport`, `clock`, `reload` (см. «Окружение прогона») |
| `frameEvents()` | события за последний кадр; вызывается shim'ом после каждого кадра |

Клавиши: `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Space`, `Enter`, `Escape`.
Касания — одним пальцем (`Input.dispatchTouchEvent`); игра их видит, только
если прогон задал `"touch": true` — тогда плагин включает эмуляцию тача до
загрузки страницы (Cocos решает, слушать ли тач, при загрузке), а `touch`
попадает в `window.__botRun`.
После старта уровня плагин фокусирует `#GameCanvas`: Cocos слушает клавиатуру на
канвасе.

### Вид (`window.__botView`) и параметры прогона

Плагин внедряет общий для Cocos помощник чтения дерева узлов:

| Метод | Что возвращает |
|---|---|
| `node(path)` | `{ active, worldRect: { x, y, w, h }, opacity, color, children }` или `null`; путь от корня сцены через `/`; `opacity` — с учётом `UIOpacity` предков |
| `find(className)` | `[{ path, active, worldRect, opacity }]` для всех узлов с компонентом |
| `pageRect(worldRect)` | CSS px страницы — по узлу `Canvas` и элементу `#GameCanvas` |

Мост решает, какие факты вида положить в `observe().view`; раскладка узлов по
темам — таблица в мосте. Параметры прогона (`theme` и др.) — в
`window.__botRun` до загрузки моста.

### Миссия

Объект `{ done(model, events), goals?: [kind…] }` или фабрика
`(params) => объект` с обязательными параметрами в свойстве `required`.
`continueAfterGameOver: true` — прогон не кончается на событии поражения, конец решает
`done` миссии (так проверяется экран поражения). `goals` ограничивает виды краткосрочных целей: так миссия-сценарий («потерять
жизнь от врага на следе») загоняет бота в нужное поведение.

### Цель (что возвращает `candidates`)

`{ kind, id, score, params, done(model, events, ctx), failed(model, events, ctx) }`, `ctx = { frame, goalFrames }` — цель может сдаться сама. Проверки получают `ctx = { frame, prevFrame }`; `prevFrame === 0` — `prev` это стартовое состояние.
Оценку считает проект; движок сравнивает числа. `kind` выбирает тактику.

## Проверки (`checks.mjs`)

```js
// инвариант — всегда
{ id, kind: 'invariant', level: 'fact', check(prev, cur, events, ctx) → null | { message, data } }

// ожидание — когда X, то в течение within кадров Y
{ id, kind: 'expectation', level: 'fact' | 'pixel' | 'agent',
  when(prev, cur, events, ctx) → null | trigger,
  then(cur, events, trigger) → boolean,     // fact
  region(cur, trigger) → { x, y, w, h },    // pixel, agent — мировые px
  within, criterion?, history: ['дата уровень: почему'] }
```

- **fact**: `then` не наступило за `within` кадров — `bug`.
- **pixel**: через `within` кадров вырезка сравнивается с эталоном
  `verify/baseline/<прогон>/<проверка>-<n>.png`. Расхождение — `bug` (эталон,
  снимок и diff в `baseline-new/`); эталона нет — прогон `needs-review`.
- **agent**: вырезка и `criterion` — в `review/` прогона на осмотр агентом;
  прогон не падает.
- Прогон кончился до срока — «не дождался»: ни подтверждение, ни нарушение.
- Шаг агента урезается до ближайшего срока ожидания.

**Покрытие.** По каждой проверке — взведено / подтверждено / нарушено / не
дождался. `requires` прогона — ожидания, которые обязаны подтвердиться.

## Прогон (`verify/runs/<имя>.json`)

```json
{ "title": "Столкновение врага со следом отнимает жизнь", "zone": "gameplay",
  "level": 0, "seed": 1, "theme": "minimal",
  "mission": "lose-life-trail",
  "requires": ["life-lost-on-trail-hit"],
  "policy": "planned",
  "expect": { "verdict": "pass" } }
```

`touch: true` — прогон с эмуляцией тача (см. «Мост»). `bridge: { … }` — параметры
прогона для моста проекта: попадают в `window.__botRun` рядом с `theme` и `touch`
(например, подготовка состояния или сцена, с которой начать). `mission` — строка или
`{ "name": …, …параметры }`. `expect`: `verdict`,
`verdictIn: [...]`, `maxFrames`.

Прогон зелёный, только если: вердикт совпал с `expect`; каждое ожидание из
`requires` подтверждено; нет пиксельных расхождений; нет вырезок без эталона.

### Паттерны случайности

`planned`, `random`, `every:N` (каждый N-й выбор случайный), `burst:K/M`
(K по плану, M случайно, по кругу), `chance:P`. Строка — для цели и действия
сразу; `{ "goal": …, "action": … }` — раздельно.

### Окружение прогона

Все поля — по выбору: не задано — страница та же, что раньше. Ошибка в поле
отклоняет прогон до запуска Chrome.

| Поле | Что делает |
|---|---|
| `query` | параметры адреса страницы: `"prod&pf=vk"` или `{ "prod": true, "api": "http://127.0.0.1:18110", "pf": "vk" }` (`true` — параметр без значения, `false` — нет параметра) |
| `clock` | часы страницы: ISO-дата или мс эпохи. До старта уровня `Date.now()` стоит на ней, дальше идёт с кадрами; `new Date()` без аргументов видит те же часы. Без `clock` — прежняя эпоха шима, а `new Date()` — настоящее время |
| `timezone` | часовой пояс страницы (IANA, `"Europe/Moscow"`) — `Emulation.setTimezoneOverride` |
| `network` | условия сети: `"offline"` или `{ "offline": true, "latency": мс, "download": байт/с, "upload": байт/с, "at": "boot" \| "ready" }` — `Network.emulateNetworkConditions`. Сборка грузится всегда; условия включаются после загрузки движка, до preload (`boot`, по умолчанию), или когда уровень готов к вводу (`ready`). Отказ запроса из-за «нет сети» (`ERR_INTERNET_DISCONNECTED` в журнале Chrome) — не `console-error`: как игра его переживает, судят проверки. Файлы самой сборки «нет сети» не отрезает: они часть игры (на устройстве уже есть), их запросы плагин отвечает с диска через CDP `Fetch` — лениво грузимые сцены и `resources` грузятся и без сети |
| `viewport` | начальный размер страницы вместо `viewport` конфига: `{ "width", "height", "mobile": true }` — `mobile` даёт экран телефона с ориентацией по сторонам |

**Посреди прогона** окружение меняет мост: `act()` возвращает вперемешку с
вводом операции, плагин исполняет их по порядку.

| Операция | Что делает |
|---|---|
| `{ type: 'network', offline?, latency?, download?, upload? }` | новые условия сети; `{ type: 'network' }` — сеть как обычно |
| `{ type: 'viewport', width, height, mobile? }` | новый размер (по умолчанию `mobile: true`, портрет — если высота больше ширины); `{ type: 'viewport' }` — назад к размеру прогона |
| `{ type: 'clock', at }` | перевести часы страницы: `Date.now()` = `at` (ISO или мс) с этого кадра |
| `{ type: 'reload', query? }` | перезапуск страницы; `query` — с другими параметрами адреса |

После `network` и `viewport` плагин ждёт, пока страница увидит изменение
(`navigator.onLine`, размер) и пройдут два настоящих кадра браузера, — события
`online`/`offline`/`resize` разосланы до следующего шага игры.

**Перезапуск** (`reload`): хранилище (`localStorage`, IndexedDB, Cache API)
живёт в профиле Chrome и сохраняется. Часы продолжаются с того же `Date.now()`,
seed тот же. Сборка грузится при любых условиях сети: они снимаются на загрузку
и возвращаются сразу после неё. Затем плагин заново стартует уровень с теми же
параметрами (preload, заморозка, `start`, кадры до `ready`); номер перезапуска
мост видит в `window.__botRun.reloads`. Ошибки загрузки, как и при первом
старте, не судятся.

## Команды

```
node scripts/verify-cocos.mjs run [--run a,b | --zone z | --since REF | --changed f1,f2] [--jobs N]
node scripts/verify-cocos.mjs soak [--seeds N] [--policies p1,p2] [--jobs N]
node scripts/verify-cocos.mjs replay tmp/bot/<прогон> [--until КАДР]
node scripts/verify-cocos.mjs probe [--level N] [--seed S] [--theme id]
node scripts/verify-cocos.mjs coverage
```

`run --update-baseline` принимает текущие вырезки как эталоны и удаляет
эталоны, которых законченный прогон не снял; `run --theme id` подменяет тему
прогонов. `--jobs N` — до N прогонов одновременно: у каждого свой Chrome и
виртуальное время, журналы совпадают с последовательным запуском побайтно.
`coverage` — какие проверки какими прогонами подтверждены (по данным `run`
с текущим адаптером и только для прогонов, что есть в `verify/runs`);
ненулевой код, если есть неподтверждённые ожидания. Id в `requires`
сверяются с проверками адаптера до запуска Chrome.

В строке прогона: `✓` — зелёный, `✗` — нет, `?` с классом `[осмотр]` —
не хватает только осмотра новых или устаревших вырезок.

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

`run` завершается с ненулевым кодом, если прогон не зелёный (см. «Прогон»);
`soak` — если есть `bug` или `error`.

## Журнал

`tmp/bot/<прогон>/trace.jsonl` — по строке на решение и событие. Поле `by`:
`score` / `tactic` — по плану, `random` — случайный выбор, `no-goal` —
целей не нашлось. Записи проверок: `arm`, `confirm`, `miss`, `shot`. Рядом
`tail.jsonl`, `state.json`, `final.png`, `baseline-new/`, `review/`.

## Требования

Установленный Chrome (`CHROME_PATH` переопределяет путь) и готовая web-сборка.
Зависимостей нет.
