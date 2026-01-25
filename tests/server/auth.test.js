import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent, createProfile, loginUser, logoutUser, registerUser } from '../helpers/api.js';
import { resetDb } from '../helpers/db.js';

vi.mock('../../server/tvmaze.js', () => ({
  searchShows: vi.fn(),
  fetchShow: vi.fn(),
  fetchEpisodes: vi.fn(),
}));

let app;

beforeAll(async () => {
  ({ app } = await import('../../server/index.js'));
});

describe('auth and profiles', () => {
  let agent;

  beforeEach(() => {
    resetDb();
    agent = createAgent(app);
    vi.clearAllMocks();
  });

  it('registers a user and sets a session', async () => {
    const response = await registerUser(agent, {
      username: 'alice',
      password: 'password123',
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.username).toBe('alice');
    expect(me.body.profileId).toBe(null);
  });

  it('rejects short passwords and duplicate usernames', async () => {
    const tooShort = await registerUser(agent, {
      username: 'bob',
      password: '123',
    });
    expect(tooShort.status).toBe(400);

    await registerUser(agent, { username: 'bob', password: 'password123' });
    const duplicate = await registerUser(agent, {
      username: 'bob',
      password: 'password456',
    });
    expect(duplicate.status).toBe(409);
  });

  it('rejects invalid login attempts', async () => {
    await registerUser(agent, { username: 'cora', password: 'password123' });
    await logoutUser(agent);

    const badLogin = await loginUser(agent, {
      username: 'cora',
      password: 'wrong-password',
    });

    expect(badLogin.status).toBe(401);
  });

  it('requires authentication for profile listing', async () => {
    const unauthenticated = await createAgent(app).get('/api/profiles');
    expect(unauthenticated.status).toBe(401);
  });

  it('creates and selects profiles', async () => {
    await registerUser(agent, { username: 'diana', password: 'password123' });
    const first = await createProfile(agent, 'Alpha');
    const second = await createProfile(agent, 'Beta');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const select = await agent.post('/api/profiles/select', {
      profileId: second.body.id,
    });
    expect(select.status).toBe(200);

    const me = await agent.get('/api/auth/me');
    expect(me.body.profileId).toBe(second.body.id);

    const list = await agent.get('/api/profiles');
    expect(list.body.activeProfileId).toBe(second.body.id);
    expect(list.body.profiles).toHaveLength(2);
  });
});
