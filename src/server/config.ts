export type ServerEnvironment = Record<string, string | undefined>;

export type ServerConfig = {
  port: number;
  databaseUrl: string;
  appOrigin: string;
  sessionTtlMs: number;
  trustProxyHops: number;
  production: boolean;
};

function integer(name: string, value: string, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function origin(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('APP_ORIGIN must be an absolute HTTP or HTTPS origin.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('APP_ORIGIN must be an absolute HTTP or HTTPS origin without a path, query, or credentials.');
  }
  return parsed.origin;
}

function postgresUrl(value: string | undefined) {
  if (!value?.trim()) throw new Error('DATABASE_URL is required. Use the pooled Supabase Postgres connection string.');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  return value.trim();
}

export function parseServerConfig(environment: ServerEnvironment): ServerConfig {
  const port = integer('PORT', environment.PORT ?? '4174', 1, 65_535);
  const databaseUrl = postgresUrl(environment.DATABASE_URL);
  const inferredVercelOrigin = environment.VERCEL_URL ? `https://${environment.VERCEL_URL.trim()}` : undefined;
  const appOrigin = origin(environment.APP_ORIGIN?.trim() || inferredVercelOrigin || `http://localhost:${port}`);
  const sessionTtlHours = integer('SESSION_TTL_HOURS', environment.SESSION_TTL_HOURS ?? '168', 1, 8_760);
  const trustProxyHops = integer('TRUST_PROXY_HOPS', environment.TRUST_PROXY_HOPS ?? '0', 0, 5);

  return {
    port,
    databaseUrl,
    appOrigin,
    sessionTtlMs: sessionTtlHours * 60 * 60 * 1000,
    trustProxyHops,
    production: environment.NODE_ENV === 'production',
  };
}
