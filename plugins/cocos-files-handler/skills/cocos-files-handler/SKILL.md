---
name: scene-prefab-tools
description: Working with Cocos Creator scenes and prefabs via Node.js scripts. Use when you need to inspect or modify prefab or scene.
---

## Инструменты

| Скрипт | Назначение |
|--------|-----------|
| `node .claude/skills/scene-prefab-tools/scripts/extract-scene-strings.js` | Ищет Label с кириллицей в .scene/.prefab, пишет в `.claude/skills/scene-prefab-tools/scripts/patches.json` |
| `node .claude/skills/scene-prefab-tools/scripts/add-locale-keys.js` | Добавляет недостающие ключи в `ru.json` и `en.json` (идемпотентен) |
| `node .claude/skills/scene-prefab-tools/scripts/add-localized-text.js --meta <meta> --patches .claude/skills/scene-prefab-tools/scripts/patches.json` | Вставляет LocalizedText компоненты в сцены/префабы по patches.json |
| `node .claude/skills/scene-prefab-tools/scripts/add-manager-to-scene.js --scene <scene> --meta <meta> --name <Name> --position first` | Добавляет менеджер-ноду в Start-сцену |
| `node .claude/skills/scene-prefab-tools/scripts/fix-uuid-compact.js` | Заменяет полные UUID (36 символов) на компактные (23 символа) во всех сценах/префабах |
| `node .claude/skills/scene-prefab-tools/scripts/prefab-inspector.js --file <prefab>` | Выводит читаемое дерево нод .prefab/.scene файла |
| `node .claude/skills/scene-prefab-tools/scripts/find-sprite-frame.js --file <scene/prefab> [--node <Name>] [--index <n>]` | Извлекает UUID ассета SpriteFrame у существующего cc.Sprite — для повторного использования того же фона в новых нодах |
| `node .claude/skills/scene-prefab-tools/scripts/add-prefab-nodes.js --file <prefab> --spec <spec.json> [--dry-run]` | Вставляет поддерево нод в префаб по spec JSON |
| `node .claude/skills/scene-prefab-tools/scripts/patch-component-property.js --file <scene> --node <NodeName> (--meta <meta> \| --type <cc.Type>) --property <prop> --value <val> [--dry-run]` | Устанавливает свойство на существующем компоненте в сцене/префабе. `--meta` для script-компонентов, `--type` для встроенных (cc.Widget, cc.Button и т.п.) |
| `node .claude/skills/scene-prefab-tools/scripts/add-component.js --file <scene/prefab> --node <NodeName> (--meta <meta> \| --type <cc.Type>) [--properties <json>] [--force] [--dry-run]` | Добавляет компонент к существующей ноде в сцене или префабе. `--meta` для script-компонентов, `--type` для встроенных (cc.Widget, cc.Button, cc.Layout и т.п.) |
| `node .claude/skills/scene-prefab-tools/scripts/edit-prefab.js --file <scene/prefab> --ops <ops.json> [--dry-run]` | Применяет набор структурных операций (resize-uitransform, **set-position**, create-node, move-component, reparent) по JSON-файлу |
| `node .claude/skills/scene-prefab-tools/scripts/create-prefab.js --file <prefab> --name <RootName> [--width w] [--height h] [--anchor-x ax] [--anchor-y ay] [--active true\|false] [--sprite-frame uuid@sub] [--sprite-color r,g,b,a] [--dry-run]` | Создаёт новый пустой .prefab файл с корневой нодой и UITransform (опционально — Sprite). |

## Полный рабочий цикл перевода новых строк

```bash
# 1. Найти все кириллические строки в сценах и префабах
node .claude/skills/scene-prefab-tools/scripts/extract-scene-strings.js
# → пишет .claude/skills/scene-prefab-tools/scripts/patches.json

# 2. Заполнить translationKey для каждой записи в patches.json
# Пустые ключи пропускаются, оставить пустыми можно для динамического контента.

# 3. Обновить add-locale-keys.js: добавить новые ключи в TRANSLATIONS,
#    затем запустить — безопасно добавит только недостающие ключи
node .claude/skills/scene-prefab-tools/scripts/add-locale-keys.js

# 4. Дождаться, чтобы Cocos Creator создал .meta для LocalizedText.ts
# (файл создаётся автоматически при обнаружении нового .ts файла)

# 5. Вставить LocalizedText компоненты в сцены/префабы
node .claude/skills/scene-prefab-tools/scripts/add-localized-text.js \
  --meta assets/scripts/Components/LocalizedText.ts.meta \
  --patches .claude/skills/scene-prefab-tools/scripts/patches.json

# 6. Проверить что кириллица не осталась
node .claude/skills/scene-prefab-tools/scripts/extract-scene-strings.js
# → повторно вывести patches.json, всё с translationKey должно исчезнуть
```

