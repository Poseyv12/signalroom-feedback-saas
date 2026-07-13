import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const port = Number(process.env.PORT || 4174);
const databasePath = process.env.DATABASE_PATH || './data/signalroom.db';
const appOrigin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const production = process.env.NODE_ENV === 'production';
const db = createDatabase(databasePath);
const app = createApp({ db, appOrigin });
const distDir = resolve(process.cwd(), 'dist');

if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: production ? '1h' : 0 }));
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.accepts('html')) return res.sendFile(resolve(distDir, 'index.html'));
    next();
  });
}

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`SignalRoom listening on ${appOrigin}`);
});

function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
