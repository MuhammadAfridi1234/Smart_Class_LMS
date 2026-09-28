const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const path = require('node:path');

// Every request gets an isolated snapshot and commits before returning success.
// Local writes are serialized; cloud writes use conditional updates.
function createStorage(seed) {
  const context = new AsyncLocalStorage();
  const cloud = process.env.BLOB_READ_WRITE_TOKEN ? require('./cloud-storage').createCloudStorage(seed) : null;
  let db, read, write;
  const dataDir = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/smartclass-data' : path.join(__dirname, 'data'));
  if (!cloud && !process.env.VERCEL) {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(path.join(dataDir, 'smartclass.sqlite'));
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS store (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    read = db.prepare('SELECT value FROM store WHERE id=1');
    write = db.prepare('INSERT INTO store VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value');
    if (!read.get()) write.run(JSON.stringify(seed()));
  }
  const state = new Proxy({}, {
    get: (_, key) => context.getStore().state[key],
    set: (_, key, value) => { context.getStore().state[key] = value; return true; }
  });
  let localQueue = Promise.resolve();
  async function middleware(req, res, next) {
    if (!cloud && process.env.VERCEL) return res.status(503).json({ error: 'Cloud storage is not configured. Connect the private storage before signing in.' });
    let unlock;
    try {
      let snapshot, etag;
      if (cloud) {
        const loaded = await cloud.read();
        snapshot = loaded.state;
        etag = loaded.etag;
      } else {
        const previous = localQueue;
        localQueue = new Promise(resolve => { unlock = resolve; });
        await previous;
        snapshot = JSON.parse(read.get().value);
      }
      const request = { state: structuredClone(snapshot), dirty: false };
      const end = res.end.bind(res);
      let finished = false;
      async function finish(args, aborted = false) {
        if (finished) return;
        finished = true;
        try {
          const success = !aborted && res.statusCode < 400;
          if (success && request.dirty) {
            if (cloud) await cloud.commit(snapshot, request.state, etag);
            else write.run(JSON.stringify(request.state));
          }
        } catch (error) {
          console.error('Database save failed:', error.message);
          res.statusCode = error.status || 503;
          res.removeHeader('Set-Cookie');
          res.removeHeader('Content-Length');
          res.setHeader('Content-Type', 'application/json');
          args = [JSON.stringify({ error: error.status === 409 ? error.message : 'Unable to save your changes. Please try again.' })];
        } finally {
          unlock?.();
        }
        if (!aborted) end(...args);
      }
      res.end = (...args) => { void finish(args); return res; };
      res.once('close', () => { if (!finished) void finish([], true); });
      context.run(request, next);
    } catch (error) {
      unlock?.();
      console.error('Database unavailable:', error.message);
      res.status(503).json({ error: 'The database is temporarily unavailable. Please try again.' });
    }
  }
  return {
    state, middleware, persistent: Boolean(cloud) || !process.env.VERCEL,
    save: () => { context.getStore().dirty = true; },
    async putFile(id, buffer) {
      if (cloud) await cloud.putFile(id, buffer);
      else fs.writeFileSync(path.join(dataDir, id), buffer);
    },
    async getFile(id) {
      if (cloud) return cloud.getFile(id);
      try { return fs.readFileSync(path.join(dataDir, id)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    close: () => db?.close()
  };
}
module.exports = { createStorage };
