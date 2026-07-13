import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/server/db.js';

describe('database migrations', () => {
  it('applies the versioned initial migration once', () => {
    const db = createDatabase(':memory:');
    try {
      const migrations = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
      expect(migrations).toEqual([{ version: 1, name: 'initial' }]);

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining([
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
    } finally {
      db.close();
    }
  });

  it('baselines databases created before migration tracking was introduced', () => {
    const directory = mkdtempSync(join(tmpdir(), 'signalroom-legacy-'));
    const path = join(directory, 'legacy.db');
    const legacy = new DatabaseSync(path);
    legacy.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    legacy.close();

    try {
      const migrated = createDatabase(path);
      expect(migrated.prepare('SELECT version, name FROM schema_migrations').get()).toEqual({ version: 1, name: 'initial' });
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
