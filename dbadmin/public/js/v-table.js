// Onglet « table » : Données (édition en place) · Structure (colonnes, index, clés) · SQL (CREATE TABLE).
import { h, btn, icon, modal, toast, confirmBox, contextMenu, dropdown, clear, append, copyText, saveFile, toCSV, cellText,
  fmtNum, fmtBytes, fmtMs, fmtDate, qt } from './lib.js';
import { api } from './api.js';
import { state, on } from './state.js';
import { createGrid, isNumeric } from './grid.js';
import { registerView, openTab } from './tabs.js';
import { tableMenu, newQuery } from './menus.js';
import { showValue, errBox, dlgExport } from './dialogs.js';
import * as F from './forms.js';

const OPS = { '>=': 'ge', '<=': 'le', '!=': 'ne', '<>': 'ne', '=': 'eq', '>': 'gt', '<': 'lt', '~': 'regex' };
/** « abc » → contient · « =abc » égal · « !=x » différent · « >5 » « <5 » « >=5 » « <=5 » · « ~regex » · « NULL » · « !NULL ». */
function parseFilter(text) {
  const t = text.trim();
  if (/^!?null$/i.test(t)) return { op: t.startsWith('!') ? 'notnull' : 'null' };
  const m = t.match(/^(>=|<=|!=|<>|=|>|<|~)\s*(.*)$/s);
  return m ? { op: OPS[m[1]], val: m[2] } : { op: 'contains', val: t };
}