## Справочники компонентов

Детальные правила и ловушки — в отдельных файлах:
- **[layout.md](layout.md)** — cc.Layout: типы, resizeMode, verticalDirection (ловушка BOTTOM_TO_TOP!), расчёт размеров
- **[uitransform-positioning.md](uitransform-positioning.md)** — позиционирование нод, якоря, z-порядок, несоответствие якорей контейнера и дочерних нод

## Инспекция и добавление нод в префабы

### prefab-inspector.js — просмотр структуры

```bash
node .claude/skills/scene-prefab-tools/scripts/prefab-inspector.js --file assets/prefabs/Settings.prefab
node .claude/skills/scene-prefab-tools/scripts/prefab-inspector.js --file assets/scenes/Settings.scene
```

Выводит читаемое дерево: имя ноды, индекс, active/inactive, размер UITransform, якорь, позицию, компоненты (тип, текст, цвет спрайта, uuid фрейма, layout-тип и т.д.). Используй перед редактированием, чтобы понять текущую структуру.

### add-prefab-nodes.js — добавление поддерева нод

```bash
# Тестовый прогон (не пишет файл)
node .claude/skills/scene-prefab-tools/scripts/add-prefab-nodes.js --file assets/prefabs/Settings.prefab --spec .claude/skills/scene-prefab-tools/scripts/my-spec.json --dry-run

# Реальное выполнение
node .claude/skills/scene-prefab-tools/scripts/add-prefab-nodes.js --file assets/prefabs/Settings.prefab --spec .claude/skills/scene-prefab-tools/scripts/my-spec.json
```

Скрипт **идемпотентен**: если нод с `idempotencyName` уже есть в родителе — пропускает.

### Формат spec JSON

```json
{
  "parentPath": "Settings",
  "insertAt": "after:SleepBlocker",
  "idempotencyName": "LanguageSettings",
  "node": {
    "name": "LanguageSettings",
    "active": true,
    "position": [0, 885, 0],
    "layer": 33554432,
    "components": [ ... ],
    "children": [ ... ]
  }
}
```

`insertAt`: `"first"` | `"last"` | `"after:<childName>"` — вставить после ноды с указанным именем.

**Дескрипторы компонентов:**

```jsonc
// Встроенные
{"type": "cc.UITransform", "size": [640, 260], "anchor": [0.5, 1]}
{"type": "cc.Sprite", "spriteFrame": "UUID@f9941", "spriteType": 0, "color": [255, 255, 255, 255]}
{"type": "cc.Label", "text": "Язык", "fontSize": 28, "font": "UUID"}
{"type": "cc.Layout", "layoutType": 2, "resizeMode": 1, "spacingY": 30, "verticalDirection": 1}
// ⚠️ verticalDirection: 0=BOTTOM_TO_TOP (дефолт!), 1=TOP_TO_BOTTOM — см. layout.md

// Пользовательский скрипт (UUID берётся из .meta файла)
{"type": "meta", "metaFile": "assets/scripts/Components/MyComp.ts.meta",
 "properties": {
   "loaderPrefab": {"prefabMeta": "assets/prefabs/Loader.prefab.meta"}
 }}

// LocalizedText — частный случай meta
{"type": "meta", "metaFile": "assets/scripts/Components/LocalizedText.ts.meta",
 "translationKey": "ui.settings.language"}
```

Если `.meta` файл не найден (Cocos ещё не создал) — компонент пропускается с предупреждением, индекс не расходуется.

