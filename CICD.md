# Проектирование полностью автоматизированного CI/CD для Android-приложения

## 1. Цель

Спроектировать и внедрить end‑to‑end CI/CD pipeline для **Android-приложения**
(APK/AAB), в котором:

- разработка ведётся по **Trunk‑Based Development (TBD)**:
  - trunk = `main`;
  - для каждой задачи создаются короткоживущие ветки `task/*`,
    живущие часы–1‑2 дня;
  - незавершённый функционал прячется за feature‑флагами;
- каждая задача реализуется в отдельной ветке от `main`;
- все Pull Request:
  - автоматически проверяются (линтеры, тесты, сборка, валидации);
  - автоматически попадают в очередь на auto‑merge и мержатся нативным
    GitHub auto‑merge;
- после merge в `main`:
  - автоматически создаётся git‑тег и GitHub Release с APK/AAB;
  - автоматически формируется changelog;
  - версия обновляется по SemVer;
  - информация о версии и changelog встраивается в APK (About‑экран);
- прямой push в `main` запрещён;
- ручное участие требуется только для создания PR.

---

## 2. Базовые принципы архитектуры CI/CD

### Main‑only release flow

- релизы формируются только из ветки `main`;
- прямые push в `main` запрещены;
- все изменения попадают в `main` только через PR и auto‑merge.

### Pull Request как единственная точка интеграции

- для каждой задачи создаётся ветка `task/*`;
- интеграция в `main` происходит только через PR `task/* → main`.

### Deterministic automation

- каждый шаг pipeline идемпотентен;
- релизный workflow триггерится только событиями GitHub (`push` в `main`);
- единый источник истины для версии и changelog (semantic‑release).

### Zero‑touch policy

- no manual approval для CI/CD;
- no manual version bump;
- no manual release notes.

---

## 3. Git‑стратегия

### Ветки

- `main` — стабильная, релизная ветка (trunk).
- `task/<id>-<short-description>` — короткоживущая ветка для задач:
  - `<id>` — ID задачи/issue;
  - `<short-description>` — slug (kebab‑case).

### Pull Request

- PR из `task/*` → `main`;
- PR‑шаблон требует:
  - ID задачи;
  - тип: `feat`/`fix`/`chore`/`docs`/`refactor`/`test`/`breaking`;
  - краткое описание.
- PR автоматически:
  - запускает CI;
  - auto‑merge при успехе всех проверок.

### Branch protection для `main`

- Require pull request before merging ✅
- Require status checks: lint, test, build, semantic ✅
- Require branches up to date ✅
- Allow auto‑merge ✅
- Restrict pushes to admins only ✅
- Require approvals ❌

---

## 4. CI: Проверки на PR (`.github/workflows/pr.yml`)

**Триггер:**

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
```

### Static checks

- ktlint / detekt ✅
- `./gradlew spotlessCheck` ✅
- `./gradlew lint` ✅
- Gradle config validation ✅

### Tests

- `./gradlew test` (unit + Robolectric) ✅
- `./gradlew connectedDebugAndroidTest` (smoke UI) ✅
- API 24+ эмулятор для инструментальных тестов ✅

### Build verification

- `./gradlew assembleDebug` ✅
- APK проверяется на валидность (aabundletool) ✅

### Semantic validation

- PR title по Conventional Commits ✅
- Обязательные labels: type:feat/fix/breaking ✅
- commitlint для squashed сообщений ✅

**Результат:** все 4 джобы required → PR auto‑mergeable.

---

## 5. Автоматический merge

**Нативный GitHub auto‑merge:**

- squash merge (одна запись в истории `main`);
- срабатывает автоматически при зелёных статусах;
- `Require branches up to date` предотвращает race conditions.

---

## 6. Versioning (SemVer)

**Инструмент:** `semantic-release` с GitHub Action.

### Правила

| Тип коммита  | Bump  | Пример          |
|--------------|-------|-----------------|
| `feat:*`     | minor | 1.0.0 → 1.1.0   |
| `fix:*`      | patch | 1.0.0 → 1.0.1   |
| `BREAKING!`  | major | 1.0.0 → 2.0.0   |
| `docs/chore` | —     | no bump         |

### Алгоритм

1. На `push main` → semantic‑release анализирует PR/commits
2. Вычисляет `v1.4.0` → создаёт git tag
3. Экспортирует `RELEASE_VERSION=1.4.0`, `RELEASE_NOTES`

---

## 7. Release pipeline (`.github/workflows/release.yml`)

**Триггер:**

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch: # ручной триггер для хотфиксов
```

### Шаги

#### 7.1 Semantic Release

```text
semantic-release → v1.4.0 + changelog + git tag
env: RELEASE_VERSION, RELEASE_NOTES
```

#### 7.2 Generate About data

```json
{
  "version": "1.4.0",
  "buildNumber": 10400,
  "date": "2026-01-26T18:34:00Z",
  "changelog": [
    {"type": "feat", "summary": "Новый экран задач"},
    {"type": "fix", "summary": "Исправлен крэш настроек"}
  ]
}
```

→ `app/src/main/assets/about.json`

#### 7.3 Android build

```bash
versionName=$RELEASE_VERSION
versionCode=10400  # major*10000 + minor*100 + patch

./gradlew bundleRelease
./gradlew assembleRelease
```

#### 7.4 GitHub Release

- tag: v1.4.0
- APK + AAB attached
- Markdown changelog в body

---

## 8. About‑экран

**Генерация:** build‑time из `assets/about.json`

**Чтение в коде:**

```kotlin
// MainActivity.kt
val about = assets.open("about.json").use {
    Gson().fromJson(it.reader(), AboutData::class.java)
}
```

**Отображение:** версия + дата + последние 5 записей changelog.

---

## 9. Безопасность

**pr.yml:**

```yaml
permissions:
  contents: read
  pull-requests: write
```

**release.yml:**

```yaml
permissions:
  contents: write
  packages: write
```

**Secrets:**

- `ANDROID_KEYSTORE_BASE64`
- `KEYSTORE_PASSWORD`
- `KEY_ALIAS`
- `KEY_PASSWORD`

---

## 10. Расширяемость

- Beta channel (task/beta → v1.4.0-beta.1) ✅
- Google Play internal testing ✅
- Feature flags в about.json ✅
- Nightly builds из main@nightly ✅
- MCP agents (read-only доступ к releases) ✅

---

## 11. Файлы для внедрения

```text
.github/workflows/
├── pr.yml          # CI проверки PR
├── release.yml     # SemVer + APK release
└── nightly.yml     # Опционально: daily builds


android/commitlint.config.js
```

---

## 12. Критерий успеха

1. `git checkout -b task/123-new-feature main`
2. `git push` → PR auto‑создаётся
3. CI зелёный → auto‑merge в main
4. v1.4.0 + APK в GitHub Releases
5. About‑экран показывает версию + changelog
