import bcrypt from 'bcryptjs';
import express from 'express';
import session from 'express-session';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { fetchEpisodes, fetchShow, searchShows } from './tvmaze.js';
import { isReleased, stripHtml } from './utils.js';

const app = express();
const port = process.env.PORT || 4285;

app.use(express.json({ limit: '10mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'episodely-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    },
  })
);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  return next();
}

function requireProfile(req, res, next) {
  if (!req.session.profileId) {
    return res.status(400).json({ error: 'No active profile' });
  }
  return next();
}

function nowIso() {
  return new Date().toISOString();
}

function runTransaction(fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function toNumber(value) {
  return typeof value === 'bigint' ? Number(value) : value;
}

function ensureActiveProfile(req) {
  if (req.session.profileId) {
    return req.session.profileId;
  }
  const user = db
    .prepare('SELECT last_profile_id FROM users WHERE id = ?')
    .get(req.session.userId);
  const lastProfileId = toNumber(user?.last_profile_id);
  if (!lastProfileId) return null;
  const profile = db
    .prepare('SELECT id FROM profiles WHERE id = ? AND user_id = ?')
    .get(lastProfileId, req.session.userId);
  if (!profile) return null;
  req.session.profileId = toNumber(profile.id);
  return req.session.profileId;
}

async function upsertShowWithEpisodes(tvmazeId) {
  const show = await fetchShow(tvmazeId);
  const episodes = await fetchEpisodes(tvmazeId);

  const showPayload = {
    tvmaze_id: show.id,
    name: show.name,
    summary: stripHtml(show.summary),
    status: show.status,
    premiered: show.premiered,
    ended: show.ended,
    image_medium: show.image?.medium || null,
    image_original: show.image?.original || null,
    updated_at: nowIso(),
  };

  const existingShow = db
    .prepare('SELECT id FROM shows WHERE tvmaze_id = ?')
    .get(showPayload.tvmaze_id);

  const insertShow = db.prepare(
    `INSERT INTO shows
      (tvmaze_id, name, summary, status, premiered, ended, image_medium, image_original, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateShow = db.prepare(
    `UPDATE shows
       SET name = ?, summary = ?, status = ?, premiered = ?, ended = ?,
           image_medium = ?, image_original = ?, updated_at = ?
     WHERE tvmaze_id = ?`
  );

  const selectEpisode = db.prepare(
    'SELECT id FROM episodes WHERE tvmaze_id = ?'
  );
  const insertEpisode = db.prepare(
    `INSERT INTO episodes
      (show_id, tvmaze_id, season, number, name, summary, airdate, airtime, runtime, image_medium, image_original)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateEpisode = db.prepare(
    `UPDATE episodes
       SET show_id = ?, season = ?, number = ?, name = ?, summary = ?,
           airdate = ?, airtime = ?, runtime = ?, image_medium = ?, image_original = ?
     WHERE tvmaze_id = ?`
  );

  let showId = existingShow?.id;

  runTransaction(() => {
    if (existingShow) {
      updateShow.run(
        showPayload.name,
        showPayload.summary,
        showPayload.status,
        showPayload.premiered,
        showPayload.ended,
        showPayload.image_medium,
        showPayload.image_original,
        showPayload.updated_at,
        showPayload.tvmaze_id
      );
    } else {
      const result = insertShow.run(
        showPayload.tvmaze_id,
        showPayload.name,
        showPayload.summary,
        showPayload.status,
        showPayload.premiered,
        showPayload.ended,
        showPayload.image_medium,
        showPayload.image_original,
        showPayload.updated_at
      );
      showId = toNumber(result.lastInsertRowid);
    }

    episodes.forEach((episode) => {
      const episodePayload = {
        show_id: showId,
        tvmaze_id: episode.id,
        season: episode.season,
        number: episode.number,
        name: episode.name,
        summary: stripHtml(episode.summary),
        airdate: episode.airdate,
        airtime: episode.airtime,
        runtime: episode.runtime,
        image_medium: episode.image?.medium || null,
        image_original: episode.image?.original || null,
      };

      if (selectEpisode.get(episodePayload.tvmaze_id)) {
        updateEpisode.run(
          episodePayload.show_id,
          episodePayload.season,
          episodePayload.number,
          episodePayload.name,
          episodePayload.summary,
          episodePayload.airdate,
          episodePayload.airtime,
          episodePayload.runtime,
          episodePayload.image_medium,
          episodePayload.image_original,
          episodePayload.tvmaze_id
        );
      } else {
        insertEpisode.run(
          episodePayload.show_id,
          episodePayload.tvmaze_id,
          episodePayload.season,
          episodePayload.number,
          episodePayload.name,
          episodePayload.summary,
          episodePayload.airdate,
          episodePayload.airtime,
          episodePayload.runtime,
          episodePayload.image_medium,
          episodePayload.image_original
        );
      }
    });
  });

  return { showId, showPayload };
}

function listShowsForProfile(profileId) {
  const shows = db
    .prepare(
      `SELECT s.*
       FROM shows s
       JOIN profile_shows ps ON ps.show_id = s.id
       WHERE ps.profile_id = ?
       ORDER BY s.name ASC`
    )
    .all(profileId);

  const episodes = db
    .prepare(
      `SELECT e.*, pe.watched_at
       FROM episodes e
       JOIN profile_shows ps ON ps.show_id = e.show_id
       LEFT JOIN profile_episodes pe
         ON pe.episode_id = e.id AND pe.profile_id = ?
       WHERE ps.profile_id = ?`
    )
    .all(profileId, profileId);

  const episodesByShow = new Map();
  episodes.forEach((episode) => {
    if (!episodesByShow.has(episode.show_id)) {
      episodesByShow.set(episode.show_id, []);
    }
    episodesByShow.get(episode.show_id).push(episode);
  });

  return shows.map((show) => {
    const showEpisodes = episodesByShow.get(show.id) || [];
    const releasedEpisodes = showEpisodes.filter((episode) =>
      isReleased(episode.airdate)
    );
    const releasedUnwatched = releasedEpisodes.filter(
      (episode) => !episode.watched_at
    );
    const watchedCount = showEpisodes.filter(
      (episode) => episode.watched_at
    ).length;
    const started = watchedCount > 0;
    const hasReleased = releasedEpisodes.length > 0;
    const hasFuture = showEpisodes.some(
      (episode) => episode.airdate && !isReleased(episode.airdate)
    );
    const isEnded = (show.status || '').toLowerCase() === 'ended';
    const allReleasedWatched =
      hasReleased && releasedUnwatched.length === 0;
    const allEpisodesWatched =
      showEpisodes.length > 0 &&
      showEpisodes.every((episode) => episode.watched_at);

    let state = 'planned';
    if (started && releasedUnwatched.length > 0) {
      state = 'watch-next';
    } else if (!started && hasReleased) {
      state = 'queued';
    } else if (started && allReleasedWatched && !isEnded) {
      state = 'up-to-date';
    } else if (isEnded && allEpisodesWatched) {
      state = 'completed';
    } else if (!hasReleased) {
      state = 'planned';
    } else {
      state = 'up-to-date';
    }

    const nextUnwatched = releasedUnwatched
      .slice()
      .sort((a, b) => (a.airdate || '').localeCompare(b.airdate || ''))[0];
    const nextFuture = showEpisodes
      .filter((episode) => episode.airdate && !isReleased(episode.airdate))
      .sort((a, b) => (a.airdate || '').localeCompare(b.airdate || ''))[0];

    return {
      id: show.id,
      name: show.name,
      summary: show.summary,
      status: show.status,
      premiered: show.premiered,
      ended: show.ended,
      image: show.image_original || show.image_medium,
      state,
      stats: {
        totalEpisodes: showEpisodes.length,
        watchedEpisodes: watchedCount,
        releasedEpisodes: releasedEpisodes.length,
        releasedUnwatched: releasedUnwatched.length,
        hasFuture,
      },
      nextEpisode: nextUnwatched || nextFuture || null,
    };
  });
}

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password too short' });
  }

  const existing = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = db
    .prepare(
      'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'
    )
    .run(username, passwordHash, nowIso());

  req.session.userId = toNumber(result.lastInsertRowid);
  req.session.profileId = null;

  return res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.userId = user.id;
  req.session.profileId = null;
  const lastProfileId = toNumber(user.last_profile_id);
  if (lastProfileId) {
    const profile = db
      .prepare('SELECT id FROM profiles WHERE id = ? AND user_id = ?')
      .get(lastProfileId, user.id);
    if (profile) {
      req.session.profileId = toNumber(profile.id);
    }
  }

  return res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null, profileId: null });
  }
  const user = db
    .prepare('SELECT id, username FROM users WHERE id = ?')
    .get(req.session.userId);
  const profileId = ensureActiveProfile(req);
  return res.json({ user, profileId: profileId || null });
});

