const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const path = require('node:path');

// Every request gets its own snapshot. PostgreSQL's row lock serializes writes
// across Vercel instances; a response is sent only after its transaction commits.
function createStorage(seed) {
  const context = new AsyncLocalStorage();
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  let pool, db, read, write, ready;
  const dataDir = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/smartclass-data' : path.join(__dirname, 'data'));
  if (connectionString) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
    pool.on('error', error => console.error('Database connection failed:', error.message));
  } else {
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
  function initialize() {
    if (!ready) ready = (async () => {
      await pool.query('CREATE TABLE IF NOT EXISTS smartclass_store (id INTEGER PRIMARY KEY, value JSONB NOT NULL)');
      await pool.query('CREATE TABLE IF NOT EXISTS smartclass_files (id TEXT PRIMARY KEY, content BYTEA NOT NULL)');
      await pool.query('INSERT INTO smartclass_store (id,value) VALUES (1,$1) ON CONFLICT (id) DO NOTHING', [JSON.stringify(seed())]);
    })().catch(error => { ready = null; throw error; });
    return ready;
  }
  let localQueue = Promise.resolve();
  async function middleware(req, res, next) {
    let client, unlock;
    try {
      let snapshot;
      if (pool) {
        await initialize();
        client = await pool.connect();
        await client.query('BEGIN');
        const result = await client.query('SELECT value FROM smartclass_store WHERE id=1 FOR UPDATE');
        snapshot = result.rows[0].value;
      } else {
        const previous = localQueue;
        localQueue = new Promise(resolve => { unlock = resolve; });
        await previous;
        snapshot = JSON.parse(read.get().value);
      }
      const request = { state: snapshot, dirty: false, client };
      const end = res.end.bind(res);
      let finished = false;
      async function finish(args, aborted = false) {
        if (finished) return;
        finished = true;
        try {
          const success = !aborted && res.statusCode < 400;
          if (client) {
            if (success && request.dirty) await client.query('UPDATE smartclass_store SET value=$1 WHERE id=1', [JSON.stringify(request.state)]);
            await client.query(success ? 'COMMIT' : 'ROLLBACK');
          } else if (success && request.dirty) write.run(JSON.stringify(request.state));
        } catch (error) {
          if (client) await client.query('ROLLBACK').catch(() => {});
          console.error('Database save failed:', error.message);
          res.statusCode = 503;
          res.removeHeader('Set-Cookie');
          res.removeHeader('Content-Length');
          res.setHeader('Content-Type', 'application/json');
          args = [JSON.stringify({ error: 'Unable to save your changes. Please try again.' })];
        } finally {
          client?.release();
          unlock?.();
        }
        if (!aborted) end(...args);
      }
      res.end = (...args) => { void finish(args); return res; };
      res.once('close', () => { if (!finished) void finish([], true); });
      context.run(request, next);
    } catch (error) {
      if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
      unlock?.();
      console.error('Database unavailable:', error.message);
      res.status(503).json({ error: 'The database is temporarily unavailable. Please try again.' });
    }
  }
  return {
    state, middleware, persistent: Boolean(pool) || !process.env.VERCEL,
    save: () => { context.getStore().dirty = true; },
    async putFile(id, buffer) {
      if (pool) await context.getStore().client.query('INSERT INTO smartclass_files (id,content) VALUES ($1,$2)', [id, buffer]);
      else fs.writeFileSync(path.join(dataDir, id), buffer);
    },
    async getFile(id) {
      if (pool) return (await context.getStore().client.query('SELECT content FROM smartclass_files WHERE id=$1', [id])).rows[0]?.content;
      try { return fs.readFileSync(path.join(dataDir, id)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    close: () => pool ? pool.end() : db.close()
  };
}
module.exports = { createStorage };
