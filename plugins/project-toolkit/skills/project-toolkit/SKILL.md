---
name: project-toolkit
description: Use when starting work in any project of this engineer that needs shared infrastructure — acceptance criteria, browser checks, product analytics, A/B experiments, a server, deployment, ports, nginx, SSH to the production machine — or when asked "что у нас есть для…", "как задеплоить", "как завести эксперимент / аналитику", "куда смотреть метрики". Points to the existing tool instead of inventing a new one. Triggers on "деплой", "сервер", "порт", "nginx", "аналитика", "события", "метрики", "AB тест", "эксперимент", "критерии приёмки", "проверь в браузере".
---

# Общие инструменты проектов

Карта того, что уже сделано и чем обязаны пользоваться все проекты инженера.
Прежде чем изобретать своё — найти здесь. Если инструмента не хватает,
дорабатывать его в его репозитории, а не копировать в проект.

## Критерии приёмки — плагин `acceptance`

Любая работа, меняющая поведение или вид продукта, начинается с файла
критериев, до первой строки кода. Скилл `acceptance` описывает порядок;
команда:

```
node E:/projects/claude-marketplace/plugins/acceptance/scripts/acceptance.mjs <list|new|show|lint|approve|freeze|unfreeze|verified>
```

Файлы — `docs/acceptance/<slug>.md` в проекте. `feature` и `ui` не начинаются
без ответа инженера (`--evidence` — дословно). Неверный критерий
размораживается с причиной, а не правится молча. В новом проекте плагин
включается в `.claude/settings.json`:
`"enabledPlugins": { "acceptance@nshvyryaev-claude-marketplace": true }`.

## Проверки в браузере — плагин `verify-web`

Сценарии (`verify/scenarios/*.mjs`), эталоны снимков и снимки для осмотра.
Запуск — движок из исходников маркетплейса (кэш плагина бывает старым):

```
node E:/projects/claude-marketplace/plugins/verify-web/scripts/verify.mjs [--scenario x] [--zone y] [--update-baseline] [--dark]
```

Нужен запущенный dev-сервер проекта. Для Cocos Creator — `verify-cocos`.

## Аналитика — `analytics-kit`

`E:\projects\analytics-kit`, публичный GitHub `nshvyryaev/analytics-kit`,
подключается тегом: `"analytics-kit": "github:nshvyryaev/analytics-kit#vX.Y.Z"`
(и в клиенте, и в сервере). Три части: браузерный транспорт, приёмник с
SQLite, общий словарь событий `src/schema.mjs`.

- Новое событие — объявить в `schema.mjs`, тест, новая версия, тег, push,
  обновить пакет в проекте (`npm install "analytics-kit@github:…#vX.Y.Z"` —
  простой `npm install` держится за старый коммит из lock-файла), деплой.
  Необъявленное событие пишется с `known = 0` и не попадает в свёртку.
- Данные в бою читаются **только на чтение** скриптом через stdin в контейнер
  сервера (`docker compose exec -T server node -`), база открывается с
  `readOnly: true`. Образцы — `word-chain/tmp` и `word-chain/scripts`.

## A/B-эксперименты — `ab-kit`

`E:\projects\ab-kit`, публичный GitHub `nshvyryaev/ab-kit`, подключается тегом
так же. Детерминированное закреплённое назначение, подменяемое хранилище
(SQLite, память; новая БД проходит `runStoreContract`), ручка
`POST /v1/ab/assign`, клиент с кешем, `compareProportions` и `sampleSize`.
Реализация на JS в `js/`, общий алгоритм и векторы — в `spec/` (место под
другой язык рядом).

- **Как вести эксперимент** — `E:\projects\ab-kit\docs\guide.md`: карточка,
  расчёт выборки, конфиг, запуск, сверка долей, промежуточный взгляд без
  остановки по p, итог, уборка.
- Единица эксперимента — тот же псевдоним игрока, что у аналитики
  (`resolveUnit` хозяина), показ — событие `ab_exposure`.
- В проекте — папка `docs/experiments/`, карточка на эксперимент. Образец —
  `word-chain`: `server/src/experiments.mjs`, `server/src/ab.mjs`,
  `src/experiments.ts`, `scripts/ab-report.js`.

## Деплой и хостинг — единый учёт `E:\projects\infra`

Не код, а учёт: что где развёрнуто, порты, чем деплоится, где секреты.
Читать **до** любой работы с сервером.

- `servers/<машина>.md` — машина, ресурсы, **таблица портов**. Новое
  приложение берёт порт оттуда, а не наугад. Память машины — 2 ГБ на всё:
  второй Postgres не ставить, лучше SQLite или база в существующем.
- `apps/<приложение>.md` — адрес, каталог на сервере, порты, как ставится и
  обновляется. Новое приложение — новый файл здесь.
- `nginx/` — копии вхостов; новый вхост и сертификат:
  `CERTBOT_EMAIL=<адрес> node nginx/apply.mjs <домен>`.
- `secrets.md` — только имена и места секретов, никогда значения.

Деплой приложения — его собственная команда, записанная в `apps/<приложение>.md`
(в `word-chain` — `npm run deploy`: сборка клиента, архив HEAD, раскладка,
пересборка образа, проверка `/healthz` изнутри и снаружи). Деплоится
закоммиченный `HEAD` — сначала коммит.

## Машина и SSH (Windows)

Сервер `root@83.217.202.175`, ключ `C:/Users/ПК/.ssh/nikitagsh`. `HOME` в
этой среде указывает в `C:\WINDOWS\system32\config\systemprofile`, поэтому
путь к ключу и `UserKnownHostsFile` всегда явно:

```
ssh -i "C:/Users/ПК/.ssh/nikitagsh" -o UserKnownHostsFile="C:/Users/ПК/.ssh/known_hosts" root@83.217.202.175 "<команда>"
```

Боевая машина: читать можно скриптами только на чтение; запись, перезапуск
и правка — только через деплой проекта или с явного согласия инженера.
