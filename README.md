# Иишница

[![PR Checks](https://github.com/pastukhov/iishnitsa/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/pastukhov/iishnitsa/actions/workflows/pr-checks.yml)
[![codecov](https://codecov.io/gh/pastukhov/iishnitsa/branch/main/graph/badge.svg)](https://codecov.io/gh/pastukhov/iishnitsa)
[![APK](https://img.shields.io/badge/APK-latest-brightgreen)](https://github.com/pastukhov/iishnitsa/releases/download/apk-latest/iishnitsa.apk)

Иишница — приложение с клиентом на Expo/React Native. Проект рассчитан на локальную разработку и сборку под разные окружения.

## Возможности

- Единый интерфейс чата с настройками подключения.
- Поддержка MCP-инструментов через конфиг в приложении.
- Запуск мобильного клиента (Expo).

## Структура проекта

- `client/` — мобильный клиент на Expo (точка входа: `client/App.tsx`).
- `assets/` — статические ресурсы.
- `scripts/` — вспомогательные скрипты сборки.

## Быстрый старт

1. Установите зависимости:

```bash
npm install
```

2. Запустите нужный режим:

```bash
npm run expo:dev
```

## Основные команды

- `npm run expo:dev` — запуск Expo dev-сервера.
- `npm run expo:static:build` — сборка статического Expo-бандла.
- `npm install eas-cli` — установка EAS CLI (разово, для сборок APK).
- `./node_modules/.bin/eas login` — авторизация EAS CLI (разово).
- `./node_modules/.bin/eas build --platform android --profile preview` — сборка APK через EAS.
- `npm run lint` / `npm run lint:fix` — линтинг и автоисправления.
- `npm run check:types` — проверка типов TypeScript.

## EAS и MCP

- Профили сборки задаются в `eas.json`; актуальный для APK — `preview`.
- Для автоматизации доступны Expo MCP-инструменты (документация и EAS workflow-помощник).

## Настройка

- Параметры API и MCP задаются в разделе Settings внутри приложения.
- Секреты храните в окружении и не коммитьте в репозиторий.

## CI/CD

### Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Feature   │     │  PR Checks  │     │   Release   │     │  Build APK  │
│   Branch    │────▶│             │────▶│             │────▶│             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
      │                   │                   │                   │
   push              pull_request        push to main          tag push
      │                   │                   │                   │
      ▼                   ▼                   ▼                   ▼
  Auto PR            lint, types,        create tag           EAS build
                     tests, format        vX.Y.Z              + release
```

### Workflows

| Workflow                   | Триггер                | Назначение                                      |
| -------------------------- | ---------------------- | ----------------------------------------------- |
| **PR Checks**              | `pull_request` to main | Lint, typecheck, format, tests, commitlint      |
| **Release**                | `push` to main         | Вычисляет версию, создаёт тег, запускает сборку |
| **Build APK**              | `tag` push `v*`        | Собирает APK через EAS, публикует релиз         |
| **Auto PR**                | `push` to branch       | Автоматически создаёт PR                        |
| **Delete Merged Branches** | PR closed              | Удаляет ветку после merge                       |

### Секреты

| Секрет          | Назначение                     |
| --------------- | ------------------------------ |
| `EXPO_TOKEN`    | Токен для EAS CLI (сборка APK) |
| `CODECOV_TOKEN` | Токен для загрузки coverage    |

### Версионирование

Версии вычисляются автоматически по [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` → minor bump (1.0.0 → 1.1.0)
- `fix:` → patch bump (1.0.0 → 1.0.1)
- `feat!:` или `BREAKING CHANGE:` → major bump (1.0.0 → 2.0.0)

## Вклад

- Держите изменения небольшими и локальными.
- Перед PR укажите назначение, описание изменений и шаги проверки.
- Избегайте коммита артефактов сборки (`dist/`).

## Лицензия

Если нужна лицензия, добавьте файл `LICENSE` и укажите её тип.
