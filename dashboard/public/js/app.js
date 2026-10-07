// docker-server — application : coquille, navigation, rafraîchissement continu.
import { h, icon, get, store, onRefresh, replace } from './lib.js';
import { createTray } from './components/jobs.js';
import * as projectsView from './views/projects.js';
import * as projectView from './views/project.js';
import * as databasesView from './views/databases.js';
import * as ftpView from './views/ftp.js';
import * as settingsView from './views/settings.js';

const ROUTES = [
  { re: /^\/?$/, view: projectsView, nav: 'projects' },
  { re: /^\/projects\/([^/]+)(?:\/([^/]+))?$/, view: projectView, nav: 'projects', params: ['slug', 'tab'] },
  { re: /^\/databases\/?$/, view: databasesView, nav: 'databases' },
  { re: /^\/ftp\/?$/, view: ftpView, nav: 'ftp' },
  { re: /^\/settings\/?$/, view: settingsView, nav: 'settings' },
];

// ── Thème ────────────────────────────────────────────────────────────────

function savedTheme() {
  try { return localStorage.getItem('ds.theme'); } catch { return null; }
}
function applyTheme(t) {
  const theme = t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  return theme;
}
applyTheme(savedTheme());

// ── Coquille ─────────────────────────────────────────────────────────────

const navCounts = {};
function navLink(id, href, ico, label) {
  navCounts[id] = h('span.nav-count');
  return h('a.nav-link', { href, dataset: { nav: id } }, icon(ico, 18), h('span.nav-label', label), navCounts[id]);
}

function extLink(href, ico, label) {
  return h('a.nav-link.nav-ext', { href, target: '_blank', rel: 'noopener' }, icon(ico, 18), h('span.nav-label', label), icon('external', 13, 'nav-ext-ico'));
}

const dbadminLink = extLink('http://dbadmin.localhost', 'table', 'DB Admin');
const mailpitLink = extLink('http://mailpit.localhost', 'mail', 'Mails');
const health = h('div.health');
const themeBtn = h('button.btn.btn-ghost.btn-icon', {
  type: 'button',
  title: 'Thème clair / sombre',
  'aria-label': 'Changer de thème',
  onclick: () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('ds.theme', next); } catch { /* ignoré */ }
    applyTheme(next);
    paintThemeBtn();
  },
});
function paintThemeBtn() {
  replace(themeBtn, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 17));
}
paintThemeBtn();

const sidebar = h('aside.sidebar',
  h('a.brand', { href: '#/' },
    h('span.brand-logo', icon('layers', 20)),
    h('span.brand-text', h('strong', 'docker-server'), h('span', 'serveur local'))),
  h('nav.nav',
    navLink('projects', '#/', 'folder', 'Projets'),
    navLink('databases', '#/databases', 'database', 'Bases de données'),
    navLink('ftp', '#/ftp', 'ftp', 'FTP'),
    h('div.nav-section', 'Outils'),
    dbadminLink,
    mailpitLink,
    h('div.nav-spacer'),
    navLink('settings', '#/settings', 'settings', 'Réglages')),
  h('div.sidebar-foot', health, themeBtn));

const viewRoot = h('main.main', { id: 'main', tabindex: '-1' });
const bootBanner = h('div.boot-banner', { hidden: true });
const offline = h('div.offline', { hidden: true }, icon('alert', 16), 'Connexion au tableau de bord perdue — nouvelle tentative…');
document.getElementById('app').replaceWith(h('div.shell', sidebar, h('div.main-wrap', offline, bootBanner, viewRoot)));
const tray = createTray();

// ── Navigation ───────────────────────────────────────────────────────────

let current = null;
let currentKey = '';

function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries((r.params || []).map((k, i) => [k, m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined]));
    // Même vue, autre paramètre (ex. changement d'onglet) : on laisse la vue gérer.
    const key = `${r.nav}:${r.view === projectView ? params.slug : ''}`;
    if (current && key === currentKey && current.navigate) {
      current.navigate(params);
    } else {
      current?.destroy?.();
      replace(viewRoot);
      currentKey = key;
      current = r.view.mount(viewRoot, params) || {};
      if (store.overview) current.update?.(store.overview);
      window.scrollTo(0, 0);
    }
    sidebar.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === r.nav));
    return;
  }
  location.hash = '#/';
}

// ── Rafraîchissement ─────────────────────────────────────────────────────

let timer = null;
let inflight = null;

function paintChrome(ov) {
  navCounts.projects.textContent = ov.projects.length || '';
  navCounts.databases.textContent = ov.mysql.length || '';
  navCounts.ftp.textContent = ov.ftp.accounts || '';
  dbadminLink.href = ov.config.dbadminUrl;
  mailpitLink.href = ov.config.mailpitUrl;

  const down = ov.services.filter((s) => s.status !== 'running');
  const failing = ov.projects.filter((p) => p.error && p.status !== 'running' && p.status !== 'working');
  if (down.length) {
    replace(health, h('span.health-dot.warn'), h('span', `${down.map((s) => s.label).join(', ')} arrêté${down.length > 1 ? 's' : ''}`));
  } else if (failing.length) {
    replace(health, h('span.health-dot.warn'), h('span', `${failing.length} projet${failing.length > 1 ? 's' : ''} en erreur`));
  } else {
    replace(health, h('span.health-dot'), h('span', 'Tout fonctionne'));
  }

  if (!ov.boot.ready) {
    bootBanner.hidden = false;
    replace(bootBanner, icon('loader', 16, 'spin'), ov.boot.error || 'Démarrage de docker-server : préparation des services…');
  } else {
    bootBanner.hidden = true;
  }
}

async function poll() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const ov = await get('/api/overview');
      offline.hidden = true;
      store.set(ov);
      paintChrome(ov);
      current?.update?.(ov);
      tray.update(ov.jobs);
    } catch {
      offline.hidden = false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => { await poll(); schedule(); }, document.hidden ? 15000 : 2500);
}

onRefresh(async () => { await poll(); schedule(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); schedule(); } });

// ── Démarrage ────────────────────────────────────────────────────────────

(async function start() {
  for (;;) {
    try {
      store.catalog = await get('/api/catalog');
      break;
    } catch {
      offline.hidden = false;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await poll();
  window.addEventListener('hashchange', route);
  route();
  schedule();
}());
