import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeAll(async () => {
  ({ app } = await import('../../server/index.js'));
});

describe('shows and episodes', () => {
  let agent;
  let profileId;

  beforeEach(async () => {
    resetDb();
    agent = createAgent(app);
    await registerUser(agent, { username: 'shows', password: 'password123' });
    const profile = await createProfile(agent, 'Main');
    profileId = profile.body.id;
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-04-10T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('categorizes shows by state', async () => {
    const releasedDate = '2024-04-01';
    const secondReleased = '2024-04-05';

    const queuedId = createShow({ tvmazeId: 101, name: 'Queued Show' });
    linkProfileShow({ profileId, showId: queuedId });
    createEpisode({
      showId: queuedId,
      tvmazeId: 1001,
      season: 1,
      number: 1,
      name: 'Queued Ep',
      airdate: releasedDate,
    });

    const watchNextId = createShow({ tvmazeId: 102, name: 'Next Show' });
    linkProfileShow({ profileId, showId: watchNextId });
    const watchedEpisode = createEpisode({
      showId: watchNextId,
      tvmazeId: 1002,
      season: 1,
      number: 1,
      name: 'Next Ep 1',
      airdate: releasedDate,
    });
    createEpisode({
      showId: watchNextId,
      tvmazeId: 1003,
      season: 1,
      number: 2,
      name: 'Next Ep 2',
      airdate: secondReleased,
    });
    markEpisodeWatched({ profileId, episodeId: watchedEpisode });

    const upToDateId = createShow({ tvmazeId: 103, name: 'Up To Date' });
    linkProfileShow({ profileId, showId: upToDateId });
    const upToDateEpisode = createEpisode({
      showId: upToDateId,
      tvmazeId: 1004,
      season: 1,
      number: 1,
      name: 'Up Ep',
      airdate: releasedDate,
    });
    markEpisodeWatched({ profileId, episodeId: upToDateEpisode });

    const completedId = createShow({
      tvmazeId: 104,
      name: 'Completed Show',
      status: 'Ended',
      ended: '2024-03-01',
    });
    linkProfileShow({ profileId, showId: completedId });
    const completedEpisode = createEpisode({
      showId: completedId,
      tvmazeId: 1005,
      season: 1,
      number: 1,
      name: 'Finale',
      airdate: releasedDate,
    });
    markEpisodeWatched({ profileId, episodeId: completedEpisode });

    const stoppedId = createShow({ tvmazeId: 105, name: 'Stopped Show' });
    linkProfileShow({ profileId, showId: stoppedId, status: 'stopped' });
    createEpisode({
      showId: stoppedId,
      tvmazeId: 1006,
      season: 1,
      number: 1,
      name: 'Stopped Ep',
      airdate: releasedDate,
    });

    const response = await agent.get('/api/shows');
    expect(response.status).toBe(200);

    const buckets = Object.fromEntries(
      response.body.categories.map((category) => [category.id, category.shows])
    );

    expect(buckets['queued'].map((show) => show.name)).toContain('Queued Show');
    expect(buckets['watch-next'].map((show) => show.name)).toContain('Next Show');
    expect(buckets['up-to-date'].map((show) => show.name)).toContain('Up To Date');
    expect(buckets.completed.map((show) => show.name)).toContain('Completed Show');
    expect(buckets.stopped.map((show) => show.name)).toContain('Stopped Show');

    const watchNextShow = buckets['watch-next'].find(
      (show) => show.name === 'Next Show'
    );
    expect(watchNextShow.nextEpisode.airdate).toBe(secondReleased);
  });

  it('returns show detail with season progress', async () => {
    const releasedDate = '2024-04-01';
    const showId = createShow({
      tvmazeId: 201,
      name: 'Detail Show',
      premiered: '2021-02-03',
      company: 'FX',
    });
    linkProfileShow({ profileId, showId });

    const s1e1 = createEpisode({
      showId,
      tvmazeId: 2001,
      season: 1,
      number: 1,
      name: 'S1E1',
      airdate: releasedDate,
    });
    createEpisode({
      showId,
      tvmazeId: 2002,
      season: 1,
      number: 2,
      name: 'S1E2',
      airdate: releasedDate,
    });
    createEpisode({
      showId,
      tvmazeId: 2003,
      season: 2,
      number: 1,
      name: 'S2E1',
      airdate: releasedDate,
    });
    markEpisodeWatched({ profileId, episodeId: s1e1 });

    const response = await agent.get(`/api/shows/${showId}`);
    expect(response.status).toBe(200);
    expect(response.body.show.name).toBe('Detail Show');
    expect(response.body.show.releaseYear).toBe(2021);
    expect(response.body.show.company).toBe('FX');
    expect(response.body.seasons).toHaveLength(2);

    const seasonOne = response.body.seasons.find(
      (season) => season.season === 1
    );
    const seasonTwo = response.body.seasons.find(
      (season) => season.season === 2
    );

    expect(seasonOne.watchedCount).toBe(1);
    expect(seasonOne.totalCount).toBe(2);
    expect(seasonOne.watched).toBe(false);
    expect(seasonTwo.watchedCount).toBe(0);
    expect(seasonTwo.totalCount).toBe(1);
    expect(seasonTwo.watched).toBe(false);
  });

  it('updates show status and toggles episodes', async () => {
    const releasedDate = '2024-04-01';
    const showId = createShow({ tvmazeId: 301, name: 'Status Show' });
    linkProfileShow({ profileId, showId });
    const episodeId = createEpisode({
      showId,
      tvmazeId: 3001,
      season: 1,
      number: 1,
      name: 'Pilot',
      airdate: releasedDate,
    });

    const invalidStatus = await agent.post(`/api/shows/${showId}/status`, {
      status: 'paused',
    });
    expect(invalidStatus.status).toBe(400);

    const stopped = await agent.post(`/api/shows/${showId}/status`, {
      status: 'stopped',
    });
    expect(stopped.status).toBe(200);

    const watch = await agent.post(`/api/episodes/${episodeId}/watch`, {
      watched: true,
    });
    expect(watch.status).toBe(200);

    const watchedRow = db
      .prepare(
        'SELECT watched_at FROM profile_episodes WHERE profile_id = ? AND episode_id = ?'
      )
      .get(profileId, episodeId);
    expect(watchedRow?.watched_at).toBeTruthy();

    const unwatch = await agent.post(`/api/episodes/${episodeId}/watch`, {
      watched: false,
    });
    expect(unwatch.status).toBe(200);

    const deletedRow = db
      .prepare(
        'SELECT watched_at FROM profile_episodes WHERE profile_id = ? AND episode_id = ?'
      )
      .get(profileId, episodeId);
    expect(deletedRow).toBeUndefined();
  });

  it('toggles an entire season at once', async () => {
    const releasedDate = '2024-04-01';
    const showId = createShow({ tvmazeId: 401, name: 'Season Show' });
    linkProfileShow({ profileId, showId });
    const episodeOne = createEpisode({
      showId,
      tvmazeId: 4001,
      season: 1,
      number: 1,
      name: 'S1E1',
      airdate: releasedDate,
    });
    const episodeTwo = createEpisode({
      showId,
      tvmazeId: 4002,
      season: 1,
      number: 2,
      name: 'S1E2',
      airdate: releasedDate,
    });

    const response = await agent.post(
      `/api/shows/${showId}/seasons/1/watch`,
      { watched: true }
    );
    expect(response.status).toBe(200);

    const rows = db
      .prepare(
        `SELECT episode_id FROM profile_episodes
         WHERE profile_id = ? AND episode_id IN (?, ?)`
      )
      .all(profileId, episodeOne, episodeTwo);
    expect(rows).toHaveLength(2);
  });
});
