import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Vercel and Supabase production contract', () => {
  it('builds the Vite client and type-checks the Node server', () => {
    const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8'));
    expect(packageJson.scripts.build).toContain('vite build');
    expect(packageJson.scripts.build).toContain('tsc -p tsconfig.server.json');
  });

  it('exports an Express function and routes API requests through Vercel', () => {
    const functionSource = readFileSync(`${process.cwd()}/api/index.ts`, 'utf8');
    const vercel = JSON.parse(readFileSync(`${process.cwd()}/vercel.json`, 'utf8'));
    expect(functionSource).toContain('export default createApp');
    expect(vercel.framework).toBe('vite');
    expect(vercel.rewrites).toContainEqual({ source: '/api/:path*', destination: '/api' });
  });

  it('tracks a Supabase-compatible Postgres migration', () => {
    expect(existsSync(`${process.cwd()}/supabase/migrations/202607130001_initial.sql`)).toBe(true);
    const migration = readFileSync(`${process.cwd()}/supabase/migrations/202607130001_initial.sql`, 'utf8');
    expect(migration).toContain('TIMESTAMPTZ');
    expect(migration).toContain('REFERENCES organizations(id)');
  });

  it('documents every server-side production configuration value without a real secret', () => {
    const environment = readFileSync(`${process.cwd()}/.env.example`, 'utf8');
    expect(environment).toContain('DATABASE_URL=postgresql://');
    expect(environment).toContain('[PASSWORD]');
    expect(environment).toContain('SESSION_TTL_HOURS=');
    expect(environment).toContain('TRUST_PROXY_HOPS=');
  });

  it('exposes an explicit database migration command', () => {
    const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8'));
    expect(packageJson.scripts['db:migrate']).toBeTruthy();
  });
});
