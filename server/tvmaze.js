const TVMAZE_BASE = 'https://api.tvmaze.com';

async function tvmazeFetch(path) {
  const response = await fetch(`${TVMAZE_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'episodely-dev',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TVmaze error ${response.status}: ${text}`);
  }

  return response.json();
}

export async function searchShows(query) {
  return tvmazeFetch(`/search/shows?q=${encodeURIComponent(query)}`);
}

export async function fetchShow(tvmazeId) {
  return tvmazeFetch(`/shows/${tvmazeId}`);
}

export async function fetchEpisodes(tvmazeId) {
  return tvmazeFetch(`/shows/${tvmazeId}/episodes`);
}
