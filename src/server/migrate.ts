import { existsSync } from 'node:fs';
import { parseServerConfig } from './config.js';
import { applyMigrations, createDatabase } from './db.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const { databaseUrl } = parseServerConfig(process.env);
const db = createDatabase(databaseUrl);

try {
  await applyMigrations(db);
  console.log('SignalRoom database migrations are current.');
} finally {
  await db.close();
}
