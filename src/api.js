const API_BASE = import.meta.env?.VITE_API_BASE || '';
const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
let csrfToken = null;
let csrfPromise = null;

async function loadCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch(`${API_BASE}/api/csrf`, { credentials: 'include' })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const message = data?.error || 'Failed to fetch CSRF token';
          throw new Error(message);
        }
        csrfToken = data?.csrfToken || null;
        return csrfToken;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}

export async function apiFetch(path, options = {}) {
  const { _csrfRetry, ...fetchOptions } = options;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  };
  const hasCsrfHeader = Object.keys(headers).some(
    (key) => key.toLowerCase() === 'x-csrf-token'
  );
  if (!SAFE_METHODS.has(method) && !hasCsrfHeader) {
    const token = await loadCsrfToken();
    if (token) {
      headers[CSRF_HEADER] = token;
    }
  }
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...fetchOptions,
    headers,
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => null);
  if (data?.csrfToken) {
    csrfToken = data.csrfToken;
  }
  if (!response.ok) {
    if (
      response.status === 403 &&
      data?.error === 'Invalid CSRF token' &&
      !_csrfRetry &&
      !SAFE_METHODS.has(method)
    ) {
      csrfToken = null;
      const token = await loadCsrfToken();
      return apiFetch(path, {
        ...fetchOptions,
        headers: {
          ...headers,
          [CSRF_HEADER]: token,
        },
        _csrfRetry: true,
      });
    }
    const message = data?.error || 'Request failed';
    throw new Error(message);
  }
  return data;
}
