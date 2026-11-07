import { get, post, patch, del } from './api.js';
import {
  html, raw, COLORS, colorOf, possessive, money, host, timeAgo, sleepsUntilChristmas, tilt,
  icons, ornament, lights, santaHat, shieldArt, waxSeal, toast, confetti, confirmDialog,
} from './ui.js';

const app = document.getElementById('app');

const WANT = { 1: 'Nice to have', 2: 'Would love', 3: 'Santa, please!' };
const STATUS = { dibs: 'Called dibs', bought: 'Bought', wrapped: 'Wrapped' };
const STEP = { dibs: 'Dibs', bought: 'Bought', wrapped: 'Wrapped' };
const LAST_KEY = 'familySanta:last';

const state = {
  session: null, // { me, family, members }
  route: { name: 'boot', params: {} },
  data: null,
  dataKey: '',
  editing: null,
  adding: false,
  hideTaken: false,
  stamped: null,
  join: { mode: 'pick', memberId: null },
};

// ---------- small utils ----------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const randomColor = () => Object.keys(COLORS)[Math.floor(Math.random() * Object.keys(COLORS).length)];

function remember(family) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ code: family.code, name: family.name })); } catch { /* private mode */ }
}
function recall() {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; }
}

function goto(hash) {
  if (location.hash === hash || (hash === '#/' && !location.hash)) navigate();
  else location.hash = hash;
}

function memberMap(members) {
  return Object.fromEntries((members || state.session?.members || []).map((m) => [m.id, m]));
}

function namesOf(ids, { exclude } = {}) {
  const map = memberMap(state.data?.members);
  const fallback = memberMap();
  const names = ids.filter((id) => id !== exclude).map((id) => (map[id] || fallback[id])?.name || 'someone');
  if (names.length <= 2) return names.join(' & ');
  return `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`;
}

// ---------- shared pieces ----------

function colorPicker(selected = randomColor()) {
  return html`<div class="swatches" role="radiogroup" aria-label="Ornament color">
    ${Object.entries(COLORS).map(([key, hex]) => html`<label class="swatch" style="--c:${hex}">
      <input type="radio" name="color" value="${key}" ${key === selected ? raw('checked') : ''}>
      <span class="swatch-ball"></span><span class="sr">${key}</span>
    </label>`)}
  </div>`;
}

function pinField(label = 'Make a PIN', hint = '4 to 8 numbers. Keeps nosy relatives out of your account.', autocomplete = 'new-password') {
  return html`<label class="field"><span>${label} ${hint ? html`<small>${hint}</small>` : ''}</span>
    <input class="pin-input" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" autocomplete="${autocomplete}" required>
  </label>`;
}

const tagString = raw(`<svg class="tag-string" viewBox="0 0 34 42" aria-hidden="true"><path d="M4 39 C 1 27, 17 25, 15 15 S 25 3, 33 1" fill="none" stroke="#c63a2e" stroke-width="3" stroke-linecap="round"/></svg>`);

function tagShell(inner, { cls = '', id = 'x', outside = '', tagName = 'article', attrs = '' } = {}) {
  return html`${raw(`<${tagName}`)} class="tag ${cls}" style="--tilt:${tilt(id).toFixed(2)}deg" ${raw(attrs)}>
    <div class="tag-shape"><div class="tag-inner">
      <span class="tag-hole" aria-hidden="true"></span>
      ${inner}
    </div></div>
    ${tagString}
    ${outside}
  ${raw(`</${tagName}>`)}`;
}

function wantBadge(w) {
  return html`<span class="want want-${w}" title="${WANT[w]}">${[1, 2, 3].map((i) => (i <= w ? icons.starFill : icons.star))}<span>${WANT[w]}</span></span>`;
}

function stepper(claim) {
  return html`<div class="stepper" role="group" aria-label="Gift status">
    ${Object.keys(STEP).map((s) => html`<button type="button" class="step ${s === claim.status ? 'on' : ''}" data-action="status" data-id="${claim.id}" data-status="${s}" aria-pressed="${s === claim.status}">${STEP[s]}</button>`)}
  </div>`;
}

function stamp(claim) {
  const label = claim.status === 'dibs' ? (claim.mine ? 'My dibs!' : 'Dibs!') : STEP[claim.status];
  const cls = [claim.mine ? 'is-mine' : '', claim.status === 'wrapped' ? 'is-wrapped' : ''].join(' ');
  return html`<span class="stamp ${cls}" aria-hidden="true">${label}</span>`;
}

function cane(pct) {
  return html`<div class="cane" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Wrapped"><span style="width:${pct}%"></span></div>`;
}

function ticket(n) {
  let big = n;
  let label = 'sleeps till Christmas';
  if (n === 0) { big = 'Today!'; label = 'Merry Christmas'; }
  else if (n === 1) label = 'more sleep. It’s Christmas Eve!';
  return html`<div class="ticket-wrap"><div class="ticket">
    <span class="ticket-num">${big}</span>
    <span class="ticket-label">${label}</span>
    <span class="ticket-stub">ADMIT ONE · DEC 25</span>
  </div></div>`;
}

function sleighArt() {
  return raw(`<svg viewBox="0 0 124 84" aria-hidden="true">
    <rect x="30" y="10" width="26" height="24" rx="2" fill="#1e5640" stroke="#2b1d16" stroke-width="3"/>
    <path d="M43 10v24M30 21h26" stroke="#e0a12f" stroke-width="3.5"/>
    <path d="M43 10c-5-8-12-6-9-1M43 10c5-8 12-6 9-1" fill="none" stroke="#e0a12f" stroke-width="3" stroke-linecap="round"/>
    <rect x="56" y="18" width="22" height="16" rx="2" fill="#e0a12f" stroke="#2b1d16" stroke-width="3"/>
    <path d="M67 18v16" stroke="#c63a2e" stroke-width="3.5"/>
    <path d="M12 34 H 94 C 104 34, 108 27, 104 18 L 112 17 C 120 34, 110 54, 92 54 H 30 C 18 54, 12 46, 12 34 Z" fill="#c63a2e" stroke="#2b1d16" stroke-width="3" stroke-linejoin="round"/>
    <path d="M22 42 H 86" stroke="#fff5e3" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 7"/>
    <path d="M32 54 V68 M82 54 V68" stroke="#2b1d16" stroke-width="3.5"/>
    <path d="M6 68 H 98 C 110 68, 116 61, 114 53" fill="none" stroke="#2b1d16" stroke-width="4" stroke-linecap="round"/>
  </svg>`);
}