**Workflow: добавить новый блок нод в префаб**
1. `node .claude/skills/scene-prefab-tools/scripts/prefab-inspector.js --file ...` — понять текущую структуру и координаты
2. Создать `.claude/skills/scene-prefab-tools/scripts/my-spec.json` с нужными нодами
3. Убедиться что Cocos Creator создал `.meta` для всех пользовательских скриптов
4. `node .claude/skills/scene-prefab-tools/scripts/add-prefab-nodes.js --file ... --spec ... --dry-run` — проверить
5. `node .claude/skills/scene-prefab-tools/scripts/add-prefab-nodes.js --file ... --spec ...` — применить
6. `node .claude/skills/scene-prefab-tools/scripts/prefab-inspector.js --file ...` — верифицировать результат

## Изменение свойства существующего компонента

```bash
# Dry-run — посмотреть что изменится
node .claude/skills/scene-prefab-tools/scripts/patch-component-property.js \
  --file assets/scenes/StartItch.scene \
  --node LocalizationManager \
  --meta assets/scripts/Managers/Global/LocalizationManager.ts.meta \
  --property defaultLocale \
  --value en \
  --dry-run

# Применить
node .claude/skills/scene-prefab-tools/scripts/patch-component-property.js \
  --file assets/scenes/StartItch.scene \
  --node LocalizationManager \
  --meta assets/scripts/Managers/Global/LocalizationManager.ts.meta \
  --property defaultLocale \
  --value en
```

`--value` парсится как JSON (числа, boolean, объекты), при ошибке — трактуется как строка.
Скрипт находит ноду по `--node` (имя), компонент — по compact UUID из `--meta` или по `--type` (например `cc.Widget`).

Примеры с `--type`:

```bash
# Поменять alignMode у cc.Widget
node .claude/skills/scene-prefab-tools/scripts/patch-component-property.js \
  --file assets/prefabs/MobileControls.prefab --node BonusButton \
  --type cc.Widget --property alignMode --value 1
```

## Добавление компонента к существующей ноде

`add-component.js` добавляет компонент к уже существующей ноде в сцене или префабе. Поддерживает:
- **script-компоненты** через `--meta path/to/Script.ts.meta` — UUID берётся из meta-файла и сжимается в compact формат.
- **встроенные cc.* компоненты** через `--type cc.Widget` (или `cc.Button`, `cc.Layout`, `cc.Sprite`, и т.п.) — `__type__` ставится напрямую без чтения meta.

Автоматически различает формат (в префабах создаёт парный `cc.CompPrefabInfo`, в сценах — нет). Идемпотентен: если такой компонент уже есть на ноде — выводит сообщение и выходит (для дубликата использовать `--force`).

```bash
# Скрипт-компонент: пустой
node .claude/skills/scene-prefab-tools/scripts/add-component.js \
  --file assets/prefabs/Player.prefab \
  --node Player \
  --meta assets/scripts/components/SpawnPoint.ts.meta

# Скрипт-компонент: с простыми свойствами
node .claude/skills/scene-prefab-tools/scripts/add-component.js \
  --file assets/prefabs/Enemy.prefab \
  --node Enemy \
  --meta assets/scripts/components/MoveSpeed.ts.meta \
  --properties '{"value": 600}'

# Скрипт-компонент: ссылки на ноды и ассеты
node .claude/skills/scene-prefab-tools/scripts/add-component.js \
  --file assets/scenes/Main.scene \
  --node GameWorld \
  --meta assets/scripts/prefabs/EnemySpawner.ts.meta \
  --properties '{"enemyPrefab":"@asset:assets/prefabs/Enemy.prefab.meta","playArea":"@node:PlayScreenBG","count":2,"speed":600}'

# Встроенный тип: cc.Widget, растянутый на весь viewport
node .claude/skills/scene-prefab-tools/scripts/add-component.js \
  --file assets/prefabs/MobileControls.prefab \
  --node MobileControls \
  --type cc.Widget \
  --properties '{"isAlignTop":true,"isAlignBottom":true,"isAlignLeft":true,"isAlignRight":true,"top":0,"bottom":0,"left":0,"right":0,"alignMode":2}'

# Встроенный тип: cc.Button
node .claude/skills/scene-prefab-tools/scripts/add-component.js \
  --file assets/scenes/Start.scene \
  --node PlayButton \
  --type cc.Button \
  --properties '{"transition":0,"target":"@node:PlayButton"}'
```

