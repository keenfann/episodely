import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { apiFetch } from './api.js';
import logo from './assets/episodely-logo.svg';

const STATE_LABELS = {
  'watch-next': 'Watch Next',
  watching: 'Watching',
  queued: 'Not Started',
  'up-to-date': 'Up To Date',
  completed: 'Finished',
  stopped: 'Stopped Watching',
};

const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

function formatEpisodeCode(episode) {
  const season = episode.season ?? 0;
  const number = episode.number ?? 0;
  return `S${String(season).padStart(2, '0')}E${String(number).padStart(
    2,
    '0'
  )}`;
}

function getLocalTimezoneLabel() {
  try {
    const formatter = new Intl.DateTimeFormat(undefined, {
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(new Date());
    const label = parts.find((part) => part.type === 'timeZoneName')?.value;
    if (label) return label;
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

function buildYearLabel({ releaseYear, premiered, ended }) {
  const startYear = Number.isFinite(Number(releaseYear))
    ? Number(releaseYear)
    : premiered
      ? Number(String(premiered).split('-')[0])
      : null;
  if (!startYear) return null;
  const endYear = ended ? Number(String(ended).split('-')[0]) : null;
  return endYear ? `${startYear}-${endYear}` : `${startYear}-`;
}

function daysUntil(airdate) {
  if (!airdate) return null;
  const today = new Date();
  const target = new Date(airdate);
  const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  return diff;
}

function countWatchedEpisodes(episodes) {
  return episodes.reduce((count, episode) => count + (episode.watched ? 1 : 0), 0);
}

function updateSeasonFromEpisodes(season, episodes) {
  const watchedCount = countWatchedEpisodes(episodes);
  const totalCount = season.totalCount ?? episodes.length;
  return {
    ...season,
    episodes,
    watchedCount,
    totalCount,
    watched: totalCount > 0 && watchedCount === totalCount,
  };
}

function applyEpisodeToggle(detail, episodeId, watched) {
  if (!detail) return detail;
  let updated = false;
  const seasons = detail.seasons.map((season) => {
    let seasonUpdated = false;
    const episodes = season.episodes.map((episode) => {
      if (episode.id !== episodeId) return episode;
      if (episode.watched === watched) return episode;
      seasonUpdated = true;
      updated = true;
      return { ...episode, watched };
    });
    if (!seasonUpdated) return season;
    return updateSeasonFromEpisodes(season, episodes);
  });
  if (!updated) return detail;
  return { ...detail, seasons };
}

function applySeasonToggle(detail, seasonNumber, watched) {
  if (!detail) return detail;
  let updated = false;
  const seasons = detail.seasons.map((season) => {
    if (season.season !== seasonNumber) return season;
    updated = true;
    const episodes = season.episodes.map((episode) =>
      episode.watched === watched ? episode : { ...episode, watched }
    );
    const totalCount = season.totalCount ?? episodes.length;
    return {
      ...season,
      episodes,
      watchedCount: watched ? totalCount : 0,
      totalCount,
      watched: watched && totalCount > 0,
    };
  });
  if (!updated) return detail;
  return { ...detail, seasons };
}

function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isReleased(airdate) {
  if (!airdate) return false;
  return airdate <= getTodayDate();
}

function flattenEpisodes(seasons) {
  return seasons.flatMap((season) => season.episodes || []);
}

function computeShowStats(show, episodes) {
  const releasedEpisodes = episodes.filter((episode) =>
    isReleased(episode.airdate)
  );
  const releasedUnwatched = releasedEpisodes.filter(
    (episode) => !episode.watched
  );
  const hasPartiallyWatchedSeason = (() => {
    const seasons = new Map();
    episodes.forEach((episode) => {
      if (!seasons.has(episode.season)) {
        seasons.set(episode.season, []);
      }
      seasons.get(episode.season).push(episode);
    });
    for (const seasonEpisodes of seasons.values()) {
      const seasonReleased = seasonEpisodes.filter((episode) =>
        isReleased(episode.airdate)
      );
      if (seasonReleased.length === 0) continue;
      const watchedReleased = seasonReleased.filter(
        (episode) => episode.watched
      ).length;
      if (watchedReleased > 0 && watchedReleased < seasonReleased.length) {
        return true;
      }
    }
    return false;
  })();
  const watchedCount = episodes.filter((episode) => episode.watched).length;
  const started = watchedCount > 0;
  const hasReleased = releasedEpisodes.length > 0;
  const hasFuture = episodes.some(
    (episode) => episode.airdate && !isReleased(episode.airdate)
  );
  const isEnded = (show.status || '').toLowerCase() === 'ended';
  const allReleasedWatched = hasReleased && releasedUnwatched.length === 0;
  const allEpisodesWatched =
    episodes.length > 0 && episodes.every((episode) => episode.watched);

  let state = 'queued';
  if (show.profileStatus === 'stopped') {
    state = 'stopped';
  } else if (hasPartiallyWatchedSeason) {
    state = 'watching';
  } else if (started && releasedUnwatched.length > 0) {
    state = 'watch-next';
  } else if (!started && hasReleased) {
    state = 'queued';
  } else if (started && allReleasedWatched && !isEnded) {
    state = 'up-to-date';
  } else if (isEnded && allEpisodesWatched) {
    state = 'completed';
  } else if (!hasReleased) {
    state = 'queued';
  } else {
    state = 'up-to-date';
  }

  const nextUnwatched = releasedUnwatched
    .slice()
    .sort((a, b) => (a.airdate || '').localeCompare(b.airdate || ''))[0];
  const nextFuture = episodes
    .filter((episode) => episode.airdate && !isReleased(episode.airdate))
    .slice()
    .sort((a, b) => (a.airdate || '').localeCompare(b.airdate || ''))[0];

  return {
    state,
    stats: {
      totalEpisodes: episodes.length,
      watchedEpisodes: watchedCount,
      releasedEpisodes: releasedEpisodes.length,
      releasedUnwatched: releasedUnwatched.length,
      hasFuture,
    },
    nextEpisode: nextUnwatched || nextFuture || null,
  };
}

function getCategoryId(state) {
  if (state === 'stopped') return 'stopped';
  if (state === 'watching') return 'watching';
  if (state === 'watch-next') return 'watch-next';
  if (state === 'queued') return 'queued';
  if (state === 'up-to-date') return 'up-to-date';
  return 'completed';
}

function insertShowSorted(shows, show) {
  const next = [...shows, show];
  next.sort((a, b) => a.name.localeCompare(b.name));
  return next;
}

function buildOptimisticShowDetail(detail) {
  if (!detail) return null;
  const episodes = flattenEpisodes(detail.seasons || []);
  const computed = computeShowStats(detail.show, episodes);
  return {
    detail: {
      ...detail,
      show: {
        ...detail.show,
        state: computed.state,
      },
    },
    computed,
  };
}

function updateCategoriesWithOptimisticShow(categories, detail, computed) {
  if (!detail?.show?.id || !Array.isArray(categories)) return categories;
  const showId = detail.show.id;
  let existingShow = null;

  const strippedCategories = categories.map((category) => {
    const filtered = category.shows.filter((show) => {
      if (show.id === showId) {
        existingShow = show;
        return false;
      }
      return true;
    });
    return { ...category, shows: filtered };
  });

  if (!existingShow) return categories;

  const updatedShow = {
    ...existingShow,
    ...detail.show,
    profileStatus:
      detail.show.profileStatus ?? existingShow.profileStatus ?? null,
    state: computed.state,
    stats: computed.stats,
    nextEpisode: computed.nextEpisode,
  };

  const targetId = getCategoryId(computed.state);
  return strippedCategories.map((category) => {
    if (category.id !== targetId) return category;
    return {
      ...category,
      shows: insertShowSorted(category.shows, updatedShow),
    };
  });
}

function AirdateBadge({ airdate, airtime, timezoneSuffix = '' }) {
  if (!airdate) {
    return <span className="badge badge--muted">TBD</span>;
  }
  const dateLabel = airtime
    ? `${airdate} · ${airtime}${timezoneSuffix}`
    : airdate;
  const remaining = daysUntil(airdate);
  if (remaining > 0) {
    const dayLabel = remaining === 1 ? 'day' : 'days';
    return (
      <>
        <span className="badge badge--muted">{dateLabel}</span>
        <span className="badge badge--accent">
          In {remaining} {dayLabel}
        </span>
      </>
    );
  }
  return <span className="badge badge--muted">{dateLabel}</span>;
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [auth, setAuth] = useState({
    loading: true,
    user: null,
    profileId: null,
  });
  const [booting, setBooting] = useState(true);
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [showDetail, setShowDetail] = useState(null);
  const [calendar, setCalendar] = useState({ days: 45, episodes: [] });
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingShows, setLoadingShows] = useState(false);
  const [loadingShowDetail, setLoadingShowDetail] = useState(false);
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const scrollRestoreRef = useRef(null);
  const [scrollRestoreTick, setScrollRestoreTick] = useState(0);
  const userMenuRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const data = await apiFetch('/api/auth/me');
        if (!cancelled) {
          setAuth({ loading: false, user: data.user, profileId: data.profileId });
        }
        if (data.user && !cancelled) {
          await loadProfiles(data.profileId);
        }
      } catch (error) {
        if (!cancelled) {
          setAuth({ loading: false, user: null, profileId: null });
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (scrollRestoreRef.current == null) return;
    const top = scrollRestoreRef.current;
    scrollRestoreRef.current = null;
    window.scrollTo({ top, left: 0, behavior: 'auto' });
  }, [scrollRestoreTick]);

  useEffect(() => {
    if (activeProfile) {
      loadShows();
      loadCalendar();
    }
  }, [activeProfile]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClickOutside = (event) => {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (auth.loading || booting) return;
    if (!auth.user) {
      if (location.pathname !== '/login') {
        navigate('/login', { replace: true });
      }
      return;
    }
    if (!activeProfile) {
      if (location.pathname !== '/profiles') {
        navigate('/profiles', { replace: true });
      }
      return;
    }
    if (location.pathname === '/login' || location.pathname === '/profiles') {
      navigate('/shows', { replace: true });
    }
  }, [
    auth.loading,
    auth.user,
    activeProfile,
    booting,
    location.pathname,
    navigate,
  ]);

  const loadProfiles = async (profileId) => {
    const data = await apiFetch('/api/profiles');
    setProfiles(data.profiles || []);
    const active = data.profiles.find(
      (profile) => profile.id === (profileId || data.activeProfileId)
    );
    setActiveProfile(active || null);
    setAuth((prev) => ({ ...prev, profileId: data.activeProfileId || null }));
  };

  const loadShows = async () => {
    if (!activeProfile) return;
    setLoadingShows(true);
    try {
      const data = await apiFetch('/api/shows');
      setCategories(data.categories || []);
    } finally {
      setLoadingShows(false);
    }
  };

  const loadShowDetail = useCallback(async (showId, options = {}) => {
    if (!showId || Number.isNaN(showId)) return;
    const silent = Boolean(options.silent);
    if (!silent) {
      setLoadingShowDetail(true);
      setShowDetail((prev) => (prev?.show?.id === showId ? prev : null));
    }
    try {
      const data = await apiFetch(`/api/shows/${showId}`);
      setShowDetail(data);
    } finally {
      if (!silent) {
        setLoadingShowDetail(false);
      }
    }
  }, []);

  const loadCalendar = async () => {
    if (!activeProfile) return;
    setLoadingCalendar(true);
    try {
      const data = await apiFetch('/api/calendar');
      setCalendar(data);
    } finally {
      setLoadingCalendar(false);
    }
  };

  const handleAuth = async (mode, username, password) => {
    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    const data = await apiFetch('/api/auth/me');
    setAuth({ loading: false, user: data.user, profileId: data.profileId });
    await loadProfiles(data.profileId);
  };

  const handleLogout = async () => {
    setUserMenuOpen(false);
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setAuth({ loading: false, user: null, profileId: null });
    setProfiles([]);
    setActiveProfile(null);
    setCategories([]);
    setShowDetail(null);
    navigate('/login', { replace: true });
  };

  const handleProfileCreate = async (name) => {
    await apiFetch('/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await loadProfiles(auth.profileId);
  };

  const handleProfileSelect = async (profileId, { stayOnPage } = {}) => {
    await apiFetch('/api/profiles/select', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    });
    await loadProfiles(profileId);
    setShowDetail(null);
    if (!stayOnPage) {
      navigate('/shows', { replace: true });
    }
  };

  const handleProfileDelete = async (profile) => {
    if (!profile) return;
    await apiFetch(`/api/profiles/${profile.id}`, { method: 'DELETE' });
    if (activeProfile?.id === profile.id) {
      setShowDetail(null);
    }
    await loadProfiles();
  };

  const handleSearchQuery = (value) => {
    setSearchQuery(value);
    setHasSearched(false);
    if (!value.trim()) {
      setSearchResults([]);
      setSearchError('');
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchError('');
    setHasSearched(true);
    setIsSearching(true);
    try {
      const data = await apiFetch(
        `/api/tvmaze/search?q=${encodeURIComponent(searchQuery)}`
      );
      setSearchResults(data.results || []);
    } catch (error) {
      setSearchError(error.message);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddShow = async (tvmazeId) => {
    await apiFetch('/api/shows', {
      method: 'POST',
      body: JSON.stringify({ tvmazeId }),
    });
    setSearchResults((prev) =>
      prev.map((result) =>
        result.id === tvmazeId
          ? { ...result, existingState: result.existingState || 'queued' }
          : result
      )
    );
    await loadShows();
  };

  const handleShowStatus = async (showId, status) => {
    await apiFetch(`/api/shows/${showId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    await loadShowDetail(showId, { silent: true });
    await loadShows();
    await loadCalendar();
  };

  const handleShowRemove = async (showId) => {
    await apiFetch(`/api/shows/${showId}`, { method: 'DELETE' });
    if (showDetail?.show?.id === showId) {
      setShowDetail(null);
    }
    await loadShows();
    await loadCalendar();
    if (location.pathname.startsWith('/shows/')) {
      navigate('/shows', { replace: true });
    }
  };

  const preserveScroll = async (action) => {
    if (typeof window === 'undefined') {
      await action();
      return;
    }
    scrollRestoreRef.current = window.scrollY;
    try {
      await action();
    } finally {
      setScrollRestoreTick((prev) => prev + 1);
    }
  };

  const toggleEpisode = async (episodeId, watched) => {
    const previousDetail = showDetail;
    const previousCategories = categories;
    const showId = previousDetail?.show?.id;
    if (previousDetail) {
      const optimisticDetail = applyEpisodeToggle(previousDetail, episodeId, watched);
      const optimisticPayload = buildOptimisticShowDetail(optimisticDetail);
      if (optimisticPayload) {
        setShowDetail(optimisticPayload.detail);
        setCategories((prev) =>
          updateCategoriesWithOptimisticShow(
            prev,
            optimisticPayload.detail,
            optimisticPayload.computed
          )
        );
      }
    }
    await preserveScroll(async () => {
      try {
        await apiFetch(`/api/episodes/${episodeId}/watch`, {
          method: 'POST',
          body: JSON.stringify({ watched }),
        });
        if (showId) {
          await loadShowDetail(showId, { silent: true });
        }
        await loadShows();
      } catch (error) {
        setShowDetail(previousDetail);
        setCategories(previousCategories);
        throw error;
      }
    });
  };

  const toggleSeason = async (seasonNumber, watched) => {
    if (!showDetail?.show?.id) return;
    const previousDetail = showDetail;
    const previousCategories = categories;
    const showId = previousDetail.show.id;
    const optimisticDetail = applySeasonToggle(previousDetail, seasonNumber, watched);
    const optimisticPayload = buildOptimisticShowDetail(optimisticDetail);
    if (optimisticPayload) {
      setShowDetail(optimisticPayload.detail);
      setCategories((prev) =>
        updateCategoriesWithOptimisticShow(
          prev,
          optimisticPayload.detail,
          optimisticPayload.computed
        )
      );
    }
    await preserveScroll(async () => {
      try {
        await apiFetch(
          `/api/shows/${showId}/seasons/${seasonNumber}/watch`,
          {
            method: 'POST',
            body: JSON.stringify({ watched }),
          }
        );
        await loadShowDetail(showId, { silent: true });
        await loadShows();
      } catch (error) {
        setShowDetail(previousDetail);
        setCategories(previousCategories);
        throw error;
      }
    });
  };

  const handleExport = async () => {
    const data = await apiFetch('/api/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `episodely-export-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event) => {
    if (importing) {
      setNotice('Import already running. Please wait.');
      return;
    }
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      setNotice('Import started. This can take a few minutes.');
      setImporting(true);
      const text = await file.text();
      let payload = null;
      if (file.name.endsWith('.csv')) {
        const ids = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => Number(line))
          .filter((id) => Number.isInteger(id));
        payload = { shows: ids.map((id) => ({ tvmazeId: id })) };
      } else {
        payload = JSON.parse(text);
        if (Array.isArray(payload)) {
          payload = { shows: payload.map((id) => ({ tvmazeId: Number(id) })) };
        }
      }
      await apiFetch('/api/import', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setNotice('Import complete.');
      await loadShows();
      await loadCalendar();
    } catch (error) {
      setNotice(`Import failed: ${error.message}`);
    } finally {
      setImporting(false);
      if (input) {
        input.value = '';
      }
    }
  };

  if (auth.loading || booting) {
    return (
      <div className="app-shell">
        <div className="boot-loading" aria-hidden="true" />
      </div>
    );
  }

  if (!auth.user) {
    return <AuthView onSubmit={handleAuth} />;
  }

  if (!activeProfile) {
    return (
      <ProfileView
        profiles={profiles}
        onCreate={handleProfileCreate}
        onSelect={handleProfileSelect}
        onLogout={handleLogout}
      />
    );
  }

  const username = auth.user?.username?.trim() || '';
  const profileName = activeProfile.name?.trim() || '';
  const showProfile =
    profileName &&
    username &&
    profileName.toLowerCase() !== username.toLowerCase();

  return (
    <div className="app-shell">
      <header className="top-bar">
        <NavLink className="brand" to="/shows" aria-label="Go to shows">
          <img className="brand__logo" src={logo} alt="Episodely logo" />
          <span>Episodely</span>
        </NavLink>
        <nav className="nav">
          <NavLink
            to="/shows"
            className={({ isActive }) => (isActive ? 'tab tab--active' : 'tab')}
          >
            Shows
          </NavLink>
          <NavLink
            to="/calendar"
            className={({ isActive }) => (isActive ? 'tab tab--active' : 'tab')}
          >
            Calendar
          </NavLink>
          <NavLink
            to="/add"
            className={({ isActive }) =>
              isActive ? 'tab tab--active tab--add' : 'tab tab--add'
            }
          >
            Add Show
          </NavLink>
        </nav>
        <div className="top-bar__right">
          <button
            className="add-show-icon"
            type="button"
            onClick={() => navigate('/add')}
            aria-label="Add show"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </button>
          <button
            className="primary primary--with-icon add-show-button"
            type="button"
            onClick={() => navigate('/add')}
          >
            <svg
              className="button-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                d="M12 5v14M5 12h14"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
            Add Show
          </button>
          <div className="user-menu" ref={userMenuRef}>
            <button
              type="button"
              className={`user-menu__trigger ${
                showProfile ? 'user-menu__trigger--stacked' : 'user-menu__trigger--single'
              }`}
              aria-haspopup="menu"
              aria-label={`${auth.user?.username || 'Account'} menu`}
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((open) => !open)}
            >
              <svg
                className="user-menu__avatar"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
                <circle
                  cx="12"
                  cy="7"
                  r="4"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
              <span className="user-menu__name">
                {auth.user?.username || 'Account'}
              </span>
              {showProfile && (
                <span className="user-menu__meta">{activeProfile.name}</span>
              )}
              <span className="user-menu__caret">▾</span>
            </button>
            {userMenuOpen && (
              <div className="user-menu__dropdown" role="menu">
                <button
                  type="button"
                  className="user-menu__item"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    navigate('/settings');
                  }}
                >
                  <svg
                    className="user-menu__icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="3"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                    />
                    <path
                      d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.09a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h.09a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.09a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                    />
                  </svg>
                  Settings
                </button>
                <button
                  type="button"
                  className="user-menu__item user-menu__item--danger"
                  role="menuitem"
                  onClick={handleLogout}
                >
                  <svg
                    className="user-menu__icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                    />
                    <path
                      d="M16 17l5-5-5-5"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                    />
                    <path
                      d="M21 12H9"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                    />
                  </svg>
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/shows" replace />} />
          <Route
            path="/shows"
            element={
              <ShowsPage
                categories={categories}
                loadingShows={loadingShows}
              />
            }
          />
          <Route
            path="/add"
            element={
              <AddShowPage
                searchQuery={searchQuery}
                searchResults={searchResults}
                searchError={searchError}
                hasSearched={hasSearched}
                isSearching={isSearching}
                onSearchQuery={handleSearchQuery}
                onSearch={handleSearch}
                onAddShow={handleAddShow}
              />
            }
          />
          <Route
            path="/shows/:id"
            element={
              <ShowDetailPage
                showDetail={showDetail}
                loading={loadingShowDetail}
                onLoadShowDetail={loadShowDetail}
                onToggleEpisode={toggleEpisode}
                onToggleSeason={toggleSeason}
                onUpdateShowStatus={handleShowStatus}
                onRemoveShow={handleShowRemove}
              />
            }
          />
          <Route
            path="/calendar"
            element={
              <CalendarPage
                calendar={calendar}
                loading={loadingCalendar}
                onShowSelect={(showId) =>
                  navigate(`/shows/${showId}`, { state: { from: 'calendar' } })
                }
              />
            }
          />
          <Route
            path="/settings"
            element={
              <SettingsPage
                profiles={profiles}
                activeProfile={activeProfile}
                notice={notice}
                isImporting={importing}
                appVersion={APP_VERSION}
                onProfileSelect={handleProfileSelect}
                onProfileCreate={handleProfileCreate}
                onProfileDelete={handleProfileDelete}
                onExport={handleExport}
                onImport={handleImport}
              />
            }
          />
          <Route path="*" element={<Navigate to="/shows" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function ShowsPage({
  categories,
  loadingShows,
}) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState(() => ({
    'up-to-date': true,
    completed: true,
    stopped: true,
  }));

  const toggleCategory = (categoryId) => {
    if (searchTerm.trim()) {
      return;
    }
    setCollapsedCategories((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  };

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredCategories = normalizedSearch
    ? categories
        .map((category) => ({
          ...category,
          shows: category.shows.filter((show) =>
            show.name.toLowerCase().includes(normalizedSearch)
          ),
        }))
        .filter((category) => category.shows.length > 0)
    : categories;

  return (
    <section className="panel shows-panel">
      <div className="panel__header">
        <div>
          <h2>Your Shows</h2>
          <p className="muted">Your shows sorted by what to watch next.</p>
        </div>
      </div>
      <div className="search-bar">
        <div className="search-field">
          <svg
            className="search-field__icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              cx="11"
              cy="11"
              r="7"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
            <path
              d="M20 20l-3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
          <input
            type="search"
            placeholder="Search your shows..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
      </div>
        {loadingShows ? (
          <div className="empty-state empty-state--loading" aria-hidden="true" />
        ) : (
          filteredCategories.map((category) => (
            <div
              key={category.id}
              className={`category category--${category.id}`}
            >
              <button
                type="button"
                className="category__header"
                aria-expanded={normalizedSearch ? true : !collapsedCategories[category.id]}
                aria-controls={`category-${category.id}`}
                onClick={() => toggleCategory(category.id)}
              >
                <div className="category__title">
                  {category.id === 'completed' ? 'Finished' : category.label}
                  <span className="category__count">({category.shows.length})</span>
                </div>
                <span className="category__toggle" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path
                      d="M6 9l6 6 6-6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
              <div
                id={`category-${category.id}`}
                className={`category__body ${
                  normalizedSearch || !collapsedCategories[category.id]
                    ? 'category__body--open'
                    : 'category__body--closed'
                }`}
                aria-hidden={
                  normalizedSearch ? false : collapsedCategories[category.id]
                }
              >
                {category.shows.length === 0 ? (
                  <div className="empty-state">No shows here yet.</div>
                ) : (
                  <div className="show-grid">
                    {category.shows.map((show) => (
                      <button
                        key={show.id}
                        type="button"
                        className="show-card"
                        onClick={() => navigate(`/shows/${show.id}`)}
                      >
                        <div className="show-card__art">
                          {show.image ? (
                            <img src={show.image} alt={show.name} />
                          ) : (
                            <div className="image-fallback" />
                          )}
                        </div>
                        <div className="show-card__body">
                          <div className="show-card__title">
                            <span className={`tag tag--${show.state}`}>
                              {STATE_LABELS[show.state]}
                            </span>
                            <h3>{show.name}</h3>
                          </div>
                          {show.nextEpisode && (
                            <div className="show-card__meta">
                              <span>
                                Next: {formatEpisodeCode(show.nextEpisode)}
                              </span>
                              <span className="muted">
                                {show.nextEpisode.name || 'Upcoming episode'}
                              </span>
                            </div>
                          )}
                          <div className="show-card__stats">
                            <span>
                              Watched {show.stats.watchedEpisodes}/
                              {show.stats.totalEpisodes}
                            </span>
                            {show.stats.releasedUnwatched > 0 && (
                              <span className="highlight">
                                {show.stats.releasedUnwatched}{' '}
                                {show.stats.releasedUnwatched === 1
                                  ? 'episode'
                                  : 'episodes'}{' '}
                                left
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      {normalizedSearch && !loadingShows && filteredCategories.length === 0 && (
        <div className="empty-state">No shows match your search.</div>
      )}
    </section>
  );
}

function AddShowPage({
  searchQuery,
  searchResults,
  searchError,
  hasSearched,
  isSearching,
  onSearchQuery,
  onSearch,
  onAddShow,
}) {
  const inputRef = useRef(null);
  const [addingIds, setAddingIds] = useState({});
  const [animatingIds, setAnimatingIds] = useState({});
  const timeoutsRef = useRef(new Map());
  const previousStatesRef = useRef(new Map());
  const hasHydratedRef = useRef(false);
  const pendingAnimationRef = useRef(new Set());

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    const nextStates = new Map();
    const newlyAdded = [];
    searchResults.forEach((result) => {
      const previousState = previousStatesRef.current.get(result.id);
      if (
        !previousState &&
        result.existingState &&
        pendingAnimationRef.current.has(result.id)
      ) {
        newlyAdded.push(result.id);
      }
      nextStates.set(result.id, result.existingState || null);
    });
    previousStatesRef.current = nextStates;
    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      return;
    }
    if (newlyAdded.length === 0) return;
    setAnimatingIds((prev) => {
      const next = { ...prev };
      newlyAdded.forEach((id) => {
        next[id] = true;
        pendingAnimationRef.current.delete(id);
        const existingTimeout = timeoutsRef.current.get(id);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }
        const timeout = setTimeout(() => {
          setAnimatingIds((current) => {
            if (!current[id]) return current;
            const updated = { ...current };
            delete updated[id];
            return updated;
          });
          timeoutsRef.current.delete(id);
        }, 650);
        timeoutsRef.current.set(id, timeout);
      });
      return next;
    });
  }, [searchResults]);

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      timeoutsRef.current.clear();
    };
  }, []);

  const handleAddClick = async (id) => {
    if (addingIds[id]) return;
    pendingAnimationRef.current.add(id);
    setAddingIds((prev) => ({ ...prev, [id]: true }));
    let succeeded = false;
    try {
      await onAddShow(id);
      succeeded = true;
    } finally {
      if (!succeeded) {
        pendingAnimationRef.current.delete(id);
      }
      setAddingIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  return (
    <section className="panel add-show-page">
      <div className="panel__header">
        <div>
          <h2>Add Shows</h2>
          <p className="muted">Search TVmaze and add a show to your queue.</p>
        </div>
        <form
          className="search-bar"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
        >
          <input
            ref={inputRef}
            type="search"
            placeholder="Search shows..."
            value={searchQuery}
            onChange={(event) => onSearchQuery(event.target.value)}
          />
          <button className="primary primary--with-icon" type="submit">
            <svg
              className="button-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                cx="11"
                cy="11"
                r="7"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
              <path
                d="M20 20l-3.5-3.5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
            Search
          </button>
        </form>
      </div>
      {searchResults.length > 0 && (
        <div className="search-results">
          {searchResults.map((result) => {
            const yearLabel = buildYearLabel({
              releaseYear: result.releaseYear,
              premiered: result.premiered,
              ended: result.ended,
            });
            const metaItems = [];
            if (result.company) {
              metaItems.push({ key: 'company', node: result.company });
            }
            if (result.imdbId) {
              metaItems.push({
                key: 'imdb',
                node: (
                  <a
                    className="show-detail__imdb-link"
                    href={`https://www.imdb.com/title/${result.imdbId}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    IMDb
                  </a>
                ),
              });
            }
            if (result.status) {
              metaItems.push({ key: 'status', node: result.status });
            }
            if (yearLabel) {
              metaItems.push({ key: 'years', node: yearLabel });
            }

            return (
              <div key={result.id} className="search-card">
                {result.image ? (
                  <img src={result.image} alt={result.name} />
                ) : (
                  <div className="image-fallback" />
                )}
                <div>
                  <h3>{result.name}</h3>
                  {metaItems.length > 0 && (
                    <p className="muted search-card__meta">
                      {metaItems.map((item, index) => (
                        <span key={item.key}>
                          {item.node}
                          {index < metaItems.length - 1 ? ' • ' : ''}
                        </span>
                      ))}
                    </p>
                  )}
                  <p className="muted">
                    {result.summary || 'No summary available.'}
                  </p>
                </div>
                <div
                  className={[
                    'search-card__action',
                    result.existingState ? 'search-card__action--added' : '',
                    animatingIds[result.id] ? 'search-card__action--animating' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <button
                    className="outline outline--with-icon search-card__add"
                    onClick={() => handleAddClick(result.id)}
                    disabled={addingIds[result.id] || Boolean(result.existingState)}
                    aria-hidden={Boolean(result.existingState)}
                    tabIndex={result.existingState ? -1 : 0}
                  >
                    <svg
                      className="button-icon"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        d="M12 5v14M5 12h14"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                    {addingIds[result.id] ? 'Adding' : 'Add'}
                  </button>
                  <span
                    className={[
                      'badge',
                      'search-card__badge',
                      result.existingState
                        ? `search-card__badge--${result.existingState}`
                        : 'badge--muted',
                    ].join(' ')}
                    aria-hidden={!result.existingState}
                  >
                    {STATE_LABELS[result.existingState] || 'Added'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {hasSearched && !searchError && !isSearching && searchResults.length === 0 && (
        <div className="empty-state">No shows found. Try another search.</div>
      )}
      {searchError && <div className="error">{searchError}</div>}
    </section>
  );
}

function ShowDetailPage({
  showDetail,
  loading,
  onLoadShowDetail,
  onToggleEpisode,
  onToggleSeason,
  onUpdateShowStatus,
  onRemoveShow,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const showId = Number(params.id);
  const backTarget =
    location.state?.from === 'calendar' ? '/calendar' : '/shows';

  useEffect(() => {
    if (!Number.isNaN(showId)) {
      onLoadShowDetail(showId);
    }
  }, [showId, onLoadShowDetail]);

  if (Number.isNaN(showId)) {
    return (
      <section className="panel">
        <div className="empty-state">Invalid show.</div>
        <button className="outline" onClick={() => navigate(backTarget)}>
          Back to shows
        </button>
      </section>
    );
  }

  if (!showDetail && loading) {
    return (
      <section className="panel">
        <div className="empty-state empty-state--loading" aria-hidden="true" />
      </section>
    );
  }

  if (!showDetail && !loading) {
    return (
      <section className="panel">
        <div className="empty-state">Show not found.</div>
        <button className="outline" onClick={() => navigate(backTarget)}>
          Back to shows
        </button>
      </section>
    );
  }

  return (
    <ShowDetailView
      show={showDetail.show}
      seasons={showDetail.seasons}
      loading={loading}
      onBack={() => navigate(backTarget)}
      onToggleEpisode={onToggleEpisode}
      onToggleSeason={onToggleSeason}
      onUpdateShowStatus={onUpdateShowStatus}
      onRemoveShow={onRemoveShow}
    />
  );
}

function CalendarPage({ calendar, loading, onShowSelect }) {
  const timezoneLabel = getLocalTimezoneLabel();
  const timezoneSuffix = timezoneLabel ? ` ${timezoneLabel}` : '';

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Upcoming Episodes</h2>
          <p className="muted">Next {calendar.days} days across your shows.</p>
        </div>
      </div>
      {loading ? (
        <div className="empty-state empty-state--loading" aria-hidden="true" />
      ) : calendar.episodes.length === 0 ? (
        <div className="empty-state">No upcoming episodes found.</div>
      ) : (
        <div className="calendar-list">
          {calendar.episodes.map((episode) => {
            const showId = episode.showId ?? episode.show_id;
            const canNavigate = Number.isFinite(showId);
            return (
            <button
              key={episode.id}
              className="calendar-card"
              type="button"
              onClick={() => {
                if (canNavigate) {
                  onShowSelect(showId);
                }
              }}
              disabled={!canNavigate}
            >
              <div className="calendar-card__image">
                {episode.showImage ? (
                  <img src={episode.showImage} alt={episode.showName} />
                ) : (
                  <div className="image-fallback" />
                )}
              </div>
              <div className="calendar-card__body">
                <div className="calendar-card__meta">
                  <AirdateBadge
                    airdate={episode.airdate}
                    airtime={episode.airtime}
                    timezoneSuffix={timezoneSuffix}
                  />
                  {episode.showState && (
                    <span
                      className={[
                        'badge',
                        'calendar-card__state',
                        `calendar-card__state--${episode.showState}`,
                      ].join(' ')}
                    >
                      {STATE_LABELS[episode.showState] || episode.showState}
                    </span>
                  )}
                </div>
                <h3 className="calendar-card__show">{episode.showName}</h3>
                <h4 className="calendar-card__episode">
                  {formatEpisodeCode(episode)} - {episode.name}
                </h4>
                <p className="muted">
                  {episode.summary || 'No episode summary available.'}
                </p>
              </div>
            </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SettingsPage({
  profiles,
  activeProfile,
  notice,
  isImporting,
  appVersion,
  onProfileSelect,
  onProfileCreate,
  onProfileDelete,
  onExport,
  onImport,
}) {
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [deleteError, setDeleteError] = useState('');

  const handleDeleteRequest = (profileId) => {
    setDeleteError('');
    setPendingDeleteId(profileId);
  };

  const handleDeleteCancel = () => {
    setPendingDeleteId(null);
  };

  const handleDeleteConfirm = async (profile) => {
    setDeleteError('');
    try {
      await onProfileDelete(profile);
      setPendingDeleteId(null);
    } catch (error) {
      setDeleteError(error.message);
    }
  };

  const handleSelect = (profileId) => {
    setPendingDeleteId(null);
    onProfileSelect(profileId, { stayOnPage: true });
  };

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Settings</h2>
          <p className="muted">Manage profiles, exports, and account access.</p>
          <p className="muted settings-version">Version {appVersion}</p>
        </div>
      </div>
      <div className="settings-grid">
        <div className="settings-card settings-card--profiles">
          <div className="settings-card__header">
            <h3>Profiles</h3>
          </div>
          <div className="settings-card__body">
            <p className="muted">Switch or add a profile for another viewer.</p>
            <div className="settings-profile-list">
              {profiles.map((profile) => {
                const initial = profile.name?.trim()?.[0]?.toUpperCase() || '?';
                const isActive = profile.id === activeProfile?.id;
                const isPendingDelete = pendingDeleteId === profile.id;
                return (
                  <div
                    key={profile.id}
                    className={
                      [
                        'settings-profile-item',
                        isActive ? 'settings-profile-item--active' : '',
                        isPendingDelete ? 'settings-profile-item--confirming' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                    }
                  >
                    <button
                      className="settings-profile-main"
                      type="button"
                      disabled={isPendingDelete}
                      aria-label={
                        isActive
                          ? `${profile.name} profile (active)`
                          : `Switch to ${profile.name} profile`
                      }
                      onClick={() => handleSelect(profile.id)}
                    >
                      <span className="settings-profile-avatar">{initial}</span>
                      <span className="settings-profile-name">{profile.name}</span>
                      {isActive && (
                        <span className="settings-profile-status">Active</span>
                      )}
                    </button>
                    {!isActive && !isPendingDelete && (
                      <div className="settings-profile-actions">
                        <button
                          className="settings-profile-action"
                          type="button"
                          aria-label={`Switch to ${profile.name} profile`}
                          title="Switch profile"
                          onClick={() => handleSelect(profile.id)}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="12" r="9" />
                            <path d="M8.5 12h7" />
                            <path d="M12 8.5l3.5 3.5-3.5 3.5" />
                          </svg>
                        </button>
                        <button
                          className="settings-profile-action settings-profile-action--danger"
                          type="button"
                          aria-label={`Delete ${profile.name} profile`}
                          title="Delete profile"
                          onClick={() => handleDeleteRequest(profile.id)}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        </button>
                      </div>
                    )}
                    {!isActive && isPendingDelete && (
                      <div className="settings-profile-confirm">
                        <span>Delete?</span>
                        <button
                          className="settings-profile-cancel"
                          type="button"
                          onClick={handleDeleteCancel}
                        >
                          Cancel
                        </button>
                        <button
                          className="settings-profile-confirm-button"
                          type="button"
                          onClick={() => handleDeleteConfirm(profile)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {deleteError && <p className="error">{deleteError}</p>}
          </div>
          <div className="settings-card__footer">
            <ProfileCreateInline onCreate={onProfileCreate} />
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-card__header">
            <h3>Import / Export</h3>
          </div>
          <div className="settings-card__body">
            <p className="muted">Download a JSON backup or import JSON/CSV TVmaze IDs.</p>
          </div>
          <div className="settings-card__footer">
            <div className="button-row">
              <button className="outline" onClick={onExport}>
                Export
              </button>
              <label className={isImporting ? 'outline is-disabled' : 'outline'}>
                Import
                <input
                  type="file"
                  accept=".json,.csv,application/json,text/csv"
                  onChange={onImport}
                  disabled={isImporting}
                />
              </label>
            </div>
            {notice && <p className="notice">{notice}</p>}
            {isImporting && (
              <div className="import-status" aria-live="polite">
                <div className="progress-bar" role="progressbar" aria-valuetext="Importing">
                  <span className="progress-bar__fill" />
                </div>
              </div>
            )}
          </div>
        </div>
        <ChangePasswordCard />
      </div>
    </section>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Complete all password fields.');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiFetch('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('Password updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="settings-card">
      <div className="settings-card__header">
        <h3>Change password</h3>
      </div>
      <div className="settings-card__body">
        <p className="muted">Update your account password.</p>
        <form className="settings-form" onSubmit={handleSubmit}>
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          <button
            className={isSubmitting ? 'outline is-disabled' : 'outline'}
            type="submit"
            disabled={isSubmitting}
          >
            Update password
          </button>
        </form>
      </div>
      {(error || notice) && (
        <div className="settings-card__footer">
          {error && <p className="error">{error}</p>}
          {notice && <p className="notice">{notice}</p>}
        </div>
      )}
    </div>
  );
}

function AuthView({ onSubmit }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await onSubmit(mode, username, password);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand brand--large">
          <img className="brand__logo" src={logo} alt="Episodely logo" />
          <span>Episodely</span>
        </div>
        <p className="muted">Track TV series with a focused, self-hosted setup.</p>
        <form onSubmit={handleSubmit}>
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" type="submit">
            {mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
        <button
          className="text-button"
          type="button"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Need an account? Register' : 'Have an account? Log in'}
        </button>
      </div>
    </div>
  );
}

function ProfileView({ profiles, onCreate, onSelect, onLogout }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setError('');
    try {
      await onCreate(name.trim());
      setName('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="auth-shell">
      <div className="panel panel--center profile-panel">
        <div className="panel__header">
          <div>
            <h2>Select a profile</h2>
            <p className="muted">Switch between viewers or create a new profile.</p>
          </div>
          <button className="outline" onClick={onLogout}>
            Log out
          </button>
        </div>
        <div className="profile-list">
          {profiles.map((profile) => (
            <button key={profile.id} className="chip" onClick={() => onSelect(profile.id)}>
              {profile.name}
            </button>
          ))}
        </div>
        <form className="inline-form" onSubmit={handleCreate}>
          <input
            placeholder="New profile name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="primary" type="submit">
            Add profile
          </button>
        </form>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}

function ProfileCreateInline({ onCreate }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await onCreate(name.trim());
      setName('');
      setIsOpen(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleOpen = () => {
    setError('');
    setIsOpen(true);
  };

  if (!isOpen) {
    return (
      <button className="outline" type="button" onClick={handleOpen}>
        Add
      </button>
    );
  }

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <input
        placeholder="New profile name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoFocus
      />
      <button className="outline" type="submit">
        Add
      </button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

function CheckButton({ active, label, onClick }) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (!animate) return;
    const timeout = setTimeout(() => setAnimate(false), 220);
    return () => clearTimeout(timeout);
  }, [animate]);

  const handleClick = (event) => {
    if (!active) {
      setAnimate(true);
    }
    onClick(event);
  };

  return (
    <button
      className={[
        'check-button',
        active ? 'check-button--active' : '',
        animate ? 'check-button--animate' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
      type="button"
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M5 13l4 4 10-10"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function ShowDetailView({
  show,
  seasons,
  loading,
  onBack,
  onToggleEpisode,
  onToggleSeason,
  onUpdateShowStatus,
  onRemoveShow,
}) {
  const [openSeasons, setOpenSeasons] = useState({});
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    setOpenSeasons((prev) => {
      const next = {};
      seasons.forEach((season) => {
        const key = String(season.season);
        if (season.watched) {
          next[key] = false;
        } else {
          next[key] = prev[key] ?? true;
        }
      });
      return next;
    });
  }, [seasons]);

  useEffect(() => {
    setConfirmingRemove(false);
  }, [show?.id]);

  const toggleSeasonOpen = (seasonNumber) => {
    const key = String(seasonNumber);
    setOpenSeasons((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleRemoveConfirm = async () => {
    await onRemoveShow(show.id);
    setConfirmingRemove(false);
  };

  if (!show) return null;
  const stateLabel = show.state ? STATE_LABELS[show.state] || show.state : null;
  const isFinished = show.state === 'completed';
  const canToggleStatus = !isFinished;
  const canRemove = show.profileStatus === 'stopped';
  const imdbUrl = show.imdbId
    ? `https://www.imdb.com/title/${show.imdbId}/`
    : null;
  const yearLabel = buildYearLabel({
    releaseYear: show.releaseYear,
    premiered: show.premiered,
    ended: show.ended,
  });
  const producerMeta = show.company || '';
  const statusMetaParts = [];
  if (show.status) statusMetaParts.push(show.status);
  if (yearLabel) statusMetaParts.push(yearLabel);
  const statusMeta = statusMetaParts.join(' · ');
  return (
    <section className="panel show-detail">
      <div className="panel__header show-detail__header">
        <div className="show-detail__heading">
          <button
            className="icon-button icon-button--back"
            type="button"
            onClick={onBack}
            aria-label="Back to shows"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M7.5 10l4.5 4.5 4.5-4.5" />
            </svg>
          </button>
          <div className="show-detail__title">
            <div className="show-detail__title-row">
              <h2>{show.name}</h2>
              {stateLabel && (
                <span
                  className={`badge show-detail__badge show-detail__badge--${show.state}`}
                >
                  {stateLabel}
                </span>
              )}
            </div>
            {(producerMeta || imdbUrl) && (
              <p className="muted show-detail__meta">
                {producerMeta}
                {producerMeta && imdbUrl ? ' · ' : ''}
                {imdbUrl && (
                  <a
                    className="show-detail__imdb-link"
                    href={imdbUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    IMDb
                  </a>
                )}
              </p>
            )}
            {statusMeta && (
              <p className="muted show-detail__meta">
                {statusMeta}
              </p>
            )}
          </div>
        </div>
        {(canToggleStatus || canRemove) && (
          <div className="show-detail__actions">
            {canToggleStatus && (
              <button
                className="outline outline--with-icon show-detail__action"
                type="button"
                onClick={() =>
                  onUpdateShowStatus(
                    show.id,
                    show.profileStatus === 'stopped' ? null : 'stopped'
                  )
                }
              >
                {show.profileStatus === 'stopped' ? (
                  <svg
                    className="button-icon resume-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      d="M7 5v14l11-7z"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                ) : (
                  <svg
                    className="button-icon stop-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <rect
                      x="6"
                      y="6"
                      width="12"
                      height="12"
                      rx="2"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                )}
                {show.profileStatus === 'stopped'
                  ? 'Resume Watching'
                  : 'Stop Watching'}
              </button>
            )}
            {canRemove &&
              (confirmingRemove ? (
                <div className="settings-profile-confirm">
                  <span>Delete?</span>
                  <button
                    className="settings-profile-cancel"
                    type="button"
                    onClick={() => setConfirmingRemove(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="settings-profile-confirm-button"
                    type="button"
                    onClick={handleRemoveConfirm}
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <button
                  className="settings-profile-action settings-profile-action--danger show-detail__delete"
                  type="button"
                  aria-label={`Remove ${show.name}`}
                  title="Remove show"
                  onClick={() => setConfirmingRemove(true)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              ))}
          </div>
        )}
      </div>
      <div className="show-detail__hero">
        <div className="show-detail__image">
          {show.image ? (
            <img src={show.image} alt={show.name} />
          ) : (
            <div className="image-fallback" />
          )}
        </div>
        <div className="show-detail__summary">
          <h3>Synopsis</h3>
          <p>{show.summary || 'No synopsis available.'}</p>
        </div>
      </div>
      {loading && (
        <div className="empty-state empty-state--loading">
          Loading episodes...
        </div>
      )}
      {!loading && (
        <div className="season-list">
          {seasons.map((season) => {
            const isOpen =
              openSeasons[String(season.season)] ?? !season.watched;
            return (
              <div key={season.season} className="season-card">
                <div
                  className="season-card__header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  aria-controls={`season-${season.season}`}
                  onClick={() => toggleSeasonOpen(season.season)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleSeasonOpen(season.season);
                    }
                  }}
                >
                  <div className="season-card__info">
                    <h3>Season {season.season}</h3>
                    <p className="muted">
                      Watched {season.watchedCount}/{season.totalCount}
                    </p>
                  </div>
                  <div className="season-actions">
                    <button
                      className="season-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleSeasonOpen(season.season);
                      }}
                      type="button"
                      aria-label={isOpen ? 'Collapse season' : 'Expand season'}
                      aria-expanded={isOpen}
                      title={isOpen ? 'Collapse season' : 'Expand season'}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path
                          d="M6 9l6 6 6-6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <CheckButton
                      active={season.watched}
                      label={
                        season.watched
                          ? 'Mark season unwatched'
                          : 'Mark season watched'
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleSeason(season.season, !season.watched);
                      }}
                    />
                  </div>
                </div>
                <div
                  id={`season-${season.season}`}
                  className={`episode-list ${
                    isOpen ? 'episode-list--open' : 'episode-list--closed'
                  }`}
                  aria-hidden={!isOpen}
                >
                  {season.episodes.map((episode) => {
                    return (
                      <div
                        key={episode.id}
                        className={`episode-row ${episode.watched ? 'is-watched' : ''}`}
                      >
                        <div className="episode-row__meta">
                          <div className="episode-row__badges">
                            <span className="tag">
                              {formatEpisodeCode(episode)}
                            </span>
                            <AirdateBadge airdate={episode.airdate} />
                            {episode.runtime && (
                              <span className="badge badge--muted">
                                {episode.runtime}m
                              </span>
                            )}
                          </div>
                          <div className="episode-row__title-row">
                            <h4>{episode.name || 'Untitled episode'}</h4>
                            <CheckButton
                              active={episode.watched}
                              label={
                                episode.watched
                                  ? 'Mark episode unwatched'
                                  : 'Mark episode watched'
                              }
                              onClick={() =>
                                onToggleEpisode(episode.id, !episode.watched)
                              }
                            />
                          </div>
                        </div>
                        <p className="muted">
                          {episode.summary || 'No episode summary available.'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default App;
