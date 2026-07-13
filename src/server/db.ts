import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppDatabase = DatabaseSync;

type Migration = { version: number; name: string; sql: string };

function loadMigrations(directory: string): Migration[] {
  const migrations = readdirSync(directory)
    .filter((file) => /^\d{3}_[a-z0-9-]+\.sql$/i.test(file))
    .sort()
    .map((file) => {
      const [versionText, ...nameParts] = file.replace(/\.sql$/i, '').split('_');
      return {
        version: Number(versionText),
        name: nameParts.join('_').replace(/-/g, '_'),
        sql: readFileSync(resolve(directory, file), 'utf8'),
      };
    });

  const versions = new Set<number>();
  for (const migration of migrations) {
    if (versions.has(migration.version)) throw new Error(`Duplicate migration version ${migration.version}.`);
    versions.add(migration.version);
  }
  return migrations;
}

export function applyMigrations(db: AppDatabase, directory = resolve(process.cwd(), 'migrations')) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((row) => Number(row.version)),
  );

  for (const migration of loadMigrations(directory)) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function createDatabase(path: string): AppDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  applyMigrations(db);
  return db;
}