**Синтаксис ссылок в `--properties`** (любое строковое значение, включая вложенные):

| Префикс | Преобразуется в | Пример |
|---------|----------------|--------|
| `@node:<NodeName>` | `{ "__id__": <id ноды в этом файле> }` | `"@node:PlayScreenBG"` |
| `@asset:<path>.meta` | `{ "__uuid__": …, "__expectedType__": <из расширения> }` | `"@asset:assets/prefabs/Enemy.prefab.meta"` |
| `@asset:<path>.meta:<Type>` | то же, но `__expectedType__` задан явно | `"@asset:assets/img/x.png.meta:cc.SpriteFrame"` |

Автовывод `__expectedType__` по расширению: `.prefab→cc.Prefab`, `.scene→cc.SceneAsset`, `.png/.jpg/.jpeg/.webp→cc.SpriteFrame`, `.ttf/.otf→cc.TTFFont`, `.mp3/.ogg/.wav→cc.AudioClip`, `.json→cc.JsonAsset`, остальное → `cc.Asset`.

Флаги:
- `--force` — добавить ещё один экземпляр, даже если компонент уже есть на ноде.
- `--dry-run` — показать, что изменилось бы, без записи в файл.

После редактирования рекомендуется открыть сцену/префаб в Cocos Creator и сохранить, чтобы привести файл к каноническому формату (иначе следующее сохранение редактором может переупорядочить поля — cf. коммит ee59533).

## Структурные правки префабов/сцен — edit-prefab.js

`edit-prefab.js` применяет последовательность структурных операций к сцене или префабу. Операции описываются в JSON-файле (массив объектов или `{"ops":[...]}`). Поддерживает prefab- и scene-формат автоматически (в префабах создаются `cc.CompPrefabInfo`/`cc.PrefabInfo`, в сценах — нет).

**Временные ops-файлы пиши в `tmp/` в корне проекта, а не в папку скилла** (после применения — удаляй).

```bash
node .claude/skills/scene-prefab-tools/scripts/edit-prefab.js \
  --file assets/prefabs/Player.prefab \
  --ops tmp/my-edit.json \
  [--dry-run]
```

### Формат ops-файла

```jsonc
{
  "ops": [
    // Изменить размер UITransform на ноде. anchor опционален.
    { "op": "resize-uitransform", "node": "Player", "size": [32, 32], "anchor": [0.5, 0.5] },

    // Создать новую ноду-ребёнка. uitransform опционален (если нужно UITransform).
    // insertAt: "first" | "last" (по умолчанию) | "after:SiblingName"
    { "op": "create-node", "name": "PlayerBackground", "parent": "Player",
      "insertAt": "first", "position": [0, 0, 0],
      "uitransform": { "size": [62, 62], "anchor": [0.5, 0.5] } },

    // Перенести компонент с одной ноды на другую. componentType — либо встроенный
    // тип ("cc.Sprite", "cc.Label", "cc.UITransform"), либо "meta:path/to/Script.ts.meta"
    // для пользовательских скриптов.
    { "op": "move-component", "from": "Player", "to": "PlayerBackground",
      "componentType": "cc.Sprite" },

    // Сменить родителя у существующей ноды.
    { "op": "reparent", "node": "SomeChild", "newParent": "OtherParent",
      "insertAt": "last" },

    // Установить локальную позицию ноды (_lpos). z опционален (по умолчанию 0).
    { "op": "set-position", "node": "PlayScreenBorder", "position": [0, -20, 0] }
  ]
}
```

**Идемпотентность:**
- `create-node` пропускается, если у родителя уже есть ребёнок с таким именем.
- `move-component` пропускается, если компонент уже находится на целевой ноде.
- `resize-uitransform`, `set-position` и `reparent` — всегда применяются (повторный запуск не изменит результат, если значения уже такие).

**Поиск нод** — по имени (`_name`). Имена должны быть уникальны среди тех, к которым обращаешься в ops. При неоднозначности скрипт падает с ошибкой.

### Пример: отделить визуал от хитбокса

