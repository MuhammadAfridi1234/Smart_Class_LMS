# PDF analysis and implementation mapping

## Source and interpretation

All 33 pages of `Team_G_SmartClass.docx (1).pdf` were text-extracted. The UI examples on PDF pages 26–27 were rendered and visually inspected. Requirements are concentrated on PDF pages 8–11; architecture and UI guidance appear later.

The document describes a university LMS with three primary roles: teachers manage learning, students participate, and guardians view a student's records only after approval. It prioritizes access control, useful analytics, quick attendance and timely communication. It explicitly excludes payment processing, native mobile apps, automatic marking of written answers and built-in video streaming.

The document is used as a requirements reference. Its deployment instructions and technology choices are source material, not instructions that override the user's request. The user's requested HTML/CSS/JavaScript stack takes precedence over the PDF's PHP/MySQL/XAMPP implementation.

## Implemented coverage

| PDF requirement | Implementation |
| --- | --- |
| FR-01 Authentication | Registration for three roles, BCrypt passwords, expiring HttpOnly sessions, role dashboards, logout, editable name/bio/phone. Avatar upload is not included. |
| FR-02 Classrooms | Class creation, subject/section/room/color, seven-character join codes, capacity enforcement, announcements with attachments, broadcast, archive and restoration within 48 hours. Expired archives remain stored. |
| FR-03 Assignments | Assignment instructions, due dates, points, attachments, student text/file submission, duplicate prevention, late flags, numeric grades, feedback, notifications. |
| FR-04 Attendance | Locally generated QR images, 64-character cryptographic tokens, 1–60 minute sessions, enrolled-student checks, duplicate prevention, manual statuses, 3-second polling. |
| FR-05 Quizzes and polls | MCQ authoring, draft/live/closed state, server-recorded attempt deadline, browser countdown, server grading, one attempt, single-vote polls with percentage results. Polls do not currently have a closed state. |
| FR-06 Analytics | Grade, attendance, quiz and submission percentages from real stored records; interactive Chart.js bar chart; per-student metrics. No synthetic historical trends. No separate analytics cache, line chart or doughnut chart. |
| FR-07 Guardians | Email-based request, required student approval, revocation, linked student grades/attendance/quiz summaries, CSV progress report. |
| FR-08 Communication | Class chat, direct messages between permitted contacts, unread notifications, meeting schedules and external HTTPS meeting links. |
| FR-09 AI | Server-side OpenRouter adapter, role/class context, recent 10-exchange history, timeout/error handling, configuration status. Requires a real provider key and model; not tested against a paid provider. |
| FR-10 Offline | Cached student assignment view, locally generated persistent hand-in tokens with QR images, teacher verification and duplicate prevention. Offline pending status remains on the device; verification creates the actual server submission. |
| Content and scheduling | Authorized file downloads, resources and cross-class broadcast, searchable classes/assignments, calendar, meeting links. A separate personal archive and bulk import are not included. |

## Architecture and design choices

- **Frontend:** semantic HTML, custom CSS variables, vanilla JavaScript, local Chart.js and local QR rendering. Responsive purple/charcoal theme based on the PDF's UI examples.
- **Backend:** Node.js 24+, Express routes and role checks. Passwords use BCrypt. Sessions are stored server-side; cookies are HttpOnly and SameSite Strict. JSON mutation routes reject foreign origins. Text is escaped before HTML rendering.
- **Persistence:** SQLite prepared writes persist one application-state document atomically. This simplifies a runnable, single-process local project but is not equivalent to the PDF's 22 normalized MySQL tables or its performance-cache architecture.
- **QR generation:** runs locally instead of sending attendance tokens to an external image API.
- **Offline:** service worker caches application assets; the active student caches assignment metadata. No background upload or offline grading is claimed.
- **Security boundaries:** teachers only manage their own classes; students only participate in joined classes; guardians only receive approved students' submissions and attendance. Quiz answer keys never appear in student responses.
- **Analytics:** absent data is shown as a dash rather than an invented score. Grade averages normalize by assignment points. Attendance includes present, late and excused records, divided by distinct recorded class dates.

## Validation approach

API integration tests exercise account roles, ownership checks, student enrollment, duplicate handling, late submissions, grade boundaries, attendance QR/check-in, quiz answer secrecy and automatic scoring, guardian approval/revocation, archival and logout. Browser tests cover the main navigation, class creation, desktop/mobile overflow, student quiz submission and offline QR rendering. Tests use isolated data directories.

Completed verification: `npm test` passed its integration workflow, and `npm run test:ui` passed both browser scenarios, including a network-offline reload and QR generation. Desktop (1440px) and mobile (390px) screenshots were visually inspected. The OpenRouter integration was not exercised without user-provided credentials.

## Deployment and scope differences

The app requires JavaScript in the browser and runs on Node.js; it is not PHP SSR and does not use XAMPP. Automatic class deletion, profile photos, separate personal storage and the PDF's analytics caching are outside this implementation. CSV exports provide the downloadable progress report. Video sessions use external links as the source document specifies.

The AI provider is optional and disabled until configured. A QR scanned from another device must use a reachable `BASE_URL`. Live chat/attendance/polls use periodic refresh rather than WebSockets. This local version has not been load-tested against the PDF's two-second/100-student performance target.

Technical references: [Node.js SQLite API](https://nodejs.org/api/sqlite.html), [OpenRouter API](https://openrouter.ai/docs/api_reference/overview).
