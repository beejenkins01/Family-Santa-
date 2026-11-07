import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStore } from '../lib/store.js';
import { createApp } from '../lib/app.js';

let server;
let base;

before(async () => {
  const store = await createStore({ memory: true });
  server = http.createServer(createApp({ store, secureCookies: false }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// A tiny cookie-keeping client, one per family member.
function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie && { cookie }), ...(method !== 'GET' && { 'content-type': 'application/json' }) },
      body: method !== 'GET' ? JSON.stringify(body || {}) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
  };
}

const mom = client();
const ray = client();
const kim = client();
let code, momId, rayId, kimId, scarfId, socksId;

test('mom starts a family, ray and kim join with the code', async () => {
  const created = await mom('POST', '/api/families', { familyName: 'The Testers', name: 'Mom', pin: '1225', color: 'pine' });
  assert.equal(created.status, 201);
  code = created.body.family.code;
  momId = created.body.me.id;
  assert.match(code, /^[A-Z]+-\d{4}$/);

  const lookup = await ray('GET', `/api/families/${code.toLowerCase()}`);
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.family.name, 'The Testers');

  const r = await ray('POST', `/api/families/${code}/join`, { name: 'Ray', pin: '4444' });
  const k = await kim('POST', `/api/families/${code}/join`, { name: 'Kim', pin: '5555' });
  assert.equal(r.status, 201);
  assert.equal(k.status, 201);
  rayId = r.body.me.id;
  kimId = k.body.me.id;

  const dupe = await client()('POST', `/api/families/${code}/join`, { name: 'ray', pin: '1111' });
  assert.equal(dupe.status, 409);
});

test('mom adds wishes; nobody else can add to her list', async () => {
  const a = await mom('POST', `/api/members/${momId}/items`, { title: 'Green wool scarf', url: 'example.com/scarf', price: '$40', want: 3 });
  const b = await mom('POST', `/api/members/${momId}/items`, { title: 'Fuzzy socks', price: 12 });
  assert.equal(a.status, 201);
  assert.equal(a.body.url, 'https://example.com/scarf');
  assert.equal(a.body.price, 40);
  scarfId = a.body.id;
  socksId = b.body.id;

  const sneaky = await ray('POST', `/api/members/${momId}/items`, { title: 'A gift ray wants mom to want' });
  assert.equal(sneaky.status, 403);

  const evil = await mom('POST', `/api/members/${momId}/items`, { title: 'x', url: 'javascript:alert(1)' });
  assert.equal(evil.status, 400);
});

test('ray calls dibs; kim sees it; double-dibs is blocked; mom cannot dibs her own', async () => {
  const d = await ray('POST', `/api/items/${scarfId}/dibs`);
  assert.equal(d.status, 201);
  assert.equal(d.body.mine, true);

  const again = await kim('POST', `/api/items/${scarfId}/dibs`);
  assert.equal(again.status, 409);
  assert.match(again.body.error, /Ray/);

  const own = await mom('POST', `/api/items/${socksId}/dibs`);
  assert.equal(own.status, 400);

  const kimView = await kim('GET', `/api/members/${momId}`);
  const scarf = kimView.body.items.find((i) => i.id === scarfId);
  assert.equal(scarf.claim.giverIds[0], rayId);
  assert.equal(kimView.body.shielded, false);
});

test('ray logs an off-list surprise and kim chips in on the scarf', async () => {
  const s = await ray('POST', `/api/members/${momId}/surprises`, { title: 'Spa day voucher', price: 80 });
  assert.equal(s.status, 201);
  const kimView = await kim('GET', `/api/members/${momId}`);
  const scarfClaim = kimView.body.items.find((i) => i.id === scarfId).claim;
  const chip = await kim('POST', `/api/claims/${scarfClaim.id}/chip-in`);
  assert.equal(chip.status, 200);
  assert.deepEqual(chip.body.giverIds, [rayId, kimId]);
  assert.equal(kimView.body.surprises.length, 1);
});

