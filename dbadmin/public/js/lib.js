// Utilitaires partagés : DOM, icônes, formatage, modales, menus contextuels, notifications.

// ── DOM ──────────────────────────────────────────────────────────────────────
/** h('div', {class:'x', onclick: fn}, 'texte', autreElement, [liste…]) → élément. */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') value = v;                       // posée après les enfants (cas de <select>)
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, ...kids);
  if (value !== undefined) el.value = value;
  return el;
}

/** Comme Element.append, mais accepte aussi des tableaux et ignore null / undefined / false. */
export function append(el, ...kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

const ICONS = {
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  view: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  sql: '<path d="M4 17l6-6-6-6M12 19h8"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  schema: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M6.5 10v4.5H14"/>',
  filter: '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  first: '<path d="M6 5v14M18 6l-8 6 8 6z"/>', last: '<path d="M18 5v14M6 6l8 6-8 6z"/>',
  prev: '<path d="M15 6l-6 6 6 6"/>', next: '<path d="M9 6l6 6-6 6"/>',
  up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12l5 5L20 7"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
};

export function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'i');
  if (size) { svg.style.width = svg.style.height = size + 'px'; }
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

/** Bouton : btn('Enregistrer', 'primary', onClick, 'check') */
export function btn(label, kind = '', onclick, ic) {
  return h('button', { class: 'btn ' + kind, onclick, type: 'button' }, ic ? icon(ic) : null, label);
}

// ── SQL côté client (les requêtes de structure sont fabriquées ici, montrées avant exécution) ──
/** `identifiant` */
export const q = (name) => '`' + String(name).replace(/`/g, '``') + '`';
/** `base`.`table` */
export const qt = (db, table) => q(db) + '.' + q(table);
/** 'littéral' (apostrophes doublées, antislash échappé) */
export const qs = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";

// ── Formatage ────────────────────────────────────────────────────────────────
export const fmtNum = (n) => (n == null ? '–' : Number(n).toLocaleString('fr-FR'));
export function fmtBytes(n) {
  if (n == null) return '–';
  n = Number(n);
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : 1)) + ' ' + u[i];
}
export const fmtMs = (ms) => (ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(2) + ' s');
export const fmtDate = (s) => (s ? String(s).slice(0, 16) : '–');
export const plural = (n, one, many) => `${fmtNum(n)} ${n > 1 ? many || one + 's' : one}`;

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = text;
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
}

export function saveFile(filename, content, mime = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([content], { type: mime + ';charset=utf-8' })), download: filename });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Valeur d'une cellule (null | texte | {t,n} | {b,n}) → texte. */
export function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') return v.t != null ? v.t : '0x' + v.b + (v.n > v.b.length / 2 ? '…' : '');
  return String(v);
}

/** CSV pour Excel (FR) : séparateur « ; », BOM UTF-8. */
export function toCSV(cols, rows) {
  const esc = (v) => { const s = cellText(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [cols.map((c) => esc(c.name)).join(';'), ...rows.map((r) => r.map(esc).join(';'))].join('\r\n');
}

// ── Notifications ────────────────────────────────────────────────────────────
let toastBox;
export function toast(message, kind = 'info', ms) {
  toastBox ??= document.body.appendChild(h('div', { class: 'toasts' }));
  const el = h('div', { class: 'toast ' + kind }, message);
  toastBox.append(el);
  setTimeout(() => el.remove(), ms ?? (kind === 'error' ? 9000 : 3200));
  el.onclick = () => el.remove();
}

// ── Modales ──────────────────────────────────────────────────────────────────
/**
 * modal({title, body, foot:[boutons], size:'wide'|'xl'}) → {el, body, close(valeur), closed:Promise}
 * Se ferme avec ✕ ou Échap (pas en cliquant à côté : on ne perd pas une saisie par accident).
 */
export function modal({ title, body, foot = [], size = '', closable = true }) {
  let done;
  const closed = new Promise((r) => (done = r));
  const overlay = h('div', { class: 'overlay' });
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const footEl = h('div', { class: 'modal-foot' }, foot);
  const api = {
    el: overlay, body: bodyEl, foot: footEl, closed,
    close(value) { document.removeEventListener('keydown', onKey, true); overlay.remove(); done(value); },
    setFoot(nodes) { clear(footEl); append(footEl, nodes); },
  };
  const onKey = (e) => { if (e.key === 'Escape' && closable && overlay === [...document.querySelectorAll('.overlay')].pop()) { e.stopPropagation(); api.close(undefined); } };
  document.addEventListener('keydown', onKey, true);
  overlay.append(h('div', { class: 'modal ' + size },
    h('div', { class: 'modal-head' }, h('h3', null, title), closable ? h('button', { class: 'btn ghost icon sm', onclick: () => api.close(undefined), type: 'button', title: 'Fermer' }, icon('close')) : null),
    bodyEl, footEl));
  document.body.append(overlay);
  setTimeout(() => (bodyEl.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, select') || {}).focus?.(), 30);
  return api;
}

/** Confirmation → Promise<boolean>. */
export function confirmBox({ title = 'Confirmer', message, confirmLabel = 'Confirmer', danger = false }) {
  const m = modal({ title, body: typeof message === 'string' ? h('p', { style: { margin: '4px 0', whiteSpace: 'pre-wrap' } }, message) : message });
  m.setFoot([btn('Annuler', '', () => m.close(false)), btn(confirmLabel, danger ? 'danger' : 'primary', () => m.close(true))]);
  return m.closed.then((v) => v === true);
}

// ── Menu contextuel ──────────────────────────────────────────────────────────
let ctxEl, ctxOff;
export function closeContextMenu() {
  ctxEl?.remove(); ctxEl = null;
  ctxOff?.(); ctxOff = null;
}
/** contextMenu(evenement, [{label, icon, onClick, danger, disabled}, '-', …]) */
export function contextMenu(ev, items) {
  ev.preventDefault(); ev.stopPropagation();
  closeContextMenu();
  ctxEl = h('div', { class: 'ctx' }, items.filter(Boolean).map((it) => it === '-'
    ? h('div', { class: 'hr' })
    : h('div', { class: 'it' + (it.danger ? ' danger' : '') + (it.disabled ? ' off' : ''), onclick: () => { closeContextMenu(); it.onClick?.(); } },
        it.icon ? icon(it.icon) : null, it.label)));
  document.body.append(ctxEl);
  const r = ctxEl.getBoundingClientRect();
  ctxEl.style.left = Math.max(4, Math.min(ev.clientX, innerWidth - r.width - 6)) + 'px';
  ctxEl.style.top = Math.max(4, Math.min(ev.clientY, innerHeight - r.height - 6)) + 'px';
  const away = (e) => { if (!ctxEl?.contains(e.target)) closeContextMenu(); };
  const esc = (e) => { if (e.key === 'Escape') closeContextMenu(); };
  document.addEventListener('mousedown', away, true);
  document.addEventListener('keydown', esc, true);
  addEventListener('blur', closeContextMenu);
  ctxOff = () => { document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc, true); removeEventListener('blur', closeContextMenu); };
}

/** Menu déroulant sous un bouton : dropdown(bouton, [items…]). */
export function dropdown(button, items) {
  const r = button.getBoundingClientRect();
  contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 2 }, items);
}
