// Onglet « Requête » : éditeur SQL coloré, exécution (tout · sélection · instruction sous le curseur),
// un onglet de résultat par instruction, historique, export CSV.
import { h, btn, icon, modal, toast, confirmBox, clear, append, fmtNum, fmtMs, toCSV, saveFile, debounce, cellText } from './lib.js';
import { api } from './api.js';
import { state, schemaChanged } from './state.js';
import { createGrid } from './grid.js';
import { registerView } from './tabs.js';
import { showValue } from './dialogs.js';

const KEYWORDS = new Set(`select from where and or not in is null like between join left right inner outer cross natural on using group by order
having limit offset insert into values update set delete create alter drop table database schema index view trigger procedure function event as
distinct union all case when then else end exists primary key foreign references default auto_increment unique constraint truncate rename show
describe desc asc explain use begin commit rollback start transaction call if while declare return returns engine charset collate comment add
column modify change after first replace ignore duplicate temporary with recursive over partition interval true false unsigned signed regexp
rlike div mod xor any some analyze optimize check repair lock unlock tables grant revoke status variables databases columns fields full
processlist warnings errors global session names engines for each row before delimiter if`.split(/\s+/));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TOKEN = /('(?:[^'\\]|\\[\s\S]|'')*'?|"(?:[^"\\]|\\[\s\S]|"")*"?|`[^`]*`?|--[ \t][^\n]*|--$|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_$]*\b)/g;

function highlight(src) {
  let out = '', last = 0, m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    out += esc(src.slice(last, m.index));
    const t = m[0];
    const cls = t[0] === "'" || t[0] === '"' ? 's' : t[0] === '`' ? 'i' : t.startsWith('--') || t[0] === '#' || t.startsWith('/*') ? 'c'
      : /^\d/.test(t) ? 'n' : KEYWORDS.has(t.toLowerCase()) ? 'k' : null;
    out += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t);
    last = m.index + t.length;
  }
  return out + esc(src.slice(last)) + '\n';
}

