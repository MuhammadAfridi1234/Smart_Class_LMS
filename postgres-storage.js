const { Pool } = require('pg');
const { mergeState } = require('./state-merge');
const schema = `CREATE TABLE IF NOT EXISTS smartclass_state (id integer PRIMARY KEY CHECK(id=1), value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS smartclass_files (id text PRIMARY KEY, content bytea NOT NULL);`;
function createPostgresStorage(pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, allowExitOnIdle: true })) {
  pool.on?.('error', error => console.error('Idle database connection failed:', error.message));
  return {
    async read() {
      const { rows } = await pool.query('SELECT value FROM smartclass_state WHERE id=1');
      if (!rows.length) throw new Error('Database is not initialized. Run the migration before deployment.');
      return { state: rows[0].value };
    },
    async commit(base, next) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        const { rows } = await client.query('SELECT value FROM smartclass_state WHERE id=1 FOR UPDATE');
        if (!rows.length) throw new Error('Database is not initialized.');
        const merged = mergeState(base, next, rows[0].value);
        await client.query('UPDATE smartclass_state SET value=$1 WHERE id=1', [JSON.stringify(merged)]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    async putFile(id, buffer) {
      await pool.query('INSERT INTO smartclass_files (id,content) VALUES ($1,$2)', [id, buffer]);
    },
    async getFile(id) {
      return (await pool.query('SELECT content FROM smartclass_files WHERE id=$1', [id])).rows[0]?.content || null;
    },
    close: () => pool.end()
  };
}
module.exports = { createPostgresStorage, schema };