registerView('table', (ctx) => {
  const { server, db, table } = ctx.params;
  let info = null, loaded = false, stale = false, sub = 'data';

  const el = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } });
  const title = h('h2', null, icon('table'), h('span', null, `${db}.${table}`));
  const head = h('div', { class: 'view-head' }, title, h('span', { class: 'spacer' }));
  const actionsBtn = h('button', { class: 'btn', onclick: (e) => dropdown(e.currentTarget, tableMenu(server, db, { name: table, view: !!info?.isView })) }, 'Actions', icon('down', 12));
  const reloadBtn = h('button', { class: 'btn icon', title: 'Actualiser (F5)', onclick: () => reload() }, icon('refresh'));
  head.append(reloadBtn, actionsBtn);
  const subtabs = h('div', { class: 'subtabs' });
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } });
  el.append(head, subtabs, body);

  const panels = {};
  const SUBS = [['data', 'Données'], ['structure', 'Structure'], ['sql', 'SQL (CREATE)']];
  function drawSubs() {
    clear(subtabs);
    SUBS.forEach(([k, label]) => subtabs.append(h('div', { class: 'subtab' + (sub === k ? ' active' : ''), onclick: () => setSub(k) }, label)));
  }
  function setSub(k) {
    sub = k; drawSubs();
    for (const [name, p] of Object.entries(panels)) p.el.classList.toggle('hidden', name !== k);
    if (loaded) panels[k].show?.();
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  Données
  // ═════════════════════════════════════════════════════════════════════════
  function dataPanel() {
    let page = 1, size = state.cfg.pageSize, sort = [], filters = {}, where = '', last = null, busy = false, exact = false, warnedNoKey = false;
    const grid = createGrid({
      filters: true,
      onSort(col, add) {
        const cur = sort.find((s) => s.col === col);
        const next = !cur ? 'asc' : cur.dir === 'asc' ? 'desc' : null;
        sort = add ? sort.filter((s) => s.col !== col) : [];
        if (next) sort.push({ col, dir: next });
        page = 1; load();
      },
      onFilter(col, text) { text.trim() === '' ? delete filters[col] : (filters[col] = text); page = 1; load(); },
      onSelect(sel) { dupBtn.disabled = sel.length !== 1 || ro(); delBtn.disabled = !sel.length || ro(); delBtn.lastChild.textContent = sel.length > 1 ? `Supprimer (${sel.length})` : 'Supprimer'; },
      onDblClick: (ri, ci, td) => startEdit(ri, ci, td),
      onContext: cellMenu,
    });
    const ro = () => !!info?.isView;

    const whereInput = h('input', { type: 'text', placeholder: "WHERE … (ex. id > 10 AND nom LIKE 'a%')", style: { flex: 1, minWidth: '200px', fontFamily: 'var(--mono)' } });
    whereInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { where = whereInput.value.trim(); page = 1; load(); } });
    const addBtn = btn('Ligne', 'sm', () => rowForm(null), 'plus');
    const dupBtn = btn('Dupliquer', 'sm', () => { const [ri] = grid.getSelected(); rowForm(ri); }, 'copy'); dupBtn.disabled = true;
    const delBtn = btn('Supprimer', 'sm danger', deleteRows, 'trash'); delBtn.disabled = true;
    const exportBtn = h('button', { class: 'btn sm', onclick: (e) => dropdown(e.currentTarget, [
      { label: 'Cette page en CSV', icon: 'download', onClick: () => saveFile(`${table}.csv`, toCSV(grid.cols(), grid.rows()), 'text/csv') },
      { label: 'La table en SQL…', icon: 'download', onClick: () => dlgExport({ server, db, tables: [table] }) },
    ]) }, icon('download'), 'Exporter', icon('down', 12));
    const clearBtn = btn('Effacer les filtres', 'sm ghost', () => { filters = {}; where = ''; whereInput.value = ''; grid.clearFilters(); sort = []; page = 1; load(); });
    const toolbar = h('div', { class: 'toolbar' }, addBtn, dupBtn, delBtn, h('span', { class: 'sep' }), whereInput, clearBtn, h('span', { class: 'sep' }), exportBtn);

    const errSlot = h('div');
    const sqlLine = h('div', { class: 'sql', title: '' });
    const msLabel = h('span'); const totalLabel = h('span');
    const first = btn('', 'sm ghost icon', () => go(1), 'first'), prev = btn('', 'sm ghost icon', () => go(page - 1), 'prev');
    const next = btn('', 'sm ghost icon', () => go(page + 1), 'next'), lastB = btn('', 'sm ghost icon', () => go(pages()), 'last');
    const pageInput = h('input', { type: 'number', min: 1, value: 1 });
    pageInput.addEventListener('change', () => go(+pageInput.value));
    const pagesLabel = h('span');
    const sizeSel = h('select', { class: 'select-inline' }, [25, 50, 100, 250, 500, 1000, 2500].map((n) => h('option', { value: n }, n + ' / page'))); sizeSel.value = size;
    sizeSel.addEventListener('change', () => { size = +sizeSel.value; page = 1; load(); });
    const countBtn = btn('compter', 'sm ghost', () => { exact = true; load(); });
    const foot = h('div', { class: 'gridfoot' }, sqlLine, msLabel, totalLabel, countBtn,
      h('div', { class: 'pager' }, first, prev, pageInput, pagesLabel, next, lastB), sizeSel);

    const pages = () => Math.max(1, Math.ceil((last?.total || 0) / size));
    function go(p) { page = Math.min(Math.max(1, p || 1), pages()); load(); }

    async function load() {
      if (busy) return; busy = true; clear(errSlot);
      try {
        const r = await api('rows', {
          s: server, db, table, page, size, sort, where, exact,
          filters: Object.entries(filters).map(([col, text]) => ({ col, ...parseFilter(text) })),
        });
        exact = false; last = r;
        grid.render(r.columns, r.rows, { offset: (page - 1) * size });
        grid.setSort(sort);
        sqlLine.textContent = r.sql; sqlLine.title = r.sql;
        msLabel.textContent = fmtMs(r.ms);
        totalLabel.textContent = (r.approx ? '≈ ' : '') + fmtNum(r.total) + ' ligne(s)';
        countBtn.classList.toggle('hidden', !r.approx);
        pageInput.value = page; pagesLabel.textContent = '/ ' + fmtNum(pages());
        first.disabled = prev.disabled = page <= 1; next.disabled = lastB.disabled = page >= pages();
      } catch (e) {
        errSlot.append(errBox(e.message));
      } finally { busy = false; }
    }

    // ── Identification d'une ligne (clé primaire, sinon toutes les valeurs) ──
    function keyOf(ri) {
      const row = grid.rows()[ri]; const cols = last.columns;
      const names = last.keyColumns.length ? last.keyColumns : cols.filter((c) => !c.binary).map((c) => c.name);
      if (!last.keyColumns.length && !warnedNoKey) { warnedNoKey = true; toast('Table sans clé primaire : chaque ligne est repérée par l\'ensemble de ses valeurs.', 'info', 6000); }
      const key = {};
      for (const n of names) {
        const v = row[cols.findIndex((c) => c.name === n)];
        if (v === null || typeof v === 'string') key[n] = v;
        else if (v.b !== undefined && v.b.length === v.n * 2) key[n] = { x: v.b };
        else if (last.keyColumns.length) throw new Error(`La clé « ${n} » est tronquée : modification impossible depuis la grille.`);
      }
      return key;
    }

    const editable = (ci) => !ro() && !last.columns[ci].generated && !last.columns[ci].binary;
    const sqlLog = (sql) => { sqlLine.textContent = sql; sqlLine.title = sql; };

    async function saveCell(ri, ci, value) {
      const old = grid.rows()[ri][ci];
      try {
        const r = await api('row.update', { s: server, db, table, key: keyOf(ri), set: { [last.columns[ci].name]: value } });
        grid.setCell(ri, ci, value); grid.flash(ri, ci); sqlLog(r.sql);
        return true;
      } catch (e) { toast(e.message, 'error'); grid.setCell(ri, ci, old); return false; }
    }

    function startEdit(ri, ci, td) {
      if (!editable(ci)) return toast(ro() ? 'Une vue est en lecture seule.' : last.columns[ci].generated ? 'Colonne générée : lecture seule.' : 'Colonne binaire : lecture seule.', 'info');
      const v = grid.rows()[ri][ci];
      if (typeof v === 'object' && v !== null || (typeof v === 'string' && (v.length > 120 || v.includes('\n')))) return textEditor(ri, ci);
      const original = v === null ? '' : v;
      const input = h('input', { type: 'text', value: original });
      td.classList.add('editing'); td.textContent = ''; td.append(input); input.focus(); input.select();
      let done = false;
      const finish = async (commit, move = 0) => {
        if (done) return; done = true;
        td.classList.remove('editing');
        grid.setCell(ri, ci, v);                                      // remet l'affichage d'origine
        if (commit && input.value !== original) await saveCell(ri, ci, input.value);
        if (move) {
          let n = ci + move; while (n >= 0 && n < last.columns.length && !editable(n)) n += move;
          if (n >= 0 && n < last.columns.length) startEdit(ri, n, grid.cell(ri, n));
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false);
        else if (e.key === 'Tab') { e.preventDefault(); finish(true, e.shiftKey ? -1 : 1); }
      });
      input.addEventListener('blur', () => finish(true));
    }

    /** Éditeur pour les textes longs, multi-lignes ou tronqués (avec case NULL). */
    async function textEditor(ri, ci) {
      const col = last.columns[ci]; let v = grid.rows()[ri][ci];
      if (v && typeof v === 'object') {
        try { const r = await api('cell', { s: server, db, table, col: col.name, key: keyOf(ri) }); v = r.value; } catch (e) { return toast(e.message, 'error'); }
      }
      const ta = h('textarea', { class: 'sqlbox', rows: 14, style: { fontFamily: 'var(--mono)', minHeight: '260px' } }); ta.value = v ?? '';
      const isNull = h('input', { type: 'checkbox', checked: v === null });
      isNull.addEventListener('change', () => { ta.disabled = isNull.checked; });
      ta.disabled = v === null;
      const m = modal({ title: `${col.name}  ·  ${col.type}`, size: 'wide', body: ta });
      m.setFoot([h('label', { class: 'chk grow' }, isNull, 'NULL'), btn('Annuler', '', () => m.close()), btn('Enregistrer', 'primary', async () => {
        const nv = isNull.checked ? null : ta.value;
        if (nv === v) return m.close();
        if (await saveCell(ri, ci, nv)) m.close();
      }, 'check')]);
    }

    function cellMenu(ev, ri, ci) {
      const sel = grid.getSelected();
      const items = [];
      if (ci >= 0) {
        const v = grid.rows()[ri][ci];
        items.push(
          { label: 'Modifier la cellule', icon: 'edit', disabled: !editable(ci), onClick: () => startEdit(ri, ci, grid.cell(ri, ci)) },
          { label: 'Mettre à NULL', disabled: !editable(ci) || !last.columns[ci].null, onClick: () => saveCell(ri, ci, null) },
          { label: 'Voir la valeur complète', onClick: async () => {
            let full = v;
            if (v && typeof v === 'object' && v.t !== undefined) { try { full = (await api('cell', { s: server, db, table, col: last.columns[ci].name, key: keyOf(ri) })).value; } catch (e) { return toast(e.message, 'error'); } }
            showValue(last.columns[ci].name, cellText(full));
          } },
          { label: 'Copier la valeur', icon: 'copy', onClick: () => copyText(cellText(v)) },
          { label: 'Filtrer sur cette valeur', icon: 'filter', onClick: () => {
            const c = last.columns[ci].name; const text = v === null ? 'NULL' : '=' + cellText(v);
            filters[c] = text; const inp = grid.el.querySelector(`input[data-col="${CSS.escape(c)}"]`); if (inp) inp.value = text; page = 1; load();
          } },
          '-');
      }
      items.push(
        { label: 'Copier la ligne', onClick: () => copyText(grid.rows()[ri].map(cellText).join('\t')) },
        { label: 'Dupliquer la ligne', icon: 'copy', disabled: ro() || sel.length !== 1, onClick: () => rowForm(ri) },
        { label: sel.length > 1 ? `Supprimer ${sel.length} lignes…` : 'Supprimer la ligne…', icon: 'trash', danger: true, disabled: ro(), onClick: deleteRows });
      contextMenu(ev, items);
    }

    async function deleteRows() {
      const sel = grid.getSelected(); if (!sel.length) return;
      let keys; try { keys = sel.map(keyOf); } catch (e) { return toast(e.message, 'error'); }
      const ok = await confirmBox({
        title: 'Supprimer', danger: true, confirmLabel: 'Supprimer',
        message: `Supprimer ${sel.length} ligne${sel.length > 1 ? 's' : ''} de ${table} ?\nCette action est définitive.` + (last.keyColumns.length ? '' : '\n\n⚠ Table sans clé primaire : les lignes identiques seront traitées une par une.'),
      });
      if (!ok) return;
      try { const r = await api('row.delete', { s: server, db, table, keys }); toast(`${r.deleted} ligne(s) supprimée(s)`, 'ok'); await load(); sqlLog(r.sql); }
      catch (e) { toast(e.message, 'error'); }
    }

    /** Formulaire d'insertion ; pré-rempli depuis la ligne `fromRi` pour une duplication. */
    function rowForm(fromRi) {
      const cols = last.columns.filter((c) => !c.generated);
      const src = fromRi == null ? null : grid.rows()[fromRi];
      const rows = cols.map((c) => {
        const ci = last.columns.indexOf(c);
        const sv = src ? src[ci] : undefined;
        const auto = /auto_increment/i.test(c.extra);
        const bin = c.binary;
        let mode = 'default';
        if (src && !auto && !bin) mode = sv === null ? 'null' : 'value';
        else if (!src && !auto && c.default == null && !c.null && !bin) mode = 'value';
        const modeSel = h('select', { disabled: bin, style: { width: '96px' } }, [['default', 'Défaut'], ['null', 'NULL'], ['value', 'Valeur']].map(([v, l]) => h('option', { value: v }, l)));
        modeSel.value = mode;
        const long = /text|blob|json/i.test(c.type);
        const input = h(long ? 'textarea' : 'input', { type: 'text', rows: 2, disabled: bin, placeholder: bin ? '(binaire : non éditable ici)' : c.default != null ? 'défaut : ' + c.default : '', style: { flex: 1, minWidth: 0, fontFamily: 'var(--mono)', height: long ? 'auto' : '' } });
        input.value = typeof sv === 'string' ? sv : sv && sv.t ? sv.t : '';
        const sync = () => { input.style.visibility = modeSel.value === 'value' ? '' : 'hidden'; };
        modeSel.addEventListener('change', () => { sync(); if (modeSel.value === 'value') input.focus(); }); sync();
        return { c, modeSel, input, row: [h('label', { title: c.type }, c.name, ' ', h('span', { class: 'hint' }, c.type.replace(/\(.*/, '')), c.key === 'PRI' ? h('span', { class: 'tag pk', style: { marginLeft: '4px' } }, 'PK') : null), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, modeSel, input)] };
      });
      const m = modal({ title: fromRi == null ? `Nouvelle ligne — ${table}` : `Dupliquer la ligne — ${table}`, size: 'wide', body: h('div', { class: 'form', style: { gridTemplateColumns: '200px 1fr' } }, rows.map((r) => r.row)) });
      const out = h('div');
      m.body.append(out);
      m.setFoot([btn('Annuler', '', () => m.close()), btn('Insérer', 'primary', async () => {
        const values = {};
        for (const r of rows) { const md = r.modeSel.value; if (md === 'null') values[r.c.name] = null; else if (md === 'value') values[r.c.name] = r.input.value; }
        clear(out);
        try { const r = await api('row.insert', { s: server, db, table, values }); toast('Ligne insérée' + (r.insertId && r.insertId !== '0' ? ` (id ${r.insertId})` : ''), 'ok'); m.close(); await load(); sqlLog(r.sql); }
        catch (e) { out.append(errBox(e.message)); }
      }, 'check')]);
    }

    const el = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, toolbar, errSlot, grid.el, foot);
    return { el, load, show() {}, hasRows: () => !!last };
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  Structure
  // ═════════════════════════════════════════════════════════════════════════
  function structurePanel() {
    const el = h('div', { class: 'pane pad' });
    const section = (titleText, addLabel, onAdd, content) => h('div', { class: 'section' }, h('h3', null, titleText, addLabel && !info.isView ? btn(addLabel, 'sm', onAdd, 'plus') : null), content);
    const act = (ic, title, fn, kind = 'sm ghost icon') => h('button', { class: 'btn ' + kind, title, onclick: fn }, icon(ic));
    const guard = (p) => p.catch((e) => toast(e.message, 'error'));

    function render() {
      clear(el);
      const i = info; const s = i.status;
      if (s) {
        el.append(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center' } },
          h('span', { class: 'pill' }, s.Engine), h('span', { class: 'pill' }, '~' + fmtNum(s.Rows) + ' lignes'), h('span', { class: 'pill' }, fmtBytes(+s.Data_length + +s.Index_length)),
          h('span', { class: 'pill' }, s.Collation || ''), s.Auto_increment ? h('span', { class: 'pill' }, 'AUTO_INCREMENT ' + s.Auto_increment) : null,
          s.Comment ? h('span', { class: 'pill', title: s.Comment }, '💬 ' + s.Comment) : null,
          h('span', { class: 'hint' }, 'créée ' + fmtDate(s.Create_time) + (s.Update_time ? ' · modifiée ' + fmtDate(s.Update_time) : '')),
          h('span', { class: 'spacer' }), btn('Propriétés…', 'sm', () => guard(F.dlgTableProps(server, db, table, s)), 'edit')));
      }
      if (i.isView) el.append(h('div', { class: 'infobox', style: { marginBottom: '14px' } }, 'Cette table est une vue : sa définition se modifie dans l\'onglet « SQL (CREATE) ».'));

      // Colonnes
      const pkSet = new Set(i.columns.filter((c) => c.key === 'PRI').map((c) => c.name));
      el.append(section('Colonnes', 'Colonne', () => guard(F.dlgColumn(server, db, table, i.columns)),
        h('table', { class: 'list' }, h('thead', null, h('tr', null, ['#', 'Nom', 'Type', 'Null', 'Défaut', 'Extra', 'Interclassement', 'Commentaire', ''].map((x) => h('th', null, x)))),
          h('tbody', null, i.columns.map((c, n) => h('tr', null,
            h('td', { class: 'muted' }, n + 1),
            h('td', null, h('b', null, c.name), ' ', pkSet.has(c.name) ? h('span', { class: 'tag pk' }, 'PK') : c.key === 'UNI' ? h('span', { class: 'tag uni' }, 'UNI') : c.key === 'MUL' ? h('span', { class: 'tag' }, 'IDX') : null),
            h('td', { class: 'mono' }, c.type), h('td', null, c.null ? 'oui' : h('span', { class: 'muted' }, 'non')),
            h('td', { class: 'mono' }, c.default === null ? h('span', { class: 'muted' }, c.null ? 'NULL' : '') : c.default),
            h('td', { class: 'muted' }, c.extra), h('td', { class: 'muted' }, c.collation || ''), h('td', { class: 'cmt', title: c.comment }, c.comment),
            h('td', { style: { whiteSpace: 'nowrap', textAlign: 'right' } }, i.isView ? null : [
              act('edit', 'Modifier', () => guard(F.dlgColumn(server, db, table, i.columns, c))),
              act('trash', 'Supprimer', () => guard(F.dlgDropColumn(server, db, table, c.name)))])))))));

      if (i.isView) return;
      // Index
      el.append(section('Index', 'Index', () => guard(F.dlgIndex(server, db, table, i.columns, i.indexes)),
        i.indexes.length ? h('table', { class: 'list' }, h('thead', null, h('tr', null, ['Nom', 'Type', 'Colonnes', 'Méthode', 'Cardinalité', ''].map((x) => h('th', null, x)))),
          h('tbody', null, i.indexes.map((x) => h('tr', null,
            h('td', null, h('b', null, x.name)), h('td', null, h('span', { class: 'tag ' + (x.type === 'PRIMARY' ? 'pk' : x.type === 'UNIQUE' ? 'uni' : '') }, x.type)),
            h('td', { class: 'mono' }, x.columns.map((c) => c.name + (c.sub ? `(${c.sub})` : '')).join(', ')),
            h('td', { class: 'muted' }, x.method), h('td', { class: 'muted' }, fmtNum(x.cardinality)),
            h('td', { style: { whiteSpace: 'nowrap', textAlign: 'right' } }, act('edit', 'Modifier', () => guard(F.dlgIndex(server, db, table, i.columns, i.indexes, x))), act('trash', 'Supprimer', () => guard(F.dlgDropIndex(server, db, table, x)))))))
        ) : h('div', { class: 'hint' }, 'Aucun index.')));

      // Clés étrangères
      const link = (d, t, label) => h('a', { href: '#', style: { color: 'var(--accent)' }, onclick: (e) => { e.preventDefault(); openTab('table', { server, db: d, table: t }); } }, label);
      const fkRow = (f) => h('tr', null,
        h('td', null, h('b', null, f.name)),
        h('td', { class: 'mono' }, f.columns.join(', ')),
        h('td', { class: 'mono' }, link(f.refDb, f.refTable, `${f.refDb}.${f.refTable}`), `(${f.refColumns.join(', ')})`),
        h('td', { class: 'muted' }, f.onDelete),
        h('td', { class: 'muted' }, f.onUpdate),
        h('td', { style: { textAlign: 'right' } }, act('trash', 'Supprimer', () => guard(F.dlgDropFk(server, db, table, f)))));
      const fkTable = i.fks.length
        ? h('table', { class: 'list' },
          h('thead', null, h('tr', null, ['Nom', 'Colonnes', 'Référence', 'ON DELETE', 'ON UPDATE', ''].map((x) => h('th', null, x)))),
          h('tbody', null, i.fks.map(fkRow)))
        : h('div', { class: 'hint' }, 'Aucune clé étrangère déclarée.');
      const refRow = (f) => h('tr', null,
        h('td', { class: 'mono' }, link(db, f.table, f.table), `(${f.columns.join(', ')})`),
        h('td', { class: 'muted' }, '→ ' + f.refColumns.join(', ')),
        h('td', { class: 'muted' }, 'ON DELETE ' + f.onDelete));
      const refTable = i.refs.length
        ? h('div', { style: { marginTop: '12px' } },
          h('div', { class: 'hint', style: { marginBottom: '4px' } }, 'Référencée par :'),
          h('table', { class: 'list' }, h('tbody', null, i.refs.map(refRow))))
        : null;
      el.append(section('Clés étrangères', 'Clé', () => guard(F.dlgFk(server, db, table, i.columns)), h('div', null, fkTable, refTable)));

      if (i.triggers.length) el.append(section('Déclencheurs', null, null, h('table', { class: 'list' }, h('tbody', null, i.triggers.map((t) =>
        h('tr', { class: 'dblclk', onclick: () => showValue(t.name, t.statement) }, h('td', null, h('b', null, t.name)), h('td', { class: 'muted' }, `${t.timing} ${t.event}`), h('td', { class: 'mono cmt' }, t.statement.replace(/\s+/g, ' '))))))));
    }
    return { el, render, show() {} };
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  SQL (CREATE TABLE)
  // ═════════════════════════════════════════════════════════════════════════
  function sqlPanel() {
    const el = h('div', { class: 'pane pad' });
    function render() {
      clear(el);
      el.append(h('div', { style: { display: 'flex', gap: '8px', marginBottom: '10px' } },
        btn('Copier', '', () => { copyText(info.create); toast('Copié', 'ok'); }, 'copy'),
        btn('Ouvrir dans la console', '', () => newQuery(server, db, info.create + ';'), 'sql')),
      h('pre', { class: 'ddl' }, info.create));
    }
    return { el, render, show() {} };
  }

  panels.data = dataPanel(); panels.structure = structurePanel(); panels.sql = sqlPanel();
  Object.values(panels).forEach((p) => body.append(p.el));

  async function loadInfo() {
    try {
      info = await api('table', { s: server, db, table });
      ctx.setTitle(`${db}.${table}`, info.isView ? 'view' : 'table');
      clear(title); append(title, icon(info.isView ? 'view' : 'table'), h('span', null, `${db}.${table}`), info.isView ? h('span', { class: 'tag' }, 'vue') : null);
      panels.structure.render(); panels.sql.render();
      return true;
    } catch (e) {
      clear(body);
      body.append(h('div', { class: 'empty-state' }, h('div', null, icon('table'), h('div', null, e.message), h('div', { style: { marginTop: '12px' } }, btn('Fermer l\'onglet', '', () => ctx.close())))));
      return false;
    }
  }

  async function reload() {
    stale = false;
    if (!(await loadInfo())) return;
    loaded = true;
    await panels.data.load();
    setSub(sub);
  }

  on('schema', ({ server: s, db: d }) => {
    if (s !== server || (d && d !== db)) return;
    if (!loaded) return;
    el.parentNode?.classList.contains('hidden') ? (stale = true) : reload();
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'F5') { e.preventDefault(); reload(); } });
  drawSubs();

  return {
    el, reload, setSub,
    onShow() { if (!loaded) reload(); else if (stale) reload(); },
  };
});
