# Requirements

## Product Summary
Episodely is a self-hosted web app for tracking watched TV series. It provides a simple watch-tracking workflow, a calendar for upcoming releases, and import/export to move data in or out easily. It is intended to run locally via Docker, similar to the *arr suite.

## Core Features
- Track TV series
- Mark watched/unwatched status
- Track seasons and episodes
- User management (accounts, login, multiple profiles)
- Shows area includes watched and queued lists
- Shows track status states:
  - Released episodes remaining (unwatched released episodes)
  - Up to date with planned future episodes
  - Completed (all episodes watched, show ended)
- Show detail view includes synopsis and episode list grouped by season
- Episode metadata is displayed per episode
- Episodes can be marked watched/unwatched
- Seasons can be marked watched/unwatched (bulk toggle of episodes)
- Future planned episodes show air date and days remaining
- If air date is unknown, display as `TBD`
- Main shows page lists "Watch Next" first (started shows with released, unwatched episodes)
- Next, list queued shows that have released episodes but are not started
- Then list watched shows with no more released episodes
- Finally, list completed/ended shows and planned-only shows with no released episodes

## UI Requirements
- Dark mode only
- Use metadata and images from the metadata source when available to enhance the UI
- Calendar view for upcoming episodes and releases
- Import data from other services/formats
- Export data for backups and migration

## Deployment
- Self-hosted using Docker

## Metadata Source
- TMDb (The Movie Database) for TV and movie metadata
- Store the TMDb API key in `.env` and never commit it
- Follow TMDb attribution requirements in the UI

## Notes
- Scope is intentionally smaller than the *arr suite.
