# Repository Guidelines

## Project Structure & Module Organization
- `client/` contains the Expo/React Native app (entry: `client/App.tsx`).
- `src/` is the web renderer source (entry: `src/main.tsx`, styles in `src/styles/`).
- `assets/` stores static app assets; `dist/` is a build output.
- Root config files include `app.json`, `eas.json`, and `tsconfig*.json`.

## Build, Test, and Development Commands
- `npm run expo:dev`: start the Expo dev server for the mobile client in local Replit-style env.
- `npm run expo:static:build`: build the static Expo bundle (uses `scripts/build.js`).
- `npm install eas-cli`: install EAS CLI (one-time setup for APK builds).
- `./node_modules/.bin/eas login`: authenticate EAS CLI (one-time setup for APK builds).
- `./node_modules/.bin/eas build --platform android --profile preview`: build an Android APK.
- `npm run lint` / `npm run lint:fix`: run ESLint (and auto-fix) for the Expo codebase.
- `npm run check:types`: TypeScript typecheck across the project.
- `npm run check:format` / `npm run format`: Prettier formatting checks and fixes.

## MCP Tooling
- Expo MCP tools are available for documentation lookups and EAS workflow guidance.
- Keep EAS profiles in `eas.json` and default to `preview` for APK builds unless noted otherwise.

## Coding Style & Naming Conventions
- TypeScript/JavaScript with double quotes and 2-space indentation (enforced by Prettier).
- Prefer descriptive, explicit names for components and hooks (e.g., `ChatView`, `useStore`).
- New scripts should live in `scripts/` and use lowercase names with hyphens.

## Testing Guidelines
- No automated test suite is configured.
- Use `npm run check:types` and `npm run lint` as the primary quality gates.
- If you add tests, document how to run them in this file and update scripts accordingly.

## Commit & Pull Request Guidelines
- Commit messages in history are short, descriptive sentences; keep them scoped and readable.
- For PRs, include: purpose, summary of changes, manual verification steps, and risk notes.
- Link related issues when applicable; include screenshots only for UI changes.

## Security & Configuration Tips
- Avoid committing secrets or local credentials; prefer environment variables for tokens.
- Treat `dist/` as a build artifact and avoid manual edits.
