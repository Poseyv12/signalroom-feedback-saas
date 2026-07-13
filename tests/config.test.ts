import { describe, expect, it } from 'vitest';
import { parseServerConfig } from '../src/server/config.js';

const databaseUrl = 'postgresql://postgres:secret@db.example.com:5432/postgres';

describe('server configuration', () => {
  it('provides safe application defaults with an explicit Postgres URL', () => {
    expect(parseServerConfig({ DATABASE_URL: databaseUrl })).toEqual({
      port: 4174,
      databaseUrl,
      appOrigin: 'http://localhost:4174',
      sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
      trustProxyHops: 0,
      production: false,
    });
  });

  it('parses explicit Supabase and Vercel deployment values', () => {
    expect(parseServerConfig({
      PORT: '8080',
      DATABASE_URL: databaseUrl,
      APP_ORIGIN: 'https://feedback.example.com',
      SESSION_TTL_HOURS: '24',
      TRUST_PROXY_HOPS: '1',
      NODE_ENV: 'production',
    })).toEqual({
      port: 8080,
      databaseUrl,
      appOrigin: 'https://feedback.example.com',
      sessionTtlMs: 24 * 60 * 60 * 1000,
      trustProxyHops: 1,
      production: true,
    });
  });

  it('uses the deployment-specific Vercel URL when APP_ORIGIN is not set', () => {
    expect(parseServerConfig({
      DATABASE_URL: databaseUrl,
      VERCEL_URL: 'signalroom-git-main-poseyv12.vercel.app',
    }).appOrigin).toBe('https://signalroom-git-main-poseyv12.vercel.app');
  });

  it.each([
    [{ DATABASE_URL: databaseUrl, PORT: 'abc' }, 'PORT'],
    [{ DATABASE_URL: databaseUrl, APP_ORIGIN: 'feedback.example.com' }, 'APP_ORIGIN'],
    [{ DATABASE_URL: databaseUrl, SESSION_TTL_HOURS: '0' }, 'SESSION_TTL_HOURS'],
    [{ DATABASE_URL: databaseUrl, TRUST_PROXY_HOPS: '-1' }, 'TRUST_PROXY_HOPS'],
    [{}, 'DATABASE_URL'],
    [{ DATABASE_URL: 'file:./signalroom.db' }, 'DATABASE_URL'],
  ])('rejects invalid configuration %#', (environment, expectedMessage) => {
    expect(() => parseServerConfig(environment)).toThrow(expectedMessage);
  });
});