app.get('/api/profiles', requireAuth, (req, res) => {
  const activeProfileId = ensureActiveProfile(req);
  const profiles = db
    .prepare('SELECT id, name FROM profiles WHERE user_id = ? ORDER BY name')
    .all(req.session.userId);
  res.json({ profiles, activeProfileId: activeProfileId || null });
});

app.post('/api/profiles', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: 'Profile name required' });
  }
  const result = db
    .prepare('INSERT INTO profiles (user_id, name, created_at) VALUES (?, ?, ?)')
    .run(req.session.userId, name, nowIso());
  const profileId = toNumber(result.lastInsertRowid);
  if (!req.session.profileId) {
    req.session.profileId = profileId;
    db.prepare('UPDATE users SET last_profile_id = ? WHERE id = ?').run(
      profileId,
      req.session.userId
    );
  }
  res.json({ id: profileId, name });
});

app.post('/api/profiles/select', requireAuth, (req, res) => {
  const { profileId } = req.body || {};
  const requestedId = Number(profileId);
  const profile = db
    .prepare('SELECT id FROM profiles WHERE id = ? AND user_id = ?')
    .get(requestedId, req.session.userId);
  if (!profile) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  req.session.profileId = requestedId;
  db.prepare('UPDATE users SET last_profile_id = ? WHERE id = ?').run(
    requestedId,
    req.session.userId
  );
  return res.json({ ok: true });
});

