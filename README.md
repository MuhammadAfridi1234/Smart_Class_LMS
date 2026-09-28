# SmartClass LMS

A working local LMS based on `Team_G_SmartClass.docx (1).pdf`. The frontend uses HTML, CSS and vanilla JavaScript. The backend uses JavaScript, Express and SQLite, following the requested JavaScript stack instead of the PDF's PHP/MySQL stack.

## Run

Install **Node.js 24 or newer**, then open a terminal in this folder:

```powershell
npm install
npm start
```

Open **http://localhost:3000**. No database installation or frontend build is required. The database is created automatically in `data/smartclass.sqlite` and persists across restarts.

On Windows, you can also double-click **Start-SmartClass.bat**. Keep its terminal window open while using the app.

The sign-in page has three demo buttons. You can also register your own accounts.

| Role | Email | Password |
| --- | --- | --- |
| Teacher | teacher@smartclass.local | password123 |
| Student | student@smartclass.local | password123 |
| Guardian | guardian@smartclass.local | password123 |

The demo student is enrolled in three sample classes. Guardian access starts empty and requires student approval. Sample classroom records are seeded once when a new database is created.

## Open the HTML with VS Code Live Server

1. Open the entire `Smart_Class_LMS` folder in VS Code so its workspace settings are loaded.
2. Start the backend using `npm start` or `Start-SmartClass.bat` and keep it running.
3. Open `public/index.html`, right-click, and choose **Open with Live Server**.
4. The frontend opens at `http://127.0.0.1:5500`. Use the demo login buttons as usual.

Live Server serves the `public` folder. The page automatically opens `http://localhost:3000` so login, cookies, attachments and charts use the same backend. Keep `npm start` running. CSS, JavaScript, QR generation and charts are local files. Stop and restart Live Server if it was already running when these settings changed. Login, saving data, uploads and reports require the Node backend; Live Server itself only serves frontend files.

Proxy configuration follows the [Live Server settings documentation](https://github.com/ritwickdey/vscode-live-server/blob/master/docs/settings.md).

## Try a complete classroom workflow

1. Sign in as Teacher. Create a class and copy its seven-character code.
2. Use another browser profile or private window for Student. Join the class with the code. Browser tabs share the same login session.
3. As Teacher, create an assignment with instructions, due date, points and an optional file.
4. As Student, submit text or a file. As Teacher, review it and save a grade and feedback.
5. Start a QR attendance session. As Student, paste its token into **Attendance → Enter attendance code**, or scan the QR code with a phone.
6. Create an MCQ quiz as Teacher, set it live, and complete it as Student. Scores are calculated on the server.
7. As Guardian, request a link to `student@smartclass.local`. Approve it in the student's **Guardian access** page, then view analytics and download a CSV report.

Additional workflows include class announcements and attachments, resource broadcasting, class chat and private messages, notifications, live polls, meeting links, calendar deadlines, profile editing, class archival and 48-hour restoration.

## Offline hand-ins

Sign in as a student while online so assignments and the application shell are cached. On this same browser tab/device, go offline. The offline classroom lets the student create and display a QR token for a saved assignment. Tokens are stored locally and survive refreshes. A teacher can scan the QR with a phone camera or copy its JSON text, then use **Assignment → Verify offline token**.

The teacher must check the student's identity and physical work before verification. Tokens are identifiers, not proof that work was completed. Verification records the submission on the server and prevents duplicate hand-ins. The offline view does not cache grades or messages. Localhost or HTTPS is required for service workers.

## QR attendance on a phone

Both devices must be able to reach the server. Copy `.env.example` to `.env`, set `BASE_URL` to the computer's LAN address (for example `http://192.168.1.20:3000`), and restart the server. Open that same address on the phone. The student must be signed in and enrolled. QR tokens expire after the teacher's selected 1–60 minute duration; a student can check in once per class per date.

## Optional AI connection

```powershell
Copy-Item .env.example .env
```

Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` to your own key and an available model, then restart. The key stays on the server. The UI clearly shows when AI is not configured; it does not fabricate AI responses. The provider receives the submitted prompt, role/class context, and recent conversation history.

Reference: [OpenRouter API documentation](https://openrouter.ai/docs/api_reference/overview).

## Project layout

```text
public/
  index.html       App entry point
  style.css        Responsive dark theme
  app.js           Role-specific views and interactions
  qrcode.js        Bundled local QR renderer
  sw.js            Offline application-shell cache
server.js          API, authorization, validation and persistence
data/              Generated SQLite database and uploaded files
docs/ANALYSIS.md    PDF requirements mapping and implementation boundaries
tests/             API integration and browser workflow tests
.env.example       Optional server configuration
```

## Verification

```powershell
npm test
npx playwright install chromium
npm run test:ui
```

Tests use separate temporary databases and do not modify your working database. To rebuild the committed browser QR bundle after changing its dependency, run `npm run build:qr`.

## Deployment boundary

This is a local/demo implementation, not a hardened institutional deployment. It uses SQLite to store a transactional application-state document rather than the PDF's normalized 22-table MySQL design. It is intended for a single Node process. Before a public deployment, remove or change seeded demo credentials, use HTTPS and secure cookies, introduce controlled teacher registration and durable backups, and review account recovery, institutional privacy policies and upload scanning. Uploaded files are limited to 4 MB and require authenticated, authorized access.

Archived classes remain stored after their 48-hour restoration window; automatic permanent deletion is deliberately not implemented. Avatar uploads and a separate personal file archive are not implemented. See the requirements mapping for precise coverage.

## Vercel deployment

Use Node.js 24.x. The repository is connected to the `smart-class-lms` Vercel project. Pushes to `main` deploy production. `vercel.json` routes requests to Express.

Production uses the connected **private Vercel Blob** store via `BLOB_READ_WRITE_TOKEN`. Accounts, password hashes, sessions, classroom records and attachments stay in authenticated private storage across deployments and instances. Files are served only after the normal role/ownership checks.

Each request reads the latest state with caching disabled. Conditional ETag writes prevent lost updates: independent record changes merge and retry, while competing edits to the same record return a conflict asking the user to refresh. Responses and login cookies are sent only after a successful save. This snapshot architecture suits a small LMS/demo; a large institution should migrate to a relational database.

Without a Blob token, local development continues to use `data/smartclass.sqlite`. Vercel API requests fail explicitly if storage is not connected rather than accepting accounts into temporary storage. Check `/api/health`: `persistentStorage` must be `true`. Existing local accounts stay local; they are not automatically uploaded. Previously lost temporary cloud accounts cannot be recovered.

Attendance QR links use the deployed HTTPS origin automatically. Uploads are limited to 4 MB to stay below [Vercel function payload limits](https://vercel.com/docs/errors/function_payload_too_large). AI requires a valid optional OpenRouter key and model.

Cloud persistence verification is opt-in: pull production environment variables into the ignored `.vercel/.env.production.local` file, set `TEST_CLOUD_STORAGE=1`, and run `node --env-file=.vercel/.env.production.local --test tests/cloud-storage.test.js`. It uses an isolated verification namespace, never classroom records. See [Vercel Blob conditional writes and consistent reads](https://vercel.com/docs/vercel-blob/using-blob-sdk).