// ---------- shell ----------

function shell(content, active) {
  const { family } = state.session;
  const nav = [
    ['workshop', '#/', 'Workshop', icons.tree],
    ['mine', '#/me', 'My list', icons.list],
    ['sleigh', '#/sleigh', 'My sleigh', icons.sleigh],
    ['family', '#/family', 'Family', icons.people],
  ];
  return html`<div class="shell">
    ${lights(48)}
    <header class="topbar">
      <a class="brand" href="#/">Family Santa</a>
      <span class="fam-name" title="${family.name}">${family.name}</span>
      <nav class="nav" aria-label="Main">
        ${nav.map(([key, href, label, ico]) => html`<a class="nav-link ${active === key ? 'is-on' : ''}" href="${href}" ${active === key ? raw('aria-current="page"') : ''}>${ico}<span>${label}</span></a>`)}
      </nav>
    </header>
    <main class="page" id="main">${content}</main>
    <footer class="foot">Family Santa · made with too much cocoa</footer>
  </div>`;
}

// ============================================================
// Views
// ============================================================

function renderLanding() {
  const last = recall();
  const flakes = Array.from({ length: 46 }, (_, i) => {
    const s = 2 + ((i * 7) % 5);
    return html`<i class="flake" style="left:${(i * 37) % 100}%;--s:${s}px;--t:${9 + ((i * 13) % 9)}s;--d:-${(i * 1.7) % 14}s;--sway:${(i % 2 ? 1 : -1) * (10 + (i % 5) * 6)}px;opacity:${0.35 + (s / 10)}"></i>`;
  });
  const demo = [
    tagShell(html`<p class="kicker">To: Dad</p><h3 class="tag-title">Pizza stone</h3><div class="tag-meta">${wantBadge(3)}<span class="chip chip-price">~$45</span></div><p class="claim-who">Called by <b>Aunt Kim</b></p>`,
      { id: 'demo-a', cls: 'is-taken', outside: stamp({ status: 'dibs', mine: false }) }),
    tagShell(html`<p class="kicker">To: Grandma</p><h3 class="tag-title">Bird puzzle</h3><div class="tag-meta">${wantBadge(2)}<span class="chip chip-price">~$22</span></div><p class="claim-who"><b>You</b> + <b>Ray</b> split it</p>`,
      { id: 'demo-b', cls: 'is-taken is-mine', outside: stamp({ status: 'bought', mine: true }) }),
    tagShell(html`<p class="kicker">To: You</p><h3 class="tag-title">Fuzzy slippers, size 9</h3><div class="tag-meta">${wantBadge(3)}</div><p class="tag-notes">Is anyone getting these? No clue!</p>`,
      { id: 'demo-c', cls: 'is-own', outside: waxSeal() }),
  ];
  return html`<div class="landing">
    <section class="night">
      ${lights(50)}
      <div class="snow" aria-hidden="true">${flakes}</div>
      <header class="hero">
        <div class="hero-copy">
          <p class="kicker">For families who keep buying the same air fryer</p>
          <h1 class="logo-xl" aria-label="Family Santa">${santaHat()}<span class="logo-word">Family</span><span class="logo-word">Santa</span></h1>
          <p class="tagline">The wish list that keeps a secret.</p>
          <p class="lede">Everyone posts their Christmas list. Everyone else quietly calls dibs on what they’re buying. You can see what’s taken on every list, <em>except your own</em>.</p>
          <div class="cta-row">
            <a class="btn btn-red btn-lg" href="#/start">Start our family</a>
            <a class="btn btn-lg" href="#/join">I have a family code</a>
          </div>
          ${last ? html`<a class="welcome-back" href="#/join/${encodeURIComponent(last.code)}">Welcome back! Hop into ${last.name} →</a>` : ''}
        </div>
        <div class="hero-art" aria-hidden="true">${demo}</div>
      </header>
    </section>

    <section class="how">
      <div class="how-head">
        <h2 class="section-title">Here’s the trick</h2>
        <p class="sub" style="margin-inline:auto">Three rules. No spreadsheets, no group-chat detective work.</p>
      </div>
      <div class="how-grid">
        <article class="how-step"><span class="how-num">1</span><h3>Write your list</h3><p>Add what you’re hoping for, with links, sizes, and the exact shade of green. Be picky. It helps.</p></article>
        <article class="how-step"><span class="how-num">2</span><h3>Call dibs</h3><p>Find something on someone’s list and stamp it. Everyone else sees it’s taken, so nobody doubles up.</p></article>
        <article class="how-step"><span class="how-num">3</span><h3>Stay surprised</h3><p>Your own list never shows what’s been claimed. No hints and no peeking. Santa’s rules.</p></article>
      </div>
      <div class="how-rogue">${icons.gift}<p><b>Going off-list?</b> Log a surprise gift for anyone and the rest of the family will see you’ve got it covered. They won’t.</p></div>
    </section>
    <footer class="foot">Family Santa · made with too much cocoa · no elves were harmed</footer>
  </div>`;
}

function authLayout(content, back = '#/') {
  return html`<div class="auth-page">
    ${lights(40)}
    <div class="auth-wrap">
      <a class="mini-brand" href="#/">Family Santa</a><br>
      <a class="back" href="${back}">${icons.back} Back</a>
      ${content}
    </div>
  </div>`;
}

function renderStart() {
  return authLayout(html`<div class="paper-card">
    <h1 class="title">Open a family workshop</h1>
    <p class="sub">You’ll get a family code to drop in the group chat. Takes about a minute.</p>
    <form data-form="create" autocomplete="off">
      <label class="field"><span>Family name</span><input name="familyName" required maxlength="60" placeholder="The Jenkins Crew"></label>
      <label class="field"><span>Your name</span><input name="name" required maxlength="40" placeholder="What the family calls you" autocomplete="given-name"></label>
      <fieldset class="field"><legend>Pick your ornament</legend>${colorPicker()}</fieldset>
      ${pinField()}
      <button class="btn btn-red btn-lg" type="submit">Open the workshop</button>
    </form>
  </div>`);
}

