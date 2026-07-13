import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from '../src/server/app.js';
import { applyMigrations } from '../src/server/db.js';
import { createTestDatabase } from './helpers/database.js';

const port = Number(process.env.PORT ?? 4190);
const appOrigin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`;
const db = await createTestDatabase();
await applyMigrations(db);
const app = createApp({ db, appOrigin });
const distDirectory = resolve(process.cwd(), 'dist');

if (!existsSync(distDirectory)) throw new Error('Run the production client build before starting the E2E server.');
app.use(express.static(distDirectory, { index: false }));
app.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html')) return res.sendFile(resolve(distDirectory, 'index.html'));
  next();
});

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`SignalRoom E2E server listening on ${appOrigin}`);
});

async function shutdown() {
  server.close(() => {
    void db.close().finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
