// Grille de données (<table>) : en-têtes collants, tri, ligne de filtres, sélection, copie.
// Utilisée par l'onglet « Données » d'une table et par les résultats de la console SQL.
import { h, icon, clear, cellText, copyText, fmtNum, debounce } from './lib.js';

const NUM_RE = /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|year|bit)\b|^(tiny|short|long|longlong|int24|float|double|newdecimal|decimal|year)$/i;
/** Type SQL (« int(11) unsigned ») ou natif PDO (« LONGLONG ») → colonne numérique ? */
export const isNumeric = (type) => NUM_RE.test(String(type || ''));

/** Affiche une valeur dans une cellule : NULL, texte (lignes → ↵), tronqué {t,n}, binaire {b,n}. */
export function fillCell(td, v, numeric) {
  td.className = td.className.replace(/\b(null|num|bin)\b/g, '').trim();
  td.textContent = '';
  td.removeAttribute('title');
  if (v === null || v === undefined) { td.classList.add('null'); td.textContent = 'NULL'; return; }
  if (typeof v === 'object') {
    if (v.b !== undefined) {
      td.classList.add('bin');
      td.textContent = '0x' + v.b + (v.n > v.b.length / 2 ? '…' : '');
      td.title = fmtNum(v.n) + ' octets';
    } else {
      td.textContent = v.t.replace(/\r?\n/g, ' ↵ ');
      td.append(h('span', { class: 'more' }, ` … (${fmtNum(v.n)} o)`));
    }
    return;
  }
  if (numeric) td.classList.add('num');
  td.textContent = v.includes('\n') ? v.replace(/\r?\n/g, ' ↵ ') : v;
}

/**
 * createGrid({filters, rowNumbers, onSort(col, ajout), onFilter(col, texte), onSelect(indices),
 *             onDblClick(ri, ci, td, ev), onContext(ev, ri, ci, td)})
 * → {el, render(cols, rows, {offset}), setSort(), getSelected(), …}
 * cols = [{name, type}] ; rows = tableaux de valeurs.
 */
