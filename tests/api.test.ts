import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { applyMigrations, type AppDatabase } from '../src/server/db.js';
import { createTestDatabase } from './helpers/database.js';

let db: AppDatabase;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await createTestDatabase();
  await applyMigrations(db);
  app = createApp({ db, appOrigin: 'http://localhost' });
});

afterEach(async () => db.close());

async function register(email: string, name = 'Test User') {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/register').send({
    email,
    name,
    password: 'correct horse battery staple',
  });
  expect(response.status).toBe(201);
  return agent;
}

async function createOrganization(agent: ReturnType<typeof request.agent>, name = 'Acme Labs') {
  const response = await agent.post('/api/organizations').send({ name });
  expect(response.status).toBe(201);
  return response.body.organization as { id: string; slug: string };
}

describe('authentication', () => {
  it('registers, restores, logs out, and logs back in without exposing password data', async () => {
    const agent = await register('owner@example.com', 'Owner');

    const me = await agent.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: 'owner@example.com', name: 'Owner' });
    expect(JSON.stringify(me.body)).not.toContain('password');

    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/me')).status).toBe(401);

    const login = await agent.post('/api/auth/login').send({
      email: 'owner@example.com',
      password: 'correct horse battery staple',
    });
    expect(login.status).toBe(200);
    expect((await agent.get('/api/me')).status).toBe(200);
  });

  it('sets the Secure cookie flag from the configured origin protocol', async () => {
    const httpApp = createApp({ db, appOrigin: 'http://localhost' });
    const httpResponse = await request(httpApp).post('/api/auth/register').send({
      email: 'http@example.com', name: 'HTTP User', password: 'correct horse battery staple',
    });
    expect(httpResponse.headers['set-cookie'][0]).not.toContain('Secure');

    const httpsApp = createApp({ db, appOrigin: 'https://feedback.example.com' });
    const httpsResponse = await request(httpsApp).post('/api/auth/register').send({
      email: 'https@example.com', name: 'HTTPS User', password: 'correct horse battery staple',
    });
    expect(httpsResponse.headers['set-cookie'][0]).toContain('Secure');
  });

  it('uses the configured session lifetime for cookies and stored sessions', async () => {
    const ttlApp = createApp({ db, appOrigin: 'http://localhost', sessionTtlMs: 60 * 60 * 1000 });
    const response = await request(ttlApp).post('/api/auth/register').send({
      email: 'ttl@example.com', name: 'TTL User', password: 'correct horse battery staple',
    });
    expect(response.headers['set-cookie'][0]).toContain('Max-Age=3600');
    const session = (await db.query<{ expires_at: string }>('SELECT expires_at FROM sessions')).rows[0];
    const remaining = new Date(session.expires_at).getTime() - Date.now();
    expect(remaining).toBeGreaterThan(59 * 60 * 1000);
    expect(remaining).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('rate limits repeated login attempts', async () => {
    const limitedApp = createApp({ db, appOrigin: 'http://localhost', authAttemptLimit: 2 });
    const credentials = { email: 'missing@example.com', password: 'incorrect password' };
    expect((await request(limitedApp).post('/api/auth/login').send(credentials)).status).toBe(401);
    expect((await request(limitedApp).post('/api/auth/login').send(credentials)).status).toBe(401);
    const blocked = await request(limitedApp).post('/api/auth/login').send(credentials);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
  });

  it('rate limits repeated registration attempts before expensive password hashing', async () => {
    const limitedApp = createApp({ db, appOrigin: 'http://localhost', authAttemptLimit: 2 });
    const makeAccount = (index: number) => request(limitedApp).post('/api/auth/register').send({
      email: `signup-${index}@example.com`, name: `Signup ${index}`, password: 'correct horse battery staple',
    });
    expect((await makeAccount(1)).status).toBe(201);
    expect((await makeAccount(2)).status).toBe(201);
    const blocked = await makeAccount(3);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
  });

  it('returns a deterministic conflict for concurrent duplicate registration', async () => {
    const payload = { email: 'race@example.com', name: 'Race User', password: 'correct horse battery staple' };
    const responses = await Promise.all([
      request(app).post('/api/auth/register').send(payload),
      request(app).post('/api/auth/register').send(payload),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  });

  it('rejects mismatched mutation origins', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .set('Origin', 'https://attacker.example')
      .send({ email: 'origin@example.com', name: 'Origin User', password: 'correct horse battery staple' });
    expect(response.status).toBe(403);
  });

  it('treats expired and malformed sessions as unauthenticated', async () => {
    const agent = await register('expired@example.com');
    await db.query("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
    expect((await agent.get('/api/me')).status).toBe(401);

    const malformed = await request(app).get('/api/me').set('Cookie', 'signalroom_session=%E0%A4%A');
    expect(malformed.status).toBe(401);
  });

  it('returns a useful 413 response for oversized JSON bodies', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ padding: 'x'.repeat(33 * 1024) });
    expect(response.status).toBe(413);
    expect(response.body.error).toMatch(/too large/i);
  });

  it('rejects weak passwords and duplicate email registration', async () => {
    expect((await request(app).post('/api/auth/register').send({ email: 'a@example.com', name: 'A', password: 'short' })).status).toBe(400);
    await register('same@example.com');
    expect((await request(app).post('/api/auth/register').send({ email: 'same@example.com', name: 'Other', password: 'correct horse battery staple' })).status).toBe(409);
  });
});

