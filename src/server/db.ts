import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export type QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
  rowCount: number | null;
};

export type DatabaseConnection = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: unknown[],
  ): Promise<QueryResult<Row>>;
  exec(sql: string): Promise<void>;
};

export type AppDatabase = DatabaseConnection & {
  transaction<T>(callback: (connection: DatabaseConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

type Migration = { version: number; name: string; sql: string };

export function loadMigrations(directory = resolve(process.cwd(), 'supabase/migrations')): Migration[] {
  const migrations = readdirSync(directory)
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
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
    if (!Number.isSafeInteger(migration.version)) throw new Error(`Invalid migration version ${migration.version}.`);
    if (versions.has(migration.version)) throw new Error(`Duplicate migration version ${migration.version}.`);
    versions.add(migration.version);
  }
  return migrations;
}

export async function applyMigrations(
  db: AppDatabase,
  directory = resolve(process.cwd(), 'supabase/migrations'),
) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const appliedResult = await db.query<{ version: string | number }>('SELECT version FROM schema_migrations');
  const applied = new Set(appliedResult.rows.map((row) => Number(row.version)));

  for (const migration of loadMigrations(directory)) {
    if (applied.has(migration.version)) continue;
    await db.transaction(async (connection) => {
      await connection.exec(migration.sql);
      await connection.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name],
      );
    });
  }
}

export function createDatabase(connectionString: string): AppDatabase {
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return {
    query: (sql, parameters = []) => pool.query(sql, parameters),
    async exec(sql: string) {
      await pool.query(sql);
    },
    async transaction<T>(callback: (connection: DatabaseConnection) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await callback({
          query: (sql, parameters = []) => client.query(sql, parameters),
          async exec(sql: string) {
            await client.query(sql);
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
