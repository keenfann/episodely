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

const STATE_LABELS = {
  'watch-next': 'Watch Next',
  queued: 'Not Started',
  'up-to-date': 'Up To Date',
  completed: 'Completed',
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

function daysUntil(airdate) {
  if (!airdate) return null;
  const today = new Date();
  const target = new Date(airdate);
  const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  return diff;
}

function AirdateBadge({ airdate }) {
  if (!airdate) {
    return <span className="badge badge--muted">TBD</span>;
  }
  const remaining = daysUntil(airdate);
  if (remaining > 0) {
    return (
      <span className="badge badge--accent">
        {airdate} - {remaining}d
      </span>
    );
  }
  return <span className="badge badge--muted">{airdate}</span>;
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [auth, setAuth] = useState({
    loading: true,
    user: null,
    profileId: null,
  });
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [categories, setCategories] = useState([]);
  const [showDetail, setShowDetail] = useState(null);
  const [calendar, setCalendar] = useState({ days: 45, episodes: [] });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [loadingShows, setLoadingShows] = useState(false);
  const [loadingShowDetail, setLoadingShowDetail] = useState(false);
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const scrollRestoreRef = useRef(null);
  const [scrollRestoreTick, setScrollRestoreTick] = useState(0);

  useEffect(() => {
    const init = async () => {
      try {
        const data = await apiFetch('/api/auth/me');
        setAuth({ loading: false, user: data.user, profileId: data.profileId });
        if (data.user) {
          await loadProfiles(data.profileId);
        }
      } catch (error) {
        setAuth({ loading: false, user: null, profileId: null });
      }
    };
    init();
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
    if (auth.loading) return;
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
  }, [auth.loading, auth.user, activeProfile, location.pathname, navigate]);

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
    const data = await apiFetch('/api/calendar');
    setCalendar(data);
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

  const handleProfileSelect = async (profileId) => {
    await apiFetch('/api/profiles/select', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    });
    await loadProfiles(profileId);
    setShowDetail(null);
    navigate('/shows', { replace: true });
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
    try {
      const data = await apiFetch(
        `/api/tvmaze/search?q=${encodeURIComponent(searchQuery)}`
      );
      setSearchResults(data.results || []);
    } catch (error) {
      setSearchError(error.message);
    }
  };

  const handleAddShow = async (tvmazeId) => {
    await apiFetch('/api/shows', {
      method: 'POST',
      body: JSON.stringify({ tvmazeId }),
    });
    setSearchResults([]);
    setSearchQuery('');
    setSearchError('');
    setHasSearched(false);
    await loadShows();
  };

  const handleShowStatus = async (showId, status) => {
    await apiFetch(`/api/shows/${showId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    await loadShowDetail(showId, { silent: true });
    await loadShows();
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
    await preserveScroll(async () => {
      await apiFetch(`/api/episodes/${episodeId}/watch`, {
        method: 'POST',
        body: JSON.stringify({ watched }),
      });
      if (showDetail?.show?.id) {
        await loadShowDetail(showDetail.show.id, { silent: true });
      }
      await loadShows();
    });
  };

  const toggleSeason = async (seasonNumber, watched) => {
    if (!showDetail?.show?.id) return;
    await preserveScroll(async () => {
      await apiFetch(
        `/api/shows/${showDetail.show.id}/seasons/${seasonNumber}/watch`,
        {
          method: 'POST',
          body: JSON.stringify({ watched }),
        }
      );
      await loadShowDetail(showDetail.show.id, { silent: true });
      await loadShows();
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

  if (auth.loading) {
    return (
      <div className="app-shell">
        <div className="panel panel--center">Loading...</div>
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

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand__dot" />
          <span>Episodely</span>
        </div>
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
            to="/settings"
            className={({ isActive }) => (isActive ? 'tab tab--active' : 'tab')}
          >
            Settings
          </NavLink>
        </nav>
        <div className="top-bar__right">
          <button
            className="primary"
            type="button"
            onClick={() => navigate('/add')}
          >
            Add show
          </button>
          <div className="profile-chip">
            <span>{activeProfile.name}</span>
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
              />
            }
          />
          <Route
            path="/calendar"
            element={
              <CalendarPage calendar={calendar} />
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
                onExport={handleExport}
                onImport={handleImport}
                onLogout={handleLogout}
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
  const [collapsedCategories, setCollapsedCategories] = useState(() => ({
    completed: true,
    stopped: true,
  }));

  const toggleCategory = (categoryId) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  };

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Watch Queue</h2>
          <p className="muted">Your shows sorted by what to watch next.</p>
        </div>
      </div>
        {loadingShows ? (
          <div className="empty-state">Loading shows...</div>
        ) : (
          categories.map((category) => (
            <div
              key={category.id}
              className={`category category--${category.id}`}
            >
              <button
                type="button"
                className="category__header"
                aria-expanded={!collapsedCategories[category.id]}
                aria-controls={`category-${category.id}`}
                onClick={() => toggleCategory(category.id)}
              >
                <div className="category__title">{category.label}</div>
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
                  collapsedCategories[category.id]
                    ? 'category__body--closed'
                    : 'category__body--open'
                }`}
                aria-hidden={collapsedCategories[category.id]}
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
                          <div>
                            <h3>{show.name}</h3>
                            <span className="tag">{STATE_LABELS[show.state]}</span>
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
                                {show.stats.releasedUnwatched} released left
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
    </section>
  );
}

