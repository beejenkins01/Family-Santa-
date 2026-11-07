// Small rendering helpers. Everything user-typed goes through `html` which
// escapes interpolated values unless they were produced by `html`/`raw`.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));

function renderValue(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new Raw(out);
}

// ---------- palette ----------

export const COLORS = {
  cranberry: '#c63a2e',
  pine: '#1e5640',
  gold: '#d99a22',
  frost: '#3f7d9c',
  plum: '#7a3b69',
  ember: '#d9692b',
  spruce: '#2a8c82',
  berry: '#c94f7c',
  slate: '#4b5b6b',
  cocoa: '#7a4a2e',
};
export const colorOf = (key) => COLORS[key] || COLORS.cranberry;

// ---------- words ----------

export const possessive = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);
export const initial = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();

export function money(n) {
  if (n == null) return '';
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

export function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
}

export function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function sleepsUntilChristmas(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let xmas = new Date(now.getFullYear(), 11, 25);
  if (today > xmas) xmas = new Date(now.getFullYear() + 1, 11, 25);
  return Math.round((xmas - today) / 86400000);
}

// Stable little tilt per id so tags look hand-placed, not random on every render.
export function tilt(id, spread = 1.4) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (((Math.abs(h) % 1000) / 1000) * 2 - 1) * spread;
}

// ---------- icons (hand-tuned, 24px grid, 2px stroke) ----------

const I = (d, extra = '') =>
  raw(`<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`);

export const icons = {
  tree: I('<path d="M12 2 6 10h3l-4 6h4l-3 4h12l-3-4h4l-4-6h3z"/><path d="M12 20v2"/>'),
  list: I('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>'),
  sleigh: I('<path d="M3 7c0 6 2 9 7 9h8c2 0 3-1.5 3-3.5V9"/><path d="M2 19h17c1.7 0 3-1.3 3-3"/><path d="M8 16v3M16 16v3"/><path d="M9 7h6v5H9z"/>'),
  people: I('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.6 3-5.5 6-5.5s5.4 1.9 6 5.5"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M16.5 14.6c2.4.2 4 1.9 4.5 4.6"/>'),
  link: I('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  pencil: I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  trash: I('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  star: I('<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>'),
  starFill: I('<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z" fill="currentColor"/>'),
  copy: I('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  share: I('<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
  back: I('<path d="M15 5 8 12l7 7"/>'),
  gift: I('<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M12 9v12M3 13h18"/><path d="M12 9c-2-4-6-5-6-2s4 2 6 2c2 0 6 1 6-2s-4-2-6 2"/>'),
  heads: I('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>'),
  door: I('<path d="M14 4h5v16h-5"/><path d="M10 16l4-4-4-4M14 12H4"/>'),
  lock: I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
};

// ---------- reusable pieces ----------

export function ornament(member, { size = 'md', you = false } = {}) {
  return html`<span class="orn orn-${size}${you ? ' is-you' : ''}" style="--c:${colorOf(member?.color)}">
    <span class="orn-cap"></span>
    <span class="orn-ball"><span class="orn-initial">${initial(member?.name)}</span></span>
  </span>`;
}

export function lights(count = 36) {
  const bulbs = ['#e5483b', '#f2c14e', '#3aa676', '#5aa9d6', '#f08fb0'];
  return html`<div class="lights" aria-hidden="true">${Array.from({ length: count }, (_, i) => html`<span class="bulb-cell"><i class="bulb" style="--b:${bulbs[i % bulbs.length]};--d:${((i * 0.37) % 2.4).toFixed(2)}s"></i></span>`)}</div>`;
}

export function santaHat(cls = 'hat') {
  return raw(`<svg class="${cls}" viewBox="0 0 80 64" aria-hidden="true">
    <path d="M10 46 C 14 22, 34 6, 58 12 C 66 14, 70 24, 66 34 C 62 28, 54 26, 50 32 L 56 46 Z" fill="#c63a2e" stroke="#2b1d16" stroke-width="3" stroke-linejoin="round"/>
    <rect x="4" y="42" width="58" height="14" rx="7" fill="#fffaf0" stroke="#2b1d16" stroke-width="3"/>
    <circle cx="67" cy="38" r="8" fill="#fffaf0" stroke="#2b1d16" stroke-width="3"/>
  </svg>`);
}

export function shieldArt() {
  return raw(`<svg class="shield-art" viewBox="0 0 64 72" aria-hidden="true">
    <defs><pattern id="cane" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><rect width="12" height="12" fill="#fffaf0"/><rect width="6" height="12" fill="#c63a2e"/></pattern></defs>
    <path d="M32 4 L58 13 V34 C58 52 46 63 32 68 C18 63 6 52 6 34 V13 Z" fill="url(#cane)" stroke="#2b1d16" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M32 18 L46 23 V35 C46 45 40 51 32 54 C24 51 18 45 18 35 V23 Z" fill="#1e5640" stroke="#2b1d16" stroke-width="3" stroke-linejoin="round"/>
    <path d="M25 36 l5 5 9-10" fill="none" stroke="#fffaf0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`);
}

export function waxSeal(label = 'shh') {
  return html`<span class="seal" aria-label="Sealed"><span>${label}</span></span>`;
}

// ---------- toasts ----------

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 400);
  }, kind === 'error' ? 4800 : 3000);
}

// ---------- confetti (paper bits + stars) ----------

export function confetti(fromEl) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = fromEl?.getBoundingClientRect?.() || { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const colors = ['#c63a2e', '#1e5640', '#e0a12f', '#3f7d9c', '#fffaf0'];
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('span');
    p.className = `confetti ${i % 4 === 0 ? 'is-star' : ''}`;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.setProperty('--k', colors[i % colors.length]);
    document.body.appendChild(p);
    const angle = (Math.PI * 2 * i) / 26 + Math.random() * 0.4;
    const dist = 60 + Math.random() * 90;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 40;
    const spin = (Math.random() * 2 - 1) * 540;
    p.animate(
      [
        { transform: 'translate(-50%,-50%) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${dx * 1.2}px), calc(-50% + ${dy + 120}px)) rotate(${spin}deg) scale(.6)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)' },
    ).onfinish = () => p.remove();
  }
}

// ---------- dialog (confirm) ----------

export function confirmDialog({ title, message, ok = 'Yes', cancel = 'Never mind', danger = false }) {
  const dlg = document.getElementById('dialog');
  dlg.innerHTML = String(html`<form method="dialog" class="dlg">
      <h2 class="dlg-title">${title}</h2>
      ${message ? html`<p>${message}</p>` : ''}
      <div class="dlg-actions">
        <button class="btn" value="cancel">${cancel}</button>
        <button class="btn ${danger ? 'btn-red' : 'btn-pine'}" value="ok" autofocus>${ok}</button>
      </div>
    </form>`);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}
