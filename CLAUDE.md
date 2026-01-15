# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Iishnitsa is a mobile AI chat application built with Expo/React Native. It provides a unified chat interface supporting multiple AI providers (OpenAI, Anthropic, Together, Mistral, Perplexity, etc.) with MCP (Model Context Protocol) tool integration.

## Commands

```bash
# Development
npm run expo:dev          # Start Expo dev server

# Quality checks
npm run lint              # Run ESLint
npm run lint:fix          # Auto-fix lint issues
npm run check:types       # TypeScript type check
npm run check:format      # Prettier check
npm run format            # Auto-format code

# Provider testing
npm run check:providers        # Test AI provider connectivity (requires API keys in env)
npm run check:providers:mock   # Test with mocked providers (for CI)

# APK build (requires EAS setup)
./node_modules/.bin/eas build --platform android --profile preview
```

## Architecture

### Directory Structure
- `client/` — Expo/React Native mobile app
  - `App.tsx` — Root component with providers (React Query, Navigation, SafeArea)
  - `lib/` — Core business logic
  - `screens/` — Main app screens
  - `navigation/` — React Navigation setup (drawer-based)
  - `components/` — Reusable UI components
- `scripts/` — Build and CI helper scripts

### Key Modules

**State Management** (`client/lib/store.ts`)
- Zustand store managing chats, settings, MCP server configurations
- Persists to AsyncStorage
- Handles MCP collections (groups of MCP servers)

**AI Provider Integration** (`client/lib/providers.ts`, `client/lib/api.ts`)
- Multi-provider support with provider-specific auth headers and base URLs
- Streaming chat completions via OpenAI-compatible API
- Provider configs define auth format (Bearer, Api-Key, etc.)

**MCP Integration** (`client/lib/mcp-client.ts`)
- JSON-RPC client for MCP servers
- Caches initialized clients per server
- Tools converted to OpenAI function format for chat completions
- Session and auth token management

### Data Flow
1. User sends message → `sendChatMessage()` in `api.ts`
2. If MCP enabled, fetches tools from configured servers
3. Streams response; if tool calls detected, executes via MCP client
4. Recursive processing until no more tool calls (max depth 10)

## Conventions

- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
- Branch names: two words joined with hyphen (e.g., `mcp-collections`)
- Path aliases: `@/*` → `./client/*`, `@shared/*` → `./shared/*`
- Formatting: Prettier with double quotes, 2-space indent

## CI/CD

- PR checks required before merge to `main`
- Releases triggered by `vX.Y.Z` tags → EAS APK build
- `EXPO_TOKEN` secret required for automated builds

## Feature Implementation Workflow

> **ОБЯЗАТЕЛЬНО:** При получении задачи на реализацию фичи, исправление бага или рефакторинг — всегда следуй цепочке субагентов ниже. Не пропускай этапы Explore и Plan.

Разработка ведётся по **Trunk-Based Development (TBD)**:
- Единственная основная ветка — `main`
- Короткоживущие feature-ветки (часы, не дни)
- Маленькие, атомарные PR
- Частые мержи в main
- Никаких долгоживущих веток

### Выбор модели для субагентов

> **ОБЯЗАТЕЛЬНО:** Всегда выбирай наиболее дешёвую модель, способную решить задачу.

Доступные модели (от дешёвой к дорогой):
| Модель | Стоимость | Когда использовать |
|--------|-----------|-------------------|
| `haiku` | $ | Простые задачи: поиск файлов, чтение кода, форматирование, простые правки |
| `sonnet` | $$ | Стандартные задачи: анализ кода, планирование, написание тестов, рефакторинг |
| `opus` | $$$ | Сложные задачи: архитектурные решения, сложная отладка, критический код |

**Примеры выбора:**
```
# haiku — достаточно для:
- Explore: поиск файлов по паттерну
- Grep/Glob операции
- Простое чтение и понимание кода
- Форматирование и линтинг

# sonnet — нужен для:
- Plan: планирование реализации
- Написание бизнес-логики
- Code review
- Написание тестов

# opus — только для:
- Сложная архитектура с trade-offs
- Отладка неочевидных багов
- Критически важный код (безопасность, производительность)
```

**Правило:** Начинай с `haiku`. Если задача требует более глубокого анализа — переключайся на `sonnet`. Используй `opus` только когда sonnet недостаточно.

Типичная цепочка субагентов для реализации фичи:

### 1. Explore (Анализ)
```
subagent_type: Explore
model: haiku  # достаточно для поиска и чтения
Задача: Исследовать кодовую базу для понимания контекста
```
- Найти связанные файлы и компоненты
- Понять существующие паттерны (стили, навигация, стейт)
- Определить точки интеграции новой фичи
- Выявить зависимости и потенциальные конфликты