app.get('/api/tvmaze/search', requireAuth, async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Query required' });
  }
  try {
    const results = await searchShows(query);
    const payload = results.map((item) => ({
      id: item.show.id,
      name: item.show.name,
      summary: stripHtml(item.show.summary),
      status: item.show.status,
      premiered: item.show.premiered,
      image: item.show.image?.medium || null,
    }));
    return res.json({ results: payload });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/shows', requireAuth, requireProfile, async (req, res) => {
  const { tvmazeId } = req.body || {};
  if (!tvmazeId) {
    return res.status(400).json({ error: 'tvmazeId required' });
  }
  try {
    const { showId } = await upsertShowWithEpisodes(tvmazeId);
    db.prepare(
      'INSERT OR IGNORE INTO profile_shows (profile_id, show_id, created_at) VALUES (?, ?, ?)'
    ).run(req.session.profileId, showId, nowIso());
    return res.json({ ok: true, showId });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/shows', requireAuth, requireProfile, (req, res) => {
  const shows = listShowsForProfile(req.session.profileId);

  const categories = [
    { id: 'watch-next', label: 'Watch Next', shows: [] },
    { id: 'queued', label: 'Queued', shows: [] },
    { id: 'up-to-date', label: 'Up To Date', shows: [] },
    { id: 'completed', label: 'Completed', shows: [] },
    { id: 'planned', label: 'Planned', shows: [] },
  ];

  const bucketMap = new Map(categories.map((category) => [category.id, category]));

  shows.forEach((show) => {
    if (show.state === 'watch-next') {
      bucketMap.get('watch-next').shows.push(show);
    } else if (show.state === 'queued') {
      bucketMap.get('queued').shows.push(show);
    } else if (show.state === 'up-to-date') {
      bucketMap.get('up-to-date').shows.push(show);
    } else if (show.state === 'planned') {
      bucketMap.get('planned').shows.push(show);
    } else {
      bucketMap.get('completed').shows.push(show);
    }
  });

  res.json({ categories });
});

