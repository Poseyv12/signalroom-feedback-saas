import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { parseServerConfig } from './config.js';
import { applyMigrations, createDatabase } from './db.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const { port, databaseUrl, appOrigin, sessionTtlMs, trustProxyHops, production } = parseServerConfig(process.env);
const db = createDatabase(databaseUrl);
await applyMigrations(db);
const app = createApp({ db, appOrigin, sessionTtlMs, trustProxyHops });
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
    void db.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
