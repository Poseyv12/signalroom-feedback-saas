import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AppDatabase, DatabaseConnection } from './db.js';

const SESSION_COOKIE = 'signalroom_session';
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const statuses = ['under_review', 'planned', 'in_progress', 'shipped'] as const;
type Status = (typeof statuses)[number];
type Role = 'owner' | 'admin' | 'member';

type CurrentUser = { id: string; email: string; name: string };
type AuthedRequest = Request & { user?: CurrentUser; sessionHash?: string };
type DataRow = Record<string, any>;

type CreateAppOptions = {
  db: AppDatabase;
  appOrigin: string;
  authAttemptLimit?: number;
  marketingAttemptLimit?: number;
  marketingEmailAdapter?: {
    sendProductUpdateConfirmation(input: { email: string }): Promise<void>;
  };
  sessionTtlMs?: number;
  trustProxyHops?: number;
};

function jsonError(res: Response, status: number, error: string) {
  return res.status(status).json({ error });
}

function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean.length >= min && clean.length <= max ? clean : null;
}

function email(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) && clean.length <= 254 ? clean : null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((part) => {
      const index = part.indexOf('=');
      const key = index >= 0 ? part.slice(0, index).trim() : part.trim();
      const value = index >= 0 ? part.slice(index + 1).trim() : '';
      try {
        return [key, decodeURIComponent(value)];
      } catch {
        return [key, ''];
      }
    }),
  );
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function setSessionCookie(res: Response, token: string, secureCookies: boolean, sessionTtlMs: number) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
  ];
  if (secureCookies) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res: Response, secureCookies: boolean) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secureCookies) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function publicUser(row: DataRow): CurrentUser {
  return { id: String(row.id), email: String(row.email), name: String(row.name) };
}

async function createSession(db: DatabaseConnection, userId: string, sessionTtlMs: number) {
  const token = randomBytes(32).toString('base64url');
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
  await db.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hash, userId, expiresAt],
  );
  return token;
}

async function getMembership(db: DatabaseConnection, organizationId: string, userId: string) {
  const result = await db.query<{ role: Role }>(
    'SELECT role FROM memberships WHERE organization_id = $1 AND user_id = $2',
    [organizationId, userId],
  );
  return result.rows[0];
}

async function statusHistory(db: DatabaseConnection, postId: string) {
  const result = await db.query(
    `SELECT status, created_at AS "createdAt"
     FROM status_history WHERE post_id = $1 ORDER BY created_at, id`,
    [postId],
  );
  return result.rows;
}

async function shapePost(db: DatabaseConnection, row: DataRow) {
  const [countsResult, commentsResult, history] = await Promise.all([
    db.query<{ vote_count: string | number; comment_count: string | number }>(
      `SELECT
        (SELECT COUNT(*) FROM votes WHERE post_id = $1) AS vote_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = $1) AS comment_count`,
      [row.id],
    ),
    db.query(
      `SELECT comments.id, comments.body, comments.created_at AS "createdAt", users.name AS "authorName"
       FROM comments JOIN users ON users.id = comments.author_id
       WHERE comments.post_id = $1 ORDER BY comments.created_at, comments.id`,
      [row.id],
    ),
    statusHistory(db, String(row.id)),
  ]);
  const counts = countsResult.rows[0];
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at ?? row.createdAt,
    authorName: row.author_name ?? row.authorName,
    voteCount: Number(counts.vote_count),
    commentCount: Number(counts.comment_count),
    comments: commentsResult.rows,
    statusHistory: history,
  };
}

