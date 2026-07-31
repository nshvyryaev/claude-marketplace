# Cocos Creator 3.x — ловушки, которые не ловит компилятор

Каждый пункт здесь стоил реального времени на проектах ImageUncovered / CodingDream / FarmArena /
UchiRuDrawing. Общее у них одно: **TypeScript пропускает, падает в рантайме или на билде.**

Автоматическая проверка первых двух пунктов:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/cocos-files-handler/scripts/verify-cocos-code.js --all
```

Она же висит PostToolUse-хуком плагина, так что находки прилетают сразу после записи файла.

---

## 1. У `cc.Node` нет `setActive()`

```ts
node.setActive(false);            // ❌ TypeError: setActive is not a function
node?.setActive(false);           // ❌ null-check пройдёт, метода всё равно нет
node.active = false;              // ✅
if (node) node.active = false;    // ✅ когда nullable
```

`setActive` существовал в Cocos 2.x и есть в Unity — привычка переносится, а в 3.x метод убрали.
Типизация `Node` из пакета `cc` об этом **не сигнализирует**: код компилируется чисто и падает
только когда до строки дойдёт исполнение. Особенно коварно с optional chaining — `?.` проверяет
на null и создаёт ложное ощущение защищённости.

Поймано в UchiRuDrawing (`EvolutionCutsceneController`), при том что весь остальной проект писал
`node.active = false`.

**Признак при поиске по коду:** любое вхождение `.setActive(` — подозрительное место.

## 2. Нет `resolveJsonModule` — прямой импорт `.json` не компилируется

```ts
import forest from './forest.world.json';   // ❌ не соберётся
const d = await import('./quests.json');    // ❌ то же самое
```

`tsconfig.json` проекта расширяет `temp/tsconfig.cocos.json`, который генерирует Cocos. Там
`target: ES2015` и **нет** `resolveJsonModule`.

Два рабочих пути:

1. **Просто и быстро** — TS-литерал в `.ts` под `assets/scripts/config/`
   (образец: `FOREST_QUESTS` в `quests.ts` в UchiRuDrawing).
2. **Через загрузчик** — положить `.json` в `assets/resources/configs/` и грузить асинхронно:
   `resources.load('configs/forest', JsonAsset, cb)`. Имеет смысл, когда конфиг нужно менять без
   ребилда — например, балансировка в проде.

## 3. `temp/tsconfig.cocos.json` править нельзя

Это генерируемый файл: Cocos перезапишет его при следующем refresh, и правка молча исчезнет.
Не пытайся включить там `resolveJsonModule` (см. пункт 2). Если нужно поменять опции компилятора —
только через `tsconfig.json` проекта, который его расширяет.

## 4. `.scene` / `.prefab` — только через скрипты плагина

Никогда не редактируй `.scene`/`.prefab` через Edit/Write и **не пиши одноразовые `node -e "..."`
JSON-эдиты**. Это сериализованный Cocos'ом YAML-ish JSON: ручные правки легко ломают ссылки между
нодами и компонентами.

Скрипты плагина уже умеют то, что нужно: компактные UUID, идемпотентность, `--dry-run`, корректный
формат node/asset-ссылок. Самописные JSON-эдиты мимо этих конвенций промахиваются.

PreToolUse-хук плагина (`block-cocos-files.js`) блокирует прямые правки этих файлов — если он
сработал, ищи подходящий скрипт в таблице инструментов [SKILL.md](SKILL.md), а не обходной путь.
Inline `node -e` допустим только если нужной операции в плагине действительно нет (например, удалить
ноду) — и тогда лучше завести скрипт.

## 5. Node-ссылки: `@node:Name`, а не `{"__node__":"Name"}`

```bash
--value '{"__node__":"DrawingsContainer"}'   # ❌ запишется буквально, Cocos это не резолвит
--value '"@node:DrawingsContainer"'          # ✅
--value '{"__id__":422}'                     # ✅ если id известен точно
```

`add-component.js` и `patch-component-property.js` **оба** понимают `@node:Name` и `@asset:path.meta`
и сами подставляют `{"__id__":N}` / ссылку на ассет.

> Историческая заметка: раньше `patch-component-property.js` записывал `--value` буквально, и
> приходилось руками искать `__id__` через `prefab-inspector.js`. Это **починено** — если встретишь
> старую инструкцию про ручной поиск `__id__`, она устарела.

Что осталось верным: если нод с одинаковым именем несколько, `--node` может выбрать не ту. Тогда
резолви id явно через `prefab-inspector.js --file <scene>` и передавай `{"__id__":<N>}`.

## 6. Корень проекта в скриптах — `CLAUDE_PROJECT_DIR`

Скрипты определяют корень как `process.env.CLAUDE_PROJECT_DIR || process.cwd()`, а **не** от
`__dirname`. При установке через маркетплейс папка плагина лежит далеко от проекта, и любой путь
от `__dirname` резолвится внутрь плагина — исторически это давало «Meta file not found» на пустом
месте.

Если добавляешь новый скрипт — используй тот же паттерн (см. `plugin-development.md`). Если старый
скрипт падает с непонятной ошибкой про путь — проверь в нём эту строку в первую очередь.
