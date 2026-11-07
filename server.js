import http from 'node:http';
import { createStore } from './lib/store.js';
import { createApp } from './lib/app.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const store = await createStore({
  dataDir: process.env.DATA_DIR || './data',
  upstashUrl: process.env.UPSTASH_REDIS_REST_URL,
  upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN,
});

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
