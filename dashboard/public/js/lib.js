// Briques communes de l'interface : DOM, icônes, API, notifications, fenêtres.

// ── DOM ──────────────────────────────────────────────────────────────────

/** h('div.card#id', { onclick, class, style, ...attrs }, ...enfants) */
export function h(tag, attrs, ...children) {
  if (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = name === 'svg' || name === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', name) : document.createElement(name || 'div');
  for (const part of rest) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false || k === 'value') continue;
    if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  // Après les enfants : un <select> n'accepte une valeur qu'une fois ses <option> présentes.
  if (attrs.value !== undefined && attrs.value !== null) el.value = attrs.value;
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

// ── Icônes (tracés Lucide, licence ISC) ──────────────────────────────────

const ICONS = {
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'folder-plus': '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  ftp: '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  settings: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  restart: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  logs: '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  hammer: '<path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  wrap: '<line x1="3" x2="21" y1="6" y2="6"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" x2="10" y1="18" y2="18"/>',
};

export function icon(name, size = 16, cls = '') {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '2');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('icon');
  if (cls) el.classList.add(...cls.split(' '));
  el.innerHTML = ICONS[name] || ICONS.box;
  return el;
}

// ── API ──────────────────────────────────────────────────────────────────

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'X-DS': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}

export const get = (url) => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const put = (url, body = {}) => api('PUT', url, body);
export const del = (url) => api('DELETE', url);

// ── Petit magasin partagé : la vue d'ensemble rafraîchie en continu ─────

export const store = {
  overview: null,
  catalog: null,
  listeners: new Set(),
  set(o) {
    this.overview = o;
    for (const fn of this.listeners) fn(o);
  },
  subscribe(fn) {
    this.listeners.add(fn);
    if (this.overview) fn(this.overview);
    return () => this.listeners.delete(fn);
  },
};

let refreshHook = () => {};
export function onRefresh(fn) { refreshHook = fn; }
/** Demande un rafraîchissement immédiat de la vue d'ensemble. */
export function refresh() { return refreshHook(); }

// ── Notifications ────────────────────────────────────────────────────────

let toastRoot = null;
export function toast(message, { type = 'info', action, duration } = {}) {
  toastRoot ??= document.body.appendChild(h('div.toasts', { role: 'status', 'aria-live': 'polite' }));
  const ico = { success: 'circle-check', error: 'circle-x', info: 'info', warning: 'alert' }[type] || 'info';
  const el = h(`div.toast.toast-${type}`,
    icon(ico, 18, 'toast-icon'),
    h('div.toast-body', message),
    action ? h('button.btn.btn-sm.btn-ghost', { onclick: () => { action.onClick(); close(); } }, action.label) : null,
    h('button.toast-close', { 'aria-label': 'Fermer', onclick: () => close() }, icon('x', 14)));
  toastRoot.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const timer = setTimeout(close, duration ?? (type === 'error' ? 9000 : 4000));
  function close() {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }
  return close;
}

export function errorToast(e) {
  toast(e.message || String(e), { type: 'error' });
}

// ── Fenêtres ─────────────────────────────────────────────────────────────

/**
 * modal({ title, subtitle, icon, body, actions: [{label, variant, onClick, icon}], size, onClose })
 * onClick peut renvoyer une promesse : le bouton passe en « occupé » ; renvoyer false garde la fenêtre ouverte.
 */
