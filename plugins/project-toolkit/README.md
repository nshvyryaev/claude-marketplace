# project-toolkit

Один скилл — карта общих инструментов, которыми пользуются все проекты:
критерии приёмки (`acceptance`), проверки в браузере (`verify-web`),
аналитика (`analytics-kit`), A/B-эксперименты (`ab-kit`), деплой и хостинг
через единый учёт `E:\projects\infra`.

Включается глобально, для всех проектов:

```
claude plugin install project-toolkit@nshvyryaev-claude-marketplace --scope user
```

Скилл ничего не делает сам — он указывает на готовый инструмент, чтобы агент
в новом проекте не изобретал своё. Новый общий инструмент — новый раздел в
`skills/project-toolkit/SKILL.md`.
