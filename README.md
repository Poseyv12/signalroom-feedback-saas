# SignalRoom feedback SaaS

SignalRoom is the verified companion application for the VibeCodeSource production-ready SaaS feedback-board guide.

## Implemented

- Email/password registration and login
- Bcrypt password hashing
- Opaque server-side sessions with hashed tokens
- Organizations and owner memberships
- Public feedback boards
- Feedback submission, voting, comments, and roadmap status history
- Server-side tenant/role authorization
- Login rate limiting
- Origin checks and restrictive security headers
- Responsive, keyboard-operable React interface
- SQLite persistence
- Unit/integration and component tests
- Production frontend/server bundle
- Non-root Docker image with persistent data volume

## Intentionally deferred

- Stripe billing
- Transactional email and invitations
- Hosted Postgres/Supabase migration
- Shared rate-limit storage for more than one server instance
- Duplicate merging and advanced moderation

The interface does not pretend these integrations exist.

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
npm run typecheck
npm run lint
npm run build
```

## Run the production build

```bash
cp .env.example .env
npm run build
npm start
```

Open `http://localhost:4174`.

## Docker

```bash
docker compose up --build
```

The named volume stores `/data/signalroom.db`.

## Environment variables

- `PORT` — server port
- `DATABASE_PATH` — SQLite database location
- `APP_ORIGIN` — exact browser origin allowed for state-changing requests
- `SESSION_TTL_HOURS` — reserved for the next configurable-session pass; current verified TTL is seven days

Do not commit `.env` files or database files.

## Deployment boundary

The current build is suitable for one Docker instance with a persistent volume. Before horizontal scaling or serverless deployment:

1. Move data to hosted Postgres.
2. Move rate limiting to shared storage.
3. Add a migration runner and backup/restore procedure.
4. Verify proxy-aware client IP handling.
5. Connect approved email and billing providers.
