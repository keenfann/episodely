import db from '../../server/db.js';

function toNumber(value) {
  return typeof value === 'bigint' ? Number(value) : value;
}

export function resetDb() {
  db.exec(`
    DELETE FROM profile_episodes;
    DELETE FROM profile_shows;
    DELETE FROM episodes;
    DELETE FROM shows;
    DELETE FROM profiles;
    DELETE FROM users;
    DELETE FROM sessions;
  `);
}

export function createShow({
  tvmazeId,
  name,
  summary = '',
  status = 'Running',
  premiered = null,
  ended = null,
  imageMedium = null,
  imageOriginal = null,
  updatedAt = new Date().toISOString(),
}) {
  const result = db
    .prepare(
      `INSERT INTO shows
        (tvmaze_id, name, summary, status, premiered, ended, image_medium, image_original, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      tvmazeId,
      name,
      summary,
      status,
      premiered,
      ended,
      imageMedium,
      imageOriginal,
      updatedAt
    );
  return toNumber(result.lastInsertRowid);
}

export function createEpisode({
  showId,
  tvmazeId,
  season,
  number,
  name,
  summary = '',
  airdate = null,
  airtime = null,
  runtime = null,
  imageMedium = null,
  imageOriginal = null,
}) {
  const result = db
    .prepare(
      `INSERT INTO episodes
        (show_id, tvmaze_id, season, number, name, summary, airdate, airtime, runtime, image_medium, image_original)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      showId,
      tvmazeId,
      season,
      number,
      name,
      summary,
      airdate,
      airtime,
      runtime,
      imageMedium,
      imageOriginal
    );
  return toNumber(result.lastInsertRowid);
}

export function linkProfileShow({
  profileId,
  showId,
  createdAt = new Date().toISOString(),
  status = null,
}) {
  db.prepare(
    `INSERT INTO profile_shows (profile_id, show_id, created_at, status)
     VALUES (?, ?, ?, ?)`
  ).run(profileId, showId, createdAt, status);
}

export function markEpisodeWatched({
  profileId,
  episodeId,
  watchedAt = new Date().toISOString(),
}) {
  db.prepare(
    `INSERT INTO profile_episodes (profile_id, episode_id, watched_at)
     VALUES (?, ?, ?)`
  ).run(profileId, episodeId, watchedAt);
}
