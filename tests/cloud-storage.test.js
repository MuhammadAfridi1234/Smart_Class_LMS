const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeState, createCloudStorage } = require('../cloud-storage');

test('cloud merge preserves concurrent logins and unrelated edits', () => {
  const base = { users: [{ id: 'a', email: 'a@example.com', name: 'A' }], sessions: [] };
  const next = structuredClone(base);
  next.sessions.push({ token: 'session-a', userId: 'a' });
  const latest = structuredClone(base);
  latest.users[0].name = 'Updated';
  latest.sessions.push({ token: 'session-b', userId: 'a' });
  const merged = mergeState(base, next, latest);
  assert.equal(merged.users[0].name, 'Updated');
  assert.deepEqual(merged.sessions.map(s => s.token), ['session-b', 'session-a']);
});

test('cloud merge rejects conflicting edits and duplicate registrations', () => {
  const base = { users: [{ id: 'a', email: 'a@example.com', name: 'A' }] };
  const next = structuredClone(base), latest = structuredClone(base);
  next.users[0].name = 'First edit'; latest.users[0].name = 'Second edit';
  assert.throws(() => mergeState(base, next, latest), { status: 409 });
  const empty = { users: [] };
  assert.throws(() => mergeState(empty, { users: [{id:'a',email:'same@example.com'}] }, { users: [{id:'b',email:'same@example.com'}] }), { status: 409 });
});

test('private cloud storage persists across clients, merges writes and serves attachments', {
  skip: !process.env.TEST_CLOUD_STORAGE
}, async () => {
  // A separate namespace ensures this verification never changes classroom data.
  process.env.SMARTCLASS_STORAGE_PREFIX = 'smartclass/verification-' + Date.now();
  const a = createCloudStorage(() => ({ users: [], sessions: [], description: 'Large compressible classroom state. '.repeat(300) }));
  const b = createCloudStorage(() => ({ users: [], sessions: [] }));
  const first = await a.read(), second = await b.read();
  const left = structuredClone(first.state), right = structuredClone(second.state);
  left.sessions.push({ token: 'a' }); right.sessions.push({ token: 'b' });
  await Promise.all([a.commit(first.state, left, first.etag), b.commit(second.state, right, second.etag)]);
  const result = await createCloudStorage(() => ({})).read();
  assert.deepEqual(result.state.sessions.map(s => s.token).sort(), ['a','b']);
  await Promise.all(Array.from({length:6},async(_,i)=>{
    const client=createCloudStorage(()=>({}));
    const before=await client.read();
    const next=structuredClone(before.state);
    next.sessions.push({token:'parallel-'+i});
    await client.commit(before.state,next,before.etag);
  }));
  assert.equal((await a.read()).state.sessions.length,8);
  await a.putFile('sample', Buffer.from('private attachment verification'));
  assert.equal((await b.getFile('sample')).toString(), 'private attachment verification');
});
