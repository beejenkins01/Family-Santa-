// Family Santa HTTP app: JSON API + static files.
//
// THE RULE: a claim (dibs, chip-in, surprise) about you never leaves the
// server in a response you can see. Every place that serializes claims or
// activity goes through `visibleTo()`. Claims about you also answer 404 rather
// than 403, so their existence can't be probed.

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPin, verifyPin, newId, newToken, hashToken, newFamilyCode } from './auth.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export const COLORS = ['cranberry', 'pine', 'gold', 'frost', 'plum', 'ember', 'spruce', 'berry', 'slate', 'cocoa'];
export const STATUSES = ['dibs', 'bought', 'wrapped'];
const SECRET_EVENTS = new Set(['dibs', 'chipin', 'surprise', 'bought', 'wrapped']);
const SESSION_MS = 60 * 24 * 60 * 60 * 1000;
const COOKIE = 'fs_session';
const MAX_ITEMS_PER_MEMBER = 150;
const MAX_MEMBERS = 80;
const ACTIVITY_PER_FAMILY = 300;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (msg = "Couldn't find that. Maybe an elf moved it?") => new HttpError(404, msg);
const forbidden = (msg = "That's not yours to touch.") => new HttpError(403, msg);
const unauthorized = () => new HttpError(401, 'Sign in first.');

// ---------- input cleaning ----------

function text(value, field, max, { required = false, multiline = false } = {}) {
  if (value == null) value = '';
  if (typeof value !== 'string' && typeof value !== 'number') throw bad(`${field} should be text.`);
  let s = String(value).trim();
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  if (required && !s) throw bad(`${field} can't be empty.`);
  if (s.length > max) throw bad(`${field} is a bit long. Keep it under ${max} characters.`);
  return s;
}

function cleanUrl(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw bad('That link looks odd.');
  let s = value.trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw bad("That link doesn't look right. Try copying it again?");
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad('Links need to start with http:// or https://');
  const out = u.toString();
  if (out.length > 2000) throw bad('That link is enormous. Try a shorter one?');
  return out;
}

function cleanPrice(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw bad("That price doesn't look right.");
  return Math.round(n * 100) / 100;
}

function cleanPin(value, field = 'PIN') {
  const s = String(value ?? '').trim();
  if (!/^\d{4,8}$/.test(s)) throw bad(`${field} should be 4 to 8 numbers.`);
  return s;
}

const cleanColor = (value) => (COLORS.includes(value) ? value : COLORS[0]);

function cleanWant(value) {
  const n = Number(value);
  return n === 1 || n === 3 ? n : 2;
}

// ---------- http helpers ----------

function send(res, status, body, headers = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(json);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed cookie */
    }
  }
  return out;
}

async function readJson(req) {
  const type = req.headers['content-type'] || '';
  // Requiring JSON (plus SameSite cookies) means plain cross-site forms can't post here.
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send JSON, please.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, "Whoa, that's a lot of text.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw bad("Couldn't read that request.");
  }
}

// ---------- the app ----------

