import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('marketing presentation and metadata contracts', () => {
  it('ships responsive marketing styles and hides the honeypot accessibly', () => {
    const css = readFileSync(`${root}/src/client/styles.css`, 'utf8');
    expect(css).toContain('.marketing-hero');
    expect(css).toContain('.signal-ledger');
    expect(css).toContain('.updates-form');
    expect(css).toMatch(/\.honeypot\s*\{[^}]*position:\s*absolute/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)/);
  });

  it('provides canonical, Open Graph, and truthful structured metadata', () => {
    const html = readFileSync(`${root}/index.html`, 'utf8');
    expect(html).toContain('<link rel="canonical" href="https://signalroom-feedback-saas.vercel.app/"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const structured = JSON.parse(match![1]);
    expect(structured['@type']).toBe('SoftwareApplication');
    expect(structured).not.toHaveProperty('aggregateRating');
    expect(structured).not.toHaveProperty('offers');
  });

  it('publishes production robots and a canonical public sitemap', () => {
    expect(existsSync(`${root}/public/robots.txt`)).toBe(true);
    expect(existsSync(`${root}/public/sitemap.xml`)).toBe(true);
    const robots = readFileSync(`${root}/public/robots.txt`, 'utf8');
    const sitemap = readFileSync(`${root}/public/sitemap.xml`, 'utf8');
    expect(robots).toContain('Sitemap: https://signalroom-feedback-saas.vercel.app/sitemap.xml');
    expect(sitemap).toContain('https://signalroom-feedback-saas.vercel.app/privacy');
    expect(sitemap).toContain('https://signalroom-feedback-saas.vercel.app/terms');
    expect(sitemap).not.toContain('/app');
  });
});
