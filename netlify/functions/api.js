// Enforce durable storage even in Netlify Dev and direct function invocation.
process.env.NETLIFY = 'true';
const serverless = require('serverless-http');
const app = require('../../server');
const handle = serverless(app, { binary: true });
exports.handler = (event, context) => {
  // Netlify may deliver the rewritten function path or the original API path.
  const prefix = '/.netlify/functions/api';
  const path = event.path?.startsWith(prefix + '/') ? event.path.slice(prefix.length) : event.path;
  return handle({ ...event, path }, context);
};
