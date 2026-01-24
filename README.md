# Episodely

Episodely is a self-hosted web app for tracking watched TV series and movies. It aims to provide the core watch tracking flow of TV Time with a local-first setup, plus calendar views for upcoming releases and import/export to make migration easy.

Status: early-stage repository. Features and setup will expand as development progresses.

## Goals
- Simple, fast watch tracking for series and movies
- Calendar views for upcoming episodes and releases
- Easy import/export for migration in and out
- Self-hosted and Docker-first, similar to the *arr suite

## Planned Features
- Track watched/unwatched status, seasons, and episodes
- Release calendar with notifications and filters
- Import/export for common formats and services
- Multi-user support with profiles
- Backups and data portability

## Stack
- UI: React + Vite
- Backend: Node.js + Express
- Storage: SQLite (planned)

## Quick Start (Local)
Requirements: Node.js 18+

- `npm install`
- `npm run dev` starts Vite (web) and the Express API together
- `npm run build` builds the UI to `dist/`
- `npm run start` serves the API and the built UI from one process

The API is available at `http://localhost:3000/api/health` during development.

## Project Structure
- `src/` React UI
- `server/` Express API
- `db/` SQLite database files (local only)
- `vite.config.js` Vite config and API proxy

## Import and Export
Import and export will be first-class features to help you migrate data. Planned formats will be documented here once implemented.

## Roadmap
- MVP watch tracking
- Calendar views
- Import/export workflows
- Polish and integrations

## Contributing
Issues and PRs are welcome. If you plan to work on a larger change, open an issue first to align on scope.

## License
See `LICENSE`.