/** Instructions risquées : on demande confirmation avant de les lancer. */
function risk(sql) {
  const clean = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(--[ \t]|#)[^\n]*/g, ' ');
  for (const s of clean.split(';')) {
    if (/^\s*(update|delete)\b/i.test(s) && !/\bwhere\b/i.test(s)) return 'Une instruction UPDATE / DELETE n\'a pas de clause WHERE : elle touchera TOUTES les lignes.';
    if (/^\s*drop\s+(database|schema)\b/i.test(s)) return 'DROP DATABASE : la base entière sera supprimée.';
    if (/^\s*truncate\b/i.test(s)) return 'TRUNCATE : toutes les lignes de la table seront supprimées.';
  }
  return null;
}

// ── Historique (par navigateur) ──────────────────────────────────────────────
const HKEY = 'dba.history';
const history = () => { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch { return []; } };
function pushHistory(entry) {
  try {
    const list = history().filter((x) => !(x.sql === entry.sql && x.db === entry.db));
    list.unshift({ ...entry, t: Date.now() });
    localStorage.setItem(HKEY, JSON.stringify(list.slice(0, 150)));
  } catch { /* quota */ }
}

registerView('query', (ctx) => {
  const { server, id } = ctx.params;
  const storeKey = 'dba.q.' + id;
  let counter = +(localStorage.getItem('dba.qn') || 0);
  if (!ctx.params.n) { counter++; ctx.params.n = counter; localStorage.setItem('dba.qn', counter); }
  ctx.setTitle('Requête ' + ctx.params.n, 'sql');

  const ta = h('textarea', { spellcheck: 'false', placeholder: '-- Écrivez votre SQL.  Ctrl+Entrée : tout exécuter (ou la sélection)  ·  Ctrl+Maj+Entrée : l\'instruction sous le curseur' });
  const pre = h('pre', { class: 'hl' });
  const saved = localStorage.getItem(storeKey);
  ta.value = ctx.params.sql ?? saved ?? '';
  if (ctx.params.sql != null) { try { localStorage.setItem(storeKey, ta.value); } catch { /* quota */ } delete ctx.params.sql; }
  const paint = () => { pre.innerHTML = highlight(ta.value); };
  const persist = debounce(() => { try { localStorage.setItem(storeKey, ta.value); } catch { /* quota */ } }, 400);
  ta.addEventListener('input', () => { paint(); persist(); });
  ta.addEventListener('scroll', () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(e.shiftKey ? 'cursor' : 'all'); }
    else if (e.key === 'F9') { e.preventDefault(); run('all'); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const a = ta.selectionStart, b = ta.selectionEnd;
      ta.setRangeText('  ', a, b, 'end'); paint(); persist();
    }
  });
  paint();

  const dbSel = h('select', { class: 'select-inline', title: 'Base par défaut de la requête' });
  const limitSel = h('select', { class: 'select-inline', title: 'Nombre maximum de lignes affichées' }, [100, 1000, 5000, 20000, 100000].map((n) => h('option', { value: n }, fmtNum(n) + ' lignes max')));
  limitSel.value = String(state.cfg.resultLimit || 1000);
  if (![...limitSel.options].some((o) => o.value === limitSel.value)) limitSel.append(h('option', { value: limitSel.value }, fmtNum(+limitSel.value) + ' lignes max'));
  limitSel.value = String(state.cfg.resultLimit || 1000);
  (async () => {
    const dbs = state.server === server && state.dbs.length ? state.dbs : (await api('dbs', { s: server }).catch(() => ({ dbs: [] }))).dbs;
    append(dbSel, h('option', { value: '' }, '(aucune base)'), dbs.map((d) => h('option', { value: d.name }, d.name)));
    dbSel.value = ctx.params.db || '';
  })();
  dbSel.addEventListener('change', () => { ctx.params.db = dbSel.value; });

  const runBtn = btn('Exécuter', 'primary', () => run('all'), 'play');
  const curBtn = btn('Instruction courante', '', () => run('cursor'));
  const stopHint = h('span', { class: 'hint hidden' }, 'Exécution…');
  const toolbar = h('div', { class: 'toolbar' }, runBtn, curBtn, h('span', { class: 'sep' }), h('span', { class: 'muted' }, 'Base'), dbSel, limitSel,
    h('span', { class: 'spacer' }), stopHint,
    btn('Historique', 'ghost', openHistory, 'history'), btn('Effacer', 'ghost', () => { ta.value = ''; paint(); persist(); ta.focus(); }));

  const editorWrap = h('div', { class: 'editor-wrap' }, h('div', { class: 'editor' }, pre, ta));
  const split = h('div', { class: 'vsplit' });
  split.addEventListener('mousedown', (e) => {
    e.preventDefault(); split.classList.add('drag');
    const y0 = e.clientY, h0 = editorWrap.offsetHeight;
    const move = (ev) => { editorWrap.style.height = Math.max(70, h0 + ev.clientY - y0) + 'px'; };
    const up = () => { split.classList.remove('drag'); removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });

  const rtabs = h('div', { class: 'rtabs' });
  const rbody = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
    h('div', { class: 'empty-state' }, h('div', null, icon('sql'), h('div', null, 'Les résultats s\'affichent ici.'))));
  const results = h('div', { class: 'results' }, rtabs, rbody);
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, toolbar, editorWrap, split, results);

  let running = false, lastResults = [], activeIdx = 0;

  async function run(mode) {
    if (running) return;
    let sql = ta.value;
    const a = ta.selectionStart, b = ta.selectionEnd;
    if (a !== b) { sql = ta.value.slice(a, b); mode = 'all'; }
    if (!sql.trim()) return toast('Rien à exécuter.', 'info');
    const warn = risk(mode === 'cursor' ? sql : sql);
    if (warn && !(await confirmBox({ title: 'Confirmer l\'exécution', message: warn + '\n\nExécuter quand même ?', confirmLabel: 'Exécuter', danger: true }))) return;
    running = true; runBtn.disabled = curBtn.disabled = true; stopHint.classList.remove('hidden');
    try {
      const r = await api('sql', { s: server, db: dbSel.value || undefined, sql, mode, cursor: a, limit: +limitSel.value });
      lastResults = r.results; showResults();
      const okOnes = r.results.filter((x) => x.type !== 'error');
      if (okOnes.length) pushHistory({ sql: mode === 'cursor' ? r.results[0].sql : sql.trim(), db: dbSel.value, server });
      if (r.results.some((x) => x.type === 'ok' && /^\s*(create|drop|alter|rename|truncate)\b/i.test(x.sql))) schemaChanged({ server, db: dbSel.value || undefined });
    } catch (e) {
      lastResults = [{ type: 'error', error: e.message, sql: '' }]; showResults();
    } finally { running = false; runBtn.disabled = curBtn.disabled = false; stopHint.classList.add('hidden'); }
  }

  const label = (r) => {
    const s = (r.sql || '').replace(/\s+/g, ' ').trim(); const short = s.length > 34 ? s.slice(0, 34) + '…' : s;
    return r.type === 'rows' ? `${short} · ${fmtNum(r.rows.length)}${r.truncated ? '+' : ''}` : r.type === 'error' ? `✖ ${short || 'erreur'}` : `✔ ${short}`;
  };

  function showResults() {
    clear(rtabs);
    const firstRows = lastResults.map((r, i) => (r.type === 'rows' ? i : -1)).filter((i) => i >= 0);
    activeIdx = lastResults.findIndex((r) => r.type === 'error');
    if (activeIdx < 0) activeIdx = firstRows.length ? firstRows[firstRows.length - 1] : lastResults.length - 1;
    lastResults.forEach((r, i) => rtabs.append(h('div', { class: 'rtab' + (r.type === 'error' ? ' err' : ''), title: r.sql, onclick: () => { activeIdx = i; paintResult(); } }, label(r))));
    paintResult();
  }

  function paintResult() {
    [...rtabs.children].forEach((t, i) => t.classList.toggle('active', i === activeIdx));
    clear(rbody);
    const r = lastResults[activeIdx];
    if (!r) return;
    if (r.type === 'error') {
      rbody.append(h('div', { class: 'msg err' }, `Erreur${r.code ? ' ' + r.code : ''} : ${r.error}`, r.sql ? '\n\n' + r.sql : ''));
    } else if (r.type === 'ok') {
      rbody.append(h('div', { class: 'msg ok' }, `✔ ${fmtNum(r.affected)} ligne(s) affectée(s)` + (r.insertId && r.insertId !== '0' ? ` · dernier id : ${r.insertId}` : '') + ` · ${fmtMs(r.ms)}`, h('span', { style: { color: 'var(--muted)' } }, '\n\n' + r.sql)));
    } else {
      const grid = createGrid({ onDblClick: (ri, ci) => { const v = r.rows[ri][ci]; showValue(r.cols[ci].name, cellText(v)); } });
      grid.render(r.cols, r.rows);
      rbody.append(grid.el, h('div', { class: 'gridfoot' },
        h('span', null, `${fmtNum(r.rows.length)} ligne(s)` + (r.truncated ? ' — limite atteinte, la suite n\'est pas affichée' : '')), h('span', { class: 'spacer' }),
        h('span', null, fmtMs(r.ms)),
        btn('CSV', 'sm', () => saveFile('resultat.csv', toCSV(r.cols, r.rows), 'text/csv'), 'download')));
    }
  }

  function openHistory() {
    const list = history();
    const filter = h('input', { type: 'search', placeholder: 'Filtrer l\'historique…', style: { width: '100%', marginBottom: '8px' } });
    const box = h('div', { style: { display: 'grid', gap: '6px' } });
    const draw = () => {
      clear(box);
      const f = filter.value.toLowerCase();
      const items = list.filter((x) => !f || x.sql.toLowerCase().includes(f) || (x.db || '').toLowerCase().includes(f));
      if (!items.length) box.append(h('div', { class: 'hint' }, list.length ? 'Aucun résultat.' : 'Historique vide.'));
      items.slice(0, 60).forEach((x) => box.append(h('div', {
        class: 'code', style: { cursor: 'pointer', padding: '8px 10px', whiteSpace: 'pre-wrap', maxHeight: '96px', overflow: 'hidden' },
        onclick: () => { ta.value = x.sql; if (x.db) { dbSel.value = x.db; ctx.params.db = x.db; } paint(); persist(); m.close(); ta.focus(); },
      }, h('div', { class: 'hint', style: { marginBottom: '3px' } }, `${new Date(x.t).toLocaleString('fr-FR')}${x.db ? '  ·  ' + x.db : ''}`), x.sql.length > 500 ? x.sql.slice(0, 500) + '…' : x.sql)));
    };
    filter.addEventListener('input', draw); draw();
    const m = modal({ title: 'Historique des requêtes', size: 'wide', body: h('div', null, filter, box) });
    m.setFoot([btn('Vider l\'historique', 'danger', () => { localStorage.removeItem(HKEY); list.length = 0; draw(); }), btn('Fermer', '', () => m.close())]);
  }

  return {
    el,
    onShow() { setTimeout(() => ta.focus(), 20); },
    destroy() { try { localStorage.removeItem(storeKey); } catch { /* ignoré */ } },
  };
});
