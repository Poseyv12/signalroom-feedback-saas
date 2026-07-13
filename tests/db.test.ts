import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, type AppDatabase } from '../src/server/db.js';
import { createTestDatabase } from './helpers/database.js';

let db: AppDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
});

afterEach(async () => {
  await db.close();
});

describe('Supabase Postgres migrations', () => {
  it('applies the versioned initial migration exactly once', async () => {
    await applyMigrations(db);
    await applyMigrations(db);

    const migrations = await db.query<{ version: string | number; name: string }>(
      'SELECT version, name FROM schema_migrations ORDER BY version',
    );
    expect(migrations.rows).toEqual([{ version: 202607130001, name: 'initial' }]);

    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    expect(tables.rows.map((table) => table.table_name)).toEqual(expect.arrayContaining([
      'boards',
      'comments',
      'feedback_posts',
      'memberships',
      'organizations',
      'sessions',
      'status_history',
      'users',
      'votes',
    ]));
  });

  it('enforces tenant and identity constraints in Postgres', async () => {
    await applyMigrations(db);
    await expect(
      db.query(
        `INSERT INTO memberships (organization_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
      ),
    ).rejects.toThrow();
  });
});
