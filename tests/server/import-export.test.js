import fs from 'fs';
import path from 'path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db.js';
import { createAgent, createProfile, registerUser } from '../helpers/api.js';
import {
  createEpisode,
  createShow,
  linkProfileShow,
  markEpisodeWatched,
  resetDb,
} from '../helpers/db.js';

vi.mock('../../server/tvmaze.js', () => ({
  searchShows: vi.fn(),
  fetchShow: vi.fn(),
  fetchEpisodes: vi.fn(),
}));

let app;
let runExportBackupsOnce;
let tvmaze;

beforeAll(async () => {
  tvmaze = await import('../../server/tvmaze.js');
  ({ app, runExportBackupsOnce } = await import('../../server/index.js'));
});

describe('tvmaze, import/export, calendar', () => {
  let agent;
  let profileId;

  beforeEach(async () => {
    resetDb();
    agent = createAgent(app);
    await registerUser(agent, { username: 'importer', password: 'password123' });
    const profile = await createProfile(agent, 'Primary');
    profileId = profile.body.id;
    vi.clearAllMocks();
  });

  it('searches tvmaze and strips HTML', async () => {
    const existingShowId = createShow({
      tvmazeId: 1,
      name: 'Example',
      status: 'Running',
    });
    linkProfileShow({ profileId, showId: existingShowId });
    createEpisode({
      showId: existingShowId,
      tvmazeId: 1101,
      season: 1,
      number: 1,
      name: 'Pilot',
      airdate: '2000-01-01',
    });

    tvmaze.searchShows.mockResolvedValue([
      {
        show: {
          id: 1,
          name: 'Example',
          summary: '<p>Summary</p>',
          status: 'Running',
          premiered: '2020-01-01',
          image: { medium: 'image.png' },
        },
      },
    ]);

    const response = await agent.get('/api/tvmaze/search?q=example');
    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].summary).toBe('Summary');
    expect(response.body.results[0].existingState).toBe('queued');
  });

  it('returns tvmaze errors and validates query', async () => {
    const missingQuery = await agent.get('/api/tvmaze/search');
    expect(missingQuery.status).toBe(400);

    tvmaze.searchShows.mockRejectedValue(new Error('TVmaze down'));
    const errorResponse = await agent.get('/api/tvmaze/search?q=fail');
    expect(errorResponse.status).toBe(500);
    expect(errorResponse.body.error).toBe('TVmaze down');
  });

  it('adds a show with episodes from tvmaze', async () => {
    tvmaze.fetchShow.mockResolvedValue({
      id: 9001,
      name: 'Mock Show',
      summary: '<p>Summary</p>',
      status: 'Running',
      premiered: '2020-01-01',
      ended: null,
      image: { medium: 'm.png', original: 'o.png' },
    });
    tvmaze.fetchEpisodes.mockResolvedValue([
      {
        id: 9101,
        season: 1,
        number: 1,
        name: 'Pilot',
        summary: '<p>Pilot</p>',
        airdate: '2024-04-01',
        airtime: '20:00',
        runtime: 60,
        image: { medium: 'm.png', original: 'o.png' },
      },
      {
        id: 9102,
        season: 1,
        number: 2,
        name: 'Second',
        summary: '<p>Second</p>',
        airdate: '2024-04-08',
        airtime: '20:00',
        runtime: 60,
        image: { medium: 'm.png', original: 'o.png' },
      },
    ]);

    const response = await agent.post('/api/shows', { tvmazeId: 9001 });
    expect(response.status).toBe(200);

    const showRow = db
      .prepare('SELECT id, name FROM shows WHERE tvmaze_id = ?')
      .get(9001);
    expect(showRow.name).toBe('Mock Show');

    const episodeCount = db
      .prepare('SELECT COUNT(*) AS count FROM episodes WHERE show_id = ?')
      .get(showRow.id);
    expect(Number(episodeCount.count)).toBe(2);
  });

  it('exports watched episodes with show metadata', async () => {
    const showId = createShow({ tvmazeId: 7001, name: 'Export Show' });
    linkProfileShow({
      profileId,
      showId,
      createdAt: '2024-04-01T12:00:00Z',
    });
    const episodeId = createEpisode({
      showId,
      tvmazeId: 7101,
      season: 1,
      number: 1,
      name: 'Export Ep',
      airdate: '2024-04-01',
    });
    markEpisodeWatched({
      profileId,
      episodeId,
      watchedAt: '2024-04-02T12:00:00Z',
    });

    const response = await agent.get('/api/export');
    expect(response.status).toBe(200);
    expect(response.body.version).toBe(1);
    expect(response.body.shows).toHaveLength(1);
    expect(response.body.shows[0].tvmazeId).toBe(7001);
    expect(response.body.shows[0].watchedEpisodes[0].tvmazeEpisodeId).toBe(7101);
  });

  it('writes profile export backups that match the importable shape', () => {
    const showId = createShow({ tvmazeId: 7201, name: 'Backup Show' });
    linkProfileShow({ profileId, showId });

    runExportBackupsOnce();

    const userRow = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get('importer');
    const exportRoot = path.join(path.dirname(process.env.DB_PATH), 'exports');
    const profileDir = path.join(
      exportRoot,
      `user-${userRow.id}`,
      `profile-${profileId}`
    );
    const files = fs
      .readdirSync(profileDir)
      .filter((file) => file.endsWith('.json'));

    expect(files.length).toBe(1);

    const payload = JSON.parse(
      fs.readFileSync(path.join(profileDir, files[0]), 'utf8')
    );
    expect(payload.version).toBe(1);
    expect(Array.isArray(payload.shows)).toBe(true);
    expect(payload.shows[0].tvmazeId).toBe(7201);
  });

  it('imports shows and watched episodes', async () => {
    tvmaze.fetchShow.mockResolvedValue({
      id: 8001,
      name: 'Import Show',
      summary: '<p>Summary</p>',
      status: 'Running',
      premiered: '2020-01-01',
      ended: null,
      image: { medium: 'm.png', original: 'o.png' },
    });
    tvmaze.fetchEpisodes.mockResolvedValue([
      {
        id: 8101,
        season: 1,
        number: 1,
        name: 'Import Ep',
        summary: '<p>Episode</p>',
        airdate: '2024-04-01',
        airtime: '21:00',
        runtime: 60,
        image: { medium: 'm.png', original: 'o.png' },
      },
    ]);

    const invalid = await agent.post('/api/import', { foo: 'bar' });
    expect(invalid.status).toBe(400);

    const payload = {
      shows: [
        {
          tvmazeId: 8001,
          addedAt: '2024-04-01T12:00:00Z',
          watchedEpisodes: [
            { tvmazeEpisodeId: 8101, watchedAt: '2024-04-03T12:00:00Z' },
          ],
        },
      ],
    };

    const response = await agent.post('/api/import', payload);
    expect(response.status).toBe(200);
    expect(response.body.importedCount).toBe(1);

    const episodeRow = db
      .prepare('SELECT id FROM episodes WHERE tvmaze_id = ?')
      .get(8101);
    const watchedRow = db
      .prepare(
        'SELECT watched_at FROM profile_episodes WHERE profile_id = ? AND episode_id = ?'
      )
      .get(profileId, episodeRow.id);
    expect(watchedRow?.watched_at).toBe('2024-04-03T12:00:00Z');
  });

  it('returns upcoming calendar episodes and filters TBD dates', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-04-10T00:00:00Z'));

      const showId = createShow({ tvmazeId: 6001, name: 'Calendar Show' });
      linkProfileShow({ profileId, showId });
      createEpisode({
        showId,
        tvmazeId: 6002,
        season: 1,
        number: 1,
        name: 'Upcoming',
        airdate: '2024-04-11',
        airtime: '20:00',
      });
      createEpisode({
        showId,
        tvmazeId: 6003,
        season: 1,
        number: 2,
        name: 'TBD',
        airdate: '2024-04-20',
        airtime: 'TBD',
      });
      createEpisode({
        showId,
        tvmazeId: 6004,
        season: 1,
        number: 3,
        name: 'Missing Airdate',
        airdate: null,
        airtime: '21:00',
      });

      const response = await agent.get('/api/calendar?days=10');
      expect(response.status).toBe(200);
      expect(response.body.episodes).toHaveLength(1);
      expect(response.body.episodes[0].name).toBe('Upcoming');
      expect(response.body.episodes[0].showId).toBe(showId);
      expect(response.body.episodes[0].showState).toBe('queued');
    } finally {
      vi.useRealTimers();
    }
  });

  it('includes computed show state for calendar episodes', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-04-10T00:00:00Z'));

      const showId = createShow({ tvmazeId: 7001, name: 'Stateful Show' });
      linkProfileShow({ profileId, showId });
      const watchedEpisodeId = createEpisode({
        showId,
        tvmazeId: 7002,
        season: 1,
        number: 1,
        name: 'Watched',
        airdate: '2024-04-01',
        airtime: '20:00',
      });
      createEpisode({
        showId,
        tvmazeId: 7003,
        season: 1,
        number: 2,
        name: 'Unwatched',
        airdate: '2024-04-05',
        airtime: '20:00',
      });
      createEpisode({
        showId,
        tvmazeId: 7004,
        season: 1,
        number: 3,
        name: 'Upcoming',
        airdate: '2024-04-11',
        airtime: '21:00',
      });

      markEpisodeWatched({ profileId, episodeId: watchedEpisodeId });

      const response = await agent.get('/api/calendar?days=10');
      expect(response.status).toBe(200);
      expect(response.body.episodes).toHaveLength(1);
      expect(response.body.episodes[0].showId).toBe(showId);
      expect(response.body.episodes[0].showState).toBe('watch-next');
    } finally {
      vi.useRealTimers();
    }
  });
});
