const { isDeepStrictEqual: equal } = require('node:util');
const { get, put, BlobPreconditionFailedError } = require('@vercel/blob');

function conflict() {
  const error = new Error('This record was changed by another request. Refresh and try again.');
  error.status = 409;
  return error;
}

// Merge independent records, but never overwrite somebody else's edit to the
// same record. This also preserves concurrent logins and new registrations.
function mergeState(base, next, latest) {
  const merged = structuredClone(latest);
  for (const key of Object.keys(next)) {
    if (equal(base[key], next[key])) continue;
    if (!Array.isArray(next[key])) {
      if (!equal(base[key], latest[key]) && !equal(next[key], latest[key])) throw conflict();
      merged[key] = next[key];
      continue;
    }
    const identity = row => row.id || row.token || row.nonce;
    const before = new Map(base[key].map(row => [identity(row), row]));
    const after = new Map(next[key].map(row => [identity(row), row]));
    const current = new Map(latest[key].map(row => [identity(row), row]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (!id) throw new Error('Stored records require a stable identifier.');
      if (equal(before.get(id), after.get(id))) continue;
      if (!equal(before.get(id), current.get(id)) && !equal(after.get(id), current.get(id))) throw conflict();
      if (after.has(id)) current.set(id, after.get(id));
      else current.delete(id);
    }
    merged[key] = [...current.values()];
  }
  for (const [collection, fields] of [
    ['users', ['email']], ['submissions', ['assignmentId', 'studentId']],
    ['attendance', ['classId', 'date', 'studentId']], ['attempts', ['quizId', 'studentId']],
    ['links', ['guardianId', 'studentId']]
  ]) {
    const seen = new Set();
    for (const row of merged[collection] || []) {
      const key = JSON.stringify(fields.map(field => row[field]));
      if (seen.has(key)) throw conflict();
      seen.add(key);
    }
  }
  return merged;
}

function createCloudStorage(seed) {
  const prefix = process.env.SMARTCLASS_STORAGE_PREFIX || 'smartclass/production';
  const pathname = prefix + '/state.json';
  const options = { access: 'private', addRandomSuffix: false };
  // Read the identity representation: compression can produce a weak ETag,
  // which is not valid for the storage API's conditional writes.
  const readOptions = { access: 'private', useCache: false, headers: { 'Accept-Encoding': 'identity' } };
  async function read() {
    let result = await get(pathname, readOptions);
    if (!result) {
      try { await put(pathname, JSON.stringify(seed()), { ...options, contentType: 'application/json', allowOverwrite: false }); }
      catch (error) {
        // A second cold start may have initialized the store concurrently.
        result = await get(pathname, readOptions);
        if (!result) throw error;
      }
      result ||= await get(pathname, readOptions);
    }
    if (!result) throw new Error('Unable to initialize private storage.');
    return { state: await new Response(result.stream).json(), etag: result.blob.etag };
  }
  return {
    read,
    async commit(base, next, etag) {
      let candidate = next;
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          await put(pathname, JSON.stringify(candidate), { ...options, contentType: 'application/json', allowOverwrite: true, ifMatch: etag });
          return;
        } catch (error) {
          if (!(error instanceof BlobPreconditionFailedError)) throw error;
          const latest = await read();
          candidate = mergeState(base, next, latest.state);
          etag = latest.etag;
        }
      }
      throw conflict();
    },
    async putFile(id, buffer) {
      await put(prefix + '/files/' + id, buffer, { ...options, contentType: 'application/octet-stream' });
    },
    async getFile(id) {
      const result = await get(prefix + '/files/' + id, { access: 'private', useCache: false });
      return result ? Buffer.from(await new Response(result.stream).arrayBuffer()) : null;
    }
  };
}
module.exports = { createCloudStorage, mergeState };