test('THE RULE: mom sees nothing about gifts for her, anywhere', async () => {
  const list = await mom('GET', `/api/members/${momId}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.shielded, true);
  assert.deepEqual(list.body.surprises, []);
  for (const item of list.body.items) assert.equal('claim' in item, false, 'own items must not carry a claim key');
  assert.doesNotMatch(list.raw, /Spa day|"giverIds"|"dibs"/);

  const overview = await mom('GET', '/api/overview');
  const me = overview.body.members.find((m) => m.id === momId);
  assert.equal('openCount' in me, false);
  assert.equal('surpriseCount' in me, false);
  assert.deepEqual(overview.body.sleigh, []);
  for (const a of overview.body.activity) {
    assert.ok(!['dibs', 'chipin', 'surprise', 'bought', 'wrapped'].includes(a.type) || a.recipientId !== momId);
  }
  assert.doesNotMatch(overview.raw, /Spa day/);

  const sleigh = await mom('GET', '/api/sleigh');
  assert.deepEqual(sleigh.body.gifts, []);

  // Probing claim ids about her gets a 404, same as a made-up id.
  const kimView = await kim('GET', `/api/members/${momId}`);
  const claimId = kimView.body.items.find((i) => i.id === scarfId).claim.id;
  for (const [method, path] of [
    ['POST', `/api/claims/${claimId}/chip-in`],
    ['PATCH', `/api/claims/${claimId}`],
    ['DELETE', `/api/claims/${claimId}`],
  ]) {
    const r = await mom(method, path, { status: 'wrapped' });
    assert.equal(r.status, 404, `${method} ${path}`);
  }
});

test('status updates only by givers, and show up for others', async () => {
  const kimView = await kim('GET', `/api/members/${momId}`);
  const claimId = kimView.body.items.find((i) => i.id === scarfId).claim.id;
  const ok = await ray('PATCH', `/api/claims/${claimId}`, { status: 'bought' });
  assert.equal(ok.body.status, 'bought');
  const surprise = kimView.body.surprises[0];
  const nope = await kim('PATCH', `/api/claims/${surprise.id}`, { status: 'wrapped' });
  assert.equal(nope.status, 403);
});

test('if mom deletes a claimed wish, the givers keep it as a heads-up; mom gets the same response', async () => {
  const del = await mom('DELETE', `/api/items/${scarfId}`);
  const del2 = await mom('DELETE', `/api/items/${socksId}`);
  assert.deepEqual(del.body, del2.body);
  const sleigh = await ray('GET', '/api/sleigh');
  const orphan = sleigh.body.gifts.find((g) => g.orphanedFrom === 'Green wool scarf');
  assert.ok(orphan, 'ray still has the scarf in his sleigh');
  assert.equal(orphan.kind, 'surprise');
  const list = await mom('GET', `/api/members/${momId}`);
  assert.equal(list.body.items.length, 0);
});

test('editing a claimed wish flags the giver until they acknowledge it', async () => {
  const item = await kim('POST', `/api/members/${kimId}/items`, { title: 'Blue mug' });
  const claim = await ray('POST', `/api/items/${item.body.id}/dibs`);
  assert.equal(claim.body.wishChangedSinceDibs, false);
  await new Promise((r) => setTimeout(r, 5));
  await kim('PATCH', `/api/items/${item.body.id}`, { title: 'Green mug, actually' });
  let sleigh = await ray('GET', '/api/sleigh');
  let gift = sleigh.body.gifts.find((g) => g.id === claim.body.id);
  assert.equal(gift.wishChangedSinceDibs, true);
  assert.equal(gift.title, 'Green mug, actually');
  await ray('PATCH', `/api/claims/${claim.body.id}`, { ack: true });
  sleigh = await ray('GET', '/api/sleigh');
  gift = sleigh.body.gifts.find((g) => g.id === claim.body.id);
  assert.equal(gift.wishChangedSinceDibs, false);
});

test('managed members: anyone can edit, everyone sees claims', async () => {
  const g = await ray('POST', '/api/members', { name: 'Grandpa', color: 'cocoa' });
  assert.equal(g.status, 201);
  const item = await kim('POST', `/api/members/${g.body.id}/items`, { title: 'Crossword book' });
  assert.equal(item.status, 201);
  await mom('POST', `/api/items/${item.body.id}/dibs`);
  const rayView = await ray('GET', `/api/members/${g.body.id}`);
  assert.equal(rayView.body.items[0].claim.giverIds[0], momId);
  const login = await client()('POST', `/api/families/${code}/login`, { memberId: g.body.id, pin: '0000' });
  assert.equal(login.status, 404);
});

test('wrong PINs lock out after five tries', async () => {
  const stranger = client();
  for (let i = 0; i < 5; i++) {
    const r = await stranger('POST', `/api/families/${code}/login`, { memberId: kimId, pin: '0000' });
    assert.equal(r.status, 401);
  }
  const locked = await stranger('POST', `/api/families/${code}/login`, { memberId: kimId, pin: '5555' });
  assert.equal(locked.status, 429);
});

test('organizer PIN reset lets the person set a new PIN', async () => {
  const notOrg = await ray('POST', `/api/members/${kimId}/reset-pin`);
  assert.equal(notOrg.status, 403);
  const reset = await mom('POST', `/api/members/${rayId}/reset-pin`);
  assert.equal(reset.body.needsPin, true);
  const old = await ray('GET', '/api/overview');
  assert.equal(old.status, 401, 'old sessions are signed out');
  const back = await ray('POST', `/api/families/${code}/login`, { memberId: rayId, pin: '9999' });
  assert.equal(back.status, 200);
  const again = await client()('POST', `/api/families/${code}/login`, { memberId: rayId, pin: '9999' });
  assert.equal(again.status, 200);
});

test('unauthenticated requests are turned away', async () => {
  const anon = client();
  assert.equal((await anon('GET', '/api/overview')).status, 401);
  assert.equal((await anon('GET', `/api/members/${momId}`)).status, 401);
  const res = await fetch(`${base}/api/families`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(res.status, 415);
});
