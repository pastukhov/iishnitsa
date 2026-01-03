Ты эксперт GitHub Actions. У меня ЕСТЬ существующие workflows в `.github/workflows/*.yml`. АДАПТИРУЙ их под мой Expo/React Native проект мобильного ассистента (OpenAI + MCP -> APK через EAS).

Текущий проект детали:
- Expo/React Native клиент в `client/` (entry: `client/App.tsx`, `client/index.js`).
- Web renderer в `src/` (entry: `src/main.tsx`, стили в `src/styles/`).
- Build артефакты: `dist/` (не редактировать вручную).
- Версия хранится в `app.json` -> `expo.version`, Android versionCode вычисляется из semver.
- EAS профили в `eas.json` (используется `preview` для APK).

Ключевые команды:
- `npm run lint` / `npm run lint:fix`
- `npm run check:types`
- `npm run check:format` / `npm run format`
- `npm run check:providers` / `npm run check:providers:mock`
- `npm run expo:dev`
- `npm run expo:static:build`
- `./node_modules/.bin/eas build --platform android --profile preview`

Текущие workflows:
- `commitlint.yml`: commitlint на PR/push в `main`.
- `version-tag.yml`: проверки (lint, types, format, providers:mock), semver bump по conventional commits, обновление `app.json`/`eas.json`, тег `vX.Y.Z`, релиз и dispatch `apk-build.yml`.
- `apk-build.yml`: EAS build по тегу `v*`, скачивание APK и публикация в GitHub Releases.
- `pr-tag-apk.yml`: теги вида `vX.Y.Z-branch` для PR.
- `auto-pr.yml`: автосоздание PR из веток в `main`.

Секреты:
- `EXPO_TOKEN` обязателен для EAS build.
- Для реальных provider checks нужны `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY`, `PERPLEXITY_API_KEY`, `YANDEX_API_KEY`, `REPLICATE_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `DASHSCOPE_API_KEY` (в CI обычно используем `check:providers:mock`).

Ожидания по изменениям:
1. Сохраняй существующие jobs/steps и добавляй новые параллельно.
2. В PR на `main` должны проходить lint, types, format, commitlint и provider checks (mock).
3. В `main` нужен semver tag по conventional commits, обновление версий в `app.json`/`eas.json`.
4. Релизный тег `v*` должен приводить к EAS сборке APK и публикации в GitHub Releases.
