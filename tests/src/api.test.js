import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('apiFetch', () => {
  let fetchMock;
  let apiFetch;

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();
    ({ apiFetch } = await import('../../src/api.js'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed JSON for successful responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    });

    const data = await apiFetch('/api/health');
    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.any(Object));
  });

  it('returns null for 204 responses', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ csrfToken: 'token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.resolve({}),
      });

    const data = await apiFetch('/api/empty', { method: 'DELETE' });
    expect(data).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/csrf');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/empty');
  });

  it('throws an error with API-provided message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Bad request' }),
    });

    await expect(apiFetch('/api/bad')).rejects.toThrow('Bad request');
  });

  it('sends JSON headers and credentials by default', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ csrfToken: 'token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      });

    await apiFetch('/api/test', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
      headers: { 'X-Test': 'true' },
    });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/csrf');
    expect(fetchMock).toHaveBeenCalledWith('/api/test', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Test': 'true',
        'X-CSRF-Token': 'token',
      },
    });
  });
});
