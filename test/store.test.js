import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';

test('file store survives a restart', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-santa-'));
  const a = await createStore({ dataDir });
  a.data.families.f1 = { id: 'f1', name: 'Test' };
  a.save();
  await a.flush();
  const b = await createStore({ dataDir });
  assert.equal(b.data.families.f1.name, 'Test');
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('upstash store speaks the REST protocol', async () => {
  // A stand-in for Upstash's REST API: POST a JSON command array, get { result }.
  const kv = new Map();
  let auth = '';
  const fake = http.createServer(async (req, res) => {
    auth = req.headers.authorization;
    let body = '';
    for await (const c of req) body += c;
    const [cmd, key, value] = JSON.parse(body);
    const result = cmd === 'GET' ? (kv.get(key) ?? null) : (kv.set(key, value), 'OK');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ result }));
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${fake.address().port}`;

  const a = await createStore({ upstashUrl: url, upstashToken: 'secret' });
  assert.equal(a.kind, 'upstash redis');
  a.data.members.m1 = { id: 'm1', name: 'Mom' };
  a.save();
  await a.flush();
  assert.equal(auth, 'Bearer secret');

  const b = await createStore({ upstashUrl: url, upstashToken: 'secret' });
  assert.equal(b.data.members.m1.name, 'Mom');
  fake.close();
});
