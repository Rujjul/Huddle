# Huddle

Single-campus activities and community app. Includes a React/TypeScript frontend, Express API, PostgreSQL schema, live database health check, and Google campus login with persistent sessions. Profiles, activity creation, joining, and chat are upcoming milestones; the illustrated activity cards are decorative.

## Local setup (Windows PowerShell)

Requires Node.js 22.12+ and Docker Desktop with its Linux engine running.

```powershell
Copy-Item .env.example .env
npm.cmd install
docker compose up -d --wait
npm.cmd run db:migrate
npm.cmd run dev
```

Open http://localhost:5173. The API is at http://localhost:3000/api/health. `npm.cmd` avoids the Windows PowerShell restriction on npm.ps1. The local database uses host port 55432 (container port 5432). If port 55432 is occupied, change the Compose host port and DATABASE_URL together. An existing PostgreSQL database can also be used through DATABASE_URL.

## Checks

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Migrations are ordered SQL files in backend/migrations, applied in transactions with checksums and a PostgreSQL advisory lock. Add a new migration for schema changes. Named Docker volumes retain data across container restarts; `docker compose down -v` deletes local database data.

## API contract

GET /api/health is public: 200 `{ "ok": true, "database": "connected" }` when PostgreSQL responds, otherwise 503 `{ "ok": false, "database": "unavailable" }`. Connection details are never returned. This tests connectivity, not whether migrations have run.

## Campus sign-in

Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL, APP_ORIGIN, and a random SESSION_SECRET (at least 32 characters) in the root .env. Register the exact callback URL in Google Cloud. Both `/api/auth/google/callback` and the compatibility path `/auth/google/callback` are supported. Only server-verified Google Workspace accounts with verified email and hosted domain `vitbhopal.ac.in` are accepted. Domain access does not independently distinguish staff from enrolled students.

Use http://localhost:5173 for sign-in. The callback and frontend must share a hostname; starting login from 127.0.0.1 redirects to the configured frontend host so session cookies work. Production requires HTTPS; configure a trusted reverse proxy explicitly if TLS terminates upstream of Express.

Routes: GET /api/auth/google, GET /api/auth/google/callback, GET /api/me, POST /api/logout. Anonymous /api/me returns 401. Logout requires the configured Origin and the `x-csrf-token` returned by /api/me. Sessions last seven days and are stored in PostgreSQL. OAuth uses state, nonce, PKCE, ID token validation, session regeneration, and sign-in rate limits. Provider tokens are not persisted.

Run `npm.cmd run test:integration -w backend` after migrations to test session persistence, campus rejection, and logout CSRF against the local database with a simulated OAuth provider. A real campus-account Google login must still be checked manually.

## Profiles and interests

After sign-in, the home page shows profile onboarding. Save a display name (1–80 characters), optional bio (up to 500 characters), and up to eight interests from the provided list. Saved profiles can be edited and previewed at `/users/:id`. Only signed-in campus members can read completed profiles; email and Google identity are excluded.

API: GET /api/me/profile, PATCH /api/me/profile, GET /api/interests, GET /api/users/:id. PATCH accepts display_name, bio, and interests; omitted fields are preserved. It requires the session's CSRF token and configured Origin. The authenticated session determines ownership; callers cannot supply another user ID. Profile fields and interests are saved in one transaction. Saving marks onboarding complete; bio and interests are optional.

## Activities

Signed-in students can browse upcoming activities, filter by category or campus date (Asia/Kolkata), and open activity details. Complete your profile before hosting. The host can edit or cancel an upcoming activity; canceled and past activities are excluded from discovery but their detail pages remain available.

API: POST /api/activities, GET /api/activities, GET /api/activities/:id, PATCH /api/activities/:id, POST /api/activities/:id/cancel. Discovery uses page/limit (default 12, maximum 50), category, and date filters, ordered by starts_at then id. Dates in API writes are ISO timestamps; forms use the device's local timezone and displays use IST. Required fields are title, description (may be empty), category, location, starts_at, ends_at, and capacity. Capacity is 1–500 and includes the host, whose participation row is created in the same transaction. Editing locks the activity and rejects capacity below existing membership. All writes require CSRF and owner authorization where applicable. Existing schema supports this milestone, so no new migration is needed.

## Next milestone

Communities: create, discover, join, and leave campus groups.

## Activity chat

Chat appears below participants for the host and joined students. GET /api/activities/:id/messages returns the newest 50 messages in chronological order, with an optional `before` message ID to load older history. POST to the same path accepts `{ "body": "..." }`, requires CSRF and current membership, and persists 1–2000 characters in PostgreSQL. Sending is limited to 30 messages per account per minute. Canceled activity chats are read-only. Leaving revokes both read and write access.

Socket.IO at /socket.io shares the PostgreSQL-backed session middleware, validates the Origin and room membership, and notifies current members after a committed write. Notifications contain no message content; clients fetch through the protected API. Session and membership are rechecked before notifications. Reconnect fetches current history; older messages remain available through pagination. A 15-second refresh provides a fallback while the panel is visible. Text renders as escaped React content. This MVP uses one server process; multiple instances require a shared event adapter. Production reverse proxies must forward /socket.io WebSocket upgrades.

Integration checks use real PostgreSQL and a live socket server to verify persisted history, pagination, second-client updates, nonmember rejection, CSRF, and access loss after leaving. Socket session wiring follows https://socket.io/how-to/use-with-express-session.

## Chat photos and videos

Choose an attachment in the chat composer, preview it, optionally add a caption, then send. One file per message: JPEG, PNG, WebP, GIF (up to 10 MB) or MP4, WebM, MOV (up to 25 MB). Browser playback depends on the video's codec; MP4 is the most portable option. The shared photos and videos panel shows media from currently loaded messages; load older history to include earlier files.

POST /api/activities/:id/attachments accepts multipart `file` and optional `body`, checks membership and CSRF before parsing, validates file signatures, then rechecks membership/cancellation before committing file bytes and the message together. Five upload attempts per account per minute are allowed. GET /api/attachments/:id checks membership on every request and supports byte ranges for videos. Files are never publicly served and responses disable caching. Canceled chats retain read-only attachment access for remaining members. Leaving prevents future requests; files already downloaded cannot be revoked.

This local MVP stores media bytes in PostgreSQL, so database backups include uploads. Upload parsing holds at most 25 MB per request in server memory. Before a larger deployment, migrate to private object storage with quotas and media processing; database storage and bandwidth will grow with use. Signature checks identify supported containers but do not transcode, scan, or guarantee codec playback.

## Participation

POST /api/activities/:id/join, DELETE /api/activities/:id/participants/me, and GET /api/activities/:id/participants implement joining, leaving, and campus-visible participant names (no email). A completed profile is required to join. The host counts toward capacity and cannot leave. Non-hosts may leave even after an activity starts or is canceled. Joining rejects canceled/started/full activities and duplicate membership. Join and leave transactions lock the same activity row used by host edits and cancellation, preserving capacity under concurrent requests. CSRF protects both mutations; participation changes are limited to 30 requests per account per minute. No removal or ban feature is implemented yet. Existing membership tables support this milestone without a migration.

The PostgreSQL integration suite includes two simultaneous last-seat joins (one succeeds), duplicate join rejection, leaving and refilling a seat, host restrictions, and participant field privacy.

## Production foundation

Build both workspaces, configure DATABASE_URL and PORT, apply migrations, then set NODE_ENV=production and run `npm.cmd start`. Express serves frontend/dist with same-origin API routing. This is a development foundation, not yet ready for a student pilot.

Campus domain confirmed: vitbhopal.ac.in.
# Huddle
