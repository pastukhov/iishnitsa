# Иишница

[![PR Checks](https://github.com/pastukhov/iishnitsa/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/pastukhov/iishnitsa/actions/workflows/pr-checks.yml)
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
1) Установите зависимости:
```bash
npm install
```

2) Запустите нужный режим:
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

## CI
- PR проверки (`PR Checks`) обязательны для merge в `main`.
- Релизы создаются по тегу `vX.Y.Z` и запускают EAS сборку APK.
- GitHub Actions для сборки APK требует секрет `EXPO_TOKEN` (Expo access token).

## Вклад
- Держите изменения небольшими и локальными.
- Перед PR укажите назначение, описание изменений и шаги проверки.
- Избегайте коммита артефактов сборки (`dist/`).

## Лицензия
Если нужна лицензия, добавьте файл `LICENSE` и укажите её тип.
