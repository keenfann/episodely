import { createRequire } from 'node:module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath =
  process.env.DB_PATH || path.resolve(__dirname, '..', 'db', 'episodely.sqlite');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    last_profile_id INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tvmaze_id INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL,
    summary TEXT,
    status TEXT,
    premiered TEXT,
    ended TEXT,
    image_medium TEXT,
    image_original TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id INTEGER NOT NULL,
    tvmaze_id INTEGER NOT NULL UNIQUE,
    season INTEGER NOT NULL,
    number INTEGER,
    name TEXT,
    summary TEXT,
    airdate TEXT,
    airtime TEXT,
    runtime INTEGER,
    image_medium TEXT,
    image_original TEXT,
    FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS profile_shows (
    profile_id INTEGER NOT NULL,
    show_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT,
    PRIMARY KEY (profile_id, show_id),
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (show_id) REFERENCES shows(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS profile_episodes (
    profile_id INTEGER NOT NULL,
    episode_id INTEGER NOT NULL,
    watched_at TEXT,
    PRIMARY KEY (profile_id, episode_id),
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_episodes_show_id ON episodes(show_id);
  CREATE INDEX IF NOT EXISTS idx_profile_episodes_profile_id
    ON profile_episodes(profile_id);

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
`);

const userColumns = db
  .prepare('PRAGMA table_info(users)')
  .all()
  .map((column) => column.name);

if (!userColumns.includes('last_profile_id')) {
  db.exec('ALTER TABLE users ADD COLUMN last_profile_id INTEGER;');
}

const profileShowColumns = db
  .prepare('PRAGMA table_info(profile_shows)')
  .all()
  .map((column) => column.name);

if (!profileShowColumns.includes('status')) {
  db.exec('ALTER TABLE profile_shows ADD COLUMN status TEXT;');
}

const showColumns = db
  .prepare('PRAGMA table_info(shows)')
  .all()
  .map((column) => column.name);

if (!showColumns.includes('imdb_id')) {
  db.exec('ALTER TABLE shows ADD COLUMN imdb_id TEXT;');
}

export default db;
