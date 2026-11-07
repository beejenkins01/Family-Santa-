// Tiny persistence layer. The whole family database is one JSON document:
// a family of 20 with 50 wishes each is still only a few hundred KB.
//
// Adapters:
//   - file    (default) writes DATA_DIR/family-santa.json atomically
//   - upstash (set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN) for
//              free hosts whose disks get wiped on restart
//   - memory  for tests

import fs from 'node:fs/promises';
import path from 'node:path';

export const emptyDb = () => ({
  version: 1,
  families: {},
  members: {},
  items: {},
  claims: {},
  sessions: {},
  activity: [],
});

function fileAdapter(dataDir) {
  const file = path.resolve(dataDir, 'family-santa.json');
  return {
    kind: `file (${file})`,
    async load() {
      try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async save(json) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, json);
      await fs.rename(tmp, file);
    },
  };
}

function upstashAdapter(url, token, key = 'family-santa:db') {
  async function command(args) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`Upstash ${res.status}: ${body.error || 'request failed'}`);
    return body.result;
  }
  return {
    kind: 'upstash redis',
    async load() {
      const raw = await command(['GET', key]);
      return raw ? JSON.parse(raw) : null;
    },
    async save(json) {
      await command(['SET', key, json]);
    },
  };
}

function memoryAdapter() {
  let saved = null;
  return {
    kind: 'memory',
    async load() { return saved ? JSON.parse(saved) : null; },
    async save(json) { saved = json; },
  };
}

export async function createStore({ dataDir = './data', upstashUrl, upstashToken, memory = false, debounceMs = 150 } = {}) {
  const adapter = memory
    ? memoryAdapter()
    : upstashUrl && upstashToken
      ? upstashAdapter(upstashUrl.replace(/\/+$/, ''), upstashToken)
      : fileAdapter(dataDir);

  const data = { ...emptyDb(), ...((await adapter.load()) || {}) };

  let timer = null;
  let dirty = false;
  let writing = Promise.resolve();

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!dirty) return writing;
    dirty = false;
    const snapshot = JSON.stringify(data);
    writing = writing
      .then(() => adapter.save(snapshot))
      .catch((err) => {
        console.error('[store] save failed, will retry on next change:', err.message);
        dirty = true;
      });
    return writing;
  }

  return {
    kind: adapter.kind,
    data,
    save() {
      dirty = true;
      if (!timer) timer = setTimeout(flush, debounceMs);
    },
    flush,
  };
}