function renderJoinCode() {
  return authLayout(html`<div class="paper-card">
    <h1 class="title">Got a code?</h1>
    <p class="sub">Whoever set up your family has a code that looks like <b>JINGLE-4821</b>.</p>
    <form data-form="join-code" autocomplete="off">
      <label class="field"><span>Family code</span><input name="code" required maxlength="20" placeholder="JINGLE-4821" autocapitalize="characters" spellcheck="false" style="font-family:var(--mono);font-weight:700;letter-spacing:.08em;text-transform:uppercase"></label>
      <button class="btn btn-red btn-lg" type="submit">Find my family</button>
    </form>
  </div>`);
}

function renderJoin(d) {
  if (d.error) {
    return authLayout(html`<div class="paper-card center">
      <h1 class="title">Hmm, no luck</h1>
      <p class="sub" style="margin-inline:auto">${d.error}</p>
      <div class="btn-row" style="justify-content:center"><a class="btn btn-red" href="#/join">Try another code</a></div>
    </div>`, '#/join');
  }
  const { family, members } = d;
  const j = state.join;
  const picked = members.find((m) => m.id === j.memberId);

  if (j.mode === 'pin' && picked) {
    return authLayout(html`<div class="paper-card has-orn">
      ${ornament(picked, { size: 'xl' })}
      <h1 class="title">Hi, ${picked.name}!</h1>
      <p class="sub" style="margin-inline:auto">${picked.needsPin ? 'Your PIN was reset. Pick a new one to get back in.' : 'Pop in your PIN.'}</p>
      <form data-form="login" style="margin-top:18px">
        ${picked.needsPin ? pinField('New PIN', '4 to 8 numbers') : pinField('Your PIN', '', 'current-password')}
        <div class="form-actions"><button class="btn btn-red btn-lg" type="submit">Come on in</button><button class="btn btn-ghost" type="button" data-action="join-back">Not ${picked.name}?</button></div>
      </form>
    </div>`, `#/join/${encodeURIComponent(family.code)}`);
  }

  if (j.mode === 'new' || !members.length) {
    return authLayout(html`<div class="paper-card">
      <p class="kicker">Joining ${family.name}</p>
      <h1 class="title">Pull up a chair</h1>
      <p class="sub">Tell the family who you are.</p>
      <form data-form="join" autocomplete="off">
        <label class="field"><span>Your name</span><input name="name" required maxlength="40" placeholder="What the family calls you" autocomplete="given-name"></label>
        <fieldset class="field"><legend>Pick your ornament</legend>${colorPicker()}</fieldset>
        ${pinField()}
        <div class="form-actions">
          <button class="btn btn-red btn-lg" type="submit">Join the family</button>
          ${members.length ? html`<button class="btn btn-ghost" type="button" data-action="join-back">I’m already in</button>` : ''}
        </div>
      </form>
    </div>`);
  }

  return authLayout(html`<div class="paper-card">
    <p class="kicker">You’re invited to</p>
    <h1 class="title">${family.name}</h1>
    <p class="sub">Who’s this?</p>
    <div class="who">
      ${members.map((m) => html`<button class="who-btn" type="button" data-action="pick-member" data-id="${m.id}">${ornament(m, { size: 'md' })}<span>${m.name}</span></button>`)}
    </div>
    <div class="divider">or</div>
    <button class="btn btn-red btn-lg" type="button" data-action="join-new">I’m new here</button>
  </div>`);
}

// ----- Workshop -----

