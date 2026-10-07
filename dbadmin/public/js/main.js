// Point d'entrée : barre du haut, arbre, onglets, raccourcis, thème. Les vues se branchent via registerView().
import { h, icon, btn, modal, toast, clear } from './lib.js';
import { api } from './api.js';
import { state, loadServers, loadDbs, setServer, ping, on } from './state.js';
import { mountTabs, openTab, restoreTabs, closeTab, activeTab, tabs } from './tabs.js';
import { createTree } from './tree.js';
import './v-server.js';
import './v-db.js';
import './v-table.js';
import './v-query.js';
import './v-schema.js';

const app = document.getElementById('app');

function help() {
  const row = (k, t) => h('tr', null, h('td', { style: { whiteSpace: 'nowrap', paddingRight: '16px' } }, h('code', null, k)), h('td', null, t));
  const m = modal({
    title: 'Aide & raccourcis', size: 'wide',
    body: h('div', null,
      h('table', { class: 'list' }, h('tbody', null,
        row('Ctrl + Entrée', 'Console : exécuter tout (ou la sélection)'), row('Ctrl + Maj + Entrée', 'Console : exécuter l\'instruction sous le curseur'),
        row('Alt + N', 'Nouvelle requête'), row('Alt + W', 'Fermer l\'onglet'), row('F5', 'Actualiser la table ouverte'),
        row('Double-clic', 'Modifier une cellule · Tab passe à la suivante · Échap annule'), row('Clic droit', 'Menu contextuel (cellule, ligne, table, base)'))),
      h('h3', { style: { margin: '18px 0 6px', fontSize: '13px' } }, 'Filtres des colonnes (ligne sous l\'en-tête)'),
      h('p', { class: 'hint', style: { margin: 0 } }, 'texte = contient · =x égal · !=x différent · >5  <5  >=5  <=5 · ~expr régulière · NULL · !NULL'),
      h('h3', { style: { margin: '18px 0 6px', fontSize: '13px' } }, 'Personnaliser'),
      h('p', { class: 'hint', style: { margin: 0, lineHeight: 1.6 } }, 'Les sources sont dans dbadmin\\ : modifiez un fichier, rafraîchissez la page. ',
        'public\\custom.css (apparence) · public\\custom.js (comportement) · config.php (serveurs, limites) · src\\Actions.php (API : une méthode a_xxx par action).')),
  });
  m.setFoot([btn('Fermer', 'primary', () => m.close())]);
}

