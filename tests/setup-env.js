import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'episodely-tests-'));

process.env.DB_PATH = path.join(tmpRoot, 'episodely.sqlite');
process.env.SESSION_SECRET = 'test-session-secret';
process.env.TVMAZE_SYNC_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.TZ = 'UTC';

globalThis.fetch = () => {
  throw new Error('Unexpected fetch in tests. Mock the call instead.');
};
