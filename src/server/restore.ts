import { resolve } from 'node:path';
import { restoreDatabase } from './maintenance.js';

const arguments_ = process.argv.slice(2);
const force = arguments_.includes('--force');
const positional = arguments_.filter((argument) => argument !== '--force');
const [backupArgument, targetArgument] = positional;
if (!backupArgument) {
  console.error('Usage: npm run db:restore -- <backup.db> <target.db> [--force]');
  process.exit(2);
}
const backup = resolve(backupArgument);
const target = resolve(targetArgument || process.env.DATABASE_PATH || './data/signalroom.db');
restoreDatabase(backup, target, { force });
console.log(`Verified database restored to ${target}`);
