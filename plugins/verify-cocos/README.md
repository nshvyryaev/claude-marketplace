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
После старта уровня плагин фокусирует `#GameCanvas`: Cocos слушает клавиатуру на
канвасе.

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
