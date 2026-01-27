# Repository Guidelines

## Project Structure & Module Organization
Current layout is a single Node server with a Vite-built UI:
- `src/` React UI code
- `server/` Express API (`server/index.js`)
- `tests/` Vitest suites for API/UI utilities
- `db/` local SQLite files (ignored by git)
- `data/` Docker-mounted SQLite data
- `public/` static assets served by Vite (favicons)
- `scripts/` one-off helpers for imports and maintenance
- `.devcontainer/` development container configuration (Node 22, forwarded ports)
- `index.html`, `vite.config.js`, `package.json` at repo root

If you add a new top-level directory, update this section with a one-line purpose.

## Build, Test, and Development Commands
- `npm install` install dependencies
- `npm run dev` run Vite and the API in parallel
- `npm run build` build the UI to `dist/`
- `npm run preview` preview the UI build
- `npm run start` serve the API and built UI from one process
- `docker compose up --build` build and run the Docker image

The Vite dev server proxies `/api` to `http://localhost:4285` by default (override with `VITE_API_TARGET`).

## Coding Style & Naming Conventions
Keep formatting consistent and easy to scan:
- Indentation: 2 spaces for JS/TS/JSON/YAML/CSS; 4 spaces for scripts; tabs only in Makefiles.
- File and directory names: `kebab-case` (e.g., `release-calendar.ts`).
- Types/components: `PascalCase` (e.g., `EpisodeCard.tsx`).
- Variables/functions: `camelCase`; constants: `UPPER_SNAKE_CASE`.
- Icons: prefer Lucide icons when adding new UI glyphs.

If a formatter or linter is added (e.g., Prettier, ESLint), run it before opening a PR and note deviations.

## Testing Guidelines
Testing framework is TBD. Until then:
- Place tests under `tests/` and mirror `src/` paths.
- Use `*.test.jsx` (or language-appropriate equivalents) for test files.
- New features should include tests or a short PR note explaining why coverage is deferred.
- Write new or updated tests whenever behavior changes or features are added.
- Run tests when building new features (`npm test`); call out if tests were not run.
- Keep tests offline and fast: avoid network calls and long sleeps; mock external APIs.

## Commit & Pull Request Guidelines
Git history only contains an "Initial commit," so no convention exists yet. Use Conventional Commits going forward:
- Examples: `feat: add calendar view`, `fix: handle missing air dates`, `docs: update README`

PRs should include a short summary, linked issue (if any), test steps, and UI screenshots for visual changes. Note any migration or data-impacting changes explicitly.

## Documentation
Keep `README.md` in sync with user-facing behavior, feature lists, and configuration defaults whenever changes are made.

## Security & Configuration
Store configuration in `.env` files and provide a `.env.example` when adding new variables. Current config includes `SESSION_SECRET`, `PORT`, and `DB_PATH`. Never commit secrets; prefer Docker secrets or environment variables in deployment.
