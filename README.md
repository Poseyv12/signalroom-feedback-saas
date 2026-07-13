# SignalRoom feedback SaaS

SignalRoom is the open-source companion application for the VibeCodeSource production-minded SaaS feedback-board guide.

Repository: <https://github.com/vpwebdev/signalroom-feedback-saas>

## Implemented

- Email/password registration and login
- Bcrypt password hashing
- Opaque server-side sessions with configurable expiry and hashed tokens
- Organizations and owner/member role boundaries
- Public feedback boards
- Feedback submission, voting, comments, and roadmap status history
- Server-side tenant and role authorization
- Registration and login throttling
- Origin checks, bounded JSON bodies, and restrictive security headers
- Responsive React interface with keyboard skip navigation
- WCAG-oriented axe checks and contrast regression coverage
- SQLite persistence with versioned migrations
- Integrity-checked backup and restore tooling
- Unit, integration, component, Playwright, mobile-emulation, and artifact-contract tests
- Production frontend/server compilation
- Non-root Docker image, health check, and persistent volume configuration

## Intentionally deferred

- Stripe billing
- Transactional email and invitations
- Hosted Postgres/Supabase migration
- Shared rate-limit storage for multiple server instances
- Duplicate merging and advanced moderation

The interface does not pretend these integrations exist.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Chromium installed through Playwright for browser tests

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

- Frontend: `http://127.0.0.1:4173`
- API: `http://127.0.0.1:4174`

## Verification

```bash
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev
```

The current verified local gate reports 32 Vitest tests and two Playwright workflows covering desktop Chromium and an emulated Pixel 7.

## Run the production build

```bash
cp .env.example .env
npm run build
npm start
```

Open `http://localhost:4174` and check `http://localhost:4174/api/health`.

## Database migrations

`createDatabase` applies ordered SQL files from `migrations/` and records them in `schema_migrations`. The initial migration uses compatibility guards so databases created before migration tracking can be baselined.

## Backup and restore

Stop application writes before a restore.

```bash
npm run db:backup -- ./data/signalroom.db ./backups/signalroom.db
npm run db:restore -- ./backups/signalroom.db ./data/restored.db
```

Restoring over an existing target requires the explicit `--force` flag. Backup and restore candidates must pass SQLite integrity checks.

## Docker

```bash
docker compose up --build
```

The named volume stores `/data/signalroom.db`. The image runs as the non-root `signalroom` user and checks `/api/health`.

The release smoke script builds the image, verifies the non-root runtime, registers a synthetic user, restarts the container, and confirms session and volume persistence:

```bash
npm run test:container
```

Local Docker execution is currently blocked on the companion host by Docker-socket permissions; the same script is intended for GitHub Actions.

## Environment variables

- `PORT` — validated server port; default `4174`
- `DATABASE_PATH` — SQLite database location
- `APP_ORIGIN` — exact HTTP/HTTPS browser origin allowed for state-changing requests
- `SESSION_TTL_HOURS` — validated session lifetime; default `168`
- `TRUST_PROXY_HOPS` — explicit trusted reverse-proxy hop count; default `0`

Do not commit `.env` files, databases, cookie jars, backups, or service credentials.

## Deployment boundary

The current build is designed for one Node/Docker instance with one persistent SQLite volume. Before horizontal scaling or serverless deployment:

1. Move data to hosted Postgres.
2. Move rate limiting to shared storage.
3. Rework backup, migration, and rollback operations for the selected platform.
4. Re-test trusted-proxy and secure-cookie behavior against the public HTTPS origin.
5. Add approved email and billing providers only when product scope requires them.
