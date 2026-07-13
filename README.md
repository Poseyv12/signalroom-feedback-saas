# SignalRoom feedback SaaS

SignalRoom is the open-source companion application for the VibeCodeSource production-minded SaaS feedback-board guide.

Target repository: <https://github.com/Poseyv12/signalroom-feedback-saas>

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
- Axe accessibility and contrast regression coverage
- Supabase-compatible Postgres schema and versioned migration
- Pooled Postgres access for Vercel Functions
- In-process Postgres-compatible integration tests through PGlite
- Vite frontend and Express Vercel Function entry point
- Optional non-root Docker runtime using the same external Postgres database

## Intentionally deferred

- Stripe billing
- Transactional email and invitations
- Shared rate-limit storage for high-volume or multi-region workloads
- Duplicate merging and advanced moderation

The interface does not pretend these integrations exist.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A Supabase project or another PostgreSQL-compatible `DATABASE_URL` for development/runtime
- Chromium installed through Playwright for browser tests

## Local development

Copy `.env.example` to `.env` and replace the placeholder with the **pooled** Supabase Postgres URL. Never use a browser-exposed Supabase key as `DATABASE_URL`.

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

- Frontend: `http://127.0.0.1:4173`
- API: `http://127.0.0.1:4174`

## Verification

Unit and browser tests do not require a live Supabase project; they use isolated in-process Postgres-compatible databases.

```bash
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev
```

The current local gate reports 34 Vitest tests and two Playwright workflows covering desktop Chromium and an emulated Pixel 7.

## Database migrations

The canonical Supabase migration lives at:

```text
supabase/migrations/202607130001_initial.sql
```

Apply it through the Supabase CLI/dashboard or from a trusted server environment:

```bash
npm run db:migrate
```

The application does not expose migration credentials or execute schema changes from browser code.

## Vercel deployment

1. Import the `Poseyv12/signalroom-feedback-saas` repository into Vercel.
2. Create a Supabase project and apply the tracked migration.
3. Set `DATABASE_URL` to Supabase's pooled server connection string in Vercel project settings.
4. Set `APP_ORIGIN` to the final production Vercel URL. Preview deployments can fall back to `VERCEL_URL`.
5. Keep `SESSION_TTL_HOURS=168` and `TRUST_PROXY_HOPS=0` unless deployment evidence justifies a change.
6. Deploy, then verify `/api/health`, authentication, tenant boundaries, and the complete feedback workflow over HTTPS.

`vercel.json` keeps Vite as the frontend framework and rewrites `/api/*` requests to the Express function in `api/index.ts`.

## Optional Docker runtime

```bash
DATABASE_URL='[REDACTED]' docker compose up --build
```

The image runs as non-root user `signalroom` and checks `/api/health`. It uses Supabase/Postgres rather than a container-local database volume.

## Environment variables

- `DATABASE_URL` — required pooled Supabase/Postgres server connection string
- `PORT` — local/container server port; default `4174`
- `APP_ORIGIN` — exact HTTP/HTTPS browser origin allowed for state-changing requests
- `SESSION_TTL_HOURS` — session lifetime; default `168`
- `TRUST_PROXY_HOPS` — explicit trusted reverse-proxy hop count; default `0`
- `VERCEL_URL` — deployment-specific fallback origin supplied automatically by Vercel

Do not commit `.env` files, database URLs, passwords, access tokens, cookie jars, or backup exports.

## Deployment boundary

Supabase removes the local-filesystem persistence limitation, but it does not eliminate operational work. Before calling the application production-ready:

1. Run the tracked migration against the actual Supabase project.
2. Verify Vercel's HTTPS origin and secure cookies.
3. Test tenant denials against the hosted database.
4. Exercise a database export and recovery procedure available to the selected Supabase plan.
5. Move rate limiting to shared storage before relying on it across concurrent regions or sustained traffic.
6. Add approved email and billing providers only when product scope requires them.
