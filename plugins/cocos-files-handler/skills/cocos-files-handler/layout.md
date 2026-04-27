# cc.Layout — правила и ловушки

## Типы лейаута (`_layoutType`)

| Значение | Константа | Описание |
|----------|-----------|----------|
| 0 | `NONE` | Нет лейаута |
| 1 | `HORIZONTAL` | Горизонтальный |
| 2 | `VERTICAL` | Вертикальный |
| 3 | `GRID` | Сетка |

## Режим изменения размера (`_resizeMode`)

| Значение | Константа | Описание |
|----------|-----------|----------|
| 0 | `NONE` | Не изменяет размер |
| 1 | `CONTAINER` | Контейнер подстраивается под детей |
| 2 | `CHILDREN` | Дети подстраиваются под контейнер |

## ⚠️ КРИТИЧНО: направление вертикального лейаута (`_verticalDirection`)

| Значение | Константа | Описание |
|----------|-----------|----------|
| **0** | `BOTTOM_TO_TOP` | **Дефолт! Первый дочерний элемент располагается СНИЗУ** |
| **1** | `TOP_TO_BOTTOM` | Первый дочерний элемент располагается СВЕРХУ |

**Дефолт = 0 (BOTTOM_TO_TOP)** — это ловушка. Если не указать явно, заголовок окажется ниже кнопок.

В spec JSON для `add-prefab-nodes.js`:
```json
{"type": "cc.Layout", "layoutType": 2, "resizeMode": 1, "spacingY": 30, "verticalDirection": 1}
```

### ⚠️ `add-component.js --type cc.Layout` требует **подчёркиваний в ключах**

`add-prefab-nodes.js` преобразует `layoutType`/`resizeMode`/etc в `_layoutType`/`_resizeMode`/etc внутри своего билдера. А `add-component.js` передаёт properties напрямую — Cocos сериализует cc.Layout под приватными именами, поэтому без `_` поле молча игнорируется (инспектор покажет `Layout undefined resize:undefined`).

Правильно при добавлении через `add-component.js`:

```bash
node .claude/skills/scene-prefab-tools/scripts/add-component.js \
  --file assets/scenes/X.scene --node Container --type cc.Layout \
  --properties '{
    "_layoutType":3, "_resizeMode":0,
    "_cellSize":{"__type__":"cc.Size","width":520,"height":230},
    "_spacingX":40, "_spacingY":40,
    "_startAxis":0, "_verticalDirection":1
  }'
```

То же правило в общем случае: для встроенных `cc.*` компонентов, у которых Cocos использует приватные поля (`_layoutType`, `_resizeMode`, `_cellSize`, `_spacingX`, `_spacingY`, `_startAxis`, `_verticalDirection`, `_horizontalDirection`, `_paddingLeft/Right/Top/Bottom`, `_constraint`, `_constraintNum`), передавай эти имена с префиксом `_` в `--properties`.

Аналогично для горизонтального (`_horizontalDirection`):

| Значение | Константа | Описание |
|----------|-----------|----------|
| 0 | `LEFT_TO_RIGHT` | Дефолт, первый элемент слева |
| 1 | `RIGHT_TO_LEFT` | Первый элемент справа |

## Отступы и промежутки

```json
{
  "type": "cc.Layout",
  "spacingX": 0,
  "spacingY": 30,
  "paddingTop": 10,
  "paddingBottom": 10,
  "paddingLeft": 0,
  "paddingRight": 0
}
```

- `spacingY` — промежуток между строками (для вертикального лейаута)
- `spacingX` — промежуток между колонками (для горизонтального)
- Padding добавляется внутри контейнера со всех сторон

## Расчёт размеров

Для `resizeMode=1` (CONTAINER), `verticalDirection=1`, три кнопки по 40px с spacingY=30:
```
totalHeight = кол-во × высота + (кол-во - 1) × spacing
totalHeight = 3 × 40 + 2 × 30 = 180px
```

При добавлении padding:
```
totalHeight = paddingTop + paddingBottom + (3 × 40) + (2 × 30) = 0 + 0 + 120 + 60 = 180px
```
