const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createStorage } = require('../storage');

test('concurrent requests, rollback, files and restart persistence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smartclass-storage-'));
  process.env.DATA_DIR = directory;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  const storage = createStorage(() => ({ count: 0 }));
  const app = express();
  app.use(storage.middleware);
  app.post('/increment', async (req, res) => {
    const count = storage.state.count;
    await new Promise(resolve => setTimeout(resolve, 5));
    storage.state.count = count + 1;
    storage.save();
    res.json({ count: storage.state.count });
  });
  app.post('/failure', (req, res) => {
    storage.state.count = -100;
    storage.save();
    res.status(400).json({ error: 'Invalid operation' });
  });
  app.post('/file', async (req, res) => {
    await storage.putFile('test-file', Buffer.from('Private attachment'));
    res.json({ ok: true });
  });
  app.get('/file', async (req, res) => res.send(await storage.getFile('test-file')));
  app.get('/', (req, res) => res.json({ count: storage.state.count }));
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://localhost:' + server.address().port;
  try {
    const results = await Promise.all(Array.from({ length: 8 }, async () => (await fetch(base + '/increment', { method: 'POST' })).json()));
    assert.deepEqual(results.map(r => r.count).sort((a, b) => a - b), [1,2,3,4,5,6,7,8]);
    assert.equal((await fetch(base + '/failure', { method: 'POST' })).status, 400);
    assert.equal((await (await fetch(base)).json()).count, 8);
    await fetch(base + '/file', { method: 'POST' });
    assert.equal(await (await fetch(base + '/file')).text(), 'Private attachment');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await storage.close();
  }
  const restarted = createStorage(() => ({ count: -1 }));
  const app2 = express();
  app2.use(restarted.middleware);
  app2.get('/', (req, res) => res.json({ count: restarted.state.count }));
  const server2 = app2.listen(0);
  await new Promise(resolve => server2.once('listening', resolve));
  try {
    assert.equal((await (await fetch('http://localhost:' + server2.address().port)).json()).count, 8);
  } finally {
    await new Promise(resolve => server2.close(resolve));
    await restarted.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
