# verify-web

Движок браузерных проверок поверх голого CDP. Плагин везёт движок, проект
владеет своими сценариями и картой зон.

## Три слоя, разной природы и цены

| Слой | Что делает | Кто судит | Цена |
|---|---|---|---|
| `scenario` | прогон шагов, утверждения, ошибки консоли | машина | 0 |
| `snapshot` | пиксельный диф против эталона | машина | 0 |
| `visual` | снимки уходят агенту, он судит по критериям приёмки | агент | токены |

`snapshot` — **только защита от регрессии**, там где вид меняться не должен.
Оценить новый интерфейс он не может: при осознанном изменении диф всегда
красный и ничего не сообщает. Для этого есть `visual`.

## Что нужно проекту

```
verify/
├── config.json        адрес, вьюпорт, карта зон
├── scenarios/*.mjs    сценарии
└── baseline/*.png     эталоны снимков
```

### `verify/config.json`

```json
{
  "url": "http://localhost:5173/",
  "viewport": { "width": 390, "height": 844, "scale": 2 },
  "clickable": "button,[role=\"button\"]",
  "shotsDir": "tmp/shots",
  "baselineDir": "verify/baseline",
  "scenarios": "verify/scenarios",
  "settleMs": 1500,
  "snapshotTolerance": 0.002,
  "zones": {
    "src/domain/**": ["game"],
    "src/screens/HomeScreen*": ["home"]
  }
}
```

### Сценарий

```js
export const zone = 'game';
export const title = 'Несуществующее слово отклоняется с объяснением';

export default async (t) => {
  await t.click('Играть');
  await t.expectText('ГОТОВО');
  await t.keys('ЪЪЪ');
  await t.click('ГОТОВО');
  await t.expectText('пока не подходит');
  await t.shot('reject');
};
```

Шаги: `click(text)`, `keys(letters)`, `wait(ms)`, `expect(выражение, описание)`,
`expectText(текст)`, `expectNoText(текст)`, `shot(имя)`, `eval(выражение)`,
`text(селектор?)`.

Ожидание встроено в утверждения: `expectText` сам опрашивает страницу до
таймаута. Россыпь `wait()` со случайными числами — главный источник мигающих
проверок, и её тут быть не должно.

Клик — по тексту, а не по CSS-селектору: текст кнопки часть продукта и меняется
осознанно, а класс переживает любую перевёрстку молча.

`click` шлёт полную последовательность указательных событий
(`pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click`), а не голый
`el.click()`. Обработчик, висящий на `pointerdown`/`pointerup` — удержание,
свайп, перетаскивание — от `el.click()` не срабатывает вовсе, и сценарий молча
идёт дальше по нетронутому экрану.

## Запуск

```
node scripts/verify.mjs                          весь набор
node scripts/verify.mjs --scenario move-reject   один сценарий
node scripts/verify.mjs --zone game              зона целиком
node scripts/verify.mjs --since HEAD             только задетое изменениями
node scripts/verify.mjs --changed src/a.ts,src/b.ts
node scripts/verify.mjs --update-baseline        принять текущий вид за эталон
node scripts/verify.mjs --dark                   тёмная тема
node scripts/verify.mjs --json                   машинный вывод
```

Код возврата ненулевой, если хоть один сценарий провален.

## Отбор по изменениям

Карта `zones` соотносит файлы с зонами; гоняется только задетое подмножество.
Ключевое свойство: **файл, не попавший ни в одно правило, означает «прогнать
всё»**. Промах карты стоит лишнего прогона, а не пропущенной поломки.

## Требования

Установленный Chrome (путь ищется автоматически, переопределяется `CHROME_PATH`)
и запущенный dev-сервер проекта. Зависимостей нет: PNG разбирается и собирается
через встроенный `zlib`.
