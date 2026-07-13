import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AppDatabase } from './db.js';

const SESSION_COOKIE = 'signalroom_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const statuses = ['under_review', 'planned', 'in_progress', 'shipped'] as const;
type Status = (typeof statuses)[number];
type Role = 'owner' | 'admin' | 'member';

type CurrentUser = { id: string; email: string; name: string };
type AuthedRequest = Request & { user?: CurrentUser; sessionHash?: string };

type CreateAppOptions = {
  db: AppDatabase;
  appOrigin: string;
  authAttemptLimit?: number;
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
      return [key, decodeURIComponent(value)];
    }),
  );
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function setSessionCookie(res: Response, token: string, secureCookies: boolean) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secureCookies) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res: Response, secureCookies: boolean) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secureCookies) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function publicUser(row: any): CurrentUser {
  return { id: String(row.id), email: String(row.email), name: String(row.name) };
}

function createSession(db: AppDatabase, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hash, userId, expiresAt);
  return token;
}

function getMembership(db: AppDatabase, organizationId: string, userId: string) {
  return db
    .prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .get(organizationId, userId) as { role: Role } | undefined;
}

function statusHistory(db: AppDatabase, postId: string) {
  return db
    .prepare('SELECT status, created_at AS createdAt FROM status_history WHERE post_id = ? ORDER BY created_at, rowid')
    .all(postId);
}

function shapePost(db: AppDatabase, row: any) {
  const counts = db
    .prepare(`SELECT
      (SELECT COUNT(*) FROM votes WHERE post_id = ?) AS voteCount,
      (SELECT COUNT(*) FROM comments WHERE post_id = ?) AS commentCount`)
    .get(row.id, row.id) as { voteCount: number; commentCount: number };
  const comments = db
    .prepare(`SELECT comments.id, comments.body, comments.created_at AS createdAt, users.name AS authorName
      FROM comments JOIN users ON users.id = comments.author_id
      WHERE comments.post_id = ? ORDER BY comments.created_at, comments.rowid`)
    .all(row.id);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at ?? row.createdAt,
    authorName: row.author_name ?? row.authorName,
    voteCount: Number(counts.voteCount),
    commentCount: Number(counts.commentCount),
    comments,
    statusHistory: statusHistory(db, row.id),
  };
}

