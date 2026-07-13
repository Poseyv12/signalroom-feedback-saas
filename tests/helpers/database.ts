import { PGlite } from '@electric-sql/pglite';
import type { AppDatabase, DatabaseConnection } from '../../src/server/db.js';

export async function createTestDatabase(): Promise<AppDatabase> {
  const database = new PGlite();
  await database.waitReady;

  const connection: DatabaseConnection = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters: unknown[] = []) {
      const result = await database.query<Row>(sql, parameters);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    async exec(sql: string) {
      await database.exec(sql);
    },
  };

  return {
    ...connection,
    async transaction<T>(callback: (transaction: DatabaseConnection) => Promise<T>) {
      return database.transaction(async (transaction) => {
        const scoped: DatabaseConnection = {
          async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters: unknown[] = []) {
            const result = await transaction.query<Row>(sql, parameters);
            return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
          },
          async exec(sql: string) {
            await transaction.exec(sql);
          },
        };
        return callback(scoped);
      });
    },
    close: () => database.close(),
  };
}
