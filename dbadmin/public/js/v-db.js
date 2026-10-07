// Onglet « base de données » : liste des tables (tri, filtre, sélection multiple, actions groupées).
import { h, btn, icon, toast, contextMenu, clear, fmtNum, fmtBytes, fmtDate } from './lib.js';
import { api } from './api.js';
import { state, on } from './state.js';
import { registerView, openTab } from './tabs.js';
import { tableMenu, dbMenu, openTable, newQuery } from './menus.js';
import * as D from './dialogs.js';
import * as F from './forms.js';

registerView('db', (ctx) => {
  const { server, db } = ctx.params;
  let tables = [], loaded = false, stale = false, filter = '';
  let sort = { col: 'name', dir: 'asc' };
  const selected = new Set();

  ctx.setTitle(db, 'db');
  const meta = h('span', { class: 'hint' });
  const head = h('div', { class: 'view-head' }, h('h2', null, icon('db'), db), meta, h('span', { class: 'spacer' }),
    btn('Nouvelle table', 'sm', () => F.dlgCreateTable(server, db), 'plus'),
    btn('Requête SQL', 'sm', () => newQuery(server, db), 'sql'),
    btn('Schéma', 'sm', () => openTab('schema', { server, db }), 'schema'),
    btn('Importer', 'sm', () => D.dlgImport({ server, db }), 'upload'),
    btn('Exporter', 'sm', () => D.dlgExport({ server, db }), 'download'),
    btn('Dupliquer', 'sm', () => D.dlgCopyDb(server, db), 'copy'),
    h('button', { class: 'btn sm icon', title: 'Actualiser', onclick: () => reload() }, icon('refresh')),
    h('button', { class: 'btn sm icon', title: 'Autres actions', onclick: (e) => contextMenu(e, dbMenu(server, db, state.dbs.find((d) => d.name === db)?.system)) }, icon('more')));

  const filterInput = h('input', { type: 'search', placeholder: 'Filtrer les tables…', style: { width: '240px' } });
  filterInput.addEventListener('input', () => { filter = filterInput.value.trim().toLowerCase(); draw(); });
  const bulk = h('div', { class: 'hidden', style: { display: 'flex', gap: '6px', alignItems: 'center' } });
  const toolbar = h('div', { class: 'toolbar' }, filterInput, h('span', { class: 'spacer' }), bulk);
  const pane = h('div', { class: 'pane' });
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, head, toolbar, pane);

  const COLS = [
    ['name', 'Nom'], ['rows', 'Lignes', true], ['data', 'Données', true], ['index', 'Index', true], ['total', 'Total', true],
    ['engine', 'Moteur'], ['collation', 'Interclassement'], ['updated', 'Modifiée'], ['comment', 'Commentaire'],
  ];
  const val = (t, c) => (c === 'total' ? t.data + t.index : t[c]);

  function visible() {
    const list = tables.filter((t) => !filter || t.name.toLowerCase().includes(filter));
    const k = sort.col, d = sort.dir === 'desc' ? -1 : 1;
    return list.sort((a, b) => {
      const x = val(a, k), y = val(b, k);
      return (x == null ? -1 : y == null ? 1 : typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true })) * d;
    });
  }

  function drawBulk() {
    clear(bulk);
    bulk.classList.toggle('hidden', !selected.size);
    if (!selected.size) return;
    const names = [...selected]; const items = names.map((n) => tables.find((t) => t.name === n)).filter(Boolean);
    const baseOnly = names.filter((n) => !tables.find((t) => t.name === n)?.view);
    bulk.append(h('span', { class: 'muted' }, `${names.length} sélectionnée(s)`),
      btn('Exporter', 'sm', () => D.dlgExport({ server, db, tables: names }), 'download'),
      btn('Optimiser', 'sm', () => D.dlgMaintenance(server, db, baseOnly, 'OPTIMIZE')),
      btn('Vider', 'sm danger', () => D.dlgTruncate(server, db, baseOnly), 'trash'),
      btn('Supprimer', 'sm danger', () => D.dlgDropTables(server, db, items), 'trash'));
  }

  function draw() {
    clear(pane);
    const list = visible();
    const allSel = list.length > 0 && list.every((t) => selected.has(t.name));
    const all = h('input', { type: 'checkbox', checked: allSel, onchange: (e) => { list.forEach((t) => (e.target.checked ? selected.add(t.name) : selected.delete(t.name))); draw(); } });
    pane.append(h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', { style: { width: '28px' } }, all),
        COLS.map(([c, l, r]) => h('th', { class: 'sortable' + (r ? ' r' : ''), onclick: () => { sort = { col: c, dir: sort.col === c && sort.dir === 'asc' ? 'desc' : 'asc' }; draw(); } },
          l, sort.col === c ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')))),
      h('tbody', null, list.map((t) => h('tr', {
        class: 'dblclk' + (selected.has(t.name) ? ' sel' : ''),
        ondblclick: () => openTable(server, db, t.name, 'data'),
        oncontextmenu: (e) => contextMenu(e, tableMenu(server, db, t)),
      },
      h('td', null, h('input', { type: 'checkbox', checked: selected.has(t.name), onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? selected.add(t.name) : selected.delete(t.name); draw(); } })),
      h('td', null, h('span', { class: 'ico' }, icon(t.view ? 'view' : 'table')), h('b', null, t.name), t.view ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, 'vue') : null),
      h('td', { class: 'r' }, t.view ? '' : '~' + fmtNum(t.rows)), h('td', { class: 'r' }, t.view ? '' : fmtBytes(t.data)), h('td', { class: 'r' }, t.view ? '' : fmtBytes(t.index)),
      h('td', { class: 'r' }, t.view ? '' : fmtBytes(t.data + t.index)), h('td', { class: 'muted' }, t.engine || ''), h('td', { class: 'muted' }, t.collation || ''),
      h('td', { class: 'muted' }, fmtDate(t.updated || t.created)), h('td', { class: 'cmt', title: t.comment }, t.comment))))));
    if (!list.length) pane.append(h('div', { class: 'empty-state', style: { height: '200px' } }, h('div', null, filter ? 'Aucune table ne correspond.' : 'Cette base est vide.', h('div', { style: { marginTop: '10px' } }, filter ? null : btn('Créer une table', 'primary', () => F.dlgCreateTable(server, db), 'plus')))));
    drawBulk();
  }

  async function reload() {
    stale = false;
    try {
      tables = (await api('tables', { s: server, db })).tables;
      selected.forEach((n) => { if (!tables.some((t) => t.name === n)) selected.delete(n); });
      const info = state.dbs.find((d) => d.name === db);
      meta.textContent = `${fmtNum(tables.length)} table(s) · ${fmtBytes(tables.reduce((a, t) => a + t.data + t.index, 0))}` + (info ? ` · ${info.collation}` : '');
      loaded = true; draw();
    } catch (e) {
      clear(pane); pane.append(h('div', { class: 'empty-state' }, h('div', null, icon('db'), h('div', null, e.message), h('div', { style: { marginTop: '12px' } }, btn('Fermer l\'onglet', '', () => ctx.close())))));
    }
  }

  on('schema', ({ server: s, db: d }) => {
    if (s !== server || (d && d !== db) || !loaded) return;
    el.parentNode?.classList.contains('hidden') ? (stale = true) : reload();
  });

  return { el, reload, onShow() { if (!loaded || stale) reload(); } };
});