app.get('/api/shows/:id', requireAuth, requireProfile, (req, res) => {
  const showId = Number(req.params.id);
  const show = db
    .prepare(
      `SELECT s.*
       FROM shows s
       JOIN profile_shows ps ON ps.show_id = s.id
       WHERE ps.profile_id = ? AND s.id = ?`
    )
    .get(req.session.profileId, showId);

  if (!show) {
    return res.status(404).json({ error: 'Show not found' });
  }

  const episodes = db
    .prepare(
      `SELECT e.*, pe.watched_at
       FROM episodes e
       LEFT JOIN profile_episodes pe
         ON pe.episode_id = e.id AND pe.profile_id = ?
       WHERE e.show_id = ?
       ORDER BY e.season ASC, e.number ASC`
    )
    .all(req.session.profileId, showId);

  const seasonsMap = new Map();
  episodes.forEach((episode) => {
    const seasonNumber = episode.season;
    if (!seasonsMap.has(seasonNumber)) {
      seasonsMap.set(seasonNumber, {
        season: seasonNumber,
        episodes: [],
        watchedCount: 0,
        totalCount: 0,
      });
    }
    const season = seasonsMap.get(seasonNumber);
    season.totalCount += 1;
    if (episode.watched_at) {
      season.watchedCount += 1;
    }
    season.episodes.push({
      id: episode.id,
      tvmazeId: episode.tvmaze_id,
      season: episode.season,
      number: episode.number,
      name: episode.name,
      summary: episode.summary,
      airdate: episode.airdate,
      airtime: episode.airtime,
      runtime: episode.runtime,
      image: episode.image_original || episode.image_medium,
      watched: Boolean(episode.watched_at),
    });
  });

  const seasons = Array.from(seasonsMap.values())
    .sort((a, b) => a.season - b.season)
    .map((season) => ({
      ...season,
      watched: season.totalCount > 0 && season.watchedCount === season.totalCount,
    }));

  return res.json({
    show: {
      id: show.id,
      name: show.name,
      summary: show.summary,
      status: show.status,
      premiered: show.premiered,
      ended: show.ended,
      image: show.image_original || show.image_medium,
    },
    seasons,
  });
});

app.post('/api/episodes/:id/watch', requireAuth, requireProfile, (req, res) => {
  const episodeId = Number(req.params.id);
  const { watched } = req.body || {};
  const episode = db
    .prepare(
      `SELECT e.id
       FROM episodes e
       JOIN profile_shows ps ON ps.show_id = e.show_id
       WHERE ps.profile_id = ? AND e.id = ?`
    )
    .get(req.session.profileId, episodeId);

  if (!episode) {
    return res.status(404).json({ error: 'Episode not found' });
  }

  if (watched) {
    db.prepare(
      `INSERT INTO profile_episodes (profile_id, episode_id, watched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(profile_id, episode_id)
       DO UPDATE SET watched_at = excluded.watched_at`
    ).run(req.session.profileId, episodeId, nowIso());
  } else {
    db.prepare(
      'DELETE FROM profile_episodes WHERE profile_id = ? AND episode_id = ?'
    ).run(req.session.profileId, episodeId);
  }

  return res.json({ ok: true });
});

app.post(
  '/api/shows/:id/seasons/:season/watch',
  requireAuth,
  requireProfile,
  (req, res) => {
    const showId = Number(req.params.id);
    const season = Number(req.params.season);
    const { watched } = req.body || {};

    const show = db
      .prepare(
        `SELECT s.id
         FROM shows s
         JOIN profile_shows ps ON ps.show_id = s.id
         WHERE ps.profile_id = ? AND s.id = ?`
      )
      .get(req.session.profileId, showId);

    if (!show) {
      return res.status(404).json({ error: 'Show not found' });
    }

    const episodes = db
      .prepare('SELECT id FROM episodes WHERE show_id = ? AND season = ?')
      .all(showId, season);

    runTransaction(() => {
      episodes.forEach((episode) => {
        if (watched) {
          db.prepare(
            `INSERT INTO profile_episodes (profile_id, episode_id, watched_at)
             VALUES (?, ?, ?)
             ON CONFLICT(profile_id, episode_id)
             DO UPDATE SET watched_at = excluded.watched_at`
          ).run(req.session.profileId, episode.id, nowIso());
        } else {
          db.prepare(
            'DELETE FROM profile_episodes WHERE profile_id = ? AND episode_id = ?'
          ).run(req.session.profileId, episode.id);
        }
      });
    });

    return res.json({ ok: true });
  }
);