export function createApp({ db, appOrigin, authAttemptLimit = 10 }: CreateAppOptions) {
  const app = express();
  const authAttempts = new Map<string, { count: number; resetAt: number }>();
  const secureCookies = new URL(appOrigin).protocol === 'https:';
  app.disable('x-powered-by');
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

  app.use((req: AuthedRequest, _res: Response, next: NextFunction) => {
    const token = parseCookies(req.get('cookie'))[SESSION_COOKIE];
    if (!token) return next();
    const hash = tokenHash(token);
    const row = db
      .prepare(`SELECT users.id, users.email, users.name
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
      .get(hash, new Date().toISOString());
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

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

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
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(userEmail)) {
      return jsonError(res, 409, 'An account already exists for that email.');
    }
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(id, userEmail, name, passwordHash);
    const token = createSession(db, id);
    setSessionCookie(res, token, secureCookies);
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
    const row = db.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').get(userEmail) as any;
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      attempts.count += 1;
      authAttempts.set(attemptKey, attempts);
      return jsonError(res, 401, 'Email or password is incorrect.');
    }
    authAttempts.delete(attemptKey);
    const token = createSession(db, row.id);
    setSessionCookie(res, token, secureCookies);
    return res.json({ user: publicUser(row) });
  });

  app.post('/api/auth/logout', (req: AuthedRequest, res: Response) => {
    if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    clearSessionCookie(res, secureCookies);
    return res.status(204).end();
  });

  app.get('/api/me', (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    return res.json({ user });
  });

  app.get('/api/organizations', (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const organizations = db
      .prepare(`SELECT organizations.id, organizations.name, organizations.slug, memberships.role
        FROM memberships JOIN organizations ON organizations.id = memberships.organization_id
        WHERE memberships.user_id = ? ORDER BY organizations.created_at`)
      .all(user.id);
    return res.json({ organizations });
  });

  app.post('/api/organizations', (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const name = text(req.body?.name, 2, 80);
    if (!name) return jsonError(res, 400, 'Organization name must be 2-80 characters.');
    const baseSlug = slugify(name) || 'workspace';
    let slug = baseSlug;
    let suffix = 2;
    while (db.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(slug)) slug = `${baseSlug}-${suffix++}`;
    const id = randomUUID();
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(id, name, slug);
      db.prepare("INSERT INTO memberships (organization_id, user_id, role) VALUES (?, ?, 'owner')").run(id, user.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return res.status(201).json({ organization: { id, name, slug, role: 'owner' } });
  });

  app.get('/api/organizations/:organizationId/boards', (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!getMembership(db, routeParam(req.params.organizationId), user.id)) return jsonError(res, 403, 'You do not have access to this organization.');
    const boards = db.prepare('SELECT id, name, slug, created_at AS createdAt FROM boards WHERE organization_id = ? ORDER BY created_at').all(routeParam(req.params.organizationId));
    return res.json({ boards });
  });

  app.post('/api/organizations/:organizationId/boards', (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const membership = getMembership(db, routeParam(req.params.organizationId), user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) return jsonError(res, 403, 'Owner or admin access is required.');
    const name = text(req.body?.name, 2, 80);
    const slug = text(req.body?.slug, 2, 60) ? slugify(req.body.slug) : '';
    if (!name || !slug) return jsonError(res, 400, 'Board name and a valid slug are required.');
    if (db.prepare('SELECT 1 FROM boards WHERE slug = ?').get(slug)) return jsonError(res, 409, 'That public board slug is already in use.');
    const id = randomUUID();
    db.prepare('INSERT INTO boards (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(id, routeParam(req.params.organizationId), name, slug);
    return res.status(201).json({ board: { id, organizationId: routeParam(req.params.organizationId), name, slug } });
  });

  app.get('/api/boards/:slug', (req: AuthedRequest, res: Response) => {
    const board = db
      .prepare(`SELECT boards.id, boards.name, boards.slug, organizations.name AS organizationName
        FROM boards JOIN organizations ON organizations.id = boards.organization_id WHERE boards.slug = ?`)
      .get(routeParam(req.params.slug)) as any;
    if (!board) return jsonError(res, 404, 'Board not found.');
    const rows = db
      .prepare(`SELECT feedback_posts.*, users.name AS author_name
        FROM feedback_posts JOIN users ON users.id = feedback_posts.author_id
        WHERE feedback_posts.board_id = ? ORDER BY feedback_posts.created_at DESC, feedback_posts.rowid DESC`)
      .all(board.id);
    return res.json({
      board: { id: board.id, name: board.name, slug: board.slug, organizationName: board.organizationName },
      posts: rows.map((row) => shapePost(db, row)),
    });
  });

  app.post('/api/boards/:boardId/posts', (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!db.prepare('SELECT 1 FROM boards WHERE id = ?').get(routeParam(req.params.boardId))) return jsonError(res, 404, 'Board not found.');
    const title = text(req.body?.title, 4, 120);
    const description = text(req.body?.description, 10, 2000);
    if (!title || !description) return jsonError(res, 400, 'Use a 4-120 character title and a 10-2000 character description.');
    const id = randomUUID();
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO feedback_posts (id, board_id, author_id, title, description) VALUES (?, ?, ?, ?, ?)').run(id, routeParam(req.params.boardId), user.id, title, description);
      db.prepare('INSERT INTO status_history (id, post_id, status, changed_by) VALUES (?, ?, ?, ?)').run(randomUUID(), id, 'under_review', user.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const row = db.prepare(`SELECT feedback_posts.*, users.name AS author_name FROM feedback_posts JOIN users ON users.id = feedback_posts.author_id WHERE feedback_posts.id = ?`).get(id);
    return res.status(201).json({ post: shapePost(db, row) });
  });

  app.post('/api/posts/:postId/vote', (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!db.prepare('SELECT 1 FROM feedback_posts WHERE id = ?').get(routeParam(req.params.postId))) return jsonError(res, 404, 'Feedback post not found.');
    const existing = db.prepare('SELECT 1 FROM votes WHERE post_id = ? AND user_id = ?').get(routeParam(req.params.postId), user.id);
    if (existing) {
      db.prepare('DELETE FROM votes WHERE post_id = ? AND user_id = ?').run(routeParam(req.params.postId), user.id);
    } else {
      db.prepare('INSERT INTO votes (post_id, user_id) VALUES (?, ?)').run(routeParam(req.params.postId), user.id);
    }
    const count = db.prepare('SELECT COUNT(*) AS count FROM votes WHERE post_id = ?').get(routeParam(req.params.postId)) as { count: number };
    return res.json({ voted: !existing, voteCount: Number(count.count) });
  });

  app.post('/api/posts/:postId/comments', (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    if (!db.prepare('SELECT 1 FROM feedback_posts WHERE id = ?').get(routeParam(req.params.postId))) return jsonError(res, 404, 'Feedback post not found.');
    const body = text(req.body?.body, 2, 1000);
    if (!body) return jsonError(res, 400, 'Comment must be 2-1000 characters.');
    const id = randomUUID();
    db.prepare('INSERT INTO comments (id, post_id, author_id, body) VALUES (?, ?, ?, ?)').run(id, routeParam(req.params.postId), user.id, body);
    return res.status(201).json({ comment: { id, body, authorName: user.name } });
  });

  app.patch('/api/posts/:postId/status', (req: AuthedRequest, res: Response) => {
    const user = requireUser(req, res);
    if (!user) return;
    const status = req.body?.status as Status;
    if (!statuses.includes(status)) return jsonError(res, 400, 'Status is not allowed.');
    const row = db
      .prepare(`SELECT feedback_posts.*, boards.organization_id, users.name AS author_name
        FROM feedback_posts JOIN boards ON boards.id = feedback_posts.board_id
        JOIN users ON users.id = feedback_posts.author_id WHERE feedback_posts.id = ?`)
      .get(routeParam(req.params.postId)) as any;
    if (!row) return jsonError(res, 404, 'Feedback post not found.');
    const membership = getMembership(db, row.organization_id, user.id);
    if (!membership || !['owner', 'admin'].includes(membership.role)) return jsonError(res, 403, 'Owner or admin access is required.');
    if (row.status !== status) {
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE feedback_posts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, routeParam(req.params.postId));
        db.prepare('INSERT INTO status_history (id, post_id, status, changed_by) VALUES (?, ?, ?, ?)').run(randomUUID(), routeParam(req.params.postId), status, user.id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    const updated = db.prepare(`SELECT feedback_posts.*, users.name AS author_name FROM feedback_posts JOIN users ON users.id = feedback_posts.author_id WHERE feedback_posts.id = ?`).get(routeParam(req.params.postId));
    return res.json({ post: shapePost(db, updated) });
  });

  app.use('/api', (_req, res) => jsonError(res, 404, 'API route not found.'));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      return jsonError(res, 409, 'A record with those unique values already exists.');
    }
    console.error('Unhandled request error', error instanceof Error ? error.message : 'unknown');
    return jsonError(res, 500, 'The server could not complete the request.');
  });

  return app;
}
