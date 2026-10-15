const { isDeepStrictEqual: equal } = require('node:util');
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
    ['users', ['email']], ['classes', ['code']], ['submissions', ['assignmentId', 'studentId']],
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

module.exports = { mergeState };
