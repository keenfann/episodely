import session from 'express-session';
import db from './db.js';

const DEFAULT_CLEANUP_MS = 60 * 60 * 1000;

class SqliteSessionStore extends session.Store {
  constructor({ cleanupIntervalMs = DEFAULT_CLEANUP_MS } = {}) {
    super();
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.startCleanup();
  }

  get(sid, callback) {
    try {
      const row = db
        .prepare('SELECT sess, expires FROM sessions WHERE sid = ?')
        .get(sid);
      if (!row) {
        return callback(null, null);
      }
      if (row.expires && row.expires <= Date.now()) {
        this.destroy(sid, () => callback(null, null));
        return;
      }
      const data = JSON.parse(row.sess);
      return callback(null, data);
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sess, callback) {
    try {
      const expires = getExpiresAt(sess);
      db.prepare(
        `INSERT INTO sessions (sid, sess, expires)
         VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`
      ).run(sid, JSON.stringify(sess), expires);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  destroy(sid, callback) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  touch(sid, sess, callback) {
    try {
      const expires = getExpiresAt(sess);
      db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(
        expires,
        sid
      );
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  startCleanup() {
    if (!this.cleanupIntervalMs) return;
    this.cleanupTimer = setInterval(() => {
      try {
        db.prepare('DELETE FROM sessions WHERE expires IS NOT NULL AND expires <= ?')
          .run(Date.now());
      } catch (error) {
        console.warn('Session cleanup failed.', error);
      }
    }, this.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }
}

function getExpiresAt(sess) {
  if (sess?.cookie?.expires) {
    return new Date(sess.cookie.expires).getTime();
  }
  if (typeof sess?.cookie?.maxAge === 'number') {
    return Date.now() + sess.cookie.maxAge;
  }
  return null;
}

export default SqliteSessionStore;
