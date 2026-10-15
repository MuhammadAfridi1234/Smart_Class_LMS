// Read-only source, all-or-nothing destination import. Never merges or overwrites.
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { schema } = require('../postgres-storage');
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Set destination DATABASE_URL.');
  const source = process.argv[2];
  let state, getFile;
  if (source === 'vercel') {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Set source BLOB_READ_WRITE_TOKEN.');
    const { get } = require('@vercel/blob');
    const prefix = process.env.SMARTCLASS_STORAGE_PREFIX || 'smartclass/production';
    const read = async key => {
      const result = await get(key, { access: 'private', useCache: false });
      if (!result) throw new Error('Missing source blob: ' + key);
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    };
    state = JSON.parse((await read(prefix + '/state.json')).toString());
    getFile = id => read(prefix + '/files/' + id);
  } else if (source === 'sqlite' && process.argv[3]) {
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(path.resolve(process.argv[3]), { readOnly: true });
    try { state = JSON.parse(database.prepare('SELECT value FROM store WHERE id=1').get().value); }
    finally { database.close(); }
    getFile = id => fs.promises.readFile(path.join(path.dirname(path.resolve(process.argv[3])), id));
  } else throw new Error('Usage: node scripts/migrate-postgres.js vercel | sqlite path/to/smartclass.sqlite');
  if (!Array.isArray(state.users) || !Array.isArray(state.files) || !Array.isArray(state.sessions)) throw new Error('Invalid source state.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(schema);
    await client.query('LOCK TABLE smartclass_state, smartclass_files IN ACCESS EXCLUSIVE MODE');
    const result = await client.query('SELECT (SELECT count(*) FROM smartclass_state) + (SELECT count(*) FROM smartclass_files) AS count');
    if (Number(result.rows[0].count)) throw new Error('Destination is not empty. Refusing to overwrite.');
    for (const file of state.files) {
      if (!/^[a-zA-Z0-9_-]+$/.test(file.id)) throw new Error('Invalid source file identifier.');
      const content = await getFile(file.id);
      if (content.length !== file.size) throw new Error('File size mismatch: ' + file.id);
      await client.query('INSERT INTO smartclass_files VALUES ($1,$2)', [file.id, content]);
    }
    await client.query('INSERT INTO smartclass_state VALUES (1,$1)', [JSON.stringify(state)]);
    await client.query('COMMIT');
    console.log('Imported state and ' + state.files.length + ' files. Source unchanged.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
