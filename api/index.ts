import { createApp } from '../src/server/app.js';
import { parseServerConfig } from '../src/server/config.js';
import { createDatabase } from '../src/server/db.js';

const { databaseUrl, appOrigin, sessionTtlMs, trustProxyHops } = parseServerConfig(process.env);
const db = createDatabase(databaseUrl);

export default createApp({ db, appOrigin, sessionTtlMs, trustProxyHops });
