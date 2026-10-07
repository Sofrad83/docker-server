// Gestion des onglets. Chaque type d'onglet (« vue ») s'enregistre avec registerView(kind, fabrique) ;
// la fabrique reçoit un contexte {params, setTitle, close} et rend {el, onShow?, destroy?}.
// Une vue charge ses données au PREMIER onShow (les onglets restaurés au démarrage ne coûtent rien tant qu'on ne les ouvre pas).
import { h, icon, clear, contextMenu } from './lib.js';
import { state, emit } from './state.js';

const views = {};
export const tabs = new Map();
let activeKey = null;
let bar, content;

const ICON = { server: 'server', db: 'db', table: 'table', query: 'sql', schema: 'schema' };

export function mountTabs(barEl, contentEl) { bar = barEl; content = contentEl; }
export function registerView(kind, factory) { views[kind] = factory; }
export const activeTab = () => tabs.get(activeKey);

export function keyOf(kind, p) {
  return kind === 'query' ? 'query|' + p.id : [kind, p.server, p.db || '', p.table || ''].join('|');
}

function create(kind, params) {
  params = { server: state.server, ...params };
  if (kind === 'query' && !params.id) params.id = 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const key = keyOf(kind, params);
  if (tabs.has(key)) return tabs.get(key);

  const tab = { key, kind, params, title: params.table || params.db || 'Serveur', icon: ICON[kind], view: null, el: h('div', { class: 'tabview hidden' }) };
  const ctx = {
    key, kind, params,
    setTitle(title, ic) { tab.title = title; if (ic) tab.icon = ic; renderBar(); },
    close: () => closeTab(key),
  };
  tabs.set(key, tab);
  content.append(tab.el);
  try {
    tab.view = views[kind](ctx);
    tab.el.append(tab.view.el);
  } catch (e) {
    console.error(e);
    tab.el.append(h('div', { class: 'msg err' }, "Erreur d'ouverture de l'onglet : " + e.message));
  }
  return tab;
}

/** openTab('table', {server, db, table}) — ouvre ou rejoint l'onglet existant. */
export function openTab(kind, params = {}) {
  const tab = create(kind, params);
  activate(tab.key);
  return tab;
}

export function activate(key) {
  const tab = tabs.get(key);
  if (!tab) return;
  for (const t of tabs.values()) t.el.classList.toggle('hidden', t !== tab);
  activeKey = key;
  tab.view?.onShow?.();
  renderBar();
  persist();
  emit('active', { key, kind: tab.kind, params: tab.params });
}

export function closeTab(key) {
  const tab = tabs.get(key);
  if (!tab) return;
  const keys = [...tabs.keys()];
  const idx = keys.indexOf(key);
  tab.view?.destroy?.();
  tab.el.remove();
  tabs.delete(key);
  if (activeKey === key) {
    activeKey = null;
    const rest = [...tabs.keys()];
    if (rest.length) return activate(rest[Math.min(idx, rest.length - 1)]);
    emit('active', null);
  }
  renderBar();
  persist();
}

export function closeWhere(fn) {
  for (const t of [...tabs.values()]) if (fn(t)) closeTab(t.key);
}

/** Ferme / rafraîchit les onglets d'une base ou d'une table qui n'existe plus. */
export function reloadTabs(fn) {
  for (const t of tabs.values()) if (fn(t)) t.view?.reload?.();
}

function renderBar() {
  if (!bar) return;
  clear(bar);
  const many = state.servers.length > 1;
  for (const t of tabs.values()) {
    const tip = [t.params.db, t.params.table].filter(Boolean).join('.') || t.title;
    bar.append(h('div', {
      class: 'tab' + (t.key === activeKey ? ' active' : ''), title: tip,
      onclick: () => activate(t.key),
      onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.key); } },
      oncontextmenu: (e) => contextMenu(e, [
        { label: 'Fermer', onClick: () => closeTab(t.key) },
        { label: 'Fermer les autres', onClick: () => closeWhere((o) => o !== t) },
        { label: 'Tout fermer', onClick: () => closeWhere(() => true) },
        '-',
        { label: 'Actualiser', icon: 'refresh', onClick: () => t.view?.reload?.() },
      ]),
    },
    icon(t.icon || ICON[t.kind]),
    h('span', { class: 'tl' }, t.title),
    many && t.params.server !== state.servers[0]?.id ? h('span', { class: 'srv' }, t.params.server) : null,
    h('span', { class: 'x', onclick: (e) => { e.stopPropagation(); closeTab(t.key); } }, icon('close', 12))));
  }
}

// ── Persistance : on retrouve ses onglets après un rechargement ─────────────
function persist() {
  try {
    localStorage.setItem('dba.tabs', JSON.stringify({
      tabs: [...tabs.values()].map((t) => ({ kind: t.kind, params: t.params })),
      active: activeKey,
    }));
  } catch { /* stockage indisponible */ }
}

export function restoreTabs() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('dba.tabs') || 'null'); } catch { saved = null; }
  if (!saved?.tabs?.length) return false;
  const known = new Set(state.servers.map((s) => s.id));
  for (const t of saved.tabs) if (views[t.kind] && known.has(t.params.server)) create(t.kind, t.params);
  const key = tabs.has(saved.active) ? saved.active : [...tabs.keys()].pop();
  if (key) activate(key); else renderBar();
  return tabs.size > 0;
}
