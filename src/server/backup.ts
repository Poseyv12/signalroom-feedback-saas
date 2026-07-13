import { resolve } from 'node:path';
import { backupDatabase } from './maintenance.js';

const [sourceArgument, outputArgument] = process.argv.slice(2);
const source = resolve(sourceArgument || process.env.DATABASE_PATH || './data/signalroom.db');
if (!outputArgument) {
  console.error('Usage: npm run db:backup -- <source.db> <backup.db>');
  process.exit(2);
}
const output = resolve(outputArgument);
backupDatabase(source, output);
console.log(`Verified backup written to ${output}`);
