// Barre latérale : bases → tables du serveur courant. Filtre global (cherche dans TOUTES les tables).
import { h, icon, clear, contextMenu, fmtBytes, fmtNum, debounce } from './lib.js';
import { state, loadDbs, loadTables, on } from './state.js';
import { openTab } from './tabs.js';
import { dbMenu, tableMenu, openTable } from './menus.js';
import { dlgCreateDb } from './dialogs.js';
import { toast } from './lib.js';

export function createTree() {
  const filterInput = h('input', { type: 'search', placeholder: 'Filtrer bases et tables…' });
  const list = h('div', { class: 'tree' });
  const el = h('aside', { class: 'sidebar' },
    h('div', { class: 'side-head' }, filterInput,
      h('button', { class: 'btn icon', title: 'Nouvelle base de données', onclick: () => dlgCreateDb(state.server) }, icon('plus')),
      h('button', { class: 'btn icon', title: 'Actualiser', onclick: () => refresh(true) }, icon('refresh'))),
    list);

  let filter = '';
  let current = null;                       // {server, db, table} de l'onglet actif
  let expanded = new Set();
  const key = () => 'dba.expanded.' + state.server;
  const loadExpanded = () => { try { expanded = new Set(JSON.parse(localStorage.getItem(key()) || '[]')); } catch { expanded = new Set(); } };
  const saveExpanded = () => { try { localStorage.setItem(key(), JSON.stringify([...expanded])); } catch { /* ignoré */ } };

  const mark = (text) => {
    if (!filter) return text;
    const i = text.toLowerCase().indexOf(filter);
    return i < 0 ? text : [text.slice(0, i), h('mark', null, text.slice(i, i + filter.length)), text.slice(i + filter.length)];
  };

  function render() {
    clear(list);
    const dbs = [...state.dbs].sort((a, b) => Number(a.system) - Number(b.system) || a.name.localeCompare(b.name));
    let shown = 0;
    for (const d of dbs) {
      const tables = state.tables[d.name];
      const dbHit = !filter || d.name.toLowerCase().includes(filter);
      const hits = tables ? (dbHit ? tables : tables.filter((t) => t.name.toLowerCase().includes(filter))) : null;
      if (filter && !dbHit && !(hits && hits.length)) continue;
      shown++;
      const open = expanded.has(d.name) || (filter && !dbHit && hits?.length > 0);
      const isCur = current && current.db === d.name && !current.table;
      list.append(h('div', {
        class: 'node db' + (open ? ' open' : '') + (d.system ? ' sys' : '') + (isCur ? ' active' : ''),
        title: `${d.name} — ${fmtNum(d.tables)} table(s), ${fmtBytes(d.size)}`,
        onclick: () => { toggle(d.name, true); openTab('db', { server: state.server, db: d.name }); },
        oncontextmenu: (e) => contextMenu(e, dbMenu(state.server, d.name, d.system)),
      },
      h('span', { class: 'chev', onclick: (e) => { e.stopPropagation(); toggle(d.name); } }, icon('chev', 12)),
      icon('db'), h('span', { class: 'nm' }, mark(d.name)), h('span', { class: 'meta' }, fmtBytes(d.size))));
      if (!open) continue;
      if (!tables) { list.append(h('div', { class: 'empty' }, 'Chargement…')); continue; }
      if (!hits.length) { list.append(h('div', { class: 'empty' }, 'Aucune table')); continue; }
      for (const t of hits) {
        const act = current && current.db === d.name && current.table === t.name;
        list.append(h('div', {
          class: 'node tbl' + (t.view ? ' view' : '') + (act ? ' active' : ''),
          title: t.view ? 'Vue' : `${t.engine} · ~${fmtNum(t.rows)} lignes · ${fmtBytes(t.data + t.index)}`,
          onclick: () => openTable(state.server, d.name, t.name, 'data'),
          oncontextmenu: (e) => contextMenu(e, tableMenu(state.server, d.name, t)),
        }, icon(t.view ? 'view' : 'table'), h('span', { class: 'nm' }, mark(t.name)),
        t.view ? null : h('span', { class: 'meta' }, t.rows == null ? '' : fmtNum(t.rows))));
      }
    }
    if (!shown) list.append(h('div', { class: 'empty', style: { paddingLeft: '14px' } }, filter ? 'Aucun résultat.' : 'Aucune base.'));
  }

  async function toggle(db, forceOpen = false) {
    if (expanded.has(db) && !forceOpen) expanded.delete(db); else expanded.add(db);
    saveExpanded(); render();
    if (expanded.has(db) && !state.tables[db]) { try { await loadTables(db); } catch (e) { toast(e.message, 'error'); } render(); }
  }

  async function refresh(all = false) {
    try {
      await loadDbs();
      const loaded = Object.keys(state.tables).filter((d) => state.dbs.some((x) => x.name === d));
      const stale = {}; for (const d of loaded) stale[d] = state.tables[d];
      state.tables = all ? {} : stale;
      render();
      await Promise.all([...expanded].filter((d) => state.dbs.some((x) => x.name === d)).map((d) => loadTables(d, all).catch(() => {})));
      render();
    } catch (e) { clear(list); list.append(h('div', { class: 'empty', style: { paddingLeft: '14px', color: 'var(--danger)' } }, e.message)); }
  }

  filterInput.addEventListener('input', debounce(async () => {
    filter = filterInput.value.trim().toLowerCase();
    render();
    if (filter.length >= 2) {            // on cherche aussi dans les bases pas encore dépliées
      const todo = state.dbs.filter((d) => !state.tables[d.name]);
      if (todo.length) { await Promise.all(todo.map((d) => loadTables(d.name).catch(() => {}))); render(); }
    }
  }, 200));

  const reRender = debounce(render, 30);
  on('tables', reRender);
  on('dbs', reRender);
  on('active', (a) => { current = a && (a.kind === 'table' || a.kind === 'db') ? a.params : null; reRender(); });
  on('schema', ({ server, db }) => {
    if (server !== state.server) return;
    loadDbs().then(() => db && state.dbs.some((d) => d.name === db) ? loadTables(db, true) : null).catch(() => {});
    if (db) delete state.tables[db];
  });

  return { el, refresh, render, reset() { loadExpanded(); filterInput.value = ''; filter = ''; } };
}
