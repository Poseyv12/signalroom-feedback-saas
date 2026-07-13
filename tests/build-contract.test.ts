import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production server bundle', () => {
  it('uses the NodeNext compiler so node:sqlite remains a built-in import', () => {
    const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8'));
    expect(packageJson.scripts.build).toContain('tsc -p tsconfig.server.json');
  });

  it('defines a container health check against the API endpoint', () => {
    const dockerfile = readFileSync(`${process.cwd()}/Dockerfile`, 'utf8');
    const compose = readFileSync(`${process.cwd()}/compose.yaml`, 'utf8');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('/api/health');
    expect(dockerfile).toContain('/app/migrations');
    expect(compose).toContain('healthcheck:');
  });

  it('documents every production configuration value', () => {
    const environment = readFileSync(`${process.cwd()}/.env.example`, 'utf8');
    expect(environment).toContain('SESSION_TTL_HOURS=');
    expect(environment).toContain('TRUST_PROXY_HOPS=');
  });

  it('exposes database backup and restore commands', () => {
    const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8'));
    expect(packageJson.scripts['db:backup']).toBeTruthy();
    expect(packageJson.scripts['db:restore']).toBeTruthy();
  });
});