export function createApp({ store, secureCookies } = {}) {
  const db = store.data;
  const loginAttempts = new Map(); // memberId -> { fails, lockedUntil }

  // ----- lookups -----

  const familyByCode = (code) => {
    const c = String(code || '').trim().toUpperCase();
    return Object.values(db.families).find((f) => f.code === c) || null;
  };
  const membersOf = (familyId) => Object.values(db.members).filter((m) => m.familyId === familyId);
  const itemsOf = (memberId) =>
    Object.values(db.items)
      .filter((i) => i.ownerId === memberId)
      .sort((a, b) => a.createdAt - b.createdAt);
  const claimsIn = (familyId) => Object.values(db.claims).filter((c) => c.familyId === familyId);
  const claimForItem = (itemId) => Object.values(db.claims).find((c) => c.itemId === itemId) || null;
  const isOrganizer = (member) => db.families[member.familyId]?.organizerIds.includes(member.id);

  // The privacy rule, in one place.
  const visibleTo = (claim, viewer) => claim.familyId === viewer.familyId && claim.recipientId !== viewer.id;

  function memberInFamily(id, viewer) {
    const m = db.members[id];
    if (!m || m.familyId !== viewer.familyId) throw notFound("That person isn't in your family workshop.");
    return m;
  }
  function itemInFamily(id, viewer) {
    const it = db.items[id];
    if (!it || it.familyId !== viewer.familyId) throw notFound('That wish has vanished. Maybe it was removed?');
    return it;
  }
  function visibleClaim(id, viewer) {
    const c = db.claims[id];
    if (!c || !visibleTo(c, viewer)) throw notFound('That gift is gone. Someone may have un-dibsed it.');
    return c;
  }
  const canEditList = (owner, viewer) => owner.familyId === viewer.familyId && (owner.id === viewer.id || owner.managed);

  // ----- serializers -----

  const memberOut = (m) => ({
    id: m.id,
    name: m.name,
    color: m.color,
    managed: !!m.managed,
    organizer: !!isOrganizer(m),
    needsPin: !m.managed && !m.pinHash,
  });
  const familyOut = (f) => ({ id: f.id, name: f.name, code: f.code, organizerIds: [...f.organizerIds] });
  const itemOut = (it) => ({
    id: it.id,
    ownerId: it.ownerId,
    title: it.title,
    url: it.url,
    price: it.price,
    notes: it.notes,
    want: it.want,
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
  });
  function claimOut(c, viewer) {
    const item = c.itemId ? db.items[c.itemId] : null;
    return {
      id: c.id,
      kind: c.kind,
      itemId: c.itemId,
      recipientId: c.recipientId,
      giverIds: [...c.giverIds],
      mine: c.giverIds.includes(viewer.id),
      status: c.status,
      title: item ? item.title : c.title,
      url: item ? item.url : c.url,
      price: c.price ?? item?.price ?? null,
      note: c.note,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      orphanedFrom: c.orphanedFrom || null,
      wishChangedSinceDibs: !!(item && item.updatedAt > Math.max(c.createdAt, c.ackAt || 0)),
    };
  }

  function bootstrap(viewer) {
    const fam = db.families[viewer.familyId];
    return {
      me: memberOut(viewer),
      family: familyOut(fam),
      members: membersOf(fam.id).map(memberOut),
    };
  }

  function log(viewer, type, { recipientId = null, title = '' } = {}) {
    db.activity.push({
      id: newId(),
      familyId: viewer.familyId,
      at: Date.now(),
      type,
      actorId: viewer.id,
      recipientId,
      title,
    });
    const mine = db.activity.filter((a) => a.familyId === viewer.familyId);
    if (mine.length > ACTIVITY_PER_FAMILY) {
      const drop = new Set(mine.slice(0, mine.length - ACTIVITY_PER_FAMILY).map((a) => a.id));
      db.activity = db.activity.filter((a) => !drop.has(a.id));
    }
  }

  // ----- sessions -----

  const isSecure = (req) =>
    secureCookies ?? (req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted);

  function startSession(req, member) {
    const token = newToken();
    db.sessions[hashToken(token)] = { memberId: member.id, createdAt: Date.now() };
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_MS / 1000}`];
    if (isSecure(req)) parts.push('Secure');
    return { 'Set-Cookie': parts.join('; ') };
  }
  const clearCookie = () => ({ 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });

  function sessionMember(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const key = hashToken(token);
    const s = db.sessions[key];
    if (!s) return null;
    const m = db.members[s.memberId];
    if (!m || Date.now() - s.createdAt > SESSION_MS) {
      delete db.sessions[key];
      store.save();
      return null;
    }
    return { member: m, key };
  }

  function dropSessionsFor(memberId) {
    for (const [k, s] of Object.entries(db.sessions)) if (s.memberId === memberId) delete db.sessions[k];
  }

  function checkLock(memberId) {
    const a = loginAttempts.get(memberId);
    if (a && a.lockedUntil > Date.now()) {
      const mins = Math.ceil((a.lockedUntil - Date.now()) / 60000);
      throw new HttpError(429, `Too many wrong guesses. Take a cocoa break and try again in ${mins} min.`);
    }
  }
  function recordFail(memberId) {
    const a = loginAttempts.get(memberId) || { fails: 0, lockedUntil: 0 };
    a.fails += 1;
    if (a.fails >= 5) {
      a.fails = 0;
      a.lockedUntil = Date.now() + 5 * 60 * 1000;
    }
    loginAttempts.set(memberId, a);
  }

  function uniqueName(familyId, name, exceptId = null) {
    const taken = membersOf(familyId).some((m) => m.id !== exceptId && m.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new HttpError(409, `There's already a ${name} here. If that's you, sign in instead. Otherwise add a last initial.`);
  }

  function removeGiver(claim, memberId) {
    claim.giverIds = claim.giverIds.filter((g) => g !== memberId);
    if (!claim.giverIds.length) delete db.claims[claim.id];
  }

  // ----- routes -----

  const routes = [];
  const route = (method, pattern, handler, { auth = true } = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler, auth });
  };

  // Public: session / families

  route('GET', '/api/session', ({ viewer }) => (viewer ? bootstrap(viewer) : { me: null }), { auth: false });

  route(
    'POST',
    '/api/families',
    ({ body, req }) => {
      const familyName = text(body.familyName, 'Family name', 60, { required: true });
      const name = text(body.name, 'Your name', 40, { required: true });
      const pin = cleanPin(body.pin);
      const family = {
        id: newId(),
        code: newFamilyCode((c) => !!familyByCode(c)),
        name: familyName,
        createdAt: Date.now(),
        organizerIds: [],
      };
      const member = { id: newId(), familyId: family.id, name, color: cleanColor(body.color), managed: false, createdAt: Date.now() };
      const { salt, hash } = hashPin(pin);
      member.pinSalt = salt;
      member.pinHash = hash;
      family.organizerIds.push(member.id);
      db.families[family.id] = family;
      db.members[member.id] = member;
      log(member, 'started');
      return { status: 201, body: bootstrap(member), headers: startSession(req, member) };
    },
    { auth: false },
  );

  route(
    'GET',
    '/api/families/:code',
    ({ params }) => {
      const fam = familyByCode(params.code);
      if (!fam) throw notFound("No workshop with that code. Double-check it with whoever sent it?");
      return {
        family: { name: fam.name, code: fam.code },
        members: membersOf(fam.id)
          .filter((m) => !m.managed)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((m) => ({ id: m.id, name: m.name, color: m.color, needsPin: !m.pinHash })),
      };
    },
    { auth: false },
  );

  route(
    'POST',
    '/api/families/:code/join',
    ({ params, body, req }) => {
      const fam = familyByCode(params.code);
      if (!fam) throw notFound("No workshop with that code.");
      if (membersOf(fam.id).length >= MAX_MEMBERS) throw bad("This workshop is full! That's a big family.");
      const name = text(body.name, 'Your name', 40, { required: true });
      uniqueName(fam.id, name);
      const pin = cleanPin(body.pin);
      const { salt, hash } = hashPin(pin);
      const member = {
        id: newId(),
        familyId: fam.id,
        name,
        color: cleanColor(body.color),
        managed: false,
        createdAt: Date.now(),
        pinSalt: salt,
        pinHash: hash,
      };
      db.members[member.id] = member;
      log(member, 'joined');
      return { status: 201, body: bootstrap(member), headers: startSession(req, member) };
    },
    { auth: false },
  );

  route(
    'POST',
    '/api/families/:code/login',
    ({ params, body, req }) => {
      const fam = familyByCode(params.code);
      if (!fam) throw notFound("No workshop with that code.");
      const m = db.members[String(body.memberId || '')];
      if (!m || m.familyId !== fam.id || m.managed) throw notFound("Couldn't find you in this family.");
      const pin = cleanPin(body.pin);
      if (!m.pinHash) {
        // PIN was reset by an organizer: first sign-in sets the new one.
        const { salt, hash } = hashPin(pin);
        m.pinSalt = salt;
        m.pinHash = hash;
      } else {
        checkLock(m.id);
        if (!verifyPin(pin, m.pinSalt, m.pinHash)) {
          recordFail(m.id);
          throw new HttpError(401, "That PIN didn't work. Nice try, though.");
        }
        loginAttempts.delete(m.id);
      }
      return { body: bootstrap(m), headers: startSession(req, m) };
    },
    { auth: false },
  );

  route(
    'POST',
    '/api/logout',
    ({ session }) => {
      if (session) delete db.sessions[session.key];
      return { body: { ok: true }, headers: clearCookie() };
    },
    { auth: false },
  );

  // Workshop overview

  route('GET', '/api/overview', ({ viewer }) => {
    const fam = db.families[viewer.familyId];
    const claims = claimsIn(fam.id);
    const claimedItemIds = new Set(claims.filter((c) => c.itemId).map((c) => c.itemId));
    const members = membersOf(fam.id).map((m) => {
      const out = memberOut(m);
      const items = itemsOf(m.id);
      out.wishCount = items.length;
      if (m.id !== viewer.id) {
        out.openCount = items.filter((i) => !claimedItemIds.has(i.id)).length;
        out.surpriseCount = claims.filter((c) => c.kind === 'surprise' && c.recipientId === m.id).length;
      }
      return out;
    });
    const mine = claims.filter((c) => c.giverIds.includes(viewer.id)).map((c) => claimOut(c, viewer));
    const activity = db.activity
      .filter((a) => a.familyId === fam.id && !(SECRET_EVENTS.has(a.type) && a.recipientId === viewer.id))
      .slice(-30)
      .reverse();
    return { ...bootstrap(viewer), members, sleigh: mine, activity };
  });

  // A member's list

  route('GET', '/api/members/:id', ({ viewer, params }) => {
    const m = memberInFamily(params.id, viewer);
    const shielded = m.id === viewer.id;
    const items = itemsOf(m.id).map((it) => {
      const out = itemOut(it);
      if (!shielded) {
        const c = claimForItem(it.id);
        out.claim = c && visibleTo(c, viewer) ? claimOut(c, viewer) : null;
      }
      return out;
    });
    const surprises = shielded
      ? []
      : claimsIn(viewer.familyId)
          .filter((c) => c.kind === 'surprise' && c.recipientId === m.id && visibleTo(c, viewer))
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((c) => claimOut(c, viewer));
    return { member: memberOut(m), shielded, canEdit: canEditList(m, viewer), items, surprises };
  });

  route('POST', '/api/members/:id/items', ({ viewer, params, body }) => {
    const owner = memberInFamily(params.id, viewer);
    if (!canEditList(owner, viewer)) throw forbidden("You can only add wishes to your own list. Try an off-list surprise instead!");
    if (itemsOf(owner.id).length >= MAX_ITEMS_PER_MEMBER) throw bad("That's a LOT of wishes. Santa's sleigh has a weight limit.");
    const now = Date.now();
    const item = {
      id: newId(),
      familyId: viewer.familyId,
      ownerId: owner.id,
      addedById: viewer.id,
      title: text(body.title, 'Wish', 120, { required: true }),
      url: cleanUrl(body.url),
      price: cleanPrice(body.price),
      notes: text(body.notes, 'Notes', 500, { multiline: true }),
      want: cleanWant(body.want),
      createdAt: now,
      updatedAt: now,
    };
    db.items[item.id] = item;
    log(viewer, 'wish', { recipientId: owner.id, title: item.title });
    return { status: 201, body: itemOut(item) };
  });

  route('PATCH', '/api/items/:id', ({ viewer, params, body }) => {
    const item = itemInFamily(params.id, viewer);
    if (!canEditList(db.members[item.ownerId], viewer)) throw forbidden();
    if ('title' in body) item.title = text(body.title, 'Wish', 120, { required: true });
    if ('url' in body) item.url = cleanUrl(body.url);
    if ('price' in body) item.price = cleanPrice(body.price);
    if ('notes' in body) item.notes = text(body.notes, 'Notes', 500, { multiline: true });
    if ('want' in body) item.want = cleanWant(body.want);
    item.updatedAt = Date.now();
    return { body: itemOut(item) };
  });

  route('DELETE', '/api/items/:id', ({ viewer, params }) => {
    const item = itemInFamily(params.id, viewer);
    if (!canEditList(db.members[item.ownerId], viewer)) throw forbidden();
    const c = claimForItem(item.id);
    if (c) {
      // Keep the giver's plans intact: the dibs becomes an off-list gift with a heads-up.
      Object.assign(c, {
        kind: 'surprise',
        itemId: null,
        title: item.title,
        url: item.url,
        price: c.price ?? item.price,
        orphanedFrom: item.title,
        updatedAt: Date.now(),
      });
    }
    delete db.items[item.id];
    // Identical response whether or not it was claimed.
    return { body: { ok: true } };
  });

  // Dibs, chip-ins and surprises

  route('POST', '/api/items/:id/dibs', ({ viewer, params }) => {
    const item = itemInFamily(params.id, viewer);
    if (item.ownerId === viewer.id) throw bad("You can't call dibs on your own wish, silly.");
    const existing = claimForItem(item.id);
    if (existing) {
      const who = existing.giverIds.map((g) => db.members[g]?.name).filter(Boolean).join(' & ') || 'Someone';
      throw new HttpError(409, existing.giverIds.includes(viewer.id) ? 'You already called dibs on this one.' : `Too slow! ${who} already called dibs on this one.`);
    }
    const now = Date.now();
    const claim = {
      id: newId(),
      familyId: viewer.familyId,
      kind: 'item',
      itemId: item.id,
      recipientId: item.ownerId,
      giverIds: [viewer.id],
      status: 'dibs',
      title: '',
      url: '',
      price: null,
      note: '',
      createdAt: now,
      updatedAt: now,
    };
    db.claims[claim.id] = claim;
    log(viewer, 'dibs', { recipientId: item.ownerId, title: item.title });
    return { status: 201, body: claimOut(claim, viewer) };
  });

  route('POST', '/api/members/:id/surprises', ({ viewer, params, body }) => {
    const recipient = memberInFamily(params.id, viewer);
    if (recipient.id === viewer.id) throw bad('Buying yourself a surprise? Bold. But no.');
    const now = Date.now();
    const claim = {
      id: newId(),
      familyId: viewer.familyId,
      kind: 'surprise',
      itemId: null,
      recipientId: recipient.id,
      giverIds: [viewer.id],
      status: STATUSES.includes(body.status) ? body.status : 'dibs',
      title: text(body.title, 'Gift', 120, { required: true }),
      url: cleanUrl(body.url),
      price: cleanPrice(body.price),
      note: text(body.note, 'Note', 300, { multiline: true }),
      createdAt: now,
      updatedAt: now,
    };
    db.claims[claim.id] = claim;
    log(viewer, 'surprise', { recipientId: recipient.id, title: claim.title });
    return { status: 201, body: claimOut(claim, viewer) };
  });

  route('POST', '/api/claims/:id/chip-in', ({ viewer, params }) => {
    const c = visibleClaim(params.id, viewer);
    if (c.giverIds.includes(viewer.id)) throw bad("You're already in on this one.");
    c.giverIds.push(viewer.id);
    c.updatedAt = Date.now();
    log(viewer, 'chipin', { recipientId: c.recipientId, title: claimOut(c, viewer).title });
    return { body: claimOut(c, viewer) };
  });

  route('PATCH', '/api/claims/:id', ({ viewer, params, body }) => {
    const c = visibleClaim(params.id, viewer);
    if (!c.giverIds.includes(viewer.id)) throw forbidden("That's someone else's gift to manage.");
    if ('status' in body) {
      if (!STATUSES.includes(body.status)) throw bad('Unknown status.');
      if (body.status !== c.status && body.status !== 'dibs') {
        log(viewer, body.status, { recipientId: c.recipientId, title: claimOut(c, viewer).title });
      }
      c.status = body.status;
    }
    if (body.ack) c.ackAt = Date.now();
    if ('note' in body) c.note = text(body.note, 'Note', 300, { multiline: true });
    if ('price' in body) c.price = cleanPrice(body.price);
    if (c.kind === 'surprise') {
      if ('title' in body) c.title = text(body.title, 'Gift', 120, { required: true });
      if ('url' in body) c.url = cleanUrl(body.url);
    }
    c.updatedAt = Date.now();
    return { body: claimOut(c, viewer) };
  });

  route('DELETE', '/api/claims/:id', ({ viewer, params }) => {
    const c = visibleClaim(params.id, viewer);
    if (!c.giverIds.includes(viewer.id)) throw forbidden("That's someone else's gift.");
    removeGiver(c, viewer.id);
    return { body: { ok: true } };
  });

  route('GET', '/api/sleigh', ({ viewer }) => ({
    gifts: claimsIn(viewer.familyId)
      .filter((c) => c.giverIds.includes(viewer.id) && visibleTo(c, viewer))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((c) => claimOut(c, viewer)),
    members: membersOf(viewer.familyId).map(memberOut),
  }));

  // Family & profile management

  route('POST', '/api/members', ({ viewer, body }) => {
    if (membersOf(viewer.familyId).length >= MAX_MEMBERS) throw bad("This workshop is full!");
    const name = text(body.name, 'Name', 40, { required: true });
    uniqueName(viewer.familyId, name);
    const m = {
      id: newId(),
      familyId: viewer.familyId,
      name,
      color: cleanColor(body.color),
      managed: true,
      addedById: viewer.id,
      createdAt: Date.now(),
    };
    db.members[m.id] = m;
    log(viewer, 'added', { recipientId: m.id, title: m.name });
    return { status: 201, body: memberOut(m) };
  });

  route('PATCH', '/api/members/:id', ({ viewer, params, body }) => {
    const m = memberInFamily(params.id, viewer);
    if (!(m.id === viewer.id || m.managed || isOrganizer(viewer))) throw forbidden();
    if ('name' in body) {
      const name = text(body.name, 'Name', 40, { required: true });
      uniqueName(m.familyId, name, m.id);
      m.name = name;
    }
    if ('color' in body) m.color = cleanColor(body.color);
    return { body: memberOut(m) };
  });

  route('DELETE', '/api/members/:id', ({ viewer, params }) => {
    const m = memberInFamily(params.id, viewer);
    if (m.id === viewer.id) throw bad("You can't remove yourself. Ask another organizer.");
    if (!isOrganizer(viewer) && !(m.managed && m.addedById === viewer.id)) throw forbidden('Only organizers can remove people.');
    const fam = db.families[m.familyId];
    for (const it of itemsOf(m.id)) delete db.items[it.id];
    for (const c of claimsIn(fam.id)) {
      if (c.recipientId === m.id) delete db.claims[c.id];
      else if (c.giverIds.includes(m.id)) removeGiver(c, m.id);
    }
    dropSessionsFor(m.id);
    fam.organizerIds = fam.organizerIds.filter((id) => id !== m.id);
    delete db.members[m.id];
    return { body: { ok: true } };
  });

  route('POST', '/api/members/:id/reset-pin', ({ viewer, params }) => {
    if (!isOrganizer(viewer)) throw forbidden('Only organizers can reset PINs.');
    const m = memberInFamily(params.id, viewer);
    if (m.managed) throw bad("They don't log in, so there's no PIN to reset.");
    if (m.id === viewer.id) throw bad('Change your own PIN in your profile instead.');
    m.pinHash = null;
    m.pinSalt = null;
    dropSessionsFor(m.id);
    loginAttempts.delete(m.id);
    return { body: memberOut(m) };
  });

  route('POST', '/api/members/:id/organizer', ({ viewer, params, body }) => {
    if (!isOrganizer(viewer)) throw forbidden('Only organizers can do that.');
    const m = memberInFamily(params.id, viewer);
    if (m.managed) throw bad("They don't log in, so they can't organize.");
    const fam = db.families[m.familyId];
    if (body.value) {
      if (!fam.organizerIds.includes(m.id)) fam.organizerIds.push(m.id);
    } else {
      if (m.id === viewer.id && fam.organizerIds.length === 1) throw bad('Someone has to run the workshop! Make another organizer first.');
      fam.organizerIds = fam.organizerIds.filter((id) => id !== m.id);
    }
    return { body: memberOut(m) };
  });

  route('POST', '/api/me/pin', ({ viewer, body, session }) => {
    const current = cleanPin(body.currentPin, 'Current PIN');
    const next = cleanPin(body.newPin, 'New PIN');
    checkLock(viewer.id);
    if (!verifyPin(current, viewer.pinSalt, viewer.pinHash)) {
      recordFail(viewer.id);
      throw new HttpError(401, "Your current PIN didn't match.");
    }
    const { salt, hash } = hashPin(next);
    viewer.pinSalt = salt;
    viewer.pinHash = hash;
    // Sign out other devices, keep this one.
    for (const [k, s] of Object.entries(db.sessions)) if (s.memberId === viewer.id && k !== session.key) delete db.sessions[k];
    return { body: { ok: true } };
  });

  route('PATCH', '/api/family', ({ viewer, body }) => {
    if (!isOrganizer(viewer)) throw forbidden('Only organizers can rename the family.');
    const fam = db.families[viewer.familyId];
    if ('name' in body) fam.name = text(body.name, 'Family name', 60, { required: true });
    return { body: familyOut(fam) };
  });

  // ----- static files -----

  async function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.resolve(PUBLIC_DIR, `.${rel}`);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'Not found' });
    let info;
    try {
      info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
    } catch {
      return send(res, 404, { error: 'Not found' });
    }
    const etag = `"${info.size.toString(36)}-${info.mtimeMs.toString(36)}"`;
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    res.end(await readFile(file));
  }

  // ----- dispatcher -----

  return async function handle(req, res) {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch {
      return send(res, 400, { error: 'Bad URL' });
    }

    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      try {
        return await serveStatic(req, res, pathname);
      } catch (err) {
        if (err instanceof URIError) return send(res, 400, { error: 'Bad URL' });
        console.error(err);
        return send(res, 500, { error: 'Something broke.' });
      }
    }

    const match = routes
      .map((r) => ({ r, m: r.method === req.method && pathname.match(r.re) }))
      .find((x) => x.m);
    if (!match) return send(res, 404, { error: 'No such page in the workshop.' });

    try {
      const session = sessionMember(req);
      const viewer = session?.member || null;
      if (match.r.auth && !viewer) throw unauthorized();
      const params = Object.fromEntries(match.r.keys.map((k, i) => [k, decodeURIComponent(match.m[i + 1])]));
      const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await readJson(req);
      const result = await match.r.handler({ req, viewer, session, params, body });
      if (req.method !== 'GET') store.save();
      const wrapped = result && typeof result === 'object' && 'body' in result ? result : { body: result };
      return send(res, wrapped.status || 200, wrapped.body, wrapped.headers);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      if (err instanceof URIError) return send(res, 400, { error: 'Bad URL' });
      console.error(err);
      return send(res, 500, { error: 'Something broke in the workshop. Try again?' });
    }
  };
}