export function createGrid(opts = {}) {
  const wrap = h('div', { class: 'gridwrap', tabindex: 0 });
  const table = h('table', { class: 'grid' });
  const thead = h('thead'); const tbody = h('tbody');
  table.append(thead, tbody); wrap.append(table);

  let cols = [], rows = [], sort = [], offset = 0, anchor = null, focus = null;
  const selected = new Set();
  let colSig = '';
  const filterInputs = new Map();

  const numFlags = () => cols.map((c) => isNumeric(c.type));
  const tdOf = (ri, ci) => tbody.rows[ri]?.cells[ci + 1];

  function buildHead() {
    clear(thead); filterInputs.clear();
    const tr = h('tr', null, h('th', { class: 'rn', title: 'Tout sélectionner', onclick: () => { selectAll(); } }, '#'));
    cols.forEach((c) => {
      const s = sort.find((x) => x.col === c.name);
      tr.append(h('th', { class: opts.onSort ? 'sortable' : '', onclick: (e) => opts.onSort?.(c.name, e.shiftKey) },
        c.key === 'PRI' ? h('span', { class: 'tag pk', style: { marginRight: '5px' } }, 'PK') : null,
        c.name, c.type && c.type !== c.name ? h('span', { class: 'ty' }, shortType(c.type)) : null,
        s ? h('span', { class: 'srt' }, s.dir === 'desc' ? '▼' : '▲') : null));
    });
    thead.append(tr);
    if (opts.filters) {
      const fr = h('tr', { class: 'flt' }, h('th', { class: 'rn', title: 'Filtres : texte = contient ; =x  !=x  >x  <x  >=x  <=x  ~regex  NULL  !NULL' }, icon('filter')));
      cols.forEach((c) => {
        const input = h('input', { type: 'text', placeholder: '…', 'data-col': c.name });
        const fire = debounce(() => opts.onFilter?.(c.name, input.value), 450);
        input.addEventListener('input', fire);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') opts.onFilter?.(c.name, input.value); });
        filterInputs.set(c.name, input);
        fr.append(h('th', null, input));
      });
      thead.append(fr);
    }
  }

  const shortType = (t) => String(t).replace(/\s+unsigned/i, '↑').replace(/^(varchar|char)\((\d+)\)/, '$1($2)');

  function render(newCols, newRows, o = {}) {
    offset = o.offset || 0;
    const sig = JSON.stringify(newCols.map((c) => [c.name, c.type]));
    cols = newCols; rows = newRows;
    if (sig !== colSig || !thead.firstChild) { colSig = sig; buildHead(); }
    selected.clear(); anchor = focus = null;
    clear(tbody);
    const nums = numFlags();
    const frag = document.createDocumentFragment();
    rows.forEach((row, ri) => {
      const tr = h('tr', { 'data-r': ri }, h('td', { class: 'rn' }, offset + ri + 1));
      row.forEach((v, ci) => { const td = h('td'); fillCell(td, v, nums[ci]); tr.append(td); });
      frag.append(tr);
    });
    tbody.append(frag);
    wrap.scrollTop = 0;
    opts.onSelect?.([]);
  }

  function setSort(s) {
    sort = s || [];
    [...thead.rows[0]?.cells || []].forEach((th, i) => {
      if (i === 0) return;
      th.querySelector('.srt')?.remove();
      const e = sort.find((x) => x.col === cols[i - 1].name);
      if (e) th.append(h('span', { class: 'srt' }, e.dir === 'desc' ? '▼' : '▲'));
    });
  }

  function paintSelection() {
    [...tbody.rows].forEach((tr, i) => tr.classList.toggle('sel', selected.has(i)));
    opts.onSelect?.([...selected].sort((a, b) => a - b));
  }
  function selectAll() { rows.forEach((_, i) => selected.add(i)); paintSelection(); }

  function setFocus(ri, ci) {
    tbody.querySelector('td.focus')?.classList.remove('focus');
    focus = ri == null ? null : { ri, ci };
    if (focus) tdOf(ri, ci)?.classList.add('focus');
  }

  tbody.addEventListener('mousedown', (e) => {
    const td = e.target.closest('td'); if (!td || e.button === 2 && selected.size > 1) return;
    const ri = +td.parentNode.dataset.r, isRn = td.classList.contains('rn');
    if (e.shiftKey && anchor != null) {
      selected.clear();
      for (let i = Math.min(anchor, ri); i <= Math.max(anchor, ri); i++) selected.add(i);
    } else if (e.ctrlKey || e.metaKey || isRn) {
      selected.has(ri) ? selected.delete(ri) : selected.add(ri); anchor = ri;
    } else {
      selected.clear(); selected.add(ri); anchor = ri;
    }
    if (!isRn) setFocus(ri, td.cellIndex - 1);
    paintSelection();
  });
  tbody.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td'); if (!td || td.classList.contains('rn') || td.classList.contains('editing')) return;
    opts.onDblClick?.(+td.parentNode.dataset.r, td.cellIndex - 1, td, e);
  });
  tbody.addEventListener('contextmenu', (e) => {
    const td = e.target.closest('td'); if (!td) return;
    const ri = +td.parentNode.dataset.r;
    if (!selected.has(ri)) { selected.clear(); selected.add(ri); anchor = ri; paintSelection(); }
    const ci = td.classList.contains('rn') ? -1 : td.cellIndex - 1;
    if (ci >= 0) setFocus(ri, ci);
    opts.onContext?.(e, ri, ci, td);
  });
  wrap.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !(e.target instanceof HTMLInputElement)) {
      if (focus) copyText(cellText(rows[focus.ri]?.[focus.ci]));
      else if (selected.size) copyText([...selected].sort((a, b) => a - b).map((i) => rows[i].map(cellText).join('\t')).join('\n'));
      e.preventDefault();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !(e.target instanceof HTMLInputElement)) { selectAll(); e.preventDefault(); }
  });

  return {
    el: wrap, render, setSort,
    rows: () => rows, cols: () => cols,
    getSelected: () => [...selected].sort((a, b) => a - b),
    clearSelection() { selected.clear(); paintSelection(); },
    focused: () => focus,
    cell: tdOf,
    setCell(ri, ci, v) { rows[ri][ci] = v; const td = tdOf(ri, ci); if (td) { fillCell(td, v, isNumeric(cols[ci].type)); } },
    flash(ri, ci) { const td = tdOf(ri, ci); if (td) { td.classList.remove('flash'); void td.offsetWidth; td.classList.add('flash'); } },
    filterValues() { const o = {}; filterInputs.forEach((i, c) => { if (i.value.trim() !== '') o[c] = i.value.trim(); }); return o; },
    clearFilters() { filterInputs.forEach((i) => (i.value = '')); },
  };
}