function hanger(m, i, me) {
  const isMe = m.id === me.id;
  const drop = [22, 54, 34, 62, 26, 46, 38][i % 7];
  let meta;
  let metaCls = '';
  if (isMe) meta = `You · ${plural(m.wishCount, 'wish', 'wishes')}`;
  else if (!m.wishCount) meta = 'No wishes yet';
  else if (m.openCount === 0) { meta = 'All taken care of'; metaCls = 'is-done'; }
  else { meta = `${m.openCount} of ${m.wishCount} up for grabs`; metaCls = 'is-open'; }
  return html`<li class="hanger" style="--drop:${drop}px">
    <a class="hang-link" href="${isMe ? '#/me' : `#/m/${m.id}`}" aria-label="${isMe ? 'Your list' : `${possessive(m.name)} list`}">
      <span class="hang-string"></span>
      ${ornament(m, { size: 'lg', you: isMe })}
      <span class="hang-name">${m.name}</span>
      <span class="hang-meta ${metaCls}">${meta}</span>
      ${m.managed ? html`<span class="hang-flag">doesn’t log in</span>` : ''}
    </a>
  </li>`;
}

function gossipLine(a, me, byId) {
  const who = (id) => (id === me.id ? 'You' : byId[id]?.name || 'Someone');
  const whom = (id) => (id === me.id ? 'you' : byId[id]?.name || 'someone');
  const actor = html`<b>${who(a.actorId)}</b>`;
  const t = html`<q>${a.title}</q>`;
  const to = html`<b>${whom(a.recipientId)}</b>`;
  const lines = {
    started: () => html`${actor} opened the workshop`,
    joined: () => html`${actor} joined the family`,
    added: () => html`${actor} added <b>${a.title}</b> to the family`,
    wish: () => (a.recipientId === a.actorId ? html`${actor} wished for ${t}` : html`${actor} added ${t} to ${possessive(whom(a.recipientId))} list`),
    dibs: () => html`${actor} called dibs on ${t} for ${to}`,
    chipin: () => html`${actor} chipped in on ${t} for ${to}`,
    surprise: () => html`${actor} planned a surprise for ${to}: ${t}`,
    bought: () => html`${actor} bought ${t} for ${to}`,
    wrapped: () => html`${actor} wrapped ${t} for ${to}`,
  };
  if (!lines[a.type]) return '';
  return html`<li class="gossip-line gossip-${a.type}"><span class="dot"></span><span>${lines[a.type]()}</span><time>${timeAgo(a.at)}</time></li>`;
}

function renderWorkshop(d) {
  const { me, family } = d;
  const byId = memberMap(d.members);
  const meFull = byId[me.id];
  const others = d.members.filter((m) => m.id !== me.id).sort((a, b) => a.name.localeCompare(b.name));
  const share = d.sleigh.reduce((sum, g) => sum + (g.price || 0) / g.giverIds.length, 0);
  const wrapped = d.sleigh.filter((g) => g.status === 'wrapped').length;
  const pct = d.sleigh.length ? Math.round((wrapped / d.sleigh.length) * 100) : 0;

  return shell(html`
    <section class="hello">
      <div>
        <p class="hand hello-hi">Hey ${me.name}!</p>
        <h1 class="page-title">The Workshop</h1>
        <p class="sub">Tap an ornament to see someone’s list and call dibs.</p>
      </div>
      ${ticket(sleepsUntilChristmas())}
    </section>

    <section class="garland" aria-label="Your family">
      <ul class="hangers">${[meFull, ...others].map((m, i) => hanger(m, i, me))}</ul>
    </section>

    ${!others.length ? html`<div class="invite-nudge">
      <p>It’s lonely up here! Send the family your code <b>${family.code}</b> so they can join.</p>
      <button class="btn btn-red" data-action="copy-link">${icons.copy} Copy invite link</button>
    </div>` : ''}

    <div class="duo">
      <section class="panel panel-sleigh">
        <h2 class="panel-title">${icons.sleigh} Your sleigh</h2>
        ${d.sleigh.length ? html`
          <div class="sleigh-stats">
            <div><b>${d.sleigh.length}</b><span>${d.sleigh.length === 1 ? 'gift' : 'gifts'}</span></div>
            <div><b>${money(Math.round(share))}</b><span>your share</span></div>
            <div><b>${wrapped}/${d.sleigh.length}</b><span>wrapped</span></div>
          </div>
          ${cane(pct)}
          <a class="btn btn-pine" href="#/sleigh">Open my sleigh</a>`
        : html`<p class="empty-note">Empty so far. Pick someone up top and call dibs on something!</p>`}
      </section>
      <section class="panel panel-gossip">
        <h2 class="panel-title">${icons.gift} Workshop gossip</h2>
        <p class="panel-sub">Anything about gifts for you is scrubbed from here.</p>
        ${d.activity.length ? html`<ul class="gossip">${d.activity.map((a) => gossipLine(a, me, byId))}</ul>` : html`<p class="empty-note">Quiet in here. Too quiet.</p>`}
      </section>
    </div>
  `, 'workshop');
}

// ----- A list (yours or someone else's) -----

function wishForm(owner, item, shielded) {
  const editing = !!item;
  const who = shielded ? 'you' : 'they';
  return tagShell(html`
    <p class="tag-form-title hand">${editing ? 'Fix up this wish' : shielded ? 'New wish' : `New wish for ${owner.name}`}</p>
    <label class="field"><span>What is it?</span><input name="title" required maxlength="120" value="${item?.title || ''}" placeholder="Wool socks, the scratchy-free kind"></label>
    <label class="field"><span>Link <small>(optional)</small></span><input name="url" inputmode="url" maxlength="2000" value="${item?.url || ''}" placeholder="Paste a link to the exact thing"></label>
    <label class="field"><span>Roughly how much? <small>(optional)</small></span><input name="price" inputmode="decimal" maxlength="12" value="${item?.price ?? ''}" placeholder="$"></label>
    <fieldset class="field want-pick"><legend>How much do ${who} want it?</legend>
      ${[1, 2, 3].map((w) => html`<label class="pill"><input type="radio" name="want" value="${w}" ${(item?.want ?? 2) === w ? raw('checked') : ''}><span>${WANT[w]}</span></label>`)}
    </fieldset>
    <label class="field"><span>Notes <small>(size, color, “NOT the blue one”)</small></span><textarea name="notes" rows="2" maxlength="500">${item?.notes || ''}</textarea></label>
    <div class="form-actions">
      <button class="btn btn-red" type="submit">${editing ? 'Save changes' : 'Add to the list'}</button>
      <button class="btn btn-ghost" type="button" data-action="${editing ? 'cancel-edit' : 'close-add'}">Cancel</button>
    </div>`,
  { id: item?.id || 'new', cls: 'tag-form', tagName: 'form', attrs: `data-form="${editing ? 'edit-wish' : 'add-wish'}" data-id="${editing ? item.id : owner.id}" autocomplete="off"` });
}

function wishTag(it, d) {
  if (state.editing === it.id) return wishForm(d.member, it, d.shielded);
  const c = it.claim;
  const meId = state.session.me.id;
  const cls = ['tag', c ? 'is-taken' : '', c?.mine ? 'is-mine' : '', d.shielded ? 'is-own' : '', state.stamped === it.id ? 'just-stamped' : ''].join(' ');

  let foot;
  if (d.shielded) {
    foot = html`<button class="btn btn-sm" data-action="edit-wish" data-id="${it.id}">${icons.pencil} Edit</button>
      <button class="icon-btn" data-action="delete-wish" data-id="${it.id}" title="Remove this wish" aria-label="Remove ${it.title}">${icons.trash}</button>`;
  } else if (!c) {
    foot = html`<button class="btn btn-red" data-action="dibs" data-id="${it.id}">Call dibs</button>`;
  } else if (c.mine) {
    const partners = c.giverIds.length > 1 ? html` with <b>${namesOf(c.giverIds, { exclude: meId })}</b>` : '';
    foot = html`<div style="display:grid;gap:8px;width:100%">
      <span class="claim-who">It’s yours${partners}.</span>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${stepper(c)}<button class="btn btn-ghost btn-sm" data-action="undibs" data-id="${c.id}">Un-dibs</button></div>
    </div>`;
  } else {
    foot = html`<span class="claim-who"><b>${namesOf(c.giverIds)}</b> ${c.giverIds.length > 1 ? 'are' : 'is'} on it · ${STATUS[c.status].toLowerCase()}</span>
      <span class="spacer"></span>
      <button class="btn btn-sm" data-action="chip-in" data-id="${c.id}" title="Split the cost with them">Chip in</button>`;
  }

  const managedTools = !d.shielded && d.canEdit
    ? html`<div style="display:flex;gap:2px;margin-left:auto"><button class="icon-btn" data-action="edit-wish" data-id="${it.id}" aria-label="Edit">${icons.pencil}</button><button class="icon-btn" data-action="delete-wish" data-id="${it.id}" aria-label="Remove">${icons.trash}</button></div>`
    : '';

  return tagShell(html`
    <h3 class="tag-title">${it.title}</h3>
    <div class="tag-meta">${wantBadge(it.want)}${it.price != null ? html`<span class="chip chip-price">~${money(it.price)}</span>` : ''}</div>
    ${it.notes ? html`<p class="tag-notes">${it.notes}</p>` : ''}
    ${it.url ? html`<a class="tag-link" href="${it.url}" target="_blank" rel="noopener noreferrer">${icons.link} ${host(it.url)}</a>` : ''}
    ${c?.mine && c.wishChangedSinceDibs ? html`<p class="heads-up">${icons.heads}<span>${d.member.name} changed this wish after you called dibs. Double-check it.</span><button data-action="ack" data-id="${c.id}">Got it</button></p>` : ''}
    <footer class="tag-foot">${foot}${managedTools}</footer>`,
  { id: it.id, cls: cls.replace(/^tag /, ''), outside: html`${c ? stamp(c) : ''}${d.shielded ? waxSeal() : ''}`, attrs: `data-item="${it.id}"` });
}

function surpriseRow(s) {
  const meId = state.session.me.id;
  const by = s.mine
    ? (s.giverIds.length > 1 ? `You + ${namesOf(s.giverIds, { exclude: meId })}` : 'You')
    : namesOf(s.giverIds);
  return html`<li class="surprise ${s.mine ? 'is-mine' : ''}">
    <span class="surprise-bow" aria-hidden="true">${icons.gift}</span>
    <div class="surprise-main">
      <span><b>${s.title}</b> ${s.price != null ? html`<span class="chip">~${money(s.price)}</span>` : ''}</span>
      <span class="surprise-by">${by} · ${STATUS[s.status].toLowerCase()}${s.orphanedFrom ? ' · was on their list, then removed' : ''}</span>
    </div>
    <div class="surprise-actions">
      ${s.mine
        ? html`${stepper(s)}<button class="icon-btn" data-action="undibs" data-id="${s.id}" aria-label="Remove">${icons.trash}</button>`
        : html`<button class="btn btn-sm" data-action="chip-in" data-id="${s.id}">Chip in</button>`}
    </div>
  </li>`;
}

function renderMember(d) {
  const { member: m, shielded, canEdit, items, surprises } = d;
  const open = items.filter((i) => !i.claim).length;
  const taken = items.length - open;
  const shown = !shielded && state.hideTaken ? items.filter((i) => !i.claim) : items;
  const showForm = canEdit && (state.adding || items.length === 0);

  let subline;
  if (shielded) subline = `${plural(items.length, 'wish', 'wishes')} · spoiler shield on`;
  else subline = `${open} up for grabs · ${taken} taken${surprises.length ? ` · ${plural(surprises.length, 'surprise', 'surprises')} planned` : ''}`;

  const addTile = canEdit
    ? (showForm ? wishForm(m, null, shielded) : html`<button class="add-wish-btn" data-action="open-add">${icons.plus} Add a wish</button>`)
    : '';

  const empty = !items.length && !canEdit
    ? html`<p class="empty-note">${m.name} hasn’t added any wishes yet. Maybe give them a nudge? Or plan an off-list surprise below.</p>`
    : '';

  return shell(html`
    <a class="back" href="#/">${icons.back} Workshop</a>
    <section class="list-head">
      ${ornament(m, { size: 'xl', you: shielded })}
      <div>
        <p class="kicker">${shielded ? 'Your Christmas list' : 'Christmas list'}</p>
        <h1 class="page-title">${shielded ? 'My wishes' : `${possessive(m.name)} wishes`}</h1>
        <p class="sub">${subline}</p>
      </div>
    </section>

    ${shielded ? html`<div class="shield">${shieldArt()}<p><b>Spoiler shield is on</b>Your family sees this list, but you’ll never see who’s getting what. Add, edit and delete all you like, and you won’t spoil anyone’s plans.</p></div>` : ''}
    ${m.managed ? html`<p class="managed-note"><b>${m.name} doesn’t log in</b>, so anyone in the family can add to or edit this list, and everyone can see what’s been claimed.</p>` : ''}

    ${!shielded && taken ? html`<div class="list-tools"><span></span><label class="toggle"><input type="checkbox" data-change="toggle-taken" ${state.hideTaken ? raw('checked') : ''}> Hide the taken ones (${taken})</label></div>` : ''}

    ${empty}
    ${shown.length || addTile ? html`<div class="tags">${shown.map((it) => wishTag(it, d))}${addTile}</div>` : ''}

    ${!shielded ? html`<section class="surprises">
      <div class="surprises-head">
        <h2 class="section-title">Off-list surprises</h2>
        <p class="sub">Getting ${m.name} something that isn’t on the list? Jot it here so nobody else buys the same thing.${m.managed ? '' : ` ${m.name} will never see this.`}</p>
      </div>
      ${surprises.length ? html`<ul class="surprise-list">${surprises.map(surpriseRow)}</ul>` : ''}
      <form class="surprise-form" data-form="surprise" data-id="${m.id}" autocomplete="off">
        <input name="title" required maxlength="120" placeholder="I’m getting ${m.name}…" aria-label="What you're getting ${m.name}">
        <input name="price" inputmode="decimal" maxlength="12" placeholder="$ (optional)" aria-label="Rough price">
        <button class="btn btn-pine" type="submit">${icons.plus} Log it</button>
      </form>
    </section>` : ''}
  `, shielded ? 'mine' : 'workshop');
}

// ----- Sleigh -----

function renderSleigh(d) {
  const meId = state.session.me.id;
  const byId = memberMap(d.members);
  const groups = new Map();
  for (const g of d.gifts) {
    if (!groups.has(g.recipientId)) groups.set(g.recipientId, []);
    groups.get(g.recipientId).push(g);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (byId[a]?.name || '').localeCompare(byId[b]?.name || ''));
  const share = d.gifts.reduce((sum, g) => sum + (g.price || 0) / g.giverIds.length, 0);
  const wrapped = d.gifts.filter((g) => g.status === 'wrapped').length;
  const bought = d.gifts.filter((g) => g.status !== 'dibs').length;
  const pct = d.gifts.length ? Math.round((wrapped / d.gifts.length) * 100) : 0;

  const row = (g, r) => {
    const split = g.giverIds.length > 1 ? ` · split with ${namesOf(g.giverIds, { exclude: meId })}` : '';
    const price = g.price != null ? ` · ~${money(g.price)}${g.giverIds.length > 1 ? ` (your share ${money(Math.round(g.price / g.giverIds.length))})` : ''}` : '';
    return html`<li class="sleigh-row status-${g.status}">
      <div class="sleigh-row-main">
        <b class="sleigh-row-title">${g.title}</b>
        <span class="sleigh-row-meta">${g.kind === 'item' ? 'From their list' : 'Off-list surprise'}${split}${price}</span>
        ${g.url ? html`<a class="tag-link" href="${g.url}" target="_blank" rel="noopener noreferrer">${icons.link} ${host(g.url)}</a>` : ''}
        ${g.orphanedFrom ? html`<p class="heads-up">${icons.heads}<span>${r?.name || 'They'} took this off their list. Still getting it? It’s an off-list surprise now.</span></p>` : ''}
        ${g.wishChangedSinceDibs ? html`<p class="heads-up">${icons.heads}<span>${r?.name || 'They'} changed this wish after you called dibs. Double-check the details.</span><button data-action="ack" data-id="${g.id}">Got it</button></p>` : ''}
      </div>
      <div class="sleigh-row-actions">${stepper(g)}<button class="icon-btn" data-action="undibs" data-id="${g.id}" aria-label="Drop this gift">${icons.trash}</button></div>
    </li>`;
  };

  return shell(html`
    <section class="list-head">
      <span class="sleigh-art">${sleighArt()}</span>
      <div>
        <p class="kicker">Your secret shopping list</p>
        <h1 class="page-title">My sleigh</h1>
        <p class="sub">Everything you’ve called dibs on, in one place. Mark things bought and wrapped as you go.</p>
      </div>
    </section>

    ${d.gifts.length ? html`
      <div class="stats-bar">
        <div class="stat"><b>${d.gifts.length}</b><span>${d.gifts.length === 1 ? 'gift' : 'gifts'}</span></div>
        <div class="stat"><b>${money(Math.round(share))}</b><span>your share</span></div>
        <div class="stat"><b>${bought}</b><span>bought</span></div>
        ${cane(pct)}
      </div>
      ${ordered.map(([rid, gifts]) => {
        const r = byId[rid];
        return html`<section class="sleigh-group">
          <header class="sleigh-group-head">${ornament(r, { size: 'sm' })}<h2>For ${r?.name || 'someone'}</h2>${r ? html`<a href="#/m/${r.id}">${possessive(r.name)} list →</a>` : ''}</header>
          <ul class="sleigh-rows">${gifts.map((g) => row(g, r))}</ul>
        </section>`;
      })}`
    : html`<div class="panel center"><p class="empty-note">Your sleigh is empty! Head to the workshop and call dibs on something.</p><a class="btn btn-red" href="#/">Go to the workshop</a></div>`}
  `, 'sleigh');
}

// ----- Family -----

function renderFamily(d) {
  const { me, family } = d;
  const members = [...d.members].sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.name.localeCompare(b.name)));
  const meFull = d.members.find((m) => m.id === me.id) || me;

  const rowActions = (m) => {
    if (m.id === me.id) return '';
    const out = [];
    if (me.organizer && !m.managed) {
      out.push(html`<button class="btn btn-ghost" data-action="reset-pin" data-id="${m.id}">Reset PIN</button>`);
      out.push(html`<button class="btn btn-ghost" data-action="toggle-org" data-id="${m.id}" data-value="${m.organizer ? '' : '1'}">${m.organizer ? 'Remove organizer' : 'Make organizer'}</button>`);
    }
    if (me.organizer || m.managed) out.push(html`<button class="btn btn-ghost" data-action="remove-member" data-id="${m.id}">Remove</button>`);
    return out.length ? html`<span class="roster-actions">${out}</span>` : '';
  };

  return shell(html`
    <section class="list-head">
      ${ornament(meFull, { size: 'xl', you: true })}
      <div>
        <p class="kicker">The family</p>
        <h1 class="page-title">${family.name}</h1>
        <p class="sub">${plural(d.members.length, 'person', 'people')} on the nice list.</p>
      </div>
    </section>

    <div class="fam-grid">
      <section class="panel">
        <h2 class="panel-title">${icons.share} Invite the family</h2>
        <p class="panel-sub">Drop the code or link in the family group chat. Anyone with it can join.</p>
        <div class="code-ticket"><span class="code-label">Family code</span><span class="code">${family.code}</span></div>
        <div class="btn-row">
          <button class="btn btn-red" data-action="copy-link">${icons.copy} Copy invite link</button>
          ${navigator.share ? html`<button class="btn" data-action="share-link">${icons.share} Share</button>` : ''}
        </div>
      </section>

      <section class="panel">
        <h2 class="panel-title">${icons.people} Who’s in</h2>
        <ul class="roster-list">
          ${members.map((m) => html`<li class="roster-row">
            ${ornament(m, { size: 'sm' })}
            <span class="roster-name">${m.name}</span>
            ${m.id === me.id ? html`<span class="role role-pine">you</span>` : ''}
            ${m.organizer ? html`<span class="role">organizer</span>` : ''}
            ${m.managed ? html`<span class="role">no login</span>` : ''}
            ${m.needsPin ? html`<span class="role">PIN reset</span>` : ''}
            ${rowActions(m)}
          </li>`)}
        </ul>
        <details class="add-managed">
          <summary>Add someone who won’t log in</summary>
          <p class="sub">Little kids, grandparents, the dog. Anyone can edit their list, and everyone can see what’s claimed for them.</p>
          <form data-form="add-managed" autocomplete="off">
            <label class="field"><span>Name</span><input name="name" required maxlength="40" placeholder="Grandpa Joe"></label>
            <fieldset class="field"><legend>Ornament</legend>${colorPicker()}</fieldset>
            <button class="btn btn-pine" type="submit">${icons.plus} Add to the family</button>
          </form>
        </details>
      </section>

      <section class="panel">
        <h2 class="panel-title">${icons.star} You</h2>
        <form data-form="profile" autocomplete="off">
          <label class="field"><span>Your name</span><input name="name" required maxlength="40" value="${me.name}"></label>
          <fieldset class="field"><legend>Your ornament</legend>${colorPicker(me.color)}</fieldset>
          <button class="btn btn-pine" type="submit">Save</button>
        </form>
        <details>
          <summary>Change my PIN</summary>
          <form data-form="pin" autocomplete="off">
            <label class="field"><span>Current PIN</span><input class="pin-input" name="currentPin" type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" required autocomplete="current-password"></label>
            <label class="field"><span>New PIN</span><input class="pin-input" name="newPin" type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" required autocomplete="new-password"></label>
            <button class="btn btn-pine" type="submit">${icons.lock} Update PIN</button>
          </form>
        </details>
        <button class="btn" data-action="logout">${icons.door} Sign out</button>
      </section>

      ${me.organizer ? html`<section class="panel">
        <h2 class="panel-title">${icons.pencil} Organizer stuff</h2>
        <p class="panel-sub">Organizers can rename the family, reset forgotten PINs, and remove people.</p>
        <form data-form="rename-family" autocomplete="off">
          <label class="field"><span>Family name</span><input name="name" required maxlength="60" value="${family.name}"></label>
          <button class="btn btn-pine" type="submit">Rename</button>
        </form>
      </section>` : ''}
    </div>
  `, 'family');
}

function renderError(err) {
  const inner = html`<div class="panel center" style="max-width:520px;margin:40px auto">
    <h1 class="title">Uh oh, tangled lights</h1>
    <p class="sub" style="margin:10px auto 18px">${err.message}</p>
    <div class="btn-row" style="justify-content:center"><button class="btn btn-red" data-action="retry">Try again</button><a class="btn" href="#/">Workshop</a></div>
  </div>`;
  return state.session ? shell(inner, '') : authLayout(inner);
}

// ============================================================
// Routing
// ============================================================

const views = {
  landing: { render: renderLanding },
  start: { render: renderStart },
  joinCode: { render: renderJoinCode },
  join: {
    load: ({ code }) => get(`/families/${encodeURIComponent(code)}`).catch((e) => ({ error: e.message })),
    render: renderJoin,
  },
  workshop: { auth: true, load: () => get('/overview'), render: renderWorkshop },
  member: { auth: true, load: ({ id }) => get(`/members/${encodeURIComponent(id)}`), render: renderMember },
  sleigh: { auth: true, load: () => get('/sleigh'), render: renderSleigh },
  family: { auth: true, load: () => get('/overview'), render: renderFamily },
};

function parseRoute(hash) {
  const h = (hash || '').replace(/^#/, '') || '/';
  const signedIn = !!state.session;
  let m;
  if (h === '/start') return { name: 'start', params: {} };
  if (h === '/join') return { name: 'joinCode', params: {} };
  if ((m = h.match(/^\/join\/([^/]+)$/))) return { name: 'join', params: { code: decodeURIComponent(m[1]).toUpperCase() } };
  if (h === '/me' && signedIn) return { name: 'member', params: { id: state.session.me.id } };
  if ((m = h.match(/^\/m\/([^/]+)$/))) return { name: 'member', params: { id: m[1] } };
  if (h === '/sleigh') return { name: 'sleigh', params: {} };
  if (h === '/family') return { name: 'family', params: {} };
  return { name: signedIn ? 'workshop' : 'landing', params: {} };
}

async function navigate() {
  const next = parseRoute(location.hash);
  const view = views[next.name];
  if (view.auth && !state.session) {
    location.hash = '#/';
    return;
  }
  const changed = next.name !== state.route.name || JSON.stringify(next.params) !== JSON.stringify(state.route.params);
  if (changed) {
    state.editing = null;
    state.adding = false;
    if (next.name !== 'join' || next.params.code !== state.route.params?.code) state.join = { mode: 'pick', memberId: null };
  }
  state.route = next;
  await load({ scroll: changed });
}

async function load({ scroll = false } = {}) {
  const route = state.route;
  const view = views[route.name];
  try {
    const data = view.load ? await view.load(route.params) : null;
    if (route !== state.route) return; // user moved on
    accept(data);
    paint();
    if (scroll) window.scrollTo(0, 0);
  } catch (err) {
    if (err.status === 401) {
      state.session = null;
      location.hash = '#/';
      if (route.name === 'workshop') navigate();
      return;
    }
    app.innerHTML = String(renderError(err));
  }
}

function accept(data) {
  state.data = data;
  state.dataKey = JSON.stringify(data);
  if (data?.me && data.family) state.session = { me: data.me, family: data.family, members: data.members };
  if (data?.members && state.session && state.route.name === 'sleigh') state.session.members = data.members;
}

function paint() {
  const view = views[state.route.name];
  app.innerHTML = String(view.render(state.data, state.route.params));
  document.title = titleFor();
  const focus = app.querySelector('[data-autofocus], .tag-form input[name=title], .pin-input');
  if (focus && (state.route.name === 'join' || state.adding || state.editing)) focus.focus({ preventScroll: state.route.name !== 'join' });
  if (state.stamped) setTimeout(() => { state.stamped = null; }, 900);
}

function titleFor() {
  const r = state.route.name;
  if (r === 'member' && state.data?.member) return state.data.shielded ? 'My list · Family Santa' : `${possessive(state.data.member.name)} list · Family Santa`;
  return { sleigh: 'My sleigh · Family Santa', family: 'Family · Family Santa', workshop: 'Workshop · Family Santa' }[r] || 'Family Santa';
}

// Quiet background refresh so dibs show up without reloading.
function userIsBusy() {
  const a = document.activeElement;
  if (a && a.closest('#app form')) return true;
  if (document.getElementById('dialog').open) return true;
  return [...app.querySelectorAll('form input:not([type=radio]):not([type=checkbox]), form textarea')].some((el) => el.value !== el.defaultValue);
}
async function poll() {
  if (document.visibilityState !== 'visible' || !state.session) return;
  const view = views[state.route.name];
  if (!view.auth || !view.load || userIsBusy() || state.editing) return;
  try {
    const route = state.route;
    const data = await view.load(route.params);
    if (route !== state.route || userIsBusy()) return;
    if (JSON.stringify(data) !== state.dataKey) {
      accept(data);
      paint();
    }
  } catch { /* try again next tick */ }
}

// ============================================================
// Actions
// ============================================================

const actions = {
  async dibs({ id }, el) {
    await post(`/items/${id}/dibs`);
    state.stamped = id;
    confetti(el);
    toast('Dibs! It’s yours. Nobody else can grab it now.');
    await load();
  },
  async 'chip-in'({ id }) {
    await post(`/claims/${id}/chip-in`);
    toast('You’re in! Splitting it.');
    await load();
  },
  async status({ id, status }, el) {
    await patch(`/claims/${id}`, { status });
    if (status === 'wrapped') { confetti(el); toast('Wrapped! Look at you go.'); }
    await load();
  },
  async ack({ id }) {
    await patch(`/claims/${id}`, { ack: true });
    await load();
  },
  async undibs({ id }) {
    const ok = await confirmDialog({ title: 'Let this one go?', message: 'It goes back up for grabs (or stays with whoever you were splitting it with).', ok: 'Un-dibs it', danger: true });
    if (!ok) return;
    await del(`/claims/${id}`);
    toast('Released back into the wild.');
    await load();
  },
  'open-add'() { state.adding = true; paint(); },
  'close-add'() { state.adding = false; paint(); },
  'edit-wish'({ id }) { state.editing = id; state.adding = false; paint(); },
  'cancel-edit'() { state.editing = null; paint(); },
  async 'delete-wish'({ id }) {
    const ok = await confirmDialog({ title: 'Remove this wish?', message: 'It’ll disappear from the list. If anyone already planned on it, they’ll get a heads-up.', ok: 'Remove it', danger: true });
    if (!ok) return;
    await del(`/items/${id}`);
    toast('Poof. Gone.');
    await load();
  },
  'pick-member'({ id }) { state.join = { mode: 'pin', memberId: id }; paint(); },
  'join-new'() { state.join = { mode: 'new', memberId: null }; paint(); },
  'join-back'() { state.join = { mode: 'pick', memberId: null }; paint(); },
  async 'copy-link'(_, el) {
    const link = inviteLink();
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied. Paste it in the group chat!');
    } catch {
      await confirmDialog({ title: 'Here’s your invite link', message: link, ok: 'Done', cancel: 'Close' });
    }
    confetti(el);
  },
  async 'share-link'() {
    const fam = state.session.family;
    try {
      await navigator.share({ title: 'Family Santa', text: `Join ${fam.name} on Family Santa! Our code is ${fam.code}.`, url: inviteLink() });
    } catch { /* cancelled */ }
  },
  async logout() {
    await post('/logout');
    state.session = null;
    toast('Signed out. See you by the fireplace.');
    goto('#/');
  },
  async 'reset-pin'({ id }) {
    const m = memberMap(state.data.members)[id];
    const ok = await confirmDialog({ title: `Reset ${possessive(m.name)} PIN?`, message: `They’ll be signed out and can pick a new PIN next time they sign in. Let ${m.name} know right away!`, ok: 'Reset it' });
    if (!ok) return;
    await post(`/members/${id}/reset-pin`);
    toast(`Done. Tell ${m.name} to sign in and pick a new PIN.`);
    await load();
  },
  async 'toggle-org'({ id, value }) {
    await post(`/members/${id}/organizer`, { value: !!value });
    await load();
  },
  async 'remove-member'({ id }) {
    const m = memberMap(state.data.members)[id];
    const ok = await confirmDialog({ title: `Remove ${m.name}?`, message: 'Their list and any gifts planned for them will be deleted. This can’t be undone.', ok: 'Remove', danger: true });
    if (!ok) return;
    await del(`/members/${id}`);
    toast(`${m.name} has left the workshop.`);
    await load();
  },
  retry() { load(); },
};

const changes = {
  'toggle-taken'(el) { state.hideTaken = el.checked; paint(); },
};

const forms = {
  async create(v) {
    const s = await post('/families', v);
    signedIn(s, `Workshop open! Your family code is ${s.family.code}.`);
  },
  async 'join-code'({ code }) {
    goto(`#/join/${encodeURIComponent(code.trim().toUpperCase())}`);
  },
  async login({ pin }) {
    const s = await post(`/families/${encodeURIComponent(state.route.params.code)}/login`, { memberId: state.join.memberId, pin });
    signedIn(s, `Welcome back, ${s.me.name}!`);
  },
  async join(v) {
    const s = await post(`/families/${encodeURIComponent(state.route.params.code)}/join`, v);
    signedIn(s, `Welcome to the family, ${s.me.name}! Start your list.`);
  },
  async 'add-wish'(v, form) {
    await post(`/members/${form.dataset.id}/items`, v);
    toast('Added! Keep ’em coming.');
    state.adding = true;
    await load();
  },
  async 'edit-wish'(v, form) {
    await patch(`/items/${form.dataset.id}`, v);
    state.editing = null;
    toast('Saved.');
    await load();
  },
  async surprise(v, form) {
    await post(`/members/${form.dataset.id}/surprises`, v);
    toast('Logged. Your secret’s safe.');
    await load();
  },
  async 'add-managed'(v) {
    const m = await post('/members', v);
    toast(`${m.name} is in! Anyone can fill in their list.`);
    await load();
  },
  async profile(v) {
    await patch(`/members/${state.session.me.id}`, v);
    toast('Looking festive.');
    await load();
  },
  async pin(v, form) {
    await post('/me/pin', v);
    form.reset();
    toast('PIN updated.');
  },
  async 'rename-family'(v) {
    await patch('/family', v);
    toast('Renamed!');
    await load();
  },
};

function signedIn(s, message) {
  state.session = s;
  remember(s.family);
  toast(message);
  goto('#/');
}

function inviteLink() {
  return `${location.origin}/#/join/${encodeURIComponent(state.session.family.code)}`;
}

async function busy(el, fn) {
  const btn = el?.matches?.('button') ? el : el?.querySelector?.('[type=submit]');
  if (btn) btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    toast(err.message || 'Something went sideways.', 'error');
    if (err.status === 409) load();
    if (err.status === 401 && state.session) { state.session = null; goto('#/'); }
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  busy(el, () => actions[el.dataset.action](el.dataset, el));
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && changes[el.dataset.change]) changes[el.dataset.change](el);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form || !forms[form.dataset.form]) return;
  e.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  busy(form, () => forms[form.dataset.form](values, form));
});

window.addEventListener('hashchange', navigate);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && poll());

(async function boot() {
  try {
    const s = await get('/session');
    state.session = s.me ? s : null;
  } catch {
    state.session = null;
  }
  await navigate();
  setInterval(poll, 15000);
})();