function AddShowPage({
  searchQuery,
  searchResults,
  searchError,
  hasSearched,
  onSearchQuery,
  onSearch,
  onAddShow,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

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
          <button className="primary" type="submit">
            Search
          </button>
        </form>
      </div>
      {searchResults.length > 0 && (
        <div className="search-results">
          {searchResults.map((result) => (
            <div key={result.id} className="search-card">
              {result.image ? (
                <img src={result.image} alt={result.name} />
              ) : (
                <div className="image-fallback" />
              )}
              <div>
                <h3>{result.name}</h3>
                <p className="muted">
                  {result.summary || 'No summary available.'}
                </p>
              </div>
              {result.existingState ? (
                <span className="badge badge--muted">
                  {STATE_LABELS[result.existingState] || 'Added'}
                </span>
              ) : (
                <button
                  className="outline"
                  onClick={() => onAddShow(result.id)}
                >
                  Add
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {hasSearched && !searchError && searchResults.length === 0 && (
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
}) {
  const navigate = useNavigate();
  const params = useParams();
  const showId = Number(params.id);

  useEffect(() => {
    if (!Number.isNaN(showId)) {
      onLoadShowDetail(showId);
    }
  }, [showId, onLoadShowDetail]);

  if (Number.isNaN(showId)) {
    return (
      <section className="panel">
        <div className="empty-state">Invalid show.</div>
        <button className="outline" onClick={() => navigate('/shows')}>
          Back to shows
        </button>
      </section>
    );
  }

  if (!showDetail && loading) {
    return (
      <section className="panel">
        <div className="empty-state">Loading show...</div>
      </section>
    );
  }

  if (!showDetail && !loading) {
    return (
      <section className="panel">
        <div className="empty-state">Show not found.</div>
        <button className="outline" onClick={() => navigate('/shows')}>
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
      onBack={() => navigate('/shows')}
      onToggleEpisode={onToggleEpisode}
      onToggleSeason={onToggleSeason}
      onUpdateShowStatus={onUpdateShowStatus}
    />
  );
}

function CalendarPage({ calendar }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Upcoming Episodes</h2>
          <p className="muted">Next {calendar.days} days across your shows.</p>
        </div>
      </div>
      {calendar.episodes.length === 0 ? (
        <div className="empty-state">No upcoming episodes found.</div>
      ) : (
        <div className="calendar-list">
          {calendar.episodes.map((episode) => (
            <div key={episode.id} className="calendar-card">
              <div className="calendar-card__image">
                {episode.showImage ? (
                  <img src={episode.showImage} alt={episode.showName} />
                ) : (
                  <div className="image-fallback" />
                )}
              </div>
              <div className="calendar-card__body">
                <div className="calendar-card__meta">
                  <AirdateBadge airdate={episode.airdate} />
                </div>
                <h3 className="calendar-card__show">{episode.showName}</h3>
                <h4 className="calendar-card__episode">
                  {formatEpisodeCode(episode)} - {episode.name}
                </h4>
                {episode.airtime && (
                  <p className="muted">Airs at {episode.airtime}</p>
                )}
                <p className="muted">
                  {episode.summary || 'No episode summary available.'}
                </p>
              </div>
            </div>
          ))}
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
  onExport,
  onImport,
  onLogout,
}) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Settings</h2>
          <p className="muted">Manage profiles, exports, and account access.</p>
          <p className="muted settings-version">Version {appVersion}</p>
        </div>
        <button className="outline" onClick={onLogout}>
          Log out
        </button>
      </div>
      <div className="settings-grid">
        <div className="settings-card">
          <h3>Profiles</h3>
          <p className="muted">Switch or add a profile for another viewer.</p>
          <div className="profile-list">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                className={
                  profile.id === activeProfile.id ? 'chip chip--active' : 'chip'
                }
                onClick={() => onProfileSelect(profile.id)}
              >
                {profile.name}
              </button>
            ))}
          </div>
          <ProfileCreateInline onCreate={onProfileCreate} />
        </div>
        <div className="settings-card">
          <h3>Import / Export</h3>
          <p className="muted">Download a JSON backup or import JSON/CSV TVmaze IDs.</p>
          <div className="button-row">
            <button className="primary" onClick={onExport}>
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
      <h3>Change password</h3>
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
          className={isSubmitting ? 'primary is-disabled' : 'primary'}
          type="submit"
          disabled={isSubmitting}
        >
          Update password
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
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
          <div className="brand__dot" />
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await onCreate(name.trim());
      setName('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <input
        placeholder="New profile name"
        value={name}
        onChange={(event) => setName(event.target.value)}
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
}) {
  const [openSeasons, setOpenSeasons] = useState({});

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

  const toggleSeasonOpen = (seasonNumber) => {
    const key = String(seasonNumber);
    setOpenSeasons((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!show) return null;
  return (
    <section className="panel show-detail">
      <div className="panel__header">
        <div className="show-detail__heading">
          <button className="outline" onClick={onBack}>
            Back to shows
          </button>
          <div className="show-detail__title">
            <div className="show-detail__title-row">
              <h2>{show.name}</h2>
              {show.profileStatus === 'stopped' && (
                <span className="badge badge--muted">Stopped Watching</span>
              )}
            </div>
            <p className="muted">
              {show.status || 'Unknown status'}
              {show.premiered ? ` - Premiered ${show.premiered}` : ''}
              {show.ended ? ` - Ended ${show.ended}` : ''}
            </p>
          </div>
        </div>
        <button
          className="outline"
          type="button"
          onClick={() =>
            onUpdateShowStatus(
              show.id,
              show.profileStatus === 'stopped' ? null : 'stopped'
            )
          }
        >
          {show.profileStatus === 'stopped' ? 'Resume Watching' : 'Stop Watching'}
        </button>
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
      {loading && <div className="empty-state">Loading episodes...</div>}
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
                  <div>
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