export function modal({ title, subtitle, icon: ico, body, actions = [], size = 'md', onClose, dismissable = true }) {
  const prevFocus = document.activeElement;
  const footer = h('div.modal-footer');
  const dialog = h(`div.modal.modal-${size}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-header',
      ico ? h('div.modal-icon', icon(ico, 20)) : null,
      h('div.modal-titles', h('h2', title), subtitle ? h('p.muted', subtitle) : null),
      dismissable ? h('button.btn.btn-icon.btn-ghost.modal-x', { 'aria-label': 'Fermer', onclick: () => close() }, icon('x', 18)) : null),
    h('div.modal-body', body),
    footer);
  const backdrop = h('div.backdrop', { onmousedown: (e) => { if (dismissable && e.target === backdrop) close(); } }, dialog);
  const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(); };
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));

  const buttons = actions.map((a) => {
    const b = h(`button.btn${a.variant ? `.btn-${a.variant}` : ''}`, { type: 'button' }, a.icon ? icon(a.icon) : null, a.label);
    b.addEventListener('click', async () => {
      if (!a.onClick) return close();
      b.classList.add('busy');
      buttons.forEach((x) => { x.disabled = true; });
      try {
        const r = await a.onClick({ close });
        if (r !== false) close();
      } catch (e) {
        errorToast(e);
      } finally {
        b.classList.remove('busy');
        buttons.forEach((x) => { x.disabled = false; });
      }
    });
    return b;
  });
  if (buttons.length) append(footer, buttons); else footer.remove();
  setTimeout(() => (dialog.querySelector('[autofocus]') || dialog.querySelector('input,select,textarea') || buttons[buttons.length - 1])?.focus(), 60);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 200);
    onClose?.();
    prevFocus?.focus?.();
  }
  return { el: dialog, close, footer };
}

/** Demande de confirmation. Renvoie false, ou { checked } si une case est proposée. */
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false, checkbox }) {
  return new Promise((resolve) => {
    let result = false;
    const cb = checkbox ? h('input', { type: 'checkbox', checked: !!checkbox.checked }) : null;
    modal({
      title,
      icon: danger ? 'alert' : 'info',
      size: 'sm',
      body: h('div', h('p', message), cb ? h('label.check', cb, h('span', checkbox.label)) : null),
      actions: [
        { label: 'Annuler' },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => { result = { checked: cb ? cb.checked : false }; } },
      ],
      onClose: () => resolve(result),
    });
  });
}

/** Menu déroulant attaché à un bouton. items : [{ label, icon, onClick, danger, disabled } | 'sep'] */
export function menu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const el = h('div.menu', { role: 'menu' }, items.map((it) => (it === 'sep' ? h('div.menu-sep')
    : h(`button.menu-item${it.danger ? '.danger' : ''}`, {
      role: 'menuitem', disabled: !!it.disabled, onclick: () => { close(); it.onClick(); },
    }, it.icon ? icon(it.icon) : h('span.icon-spacer'), it.label))));
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.top = `${r.bottom + 6 + window.scrollY}px`;
  el.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + window.scrollX}px`;
  const close = () => { el.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  el.querySelector('button:not([disabled])')?.focus();
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

// ── Copier ───────────────────────────────────────────────────────────────

export async function copy(text, label = 'Copié dans le presse-papiers') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(label, { type: 'success', duration: 1800 });
}

export function copyBtn(text, { label, title = 'Copier', small = true } = {}) {
  const b = h(`button.btn.btn-ghost${small ? '.btn-sm' : ''}${label ? '' : '.btn-icon'}.copy-btn`, {
    type: 'button',
    title,
    onclick: (e) => {
      e.stopPropagation();
      copy(typeof text === 'function' ? text() : text);
      b.classList.add('copied');
      setTimeout(() => b.classList.remove('copied'), 1400);
    },
  }, h('span.copy-ico', icon('copy', 14)), h('span.copied-ico', icon('check', 14)), label || null);
  return b;
}

/** Valeur monospace avec bouton copier. */
export function codeValue(text, { secret = false } = {}) {
  const val = h('code.cv-text', secret ? '••••••••••' : text);
  let shown = !secret;
  const eye = secret ? h('button.btn.btn-ghost.btn-sm.btn-icon', {
    type: 'button',
    title: 'Afficher / masquer',
    onclick: () => { shown = !shown; replace(val, shown ? text : '••••••••••'); replace(eye, icon(shown ? 'eye-off' : 'eye', 14)); },
  }, icon('eye', 14)) : null;
  return h('span.code-value', val, eye, copyBtn(text));
}

/** Mot de passe : la valeur, ou « aucun » quand il est vide. */
export function passwordValue(pw) {
  return pw ? codeValue(pw) : h('span.muted', 'aucun (vide)');
}

/** Bloc de code avec bouton copier. */
export function codeBlock(text, { lang } = {}) {
  return h('div.code-block', h('div.code-head', h('span.code-lang', lang || ''), copyBtn(text)), h('pre', h('code', text)));
}

/** Onglets de snippets : [{ label, text, lang }] */
export function snippetTabs(items) {
  const body = h('div');
  const tabs = h('div.seg.seg-sm');
  const show = (i) => {
    tabs.querySelectorAll('button').forEach((b, j) => b.classList.toggle('active', i === j));
    replace(body, codeBlock(items[i].text, { lang: items[i].lang }));
  };
  items.forEach((it, i) => tabs.append(h('button', { type: 'button', onclick: () => show(i) }, it.label)));
  show(0);
  return h('div.snippets', tabs, body);
}

// ── Formatage ────────────────────────────────────────────────────────────

export function fmtBytes(n) {
  if (!n) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toLocaleString('fr-FR', { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}

export function plural(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'à l\'instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(ts).toLocaleDateString('fr-FR');
}

export const STATUS = {
  running: { label: 'En ligne', cls: 'ok' },
  stopped: { label: 'Arrêté', cls: 'off' },
  missing: { label: 'Non démarré', cls: 'off' },
  working: { label: 'En cours…', cls: 'busy' },
  error: { label: 'Erreur', cls: 'err' },
};

export function statusPill(status, label) {
  const s = STATUS[status] || STATUS.stopped;
  return h(`span.status.status-${s.cls}`, h('span.status-dot'), label || s.label);
}

/** Champ de formulaire : libellé + contrôle + aide. */
export function field(label, control, hint) {
  return h('label.field', h('span.field-label', label), control, hint ? h('span.field-hint', hint) : null);
}

export function toggle(checked, onChange, { disabled = false } = {}) {
  const input = h('input', { type: 'checkbox', checked, disabled, onchange: () => onChange(input.checked) });
  return h('span.switch', input, h('span.switch-track', h('span.switch-thumb')));
}

export const FRAMEWORKS = {
  laravel: { color: '#ff2d20', letter: 'L' },
  symfony: { color: '#1a171b', letter: 'S' },
  wordpress: { color: '#21759b', letter: 'W' },
  drupal: { color: '#0678be', letter: 'D' },
  prestashop: { color: '#df0067', letter: 'P' },
  joomla: { color: '#f44321', letter: 'J' },
  codeigniter: { color: '#dd4814', letter: 'C' },
  cakephp: { color: '#d33c43', letter: 'C' },
  yii: { color: '#40b3d8', letter: 'Y' },
  static: { color: '#64748b', letter: '<>' },
  php: { color: '#777bb3', letter: 'php' },
};

// ── Adresses ─────────────────────────────────────────────────────────────

/** Nettoie une adresse saisie : minuscules, sans protocole, port ni chemin. */
export function cleanHost(v) {
  return String(v || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[:/?#].*$/, '');
}

export const HOST_OK = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * État d'une adresse : « auto » (.localhost, rien à faire), « ok » (présente dans
 * le fichier hosts), « missing » (absente) ou « unknown » (agent non lancé).
 */
export function hostState(host, ov = store.overview) {
  if (host === 'localhost' || host.endsWith('.localhost')) return 'auto';
  const st = ov?.hosts;
  if (!st || !st.agent || !st.missing) return 'unknown';
  return st.missing.includes(host) ? 'missing' : 'ok';
}

const IS_WINDOWS = /windows/i.test(navigator.userAgent);
export const HOSTS_TOOL = IS_WINDOWS ? 'hosts.cmd' : './hosts.sh';

/** Petit texte d'aide sous un champ d'adresse. */
export function hostHint(host, ov = store.overview) {
  if (!host) return h('span.host-hint', 'Exemples : mon-site.localhost, mon-site.test, local-mon-site');
  if (!HOST_OK.test(host)) return h('span.host-hint.bad', icon('alert', 13), 'Lettres, chiffres, tirets et points uniquement.');
  if (hostState(host, ov) === 'auto') return h('span.host-hint.good', icon('check', 13), 'Fonctionne immédiatement, sans configuration.');
  return h('span.host-hint', icon('info', 13), ov?.hosts?.agent
    ? 'Adresse personnalisée : ajoutée au fichier hosts, Windows vous demandera une confirmation.'
    : `Adresse personnalisée : à ajouter au fichier hosts, en lançant ${HOSTS_TOOL} dans le dossier docker-server.`);
}

/** « Laravel 11 · PHP 8.3 », ou simplement « PHP 8.4 » pour un projet sans framework. */
export function stackLabel(p) {
  return p.framework === 'php' || !p.frameworkLabel ? `PHP ${p.php}` : `${p.frameworkLabel} · PHP ${p.php}`;
}

export function avatar(framework, size = 40) {
  const f = FRAMEWORKS[framework] || FRAMEWORKS.php;
  return h('span.avatar', { style: { background: f.color, width: `${size}px`, height: `${size}px`, fontSize: `${f.letter.length > 1 ? size * 0.3 : size * 0.45}px` } }, f.letter);
}
