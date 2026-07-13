import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupDatabase, restoreDatabase } from '../src/server/maintenance.js';
import { createDatabase } from '../src/server/db.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('database backup and restore', () => {
  it('creates an integrity-checked backup and restores its data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'signalroom-maintenance-'));
    directories.push(directory);
    const source = join(directory, 'source.db');
    const backup = join(directory, 'backup.db');
    const restored = join(directory, 'restored.db');

    const db = createDatabase(source);
    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
      'user-1',
      'backup@example.com',
      'Backup User',
      'synthetic-hash',
    );
    db.close();

    backupDatabase(source, backup);
    restoreDatabase(backup, restored);

    const restoredDb = createDatabase(restored);
    try {
      expect(restoredDb.prepare('SELECT email, name FROM users WHERE id = ?').get('user-1')).toEqual({
        email: 'backup@example.com',
        name: 'Backup User',
      });
    } finally {
      restoredDb.close();
    }
  });

  it('refuses to overwrite an existing restore target without force', () => {
    const directory = mkdtempSync(join(tmpdir(), 'signalroom-maintenance-'));
    directories.push(directory);
    const source = join(directory, 'source.db');
    const backup = join(directory, 'backup.db');
    const target = join(directory, 'target.db');

    createDatabase(source).close();
    createDatabase(target).close();
    backupDatabase(source, backup);

    expect(() => restoreDatabase(backup, target)).toThrow(/already exists/i);
  });
});
