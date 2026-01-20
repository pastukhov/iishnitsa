# Repository Guidelines

## Project Structure & Module Organization
- `client/` contains the Expo/React Native app (entry: `client/App.tsx`).
- `assets/` stores static app assets; `dist/` is a build output.
- Root config files include `app.json`, `eas.json`, and `tsconfig*.json`.

## Build, Test, and Development Commands
- `npm run expo:dev`: start the Expo dev server for the mobile client in local Replit-style env.
- `npm run expo:static:build`: build the static Expo bundle (uses `scripts/build.js`).
- `npm run sync:prompts`: sync and generate the prompt catalog from awesome-ai-prompts.
- `npm install eas-cli`: install EAS CLI (one-time setup for APK builds).
- `./node_modules/.bin/eas login`: authenticate EAS CLI (one-time setup for APK builds).
- `./node_modules/.bin/eas build --platform android --profile preview`: build an Android APK.
- `npm run lint` / `npm run lint:fix`: run ESLint (and auto-fix) for the Expo codebase.
- `npm run check:types`: TypeScript typecheck across the project.
- `npm run check:format` / `npm run format`: Prettier formatting checks and fixes.

## MCP Tooling
- Expo MCP tools are available for documentation lookups and EAS workflow guidance.
- Keep EAS profiles in `eas.json` and default to `preview` for APK builds unless noted otherwise.

## GitHub Helper
- Use the GitHub CLI (`gh`) to inspect Actions runs, releases, and PR status when troubleshooting CI.
- Always create PR branches from the latest `main` (rebase or update before opening PRs).
- Each PR must be opened from the latest `main` (refresh the branch immediately before creating the PR).
- After a PR is merged, always start a new branch from the latest `main` for the next change.
- Prefer `gh api` for repository queries if standard `gh` commands rely on git in environments where git execution is restricted.

## Coding Style & Naming Conventions
- TypeScript/JavaScript with double quotes and 2-space indentation (enforced by Prettier).
- Prefer descriptive, explicit names for components and hooks (e.g., `ChatView`, `useStore`).
- New scripts should live in `scripts/` and use lowercase names with hyphens.

## Testing Guidelines
- No automated test suite is configured.
- Use `npm run check:types` and `npm run lint` as the primary quality gates.
- Use `npm run check:providers` to smoke-test provider connectivity (set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY`, `PERPLEXITY_API_KEY`, `YANDEX_API_KEY`, `REPLICATE_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `DASHSCOPE_API_KEY`; optional per-provider `*_BASE_URL` overrides and `ANTHROPIC_MODEL`/`PERPLEXITY_MODEL`).
- Use `npm run check:providers:mock` (or `MOCK_PROVIDERS=1`) to run mocked provider checks when CI secrets are unavailable.
- If you add tests, document how to run them in this file and update scripts accordingly.
- Be proactive: when checks or validations are feasible, run them instead of asking the user to do so.

## Commit & Pull Request Guidelines
- Commit messages must follow Conventional Commits (e.g., `feat: add mcp checks`, `chore(ci): update workflows`).
- Keep commit subjects short and descriptive.
- Branch names should be two words describing the change, joined with a hyphen (e.g., `mcp-collections`).
- PRs are auto-created from branch pushes and auto-merged when required checks are green.
- Open PRs proactively after pushing changes; do not ask the user to open PRs for you.
- Apply branch protection from `branch-protection.json` via `scripts/apply-branch-protection.js` when updating review requirements.
- Protect `main`: require all workflow status checks to pass before merging.
- For PRs, include: purpose, summary of changes, manual verification steps, and risk notes.
- Link related issues when applicable; include screenshots only for UI changes.

## Security & Configuration Tips
- Avoid committing secrets or local credentials; prefer environment variables for tokens.
- Treat `dist/` as a build artifact and avoid manual edits.
