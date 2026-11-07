import http from 'node:http';
import { createStore } from './lib/store.js';
import { createApp } from './lib/app.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const upstashUrl = (process.env.UPSTASH_REDIS_REST_URL || '').trim();
const upstashToken = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

// Render sets RENDER=true. Its free web services wipe the local disk on
// restart and after idle spin-down, so a missing Upstash config must not
// quietly fall back to a file.
if (process.env.RENDER === 'true' && (!upstashUrl || !upstashToken)) {
  console.error(
    '[family-santa] Running on Render without Upstash. The free disk is wiped when the service restarts or spins down, so the wish list would disappear. Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
  );
  process.exit(1);
}

let store;
try {
  store = await createStore({
    dataDir: process.env.DATA_DIR || './data',
    upstashUrl,
    upstashToken,
  });
} catch (err) {
  console.error(`[family-santa] ${err.message}`);
  process.exit(1);
}

const server = http.createServer(createApp({ store }));
server.listen(PORT, HOST, () => {
  console.log(`Family Santa is open for business at http://localhost:${PORT}`);
  console.log(`Storage: ${store.kind}`);
});

async function shutdown() {
  server.close();
  await store.flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