**Ключевые места для анализа:**
- `client/lib/store.ts` — если фича требует нового состояния
- `client/lib/api.ts` — если нужны новые API-вызовы
- `client/screens/` — для понимания структуры экранов
- `client/navigation/` — если нужна новая навигация

### 2. Plan (Планирование)
```
subagent_type: Plan
model: sonnet  # требуется анализ и синтез
Задача: Разработать детальный план реализации
```
- Определить изменяемые файлы
- Спроектировать интерфейсы и типы
- Продумать граничные случаи
- Оценить влияние на существующий код

**Выходной артефакт:** Пошаговый план с указанием файлов и изменений

### 3. Bash (Создание ветки)
```
git checkout -b <feature-name>
```
- Имя ветки: два слова через дефис (например, `chat-export`)

### 4. Реализация (последовательно)

**4.1. Типы и интерфейсы**
- Добавить новые типы в `client/lib/store.ts` или создать отдельный файл типов
- Расширить существующие интерфейсы при необходимости

**4.2. Бизнес-логика**
- `client/lib/` — новые утилиты или расширение существующих
- Zustand actions в `store.ts` для управления состоянием

**4.3. UI компоненты**
- Переиспользовать компоненты из `client/components/`
- Следовать паттернам ThemedText, ThemedView для темизации
- Использовать expo-haptics для тактильной обратной связи

**4.4. Интеграция**
- Добавить экран в `client/screens/`
- Обновить навигацию в `client/navigation/`
- Подключить к существующему UI

### 5. Bash (Проверка качества)
```bash
npm run check:types && npm run lint:fix && npm run check:format
```
- Исправить все ошибки типов
- Применить автоформатирование
- Убедиться что линтер не выдаёт ошибок

### 5.1. Systematic Debugging (при ошибках)
```
subagent_type: systematic-debugging
model: sonnet  # или opus для сложных багов
Задача: Систематический поиск и исправление ошибок
```
Используй когда:
- Тесты падают
- Runtime ошибки
- Неожиданное поведение

Методология:
1. Воспроизвести проблему
2. Сформулировать гипотезы
3. Проверить каждую систематически
4. Изолировать причину
5. Исправить и верифицировать

### 5.2. Senior DevOps (CI/CD и инфра)
```
subagent_type: senior-devops
model: sonnet  # стандартные CI/CD задачи
Задача: Настройка CI/CD, сборки, деплоя
```
Используй когда:
- Изменения в GitHub Actions workflows
- Настройка EAS Build
- Проблемы с CI пайплайном
- Оптимизация сборки

Зона ответственности:
- `.github/workflows/`
- `eas.json`
- `app.json` (build config)
- Секреты и переменные окружения

### 5.3. Senior Prompt Engineer (системные промпты)
```
subagent_type: senior-prompt-engineer
model: sonnet  # требуется понимание нюансов
Задача: Оптимизация промптов и инструкций для AI
```
Используй когда:
- Изменение системного промпта в `store.ts`
- Настройка MCP tool descriptions
- Улучшение качества ответов AI
- Добавление новых AI-возможностей

Принципы:
- Чёткие инструкции
- Структурированный формат
- Примеры использования
- Ограничения и guardrails

### 6. Bash (Коммит и PR)
```bash
git add -A
git commit -m "feat: <описание фичи>"
gh pr create --title "feat: <название>" --body "..."
```

**Шаблон PR:**
```markdown
## Summary
- Что добавлено/изменено

## Test plan
- [ ] Проверить на iOS/Android
- [ ] Проверить граничные случаи
- [ ] Проверить с разными провайдерами (если затронуто)
```

### Пример цепочки для фичи "Экспорт чата"

```
1. Explore → найти как работает текущий чат, формат сообщений в store
2. Plan → определить формат экспорта (JSON/текст), UI кнопки, share API
3. Bash → git checkout -b chat-export
4. Код:
   - store.ts: добавить action exportChat()
   - ChatScreen.tsx: добавить кнопку в header
   - Использовать expo-sharing для шаринга
5. Bash → npm run check:types && npm run lint:fix
6. Bash → git commit + gh pr create
```

### Параллельное выполнение

Некоторые этапы можно запускать параллельно:
- Explore нескольких областей кодовой базы одновременно
- Проверки (types, lint, format) в одном вызове через `&&`

### Откат при ошибках

Если проверки падают:
1. Прочитать вывод ошибки
2. Исправить код
3. Повторить проверки
4. Не коммитить с ошибками типов или линтера
