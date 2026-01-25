import { createTestClient } from './request.js';

export function createAgent(app) {
  return createTestClient(app);
}

export async function registerUser(
  agent,
  { username = 'user', password = 'password123' } = {}
) {
  return agent.post('/api/auth/register', { username, password });
}

export async function loginUser(
  agent,
  { username = 'user', password = 'password123' } = {}
) {
  return agent.post('/api/auth/login', { username, password });
}

export async function logoutUser(agent) {
  return agent.post('/api/auth/logout');
}

export async function createProfile(agent, name = 'Primary') {
  return agent.post('/api/profiles', { name });
}