app.get('/api/calendar', requireAuth, requireProfile, (req, res) => {
  const days = Number(req.query.days) || 45;
  const today = new Date();
  const cutoff = new Date();
  cutoff.setDate(today.getDate() + days);

  const episodes = db
    .prepare(
      `SELECT e.*, s.name AS show_name, s.image_medium, s.image_original
       FROM episodes e
       JOIN shows s ON s.id = e.show_id
       JOIN profile_shows ps ON ps.show_id = s.id
       WHERE ps.profile_id = ?
       ORDER BY e.airdate ASC`
    )
    .all(req.session.profileId);

  const upcoming = episodes.filter((episode) => {
    if (!episode.airdate) return true;
    const airdate = new Date(episode.airdate);
    return airdate >= today && airdate <= cutoff;
  });

  const sorted = upcoming.sort((a, b) => {
    if (!a.airdate && !b.airdate) return 0;
    if (!a.airdate) return 1;
    if (!b.airdate) return -1;
    return a.airdate.localeCompare(b.airdate);
  });

  const payload = sorted.map((episode) => ({
    id: episode.id,
    showName: episode.show_name,
    showImage: episode.image_original || episode.image_medium,
    season: episode.season,
    number: episode.number,
    name: episode.name,
    summary: episode.summary,
    airdate: episode.airdate,
    airtime: episode.airtime,
    runtime: episode.runtime,
  }));

  res.json({ days, episodes: payload });
});

app.get('/api/export', requireAuth, requireProfile, (req, res) => {
  const profileId = req.session.profileId;
  const shows = db
    .prepare(
      `SELECT s.id, s.tvmaze_id, s.name, ps.created_at
       FROM shows s
       JOIN profile_shows ps ON ps.show_id = s.id
       WHERE ps.profile_id = ?`
    )
    .all(profileId);

  const episodes = db
    .prepare(
      `SELECT e.tvmaze_id, e.show_id, pe.watched_at
       FROM profile_episodes pe
       JOIN episodes e ON e.id = pe.episode_id
       WHERE pe.profile_id = ?`
    )
    .all(profileId);

  const watchedByShow = new Map();
  episodes.forEach((episode) => {
    if (!watchedByShow.has(episode.show_id)) {
      watchedByShow.set(episode.show_id, []);
    }
    watchedByShow.get(episode.show_id).push({
      tvmazeEpisodeId: episode.tvmaze_id,
      watchedAt: episode.watched_at,
    });
  });

  const payload = {
    version: 1,
    exportedAt: nowIso(),
    shows: shows.map((show) => ({
      tvmazeId: show.tvmaze_id,
      name: show.name,
      addedAt: show.created_at,
      watchedEpisodes: watchedByShow.get(show.id) || [],
    })),
  };

  res.json(payload);
});

app.post('/api/import', requireAuth, requireProfile, async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !Array.isArray(payload.shows)) {
      return res.status(400).json({ error: 'Invalid import file' });
    }

    const imported = [];
    for (const show of payload.shows) {
      if (!show.tvmazeId) continue;
      const { showId } = await upsertShowWithEpisodes(show.tvmazeId);
      db.prepare(
        'INSERT OR IGNORE INTO profile_shows (profile_id, show_id, created_at) VALUES (?, ?, ?)'
      ).run(req.session.profileId, showId, show.addedAt || nowIso());

      if (Array.isArray(show.watchedEpisodes)) {
        show.watchedEpisodes.forEach((episode) => {
          if (!episode.tvmazeEpisodeId) return;
          const row = db
            .prepare('SELECT id FROM episodes WHERE tvmaze_id = ?')
            .get(episode.tvmazeEpisodeId);
          if (row) {
            db.prepare(
              `INSERT INTO profile_episodes (profile_id, episode_id, watched_at)
               VALUES (?, ?, ?)
               ON CONFLICT(profile_id, episode_id)
               DO UPDATE SET watched_at = excluded.watched_at`
            ).run(
              req.session.profileId,
              row.id,
              episode.watchedAt || nowIso()
            );
          }
        });
      }

      imported.push(show.tvmazeId);
    }

    return res.json({ ok: true, importedCount: imported.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '..', 'dist');
const indexHtml = path.join(distPath, 'index.html');

if (fs.existsSync(indexHtml)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(indexHtml);
  });
} else {
  console.log('No frontend build found. Run `npm run build` to generate `dist/`.');
}

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