export function createApp({
  db,
  appOrigin,
  authAttemptLimit = 10,
  marketingAttemptLimit = 8,
  marketingEmailAdapter,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  trustProxyHops = 0,
}: CreateAppOptions) {
  const app = express();
  const authAttempts = new Map<string, { count: number; resetAt: number }>();
  const marketingAttempts = new Map<string, { count: number; resetAt: number }>();
  const secureCookies = new URL(appOrigin).protocol === 'https:';
  app.disable('x-powered-by');
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);
  app.use(express.json({ limit: '32kb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin && origin !== appOrigin) return jsonError(res, 403, 'Request origin is not allowed.');
    }
    next();
  });

  app.use(async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const token = parseCookies(req.get('cookie'))[SESSION_COOKIE];
    if (!token) return next();
    const hash = tokenHash(token);
    const result = await db.query(
      `SELECT users.id, users.email, users.name
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > $2`,
      [hash, new Date().toISOString()],
    );
    const row = result.rows[0];
    if (row) {
      req.user = publicUser(row);
      req.sessionHash = hash;
    }
    next();
  });

  function requireUser(req: AuthedRequest, res: Response): CurrentUser | null {
    if (!req.user) {
      jsonError(res, 401, 'Sign in to continue.');
      return null;
    }
    return req.user;
  }

  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    return res.json({ ok: true });
  });

  app.post('/api/marketing/leads', async (req: Request, res: Response) => {
    const attemptKey = String(req.ip);
    const now = Date.now();
    const current = marketingAttempts.get(attemptKey);
    const attempts = !current || current.resetAt <= now ? { count: 0, resetAt: now + 15 * 60 * 1000 } : current;
    if (attempts.count >= marketingAttemptLimit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((attempts.resetAt - now) / 1000))));
      return jsonError(res, 429, 'Too many update requests. Try again later.');
    }
    attempts.count += 1;
    marketingAttempts.set(attemptKey, attempts);

    const website = typeof req.body?.website === 'string' ? req.body.website.trim() : '';
    if (website) return res.status(202).json({ accepted: true });
    const leadEmail = email(req.body?.email);
    const company = req.body?.company === undefined || req.body?.company === '' ? null : text(req.body.company, 1, 100);
    if (!leadEmail || (req.body?.company && !company)) {
      return jsonError(res, 400, 'Enter a valid email and keep the optional company name under 100 characters.');
    }
    const inserted = await db.query(
      `INSERT INTO marketing_leads (id, email, company) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [randomUUID(), leadEmail, company],
    );
    if (inserted.rows[0] && marketingEmailAdapter) {
      try {
        await marketingEmailAdapter.sendProductUpdateConfirmation({ email: leadEmail });
      } catch {
        return jsonError(res, 503, 'Your update request was saved, but confirmation delivery is unavailable.');
      }
    }
    return res.status(202).json({ accepted: true });
  });

  app.post('/api/marketing/events', async (req: Request, res: Response) => {
    const event = typeof req.body?.event === 'string' ? req.body.event : '';
    const properties = req.body?.properties;
    const events = new Set(['primary_cta_clicked', 'demo_clicked', 'pricing_cta_clicked', 'lead_form_started', 'lead_form_succeeded', 'lead_form_failed']);
    const ctaIds = new Set(['hero-primary', 'hero-demo', 'header-primary', 'availability-primary', 'final-primary']);
    const routes = new Set(['/', '/privacy', '/terms']);
    const failures = new Set(['validation', 'rate_limit', 'storage', 'provider', 'network', 'unknown']);
    if (!events.has(event) || !properties || typeof properties !== 'object' || Array.isArray(properties)) {
      return jsonError(res, 400, 'Analytics event is not allowed.');
    }
    const record = properties as Record<string, unknown>;
    if (Object.keys(record).some((key) => !['ctaId', 'route', 'failureCategory'].includes(key))
      || typeof record.route !== 'string' || !routes.has(record.route)
      || (record.ctaId !== undefined && (typeof record.ctaId !== 'string' || !ctaIds.has(record.ctaId)))
      || (record.failureCategory !== undefined && (typeof record.failureCategory !== 'string' || !failures.has(record.failureCategory)))) {
      return jsonError(res, 400, 'Analytics properties are not allowed.');
    }
    await db.query(
      'INSERT INTO marketing_events (id, event_name, properties) VALUES ($1, $2, $3)',
      [randomUUID(), event, JSON.stringify(record)],
    );
    return res.status(202).json({ accepted: true });
  });

  app.post('/api/auth/register', async (req: Request, res: Response) => {
    const attemptKey = `register:${req.ip}`;
    const now = Date.now();
    const current = authAttempts.get(attemptKey);
    const attempts = !current || current.resetAt <= now ? { count: 0, resetAt: now + 15 * 60 * 1000 } : current;
    if (attempts.count >= authAttemptLimit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((attempts.resetAt - now) / 1000))));
      return jsonError(res, 429, 'Too many registration attempts. Try again later.');
    }
    attempts.count += 1;
    authAttempts.set(attemptKey, attempts);
    const userEmail = email(req.body?.email);
    const name = text(req.body?.name, 2, 60);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!userEmail || !name || password.length < 12 || password.length > 128) {
      return jsonError(res, 400, 'Use a valid email, a 2-60 character name, and a password of at least 12 characters.');
    }
    const existing = await db.query('SELECT 1 FROM users WHERE email = $1', [userEmail]);
    if (existing.rows[0]) return jsonError(res, 409, 'An account already exists for that email.');

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const token = await db.transaction(async (connection) => {
      await connection.query(
        'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
        [id, userEmail, name, passwordHash],
      );
      return createSession(connection, id, sessionTtlMs);
    });
    setSessionCookie(res, token, secureCookies, sessionTtlMs);
    return res.status(201).json({ user: { id, email: userEmail, name } });
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const userEmail = email(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!userEmail || !password) return jsonError(res, 400, 'Email and password are required.');
    const attemptKey = `${req.ip}:${userEmail}`;
    const now = Date.now();
    const current = authAttempts.get(attemptKey);
    const attempts = !current || current.resetAt <= now ? { count: 0, resetAt: now + 15 * 60 * 1000 } : current;
    if (attempts.count >= authAttemptLimit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((attempts.resetAt - now) / 1000))));
      return jsonError(res, 429, 'Too many sign-in attempts. Try again later.');
    }
    const result = await db.query('SELECT id, email, name, password_hash FROM users WHERE email = $1', [userEmail]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(password, String(row.password_hash)))) {
      attempts.count += 1;
      authAttempts.set(attemptKey, attempts);
      return jsonError(res, 401, 'Email or password is incorrect.');
    }
    authAttempts.delete(attemptKey);
    const token = await createSession(db, String(row.id), sessionTtlMs);
    setSessionCookie(res, token, secureCookies, sessionTtlMs);
    return res.json({ user: publicUser(row) });
  });

  app.post('/api/auth/logout', async (req: AuthedRequest, res: Response) => {
    if (req.sessionHash) await db.query('DELETE FROM sessions WHERE token_hash = $1', [req.sessionHash]);
    clearSessionCookie(res, secureCookies);
    return res.status(204).end();
  });

  app.get('/api/me', (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    return res.json({ user });
  });

  app.get('/api/organizations', async (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const result = await db.query(
      `SELECT organizations.id, organizations.name, organizations.slug, memberships.role
       FROM memberships JOIN organizations ON organizations.id = memberships.organization_id
       WHERE memberships.user_id = $1 ORDER BY organizations.created_at`,
      [user.id],
    );
    return res.json({ organizations: result.rows });
  });

  app.post('/api/organizations', async (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const name = text(req.body?.name, 2, 80);
    if (!name) return jsonError(res, 400, 'Organization name must be 2-80 characters.');
    const baseSlug = slugify(name) || 'workspace';
    let slug = baseSlug;
    let suffix = 2;
    while ((await db.query('SELECT 1 FROM organizations WHERE slug = $1', [slug])).rows[0]) {
      slug = `${baseSlug}-${suffix++}`;
    }
    const id = randomUUID();
    await db.transaction(async (connection) => {
      await connection.query('INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)', [id, name, slug]);
      await connection.query(
        "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
        [id, user.id],
      );
    });
    return res.status(201).json({ organization: { id, name, slug, role: 'owner' } });
  });

  app.get('/api/organizations/:organizationId/boards', async (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const organizationId = routeParam(req.params.organizationId);
    if (!(await getMembership(db, organizationId, user.id))) {
      return jsonError(res, 403, 'You do not have access to this organization.');
    }
    const result = await db.query(
      'SELECT id, name, slug, created_at AS "createdAt" FROM boards WHERE organization_id = $1 ORDER BY created_at',
      [organizationId],
    );
    return res.json({ boards: result.rows });
  });

  app.post('/api/organizations/:organizationId/boards', async (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const organizationId = routeParam(req.params.organizationId);
    const membership = await getMembership(db, organizationId, user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return jsonError(res, 403, 'Owner or admin access is required.');
    }
    const name = text(req.body?.name, 2, 80);
    const slug = text(req.body?.slug, 2, 60) ? slugify(req.body.slug) : '';
    if (!name || !slug) return jsonError(res, 400, 'Board name and a valid slug are required.');
    if ((await db.query('SELECT 1 FROM boards WHERE slug = $1', [slug])).rows[0]) {
      return jsonError(res, 409, 'That public board slug is already in use.');
    }
    const id = randomUUID();
    await db.query(
      'INSERT INTO boards (id, organization_id, name, slug) VALUES ($1, $2, $3, $4)',
      [id, organizationId, name, slug],
    );
    return res.status(201).json({ board: { id, organizationId, name, slug } });
  });

  app.get('/api/boards/:slug', async (req: AuthedRequest, res: Response) => {
    const boardResult = await db.query(
      `SELECT boards.id, boards.name, boards.slug, organizations.name AS "organizationName"
       FROM boards JOIN organizations ON organizations.id = boards.organization_id
       WHERE boards.slug = $1`,
      [routeParam(req.params.slug)],
    );
    const board = boardResult.rows[0];
    if (!board) return jsonError(res, 404, 'Board not found.');
    const postsResult = await db.query(
      `SELECT feedback_posts.*, users.name AS author_name
       FROM feedback_posts JOIN users ON users.id = feedback_posts.author_id
       WHERE feedback_posts.board_id = $1 ORDER BY feedback_posts.created_at DESC, feedback_posts.id DESC`,
      [board.id],
    );
    return res.json({
      board: { id: board.id, name: board.name, slug: board.slug, organizationName: board.organizationName },
      posts: await Promise.all(postsResult.rows.map((row) => shapePost(db, row))),
    });
  });

  app.post('/api/boards/:boardId/posts', async (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const boardId = routeParam(req.params.boardId);
    if (!(await db.query('SELECT 1 FROM boards WHERE id = $1', [boardId])).rows[0]) {
      return jsonError(res, 404, 'Board not found.');
    }
    const title = text(req.body?.title, 4, 120);
    const description = text(req.body?.description, 10, 2000);
    if (!title || !description) return jsonError(res, 400, 'Use a 4-120 character title and a 10-2000 character description.');
    const id = randomUUID();
    await db.transaction(async (connection) => {
      await connection.query(
        'INSERT INTO feedback_posts (id, board_id, author_id, title, description) VALUES ($1, $2, $3, $4, $5)',
        [id, boardId, user.id, title, description],
      );
      await connection.query(
        'INSERT INTO status_history (id, post_id, status, changed_by) VALUES ($1, $2, $3, $4)',
        [randomUUID(), id, 'under_review', user.id],
      );
    });
    const result = await db.query(
      `SELECT feedback_posts.*, users.name AS author_name
       FROM feedback_posts JOIN users ON users.id = feedback_posts.author_id
       WHERE feedback_posts.id = $1`,
      [id],
    );
    return res.status(201).json({ post: await shapePost(db, result.rows[0]) });
  });

  app.post('/api/posts/:postId/vote', async (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const postId = routeParam(req.params.postId);
    if (!(await db.query('SELECT 1 FROM feedback_posts WHERE id = $1', [postId])).rows[0]) {
      return jsonError(res, 404, 'Feedback post not found.');
    }
    const voted = await db.transaction(async (connection) => {
      const existing = (await connection.query(
        'SELECT 1 FROM votes WHERE post_id = $1 AND user_id = $2',
        [postId, user.id],
      )).rows[0];
      if (existing) {
        await connection.query('DELETE FROM votes WHERE post_id = $1 AND user_id = $2', [postId, user.id]);
        return false;
      }
      await connection.query('INSERT INTO votes (post_id, user_id) VALUES ($1, $2)', [postId, user.id]);
      return true;
    });
    const countResult = await db.query<{ count: string | number }>(
      'SELECT COUNT(*) AS count FROM votes WHERE post_id = $1',
      [postId],
    );
    return res.json({ voted, voteCount: Number(countResult.rows[0].count) });
  });

  app.post('/api/posts/:postId/comments', async (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const postId = routeParam(req.params.postId);
    if (!(await db.query('SELECT 1 FROM feedback_posts WHERE id = $1', [postId])).rows[0]) {
      return jsonError(res, 404, 'Feedback post not found.');
    }
    const body = text(req.body?.body, 2, 1000);
    if (!body) return jsonError(res, 400, 'Comment must be 2-1000 characters.');
    const id = randomUUID();
    await db.query(
      'INSERT INTO comments (id, post_id, author_id, body) VALUES ($1, $2, $3, $4)',
      [id, postId, user.id, body],
    );
    return res.status(201).json({ comment: { id, body, authorName: user.name } });
  });

  app.patch('/api/posts/:postId/status', async (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const status = req.body?.status as Status;
    if (!statuses.includes(status)) return jsonError(res, 400, 'Status is not allowed.');
    const postId = routeParam(req.params.postId);
    const result = await db.query(
      `SELECT feedback_posts.*, boards.organization_id, users.name AS author_name
       FROM feedback_posts JOIN boards ON boards.id = feedback_posts.board_id
       JOIN users ON users.id = feedback_posts.author_id WHERE feedback_posts.id = $1`,
      [postId],
    );
    const row = result.rows[0];
    if (!row) return jsonError(res, 404, 'Feedback post not found.');
    const membership = await getMembership(db, String(row.organization_id), user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return jsonError(res, 403, 'Owner or admin access is required.');
    }
    if (row.status !== status) {
      await db.transaction(async (connection) => {
        await connection.query('UPDATE feedback_posts SET status = $1, updated_at = NOW() WHERE id = $2', [status, postId]);
        await connection.query(
          'INSERT INTO status_history (id, post_id, status, changed_by) VALUES ($1, $2, $3, $4)',
          [randomUUID(), postId, status, user.id],
        );
      });
    }
    const updatedResult = await db.query(
      `SELECT feedback_posts.*, users.name AS author_name
       FROM feedback_posts JOIN users ON users.id = feedback_posts.author_id
       WHERE feedback_posts.id = $1`,
      [postId],
    );
    return res.json({ post: await shapePost(db, updatedResult.rows[0]) });
  });

  app.use('/api', (_req, res) => jsonError(res, 404, 'API route not found.'));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 500;
    if (status === 413) return jsonError(res, 413, 'Request body is too large.');
    if (status === 400) return jsonError(res, 400, 'Request body is not valid JSON.');
    const databaseCode = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    if (databaseCode === '23505') return jsonError(res, 409, 'A record with those unique values already exists.');
    console.error('Unhandled request error', error instanceof Error ? error.message : 'unknown');
    return jsonError(res, 500, 'The server could not complete the request.');
  });

  return app;
}