describe('organizations and tenant boundaries', () => {
  it('creates an organization with the creator as owner', async () => {
    const owner = await register('owner@example.com');
    const organization = await createOrganization(owner);

    const list = await owner.get('/api/organizations');
    expect(list.status).toBe(200);
    expect(list.body.organizations[0]).toMatchObject({ id: organization.id, role: 'owner', name: 'Acme Labs' });
  });

  it('prevents a non-member from creating a board in another organization', async () => {
    const owner = await register('owner@example.com');
    const outsider = await register('outsider@example.com');
    const organization = await createOrganization(owner);

    const denied = await outsider.post(`/api/organizations/${organization.id}/boards`).send({ name: 'Ideas', slug: 'ideas' });
    expect(denied.status).toBe(403);
  });

  it('denies member-level board creation', async () => {
    const owner = await register('owner@example.com');
    const member = await register('member@example.com');
    const organization = await createOrganization(owner);
    const memberRow = (await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', ['member@example.com'])).rows[0];
    await db.query(
      "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'member')",
      [organization.id, memberRow.id],
    );

    const denied = await member.post(`/api/organizations/${organization.id}/boards`).send({ name: 'Ideas', slug: 'member-ideas' });
    expect(denied.status).toBe(403);
  });
});

describe('feedback workflow', () => {
  it('creates a public board, accepts feedback, toggles one vote, and adds a comment', async () => {
    const owner = await register('owner@example.com');
    const customer = await register('customer@example.com');
    const organization = await createOrganization(owner);
    const boardResponse = await owner.post(`/api/organizations/${organization.id}/boards`).send({ name: 'Product feedback', slug: 'product-feedback' });
    expect(boardResponse.status).toBe(201);
    const board = boardResponse.body.board as { id: string; slug: string };

    const postResponse = await customer.post(`/api/boards/${board.id}/posts`).send({
      title: 'Keyboard shortcuts',
      description: 'Let me move through the queue without reaching for the mouse.',
    });
    expect(postResponse.status).toBe(201);
    const postId = postResponse.body.post.id as string;

    expect((await customer.post(`/api/posts/${postId}/vote`)).body.voted).toBe(true);
    expect((await customer.post(`/api/posts/${postId}/vote`)).body.voted).toBe(false);

    const comment = await customer.post(`/api/posts/${postId}/comments`).send({ body: 'The J and K keys would cover my main use case.' });
    expect(comment.status).toBe(201);

    const publicBoard = await request(app).get('/api/boards/product-feedback');
    expect(publicBoard.status).toBe(200);
    expect(publicBoard.body.posts[0]).toMatchObject({ title: 'Keyboard shortcuts', voteCount: 0, commentCount: 1, status: 'under_review' });
    expect(JSON.stringify(publicBoard.body)).not.toContain('password');
  });

  it('allows an owner to change status but denies an outsider', async () => {
    const owner = await register('owner@example.com');
    const outsider = await register('outsider@example.com');
    const organization = await createOrganization(owner);
    const board = (await owner.post(`/api/organizations/${organization.id}/boards`).send({ name: 'Roadmap', slug: 'roadmap' })).body.board;
    const post = (await outsider.post(`/api/boards/${board.id}/posts`).send({ title: 'CSV export', description: 'Export feedback for quarterly planning.' })).body.post;

    expect((await outsider.patch(`/api/posts/${post.id}/status`).send({ status: 'planned' })).status).toBe(403);
    const changed = await owner.patch(`/api/posts/${post.id}/status`).send({ status: 'planned' });
    expect(changed.status).toBe(200);
    expect(changed.body.post.status).toBe('planned');
    expect(changed.body.post.statusHistory).toHaveLength(2);
  });
});
