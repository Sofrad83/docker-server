// Onglet « serveur » : liste des bases, et processus en cours (avec KILL).
import { h, btn, icon, toast, contextMenu, clear, fmtNum, fmtBytes, confirmBox } from './lib.js';
import { api } from './api.js';
import { state, on, loadDbs } from './state.js';
import { registerView, openTab } from './tabs.js';
import { dbMenu, newQuery } from './menus.js';
import * as D from './dialogs.js';

registerView('server', (ctx) => {
  const { server } = ctx.params;
  const srv = () => state.servers.find((s) => s.id === server);
  let sub = 'dbs', loaded = false, stale = false, timer = null, dbs = [];
  let sort = { col: 'name', dir: 'asc' };

  ctx.setTitle(srv()?.label || 'Serveur', 'server');
  const head = h('div', { class: 'view-head' }, h('h2', null, icon('server'), srv()?.label || server), h('span', { class: 'hint', id: 'ver' }, srv()?.version ? 'MySQL ' + srv().version : ''),
    h('span', { class: 'spacer' }),
    btn('Nouvelle base', 'sm', () => D.dlgCreateDb(server), 'plus'),
    btn('Importer un fichier SQL', 'sm', () => D.dlgImport({ server }), 'upload'),
    btn('Nouvelle requête', 'sm', () => newQuery(server, ''), 'sql'),
    h('button', { class: 'btn sm icon', title: 'Actualiser', onclick: () => reload() }, icon('refresh')));
  const subtabs = h('div', { class: 'subtabs' });
  const pane = h('div', { class: 'pane' });
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, head, subtabs, pane);

  function drawSubs() {
    clear(subtabs);
    [['dbs', 'Bases de données'], ['proc', 'Processus']].forEach(([k, l]) => subtabs.append(h('div', { class: 'subtab' + (sub === k ? ' active' : ''), onclick: () => { sub = k; drawSubs(); reload(); } }, l)));
  }

  function drawDbs() {
    clear(pane);
    const k = sort.col, d = sort.dir === 'desc' ? -1 : 1;
    const list = [...dbs].sort((a, b) => ((typeof a[k] === 'number' ? a[k] - b[k] : String(a[k]).localeCompare(String(b[k]))) * d));
    const COLS = [['name', 'Base'], ['tables', 'Tables', true], ['size', 'Taille', true], ['charset', 'Jeu de caractères'], ['collation', 'Interclassement']];
    pane.append(h('table', { class: 'list' },
      h('thead', null, h('tr', null, COLS.map(([c, l, r]) => h('th', { class: 'sortable' + (r ? ' r' : ''), onclick: () => { sort = { col: c, dir: sort.col === c && sort.dir === 'asc' ? 'desc' : 'asc' }; drawDbs(); } }, l, sort.col === c ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')))),
      h('tbody', null, list.map((x) => h('tr', { class: 'dblclk', ondblclick: () => openTab('db', { server, db: x.name }), oncontextmenu: (e) => contextMenu(e, dbMenu(server, x.name, x.system)) },
        h('td', null, h('span', { class: 'ico' }, icon('db')), h('b', { style: x.system ? { color: 'var(--muted)', fontStyle: 'italic' } : null }, x.name)),
        h('td', { class: 'r' }, fmtNum(x.tables)), h('td', { class: 'r' }, fmtBytes(x.size)), h('td', { class: 'muted' }, x.charset), h('td', { class: 'muted' }, x.collation))))));
  }

  async function drawProc() {
    try {
      const r = await api('processlist', { s: server });
      clear(pane);
      pane.append(h('div', { class: 'toolbar' }, h('span', { class: 'muted' }, `${r.rows.length} processus · actualisation automatique toutes les 3 s`)),
        h('table', { class: 'list' }, h('thead', null, h('tr', null, ['Id', 'Utilisateur', 'Hôte', 'Base', 'Commande', 'Durée (s)', 'État', 'Requête', ''].map((x) => h('th', null, x)))),
          h('tbody', null, r.rows.map((p) => h('tr', null, h('td', null, p.Id), h('td', null, p.User), h('td', { class: 'muted' }, p.Host), h('td', null, p.db || ''), h('td', null, p.Command),
            h('td', null, p.Time), h('td', { class: 'muted' }, p.State || ''), h('td', { class: 'mono cmt', style: { maxWidth: '420px' }, title: p.Info || '' }, p.Info || ''),
            h('td', null, btn('', 'sm ghost icon', async () => {
              if (!(await confirmBox({ title: 'Interrompre', message: `Terminer le processus ${p.Id} ?`, danger: true, confirmLabel: 'KILL' }))) return;
              try { await api('sql', { s: server, sql: `KILL ${+p.Id}` }); toast('Processus interrompu', 'ok'); drawProc(); } catch (e) { toast(e.message, 'error'); }
            }, 'close')))))));
    } catch (e) { clear(pane); pane.append(h('div', { class: 'msg err' }, e.message)); }
  }

  async function reload() {
    stale = false; clearInterval(timer); timer = null;
    try {
      if (sub === 'dbs') { dbs = (await api('dbs', { s: server })).dbs; loaded = true; drawDbs(); }
      else { await drawProc(); timer = setInterval(() => { if (!el.parentNode?.classList.contains('hidden') && sub === 'proc') drawProc(); }, 3000); }
    } catch (e) { clear(pane); pane.append(h('div', { class: 'msg err' }, e.message)); }
  }

  on('schema', ({ server: s }) => { if (s !== server || !loaded) return; el.parentNode?.classList.contains('hidden') ? (stale = true) : reload(); });
  drawSubs();
  return { el, reload, onShow() { if (!loaded || stale) reload(); }, destroy() { clearInterval(timer); } };
});
