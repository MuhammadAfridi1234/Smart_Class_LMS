
const { get, put, BlobPreconditionFailedError } = require('@vercel/blob');

const { mergeState } = require('./state-merge');
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
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          await put(pathname, JSON.stringify(candidate), { ...options, contentType: 'application/json', allowOverwrite: true, ifMatch: etag });
          return;
        } catch (error) {
          // Blob can report simultaneous conditional PUTs as a transient
          // operation conflict rather than a precondition failure. Both need
          // a fresh snapshot and a conditional retry, never an unconditional PUT.
          const operationConflict = error.message?.includes('conditional request cannot succeed due to a conflicting operation');
          if (!(error instanceof BlobPreconditionFailedError) && !operationConflict) throw error;
          await new Promise(resolve => setTimeout(resolve, 30 + attempt * 20 + Math.random() * 80));
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
