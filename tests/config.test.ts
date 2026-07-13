import { describe, expect, it } from 'vitest';
import { parseServerConfig } from '../src/server/config.js';

describe('server configuration', () => {
  it('provides safe single-instance defaults', () => {
    expect(parseServerConfig({})).toEqual({
      port: 4174,
      databasePath: './data/signalroom.db',
      appOrigin: 'http://localhost:4174',
      sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
      trustProxyHops: 0,
      production: false,
    });
  });

  it('parses explicit deployment values', () => {
    expect(parseServerConfig({
      PORT: '8080',
      DATABASE_PATH: '/data/app.db',
      APP_ORIGIN: 'https://feedback.example.com',
      SESSION_TTL_HOURS: '24',
      TRUST_PROXY_HOPS: '1',
      NODE_ENV: 'production',
    })).toEqual({
      port: 8080,
      databasePath: '/data/app.db',
      appOrigin: 'https://feedback.example.com',
      sessionTtlMs: 24 * 60 * 60 * 1000,
      trustProxyHops: 1,
      production: true,
    });
  });

  it.each([
    [{ PORT: 'abc' }, 'PORT'],
    [{ APP_ORIGIN: 'feedback.example.com' }, 'APP_ORIGIN'],
    [{ SESSION_TTL_HOURS: '0' }, 'SESSION_TTL_HOURS'],
    [{ TRUST_PROXY_HOPS: '-1' }, 'TRUST_PROXY_HOPS'],
  ])('rejects invalid configuration %#', (environment, expectedMessage) => {
    expect(() => parseServerConfig(environment)).toThrow(expectedMessage);
  });
});
