import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || '';

function App() {
  const [health, setHealth] = useState('checking...');

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((response) => response.json())
      .then((data) => setHealth(data.status || 'unknown'))
      .catch(() => setHealth('offline'));
  }, []);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Episodely</h1>
        <p>Track shows and movies with a simple, self-hosted stack.</p>
      </header>
      <section className="app__panel">
        <h2>API status</h2>
        <p className="app__status">{health}</p>
      </section>
      <section className="app__panel">
        <h2>Next steps</h2>
        <ul>
          <li>Model shows, seasons, and episodes in SQLite.</li>
          <li>Add a watchlist view and calendar.</li>
          <li>Implement import and export workflows.</li>
        </ul>
      </section>
    </div>
  );
}

export default App;
