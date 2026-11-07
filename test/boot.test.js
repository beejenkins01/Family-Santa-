import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function spawnServer(env) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
  });
  child.stderr.on('data', (d) => {
    out += d;
  });
  return { child, output: () => out };
}

function started(child, output) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = () => {
      if (settled || !output().includes('Family Santa is open')) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`server did not listen:\n${output()}`));
    }, 5000);
    child.stdout.on('data', succeed);
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`server exited ${code} before listening:\n${output()}`));
    });
    succeed();
  });
}

function stopped(child) {
  return new Promise((resolve) => {
    if (child.exitCode != null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

function untilExit(env, timeoutMs = 4000) {
  const { child, output } = spawnServer(env);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, out: output(), timedOut: true });
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out: output(), timedOut: false });
    });
  });
}

function client(base) {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(cookie && { cookie }),
        ...(method !== 'GET' && { 'content-type': 'application/json' }),
      },
      body: method !== 'GET' ? JSON.stringify(body || {}) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

test('file fallback serves the workshop and keeps it across a restart', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-santa-'));
  const port = await freePort();
  const env = {
    PORT: String(port),
    HOST: '0.0.0.0',
    DATA_DIR: dataDir,
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    RENDER: '',
  };
  const base = `http://127.0.0.1:${port}`;

  const first = spawnServer(env);
  try {
    await started(first.child, first.output);
    assert.match(first.output(), /Storage: file/);

    const mom = client(base);
    const ray = client(base);
    const created = await mom('POST', '/api/families', {
      familyName: 'Boot Testers',
      name: 'Mom',
      pin: '1225',
      color: 'pine',
    });
    assert.equal(created.status, 201);
    const code = created.body.family.code;
    const momId = created.body.me.id;

    const wish = await mom('POST', `/api/members/${momId}/items`, {
      title: 'Wool scarf',
      price: '40',
      want: 3,
    });
    assert.equal(wish.status, 201);

    const joined = await ray('POST', `/api/families/${code}/join`, { name: 'Ray', pin: '4444' });
    assert.equal(joined.status, 201);
    const dibs = await ray('POST', `/api/items/${wish.body.id}/dibs`);
    assert.equal(dibs.status, 201);

    const ownList = await mom('GET', `/api/members/${momId}`);
    assert.equal(ownList.body.shielded, true);
    assert.equal('claim' in ownList.body.items[0], false);

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Family Santa/);

    await stopped(first.child);
  } catch (err) {
    first.child.kill('SIGKILL');
    throw err;
  }

  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'family-santa.json'), 'utf8'));
  const memberNames = Object.values(saved.members).map((m) => m.name).sort();
  assert.deepEqual(memberNames, ['Mom', 'Ray']);

  const second = spawnServer(env);
  try {
    await started(second.child, second.output);
    const mom = client(base);
    const back = await mom('POST', `/api/families/${Object.values(saved.families)[0].code}/login`, {
      memberId: Object.values(saved.members).find((m) => m.name === 'Mom').id,
      pin: '1225',
    });
    assert.equal(back.status, 200);
    const list = await mom('GET', `/api/members/${back.body.me.id}`);
    assert.equal(list.body.items[0].title, 'Wool scarf');
    assert.equal('claim' in list.body.items[0], false);
  } finally {
    second.child.kill('SIGKILL');
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('Render without Upstash exits before listening', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-santa-'));
  try {
    const result = await untilExit({
      PORT: '3999',
      DATA_DIR: dataDir,
      RENDER: 'true',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
    });
    assert.equal(result.timedOut, false);
    assert.equal(result.code, 1);
    assert.match(result.out, /UPSTASH_REDIS_REST_URL/);
    assert.match(result.out, /UPSTASH_REDIS_REST_TOKEN/);
    assert.doesNotMatch(result.out, /Family Santa is open/);
    assert.deepEqual(await fs.readdir(dataDir), []);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('wrong Upstash credentials exit before listening and do not write a file', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'family-santa-'));
  const fake = http.createServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'WRONGPASS invalid token' }));
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${fake.address().port}`;
  try {
    const result = await untilExit({
      PORT: '3998',
      DATA_DIR: dataDir,
      RENDER: '',
      UPSTASH_REDIS_REST_URL: url,
      UPSTASH_REDIS_REST_TOKEN: 'not-a-real-token',
    });
    assert.equal(result.timedOut, false);
    assert.equal(result.code, 1);
    assert.match(result.out, /Upstash 401: WRONGPASS invalid token/);
    assert.doesNotMatch(result.out, /Family Santa is open/);
    assert.deepEqual(await fs.readdir(dataDir), []);
  } finally {
    fake.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