Типичный паттерн — когда спрайт включает размытую тень/ореол, и его реальный размер больше хитбокса. Переносим спрайт в дочернюю ноду, а корневой UITransform оставляем "правильного" размера (для AABB/коллизий).

`tmp/shrink-player.json`:
```json
{
  "ops": [
    { "op": "resize-uitransform", "node": "Player", "size": [32, 32] },
    { "op": "create-node", "name": "PlayerBackground", "parent": "Player",
      "insertAt": "first", "uitransform": { "size": [62, 62] } },
    { "op": "move-component", "from": "Player", "to": "PlayerBackground",
      "componentType": "cc.Sprite" }
  ]
}
```

```bash
node .claude/skills/scene-prefab-tools/scripts/edit-prefab.js \
  --file assets/prefabs/Player.prefab --ops tmp/shrink-player.json --dry-run
# → проверить вывод, затем запустить без --dry-run
rm tmp/shrink-player.json
```

## UUID: КРИТИЧЕСКИ ВАЖНО

Cocos Creator хранит ссылки на скрипты в сценах в **компактном 23-символьном формате**, НЕ в полном UUID из .meta файла.

**Алгоритм конвертации** (реализован во всех .claude/skills/scene-prefab-tools/scripts/*.js скриптах):
```javascript
function compressUuid(uuid) {
    const hex = uuid.replace(/-/g, '');                           // 32 hex символа
    const tail = Buffer.from(hex.slice(5) + '0', 'hex')
                       .toString('base64').slice(0, 18);          // 18 base64 символов
    return hex.slice(0, 5) + tail;                                // итого 23 символа
}
// Пример: 'e19100ae-3625-4b77-b188-eddd782afe79' → 'e1910CuNiVLd7GI7d14Kv55'
```

Если скрипты вставили компоненты с **полным UUID** (36 символов с дефисами) — Cocos показывает
`Script "..." is missing or invalid`. Исправление: запустить `node .claude/skills/scene-prefab-tools/scripts/fix-uuid-compact.js`.

## Формат Cocos Creator 3.x сцены (JSON-массив)

- `cc.Scene` — объект с `_children` (индексы дочерних нод)
- `cc.Node` — объект с `_components: [{__id__: N}]`
- Компонент — объект с `__type__: "<compact-uuid>"` и `node: {__id__: N}`
- Встроенные типы: `"cc.Label"`, `"cc.UITransform"`, `"cc.Sprite"` — полные строки
- Пользовательские скрипты: всегда compact UUID

Скрипт `add-localized-text.js` — **идемпотентен**: не добавит второй LocalizedText если нода уже его содержит.

## Локализация: архитектура

- `utils/i18n.ts` — `t(key)`: синхронная, бросает ошибку если вызвана до загрузки переводов
- `utils/i18n.ts` — `i18nEvents` EventTarget + константа `LANGUAGE_CHANGED`: подписка на смену языка
- `utils/i18n.ts` — `changeLanguage(locale)`, `resetToAutoLanguage()`, `isManualLanguageSet()`: мост для компонентов (не зависят от Managers)
- `LocalizationManager` (Persistent) — регистрирует translate-функцию + changeLanguage/resetToAuto/isManualSet
- `LocalizedText` (Component) — в `onLoad()` подписывается на `LANGUAGE_CHANGED`, переводит при каждой смене языка
- Locale-файлы: `assets/resources/data/locale/ru.json` и `en.json`

**Приоритет языка**: Сохранённая настройка (`localStorage.userLanguage`) → Автоопределение → Дефолт (`'ru'`)

**Языки**: `ru, uk, be, kz` → `'ru'`; остальное → `'en'` (в DefaultLanguageSource)

**Тестирование языка**: добавить `?lang=en` в URL при открытии StartTest сцены.

## Добавление нового менеджера в Start-сцены

```bash
# Дождаться создания .meta файла Cocos Creator, затем:
for scene in StartDefault StartVK StartYandex StartTest; do
  node .claude/skills/scene-prefab-tools/scripts/add-manager-to-scene.js \
    --scene "assets/scenes/${scene}.scene" \
    --meta "assets/scripts/Managers/Global/MyManager.ts.meta" \
    --name MyManager --position first
done
```

`--position first` обязателен для менеджеров, которые должны инициализироваться до AutoNavigate.