async function boot() {
  try {
    await loadServers();
  } catch (e) {
    app.innerHTML = '';
    app.append(h('div', { class: 'boot' }, 'Impossible de joindre le backend : ' + e.message));
    return;
  }
  // Serveur de départ : le dernier utilisé, sinon celui de config.php, sinon le premier qui répond.
  // On ne sonde que le nécessaire (un serveur arrêté coûte plusieurs secondes) ; les autres le sont en arrière-plan.
  // Lien direct depuis le tableau de bord : ?server=mysql&db=blog
  const wanted = new URLSearchParams(location.search);
  let saved = null; try { saved = localStorage.getItem('dba.server'); } catch { /* ignoré */ }
  const order = [...new Set([wanted.get('server'), saved, state.defaultServer, ...state.servers.map((s) => s.id)])].filter((id) => state.servers.some((s) => s.id === id));
  let first = null;
  for (const id of order) { const s = await ping(id); if (s.up) { first = s; break; } }
  first ??= state.servers.find((s) => s.id === order[0]);
  setServer(first.id);

  // ── Barre du haut ──
  const dot = h('span', { class: 'dot' });
  const serverSel = h('select', { title: 'Serveur MySQL' });
  const version = h('span', { class: 'pill' });
  const paintServer = () => {
    const s = state.servers.find((x) => x.id === state.server);
    dot.className = 'dot ' + (s?.up === undefined ? '' : s.up ? 'up' : 'down');
    clear(version); version.append(s?.up ? 'v' + s.version : s?.up === false ? 'injoignable' : '…');
    version.title = s?.error || '';
    clear(serverSel);
    state.servers.forEach((x) => serverSel.append(h('option', { value: x.id }, x.label + (x.up === false ? ' — arrêté' : ''))));
    serverSel.value = state.server;
  };
  on('servers', paintServer);
  state.servers.filter((s) => s.up === undefined).forEach((s) => ping(s.id).catch(() => {}));   // les autres, sans bloquer
  const themeBtn = h('button', { class: 'btn icon ghost', title: 'Thème clair / sombre', onclick: () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t; try { localStorage.setItem('dba.theme', t); } catch { /* ignoré */ }
  } }, icon('theme'));
  const top = h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, icon('db'), 'DB Admin'), dot, serverSel, version,
    h('button', { class: 'btn ghost', title: 'Vue d\'ensemble du serveur', onclick: () => openTab('server', { server: state.server }) }, icon('server'), 'Serveur'),
    h('span', { class: 'spacer' }),
    btn('Nouvelle requête', 'primary', () => openTab('query', { server: state.server }), 'sql'),
    btn('Importer', '', () => import('./dialogs.js').then((d) => d.dlgImport({ server: state.server })), 'upload'),
    themeBtn, h('button', { class: 'btn icon ghost', title: 'Aide & raccourcis', onclick: help }, '?'));

  // ── Arbre, séparateur, onglets ──
  const tree = createTree();
  const splitter = h('div', { class: 'splitter' });
  const tabbar = h('div', { class: 'tabbar' });
  const content = h('div', { class: 'tabs-content' });
  const main = h('main', { class: 'main' }, tabbar, content);
  clear(app); app.append(top, tree.el, splitter, main);
  mountTabs(tabbar, content);

  const w = +localStorage.getItem('dba.sidebar') || 0;
  if (w) document.documentElement.style.setProperty('--sidebar-w', w + 'px');
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault(); splitter.classList.add('drag');
    const move = (ev) => { const nw = Math.min(600, Math.max(180, ev.clientX)); document.documentElement.style.setProperty('--sidebar-w', nw + 'px'); try { localStorage.setItem('dba.sidebar', nw); } catch { /* ignoré */ } };
    const up = () => { splitter.classList.remove('drag'); removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });

  async function switchServer(id) {
    const wasKnownDown = state.servers.find((x) => x.id === id)?.up === false;
    if (wasKnownDown) toast('Connexion en cours…', 'info', 4500);      // un container arrêté met quelques secondes à répondre « introuvable »
    await ping(id).catch(() => {});
    setServer(id); paintServer(); tree.reset();
    const s = state.servers.find((x) => x.id === id);
    if (!s?.up) { toast(`Serveur « ${s?.label} » injoignable : ${s?.error || ''}`, 'error'); tree.render(); return; }
    await tree.refresh();
    openTab('server', { server: id });
  }
  serverSel.addEventListener('change', () => switchServer(serverSel.value));

  // ── Raccourcis ──
  addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); openTab('query', { server: state.server }); }
    if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'w') { e.preventDefault(); const t = activeTab(); if (t) closeTab(t.key); }
  });

  paintServer(); tree.reset();
  if (state.servers.find((s) => s.id === state.server)?.up) await tree.refresh();
  else toast('MySQL est injoignable. Démarrez-le depuis le tableau de bord (http://localhost) puis rechargez la page.', 'error', 10000);
  const restored = restoreTabs();
  if (wanted.get('db') && wanted.get('server') === state.server) {
    openTab('db', { server: state.server, db: wanted.get('db') });
    history.replaceState(null, '', location.pathname);
  } else if (!restored) openTab('server', { server: state.server });

  // ── Personnalisation : window.DBA + custom.js ──
  window.DBA = { api, state, openTab, closeTab, tabs, toast, h, icon, btn, modal, on };
  import(new URL('../custom.js', import.meta.url).href).catch((e) => console.warn('custom.js :', e));
}

boot();
