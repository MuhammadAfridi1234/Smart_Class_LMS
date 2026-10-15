# Netlify deployment

This is a vanilla HTML/CSS/JavaScript frontend with an Express API, not a framework build. No live deployment has been performed.

## Settings and import

1. Create a Netlify site by importing `MuhammadAfridi1234/Smart_Class_LMS` from GitHub, after committing these changes.
2. Base directory: repository root (leave blank). Build: `npm run build:netlify`. Publish: `public`. Functions: `netlify/functions`. Node: 24, specified in netlify.toml. Set `AWS_LAMBDA_JS_RUNTIME=nodejs24.x` in Netlify's environment settings to pin the function runtime as well.
3. Configure runtime environment variables below and import the database before accepting traffic.
4. Deploy and run the verification below. The Vercel deployment configuration has been removed. Disable the old project’s Git auto-deployment in Vercel before updating its production branch; repository changes alone do not disconnect that service.

The build copies Chart.js into public/vendor/chart.js, preserving the existing frontend and offline service worker URL. Only `/api/*` rewrites to the Express function. Missing static paths return 404; no SPA fallback is needed. Function source and database files are outside the publish directory. Static security headers mirror Express headers.

Official references: [Express on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/express/), [function configuration](https://docs.netlify.com/build/functions/configuration/), [node-postgres transactions](https://node-postgres.com/features/transactions), [TLS configuration](https://node-postgres.com/features/ssl).

## Environment variables

| Variable | Netlify value / purpose |
| --- | --- |
| DATABASE_URL | Required: managed PostgreSQL pooled connection URL supplied by your provider. Configure provider-required TLS with certificate verification (for example sslmode=verify-full). Keep private; runtime/functions scope. |
| AWS_LAMBDA_JS_RUNTIME | nodejs24.x; configure before building |
| COOKIE_SECURE | 1 in production; secure cookies are automatic when NETLIFY is set |
| BASE_URL | Your HTTPS site/custom domain, no trailing slash. Local development uses this; serverless QR URLs use the request host so previews stay on their own origin. |
| OPENROUTER_API_KEY | Optional secret, manually supplied to enable AI |
| OPENROUTER_MODEL | Optional provider model identifier; required with the key for AI |
| NODE_VERSION | 24; already in netlify.toml for builds |

NETLIFY is supplied by the platform. PORT and DATA_DIR are local-only settings. BLOB_READ_WRITE_TOKEN and SMARTCLASS_STORAGE_PREFIX are for the existing Vercel deployment or read-only migration source, not required on Netlify. DATABASE_URL takes precedence over other storage settings; do not add it to Vercel unless intentionally switching that deployment too. Use separate databases for production and previews. No signing secret is needed by the existing session mechanism: opaque session tokens are persisted in the state. This branch preserves the latest GitHub open email sign-in behavior, which does not verify passwords; anyone who knows an account email can sign in. Review that existing authentication behavior before public release.

## Durable storage

Provision managed PostgreSQL reachable from Netlify (for example a Neon or Supabase PostgreSQL database), with backups and a pooled endpoint. Choose a region near your functions. Tables `smartclass_state` (JSONB) and `smartclass_files` (private BYTEA) preserve the existing record format, password hashes, sessions and upload bytes without a Vercel dependency. All file downloads still pass through existing authorization.

Successful state changes commit before the HTTP response finishes. A transaction locks the latest state row and merges independent record edits; conflicting edits or duplicate unique records return 409 rather than overwrite. Connection pools are limited to two connections per function instance. This retains the current whole-state design: large datasets and heavy write workloads should eventually use normalized tables. Failed uploads/state commits can leave unreferenced file rows, but never advertise a missing successfully written file. Do not delete files without checking references.

Schema creation and data import are explicit. An uninitialized/unreachable database returns 503; no demo seeding or temporary disk fallback occurs on Netlify. `/api/health` reports configuration only, not database connectivity: verify `/api/auth/login` and `/api/state` too.

## Safe migration

Use a dedicated EMPTY destination database. Back up the source and destination first. Pause source writes during export/import and verification, including logins; otherwise a snapshot cannot include changes made afterward. The scripts never modify the source. Do not point both Vercel and Netlify at independently writable copies after cutover: choose one writer, or intentionally move both to the same PostgreSQL database.

Set destination DATABASE_URL in a local private .env or process environment (never commit it). For Vercel source also set BLOB_READ_WRITE_TOKEN and the existing SMARTCLASS_STORAGE_PREFIX. Then run:

```powershell
npm ci
npm run migrate:postgres -- vercel
```

For a local SQLite source (with its adjacent uploaded files):

```powershell
npm run migrate:postgres -- sqlite C:/path/to/data/smartclass.sqlite
```

The import uses one transaction, copies every referenced file, verifies byte lengths, and preserves all state collections and session tokens. A missing file aborts the entire transaction. Any nonempty destination is refused, so repeated runs cannot overwrite an earlier import. If an import fails, correct the issue and retry against the empty destination. For a fresh installation, first run the app locally to initialize its SQLite database, then import it; that source contains the existing demo accounts and passwords, which must be secured before public use.

Verify account counts, class counts, representative records and file downloads before routing users to Netlify. Keep Vercel and its data for rollback. Cookies are domain-bound: users must log in again on the new Netlify domain even though session records are retained. Offline browser caches/local data also do not transfer between domains. Rollback after accepting Netlify writes requires a planned reverse data transfer; switching back to the old copy would lose those new changes.

## Verification

```powershell
npm ci
npm test
npm run test:ui
npm run build:netlify
npx netlify dev
```

Local Netlify Dev: open http://localhost:8888; check `/`, `/app.js`, `/vendor/chart.js`, `/qrcode.js`, `/sw.js`, and `/api/health`. Set DATABASE_URL to a disposable imported database to test the real PostgreSQL path. Never test writes against production. Node handler tests simulate Lambda events including binary multipart uploads; transaction unit tests use a mock client and do not prove remote database durability.

After deploying, verify same-origin login/register for each role, Secure/HttpOnly/SameSite cookies, logout, role restrictions, all classroom workflows, QR HTTPS links, binary uploads/downloads and forbidden downloads. Verify AI with configured credentials. Restart/redeploy, then verify the same users, records and files persist. Run simultaneous logins and independent writes; same-record conflicts should return 409. Test mobile layout and offline reload after first loading online. Confirm preview isolation and custom domain behavior.

Local Netlify CLI 27.12.1 verification (`netlify dev --offline`): `/`, `/app.js`, `/vendor/chart.js`, `/qrcode.js` and `/sw.js` returned 200; missing static asset returned 404; `/api/health` returned 200 with persistentStorage=false; login returned 503 without database credentials, as intended. A separate `functions:build` attempt did not complete during verification; verify the full production build in Netlify before release.

Local results: 10 automated tests passed on the publication branch, one existing live Vercel Blob test skipped without credentials; four Playwright browser tests passed in the original workspace. PostgreSQL provider connectivity, real concurrent transactions, remote persistence, Netlify platform routing/runtime and live AI remain deployment checks until credentials are available.

## Troubleshooting and limits

- 503 on login: check DATABASE_URL scope, network/TLS, schema and completed import. No filesystem fallback is intentional.
- 404 API: ensure the repository root/base directory and netlify.toml are used, and the api function was built. The handler accepts original and rewritten function paths.
- Missing Chart.js: run the configured build; generated vendor file is ignored by Git.
- 403 origin: use one HTTPS host consistently. Express trusts the platform proxy; custom domains must send the correct host and forwarded protocol.
- 409: refresh before retrying the edit; concurrent changes are preserved.
- 413: synchronous Netlify/Lambda payload limits include base64 overhead. The app retains its 4 MiB upload limit, but multipart overhead/platform limits can reject boundary-sized requests. Downloads also have buffered response limits; large reports may require streaming or signed object storage in a future change.
- AI: requests retain the existing 30-second upstream timeout; provider latency and the platform function deadline can still cause failures.
- Authentication throttling is the existing per-instance in-memory limiter; it is not a global rate limit across serverless instances. Consider a shared limiter for public production abuse protection.
- Publication uses a clean clone because the original workspace has invalid Git worktree metadata. The migration branch preserves the latest GitHub login behavior.
