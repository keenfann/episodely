# Episodely

[![Build and Publish Docker Image](https://github.com/keenfann/episodely/actions/workflows/docker-publish.yml/badge.svg?branch=main)](https://github.com/keenfann/episodely/actions/workflows/docker-publish.yml)

Episodely is a self-hosted web app for tracking watched TV series. It aims to provide the core watch tracking flow of TV Time with a local-first setup, plus calendar views for upcoming releases and import/export to make migration easy. Episodely is created to replace TV Time and is developed primarily with OpenAI Codex.

Status: early-stage repository with a working local stack. Expect changes as features expand.

## Goals
- Simple, fast watch tracking for TV series
- Calendar views for upcoming episodes and releases
- Easy import/export for migration in and out
- Self-hosted and Docker-first, similar to the *arr suite

## Features
- Track watched/unwatched status, seasons, and episodes
- Release calendar for upcoming episodes
- Import/export for backups and migration
- Multi-user support with profiles
- TVmaze metadata and imagery (no API key required)
- Show lists grouped by status (watch next, queued, up to date, completed, planned)

## Stack
- UI: React + Vite
- Backend: Node.js + Express
- Storage: SQLite

## Quick Start (Local)
Requirements: Node.js 22+

- `npm install`
- `npm run dev` starts Vite (web) and the Express API together
- `npm run build` builds the UI to `dist/`
- `npm run start` serves the API and the built UI from one process

The API is available at `http://localhost:3000/api/health` during development.

### First run
- Create an account and log in.
- Create or select a profile.
- Search TVmaze and add shows to your queue.

## Quick Start (Docker)
- `docker compose up`
- Visit `http://localhost:3000`

Set `DB_PATH` in `compose.yaml` or a `.env` file (see `.env.example`). The server generates and stores `SESSION_SECRET` on first start, and the Compose file pulls `ghcr.io/keenfann/episodely:latest` on start.

## Project Structure
- `src/` React UI
- `server/` Express API
- `db/` SQLite database files (local only)
- `data/` Docker volume mount for SQLite
- `vite.config.js` Vite config and API proxy

## Import and Export
Import and export are available in Settings. Exports are JSON backups that can be imported into another instance. Imports also accept a CSV of TVmaze IDs (one per line).

## Roadmap
- MVP watch tracking
- Calendar views
- Import/export workflows
- Polish and integrations

## Contributing
Issues and PRs are welcome. If you plan to work on a larger change, open an issue first to align on scope.

## License
See `LICENSE`.
