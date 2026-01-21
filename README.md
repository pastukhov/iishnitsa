# Иишница

[![PR Checks](https://github.com/pastukhov/iishnitsa/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/pastukhov/iishnitsa/actions/workflows/pr-checks.yml)
[![codecov](https://codecov.io/gh/pastukhov/iishnitsa/branch/main/graph/badge.svg)](https://codecov.io/gh/pastukhov/iishnitsa)
[![APK](https://img.shields.io/badge/APK-latest-brightgreen)](https://github.com/pastukhov/iishnitsa/releases/download/apk-latest/iishnitsa.apk)

Иишница — приложение с клиентом на Expo/React Native. Проект рассчитан на локальную разработку и сборку под разные окружения.

## Возможности

- Единый интерфейс чата с поддержкой множества AI-провайдеров (OpenAI, Anthropic, Together, Mistral, Perplexity, DeepSeek, Groq, Yandex и др.)
- Поддержка MCP-инструментов (Model Context Protocol) через конфиг в приложении
- Прикрепление изображений к сообщениям
- Тёмная и светлая темы
- Персистентное хранение чатов и настроек

## Промпты

Коллекция промптов для выбора при старте чата синхронизируется из репозитория
[awesome-ai-prompts](https://github.com/0x2e-Tech/awesome-ai-prompts) и
генерируется скриптом `npm run sync:prompts`. Данные сохраняются в
`client/lib/prompts-data.ts` и используются через `client/lib/prompts.ts`.

## Архитектура приложения

### Общая структура

```mermaid
graph TB
    subgraph "UI Layer"
        App[App.tsx<br/>Providers: Query, Navigation, SafeArea]
        Nav[Navigation<br/>RootStack → Drawer]
        Screens[Screens<br/>Chat, Settings, About]
        Components[Components<br/>ThemedText, Button, Card]
    end

    subgraph "Business Logic Layer"
        Store[Store<br/>Zustand + AsyncStorage<br/>Chats, Settings, MCP]
        API[API<br/>sendChatMessage<br/>Streaming + Tools]
        Providers[Providers<br/>11 AI Providers<br/>Auth Configs]
        MCP[MCP Client<br/>JSON-RPC<br/>Tool Execution]
    end

    subgraph "External Services"
        AIProvider[AI Provider APIs<br/>OpenAI, Anthropic, etc.]
        MCPServers[MCP Servers<br/>External Tools]
    end

    App --> Nav
    Nav --> Screens
    Screens --> Components
    Screens --> Store
    Screens --> API
    API --> Providers
    API --> MCP
    Providers --> AIProvider
    MCP --> MCPServers
    Store -.persists.-> AsyncStorage[(AsyncStorage)]
```

### Навигация

```mermaid
graph LR
    Root[RootStackNavigator] --> Drawer[DrawerNavigator]

    Drawer --> Chat[ChatScreen<br/>Main conversation]
    Drawer --> Settings[SettingsScreen<br/>Modal]
    Drawer --> About[AboutScreen<br/>Modal]

    DrawerContent[Drawer Content] -.lists.- Chats[(Chat History)]
    DrawerContent -.actions.- NewChat[New Chat]
    DrawerContent -.footer.- SettingsLink[Settings]
    DrawerContent -.footer.- AboutLink[About]
```

### Data Flow: Отправка сообщения

```mermaid
sequenceDiagram
    participant U as User
    participant S as ChatScreen
    participant API as api.ts
    participant MCP as mcp-client.ts
    participant P as Providers
    participant AI as AI Provider API
    participant Store as store.ts

    U->>S: Отправить сообщение
    S->>Store: addMessage(user)
    S->>API: sendChatMessage()

    alt MCP включен
        API->>MCP: fetchToolsFromServers()
        MCP-->>API: Список tools
    end

    API->>P: buildAuthHeaders()
    P-->>API: Auth headers

    API->>AI: POST /chat/completions (streaming)

    loop Streaming chunks
        AI-->>API: SSE chunk
        API->>Store: updateMessage(assistant, partial)
        Store-->>S: Re-render с новым текстом
    end

    alt Tool calls обнаружены
        API->>MCP: executeToolCall()
        MCP-->>API: Tool result
        API->>AI: POST /chat/completions (с результатом)
        Note over API,AI: Рекурсия до 10 уровней
    end

    API-->>S: Завершено
    S->>Store: finalizeMessage()
```

### Ключевые модули

```mermaid
graph TD
    subgraph "store.ts"
        ChatState[Chat State<br/>messages, title]
        Settings[Settings<br/>provider, apiKey, model]
        MCPConfig[MCP Config<br/>servers, tokens]
    end

    subgraph "api.ts"
        SendMsg[sendChatMessage<br/>Orchestrator]
        Process[processConversation<br/>Recursive tool handling]
        Stream[Stream Parser<br/>SSE chunks]
    end

    subgraph "providers.ts"
        ProviderList[11 Providers<br/>OpenAI, Anthropic, etc.]
        AuthBuilder[buildAuthHeaders<br/>Bearer/Api-Key/Token]
        BaseURLs[Base URLs<br/>per provider]
    end

    subgraph "mcp-client.ts"
        MCPClient[MCPClient<br/>JSON-RPC 2.0]
        ClientCache[Client Cache<br/>per server URL]
        ToolConvert[mcpToolsToOpenAIFunctions<br/>Format converter]
    end

    SendMsg --> Process
    Process --> Stream
    Process --> MCPClient
    SendMsg --> AuthBuilder
    SendMsg --> ProviderList
    MCPClient --> ToolConvert
```

## Структура проекта

- `client/` — мобильный клиент на Expo
  - `App.tsx` — точка входа с провайдерами (React Query, Navigation, SafeArea)
  - `lib/` — бизнес-логика (store, api, providers, mcp-client)
  - `screens/` — экраны приложения (Chat, Settings, About)
  - `navigation/` — настройка навигации (drawer)
  - `components/` — переиспользуемые UI-компоненты
  - `hooks/` — кастомные хуки (useTheme, useColorScheme)
  - `constants/` — константы (theme, releaseNotes)
- `scripts/` — вспомогательные скрипты сборки
- `assets/` — статические ресурсы

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

```bash
# Разработка
npm run expo:dev              # Запуск Expo dev-сервера

# Качество кода
npm run lint                  # ESLint проверка
npm run lint:fix              # ESLint с автоисправлением
npm run check:types           # Проверка типов TypeScript
npm run check:format          # Проверка форматирования Prettier
npm run format                # Автоформатирование кода

# Тестирование
npm test                      # Запуск Jest тестов
npm run test:watch            # Тесты в watch-режиме
npm run test:coverage         # Тесты с отчётом покрытия

# Проверка провайдеров
npm run check:providers       # Тест подключения к AI-провайдерам
npm run check:providers:mock  # Тест с моками (для CI)

# Промпты
npm run sync:prompts          # Синхронизация списка промптов

# Сборка
npm run expo:static:build     # Сборка статического бандла
```

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
   push              pull_request         PR merged          workflow_dispatch
      │                   │                   │                   │
      ▼                   ▼                   ▼                   ▼
  Auto PR            lint, types,        create tag          Gradle build
                     tests, format        vX.Y.Z              + release
```

### Workflows

| Workflow                   | Триггер                          | Назначение                                      |
| -------------------------- | -------------------------------- | ----------------------------------------------- |
| **PR Checks**              | `pull_request` to main           | Lint, typecheck, format, tests, commitlint      |
| **Release**                | `push` to main / merged PR       | Вычисляет версию, создаёт тег, запускает сборку |
| **Build APK**              | triggered by Release             | Собирает APK через Gradle, публикует релиз      |
| **Auto PR**                | `push` to branch                 | Автоматически создаёт PR                        |
| **Delete Merged Branches** | PR merged                        | Удаляет ветку после merge                       |

### Секреты

| Секрет          | Назначение                  |
| --------------- | --------------------------- |
| `CODECOV_TOKEN` | Токен для загрузки coverage |

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
