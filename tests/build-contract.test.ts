import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production server bundle', () => {
  it('uses the NodeNext compiler so node:sqlite remains a built-in import', () => {
    const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8'));
    expect(packageJson.scripts.build).toContain('tsc -p tsconfig.server.json');
  });
});
