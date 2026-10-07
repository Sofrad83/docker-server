// Formulaires de structure : colonne, index, clé étrangère, nouvelle table, propriétés de table.
// Chacun fabrique du SQL (aperçu en direct, modifiable) exécuté par sqlForm().
import { h, btn, icon, q, qt, qs, clear } from './lib.js';
import { api } from './api.js';
import { sqlForm } from './dialogs.js';
import { state, getMeta } from './state.js';
import { isNumeric } from './grid.js';
import { openTable } from './menus.js';

const TYPES = ['int', 'bigint', 'smallint', 'tinyint', 'mediumint', 'decimal(10,2)', 'float', 'double', 'varchar(255)', 'char(1)',
  'text', 'tinytext', 'mediumtext', 'longtext', 'blob', 'mediumblob', 'longblob', 'binary(16)', 'varbinary(255)', 'date', 'datetime', 'timestamp',
  'time', 'year', 'json', "enum('a','b')", "set('a','b')", 'bit(1)'];
const TEXTUAL = /^(char|varchar|tinytext|text|mediumtext|longtext|enum|set)\b/i;

function typesList() {
  let dl = document.getElementById('dba-types');
  if (!dl) { dl = h('datalist', { id: 'dba-types' }, TYPES.map((t) => h('option', { value: t }))); document.body.append(dl); }
}

const field = (label, el, note) => [h('label', null, label), el, note ? h('div', { class: 'hint field-note' }, note) : null];

/** Définition d'une colonne : `nom` type [COLLATE] NULL|NOT NULL [DEFAULT …] [AUTO_INCREMENT] [ON UPDATE …] [COMMENT …] */
export function columnDef(c) {
  let s = `${q(c.name)} ${c.type}${c.unsigned ? ' unsigned' : ''}`;
  if (c.collation && TEXTUAL.test(c.type)) s += ` COLLATE ${c.collation}`;
  s += c.nullable ? ' NULL' : ' NOT NULL';
  if (c.defMode === 'null') s += ' DEFAULT NULL';
  else if (c.defMode === 'expr' && c.defValue) s += ` DEFAULT ${c.defValue}`;
  else if (c.defMode === 'value') s += ` DEFAULT ${isNumeric(c.type) && /^-?\d+(\.\d+)?$/.test(c.defValue) ? c.defValue : qs(c.defValue)}`;
  if (c.autoInc) s += ' AUTO_INCREMENT';
  if (c.onUpdate) s += ' ON UPDATE CURRENT_TIMESTAMP';
  if (c.comment) s += ` COMMENT ${qs(c.comment)}`;
  return s;
}

// ── Colonne ──────────────────────────────────────────────────────────────────
/** existing = colonne telle que renvoyée par l'API (édition) ; null pour en ajouter une. */
export async function dlgColumn(server, db, table, columns, existing = null) {
  typesList();
  if (existing?.generated) throw new Error('Colonne générée : modifiez-la avec une requête SQL (ALTER TABLE … MODIFY).');
  const meta = await getMeta(server);
  const e = existing;
  const unsigned0 = !!e && /\sunsigned/i.test(e.type);
  const type0 = e ? e.type.replace(/\s+unsigned/i, '') : 'varchar(255)';
  const defIsExpr = !!e && e.default != null && (/^CURRENT_TIMESTAMP/i.test(e.default) || /DEFAULT_GENERATED/i.test(e.extra));
  const defMode0 = !e ? 'none' : e.default == null ? (e.null ? 'null' : 'none') : defIsExpr ? 'expr' : 'value';

  const name = h('input', { type: 'text', value: e?.name || '', placeholder: 'nom_colonne' });
  const type = h('input', { type: 'text', value: type0, list: 'dba-types' });
  const unsigned = h('input', { type: 'checkbox', checked: unsigned0 });
  const unsignedLbl = h('label', { class: 'chk' }, unsigned, 'Non signé (unsigned)');
  const nullable = h('input', { type: 'checkbox', checked: e ? e.null : true });
  const defMode = h('select', null, [['none', 'Aucune'], ['null', 'NULL'], ['value', 'Valeur'], ['expr', 'Expression (ex. CURRENT_TIMESTAMP)']].map(([v, l]) => h('option', { value: v }, l)));
  defMode.value = defMode0;
  const defValue = h('input', { type: 'text', value: e?.default ?? '', placeholder: 'valeur' });
  const autoInc = h('input', { type: 'checkbox', checked: !!e && /auto_increment/i.test(e.extra) });
  const onUpdate = h('input', { type: 'checkbox', checked: !!e && /on update/i.test(e.extra) });
  const collation = h('select', null, h('option', { value: '' }, '(par défaut de la table)'),
    meta.charsets.map((c) => h('optgroup', { label: c.name }, c.collations.map((x) => h('option', { value: x }, x)))));
  collation.value = e?.collation || '';
  const comment = h('input', { type: 'text', value: e?.comment || '' });
  const others = columns.filter((c) => c.name !== e?.name);
  const pos = h('select', null, h('option', { value: '' }, e ? '(inchangée)' : 'À la fin'), h('option', { value: '#first' }, 'En premier'),
    others.map((c) => h('option', { value: c.name }, 'Après ' + c.name)));

  const sync = () => {
    unsignedLbl.style.visibility = isNumeric(type.value) ? '' : 'hidden';
    defValue.style.display = defMode.value === 'value' || defMode.value === 'expr' ? '' : 'none';
    collation.disabled = !TEXTUAL.test(type.value);
  };
  const body = h('div', { class: 'form' },
    field('Nom', name), field('Type', h('div', { class: 'row' }, type, unsignedLbl)),
    field('Null', h('label', { class: 'chk' }, nullable, 'Autorise NULL')),
    field('Défaut', h('div', { class: 'row' }, defMode, defValue)),
    field('Extras', h('div', { class: 'row' }, h('label', { class: 'chk' }, autoInc, 'AUTO_INCREMENT'), h('label', { class: 'chk' }, onUpdate, 'ON UPDATE CURRENT_TIMESTAMP'))),
    field('Interclassement', collation), field('Commentaire', comment), field('Position', pos));
  body.addEventListener('input', sync); body.addEventListener('change', sync); sync();

  const tq = qt(db, table);
  return sqlForm({
    server, db, title: e ? `Modifier la colonne « ${e.name} »` : `Nouvelle colonne dans « ${table} »`, body, confirmLabel: e ? 'Modifier' : 'Ajouter',
    build() {
      if (!name.value.trim()) return { error: 'Saisissez un nom de colonne.' };
      if (!type.value.trim()) return { error: 'Saisissez un type.' };
      const def = columnDef({
        name: name.value.trim(), type: type.value.trim(), unsigned: unsigned.checked && isNumeric(type.value), nullable: nullable.checked,
        defMode: defMode.value, defValue: defValue.value, autoInc: autoInc.checked, onUpdate: onUpdate.checked, collation: collation.value, comment: comment.value,
      });
      const where = pos.value === '#first' ? ' FIRST' : pos.value ? ` AFTER ${q(pos.value)}` : '';
      return e ? `ALTER TABLE ${tq}\n  CHANGE COLUMN ${q(e.name)} ${def}${where};` : `ALTER TABLE ${tq}\n  ADD COLUMN ${def}${where};`;
    },
  });
}

export function dlgDropColumn(server, db, table, column) {
  return sqlForm({
    server, db, danger: true, confirmLabel: 'Supprimer la colonne', title: `Supprimer la colonne « ${column} »`,
    note: 'Les données de cette colonne seront perdues.',
    build: () => `ALTER TABLE ${qt(db, table)} DROP COLUMN ${q(column)};`,
  });
}

// ── Index ────────────────────────────────────────────────────────────────────
/** existing = index tel que renvoyé par l'API {name, type, columns:[{name, sub}]} ; indexes = tous les index de la table. */
export function dlgIndex(server, db, table, columns, indexes, existing = null) {
  const e = existing;
  const type = h('select', null, ['INDEX', 'UNIQUE', 'FULLTEXT', 'SPATIAL', 'PRIMARY'].map((t) => h('option', { value: t }, t)));
  type.value = e?.type || 'INDEX';
  const name = h('input', { type: 'text', value: e?.name || '', placeholder: 'auto' });
  const rows = h('div', { style: { display: 'grid', gap: '6px' } });
  const colSel = (v) => h('select', { style: { flex: 1 } }, columns.map((c) => h('option', { value: c.name }, c.name + '  ·  ' + c.type)));
  const addRow = (col, len) => {
    const sel = colSel(); if (col) sel.value = col;
    const ln = h('input', { type: 'number', min: 1, placeholder: 'longueur', value: len || '', style: { width: '90px' } });
    const row = h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, sel, ln,
      btn('', 'sm ghost icon', () => { if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); rows.dispatchEvent(new Event('change', { bubbles: true })); }, 'up'),
      btn('', 'sm ghost icon', () => { if (row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row); rows.dispatchEvent(new Event('change', { bubbles: true })); }, 'down'),
      btn('', 'sm ghost icon', () => { row.remove(); rows.dispatchEvent(new Event('change', { bubbles: true })); }, 'close'));
    row.sel = sel; row.ln = ln; rows.append(row);
  };
  (e ? e.columns : [{ name: columns[0]?.name }]).forEach((c) => addRow(c.name, c.sub));
  const body = h('div', { class: 'form' }, field('Type', type), field('Nom', name, 'Vide = nom automatique. Ignoré pour PRIMARY.'),
    field('Colonnes', h('div', null, rows, h('div', { style: { marginTop: '8px' } }, btn('Colonne', 'sm', () => { addRow(); rows.dispatchEvent(new Event('change', { bubbles: true })); }, 'plus')))));

  return sqlForm({
    server, db, title: e ? `Modifier l'index « ${e.name} »` : `Nouvel index sur « ${table} »`, body, confirmLabel: e ? 'Modifier' : 'Créer', size: 'wide',
    build() {
      const list = [...rows.children].map((r) => q(r.sel.value) + (r.ln.value ? `(${r.ln.value})` : ''));
      if (!list.length) return { error: 'Ajoutez au moins une colonne.' };
      const t = type.value;
      const nm = name.value.trim() || 'idx_' + [...rows.children].map((r) => r.sel.value).join('_').slice(0, 50);
      const parts = [];
      if (t === 'PRIMARY') {
        if (indexes.some((i) => i.type === 'PRIMARY')) parts.push('DROP PRIMARY KEY');
        parts.push(`ADD PRIMARY KEY (${list.join(', ')})`);
      } else {
        if (e) parts.push(e.type === 'PRIMARY' ? 'DROP PRIMARY KEY' : `DROP INDEX ${q(e.name)}`);
        parts.push(`ADD ${t === 'INDEX' ? '' : t + ' '}INDEX ${q(nm)} (${list.join(', ')})`);
      }
      return `ALTER TABLE ${qt(db, table)}\n  ${parts.join(',\n  ')};`;
    },
  });
}

export function dlgDropIndex(server, db, table, index) {
  return sqlForm({
    server, db, danger: true, confirmLabel: 'Supprimer l\'index', title: `Supprimer l'index « ${index.name} »`,
    build: () => `ALTER TABLE ${qt(db, table)} ${index.type === 'PRIMARY' ? 'DROP PRIMARY KEY' : 'DROP INDEX ' + q(index.name)};`,
  });
}

// ── Clés étrangères ──────────────────────────────────────────────────────────
export async function dlgFk(server, db, table, columns) {
  const dbs = state.server === server && state.dbs.length ? state.dbs : (await api('dbs', { s: server })).dbs;
  const refDb = h('select', null, dbs.filter((d) => !d.system).map((d) => h('option', { value: d.name }, d.name))); refDb.value = db;
  const refTable = h('select');
  const name = h('input', { type: 'text', placeholder: 'auto' });
  const onDelete = h('select', null, ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'].map((x) => h('option', null, x)));
  const onUpdate = h('select', null, ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'].map((x) => h('option', null, x)));
  let refCols = [];
  const pairs = h('div', { style: { display: 'grid', gap: '6px' } });

  const refOptions = () => refCols.map((c) => h('option', { value: c.name }, c.name + '  ·  ' + c.type));
  const addPair = () => {
    const l = h('select', { style: { flex: 1 } }, columns.map((c) => h('option', { value: c.name }, c.name + '  ·  ' + c.type)));
    const r = h('select', { style: { flex: 1 } }, refOptions());
    const row = h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, l, h('span', { class: 'muted' }, '→'), r, btn('', 'sm ghost icon', () => { row.remove(); pairs.dispatchEvent(new Event('change', { bubbles: true })); }, 'close'));
    row.l = l; row.r = r; pairs.append(row);
  };
  async function loadRefTables() {
    clear(refTable);
    const tables = (await api('tables', { s: server, db: refDb.value })).tables.filter((t) => !t.view);
    tables.forEach((t) => refTable.append(h('option', { value: t.name }, t.name)));
    await loadRefCols();
  }
  async function loadRefCols() {
    refCols = refTable.value ? (await api('table', { s: server, db: refDb.value, table: refTable.value })).columns : [];
    [...pairs.children].forEach((row) => { clear(row.r); refOptions().forEach((o) => row.r.append(o)); });
    pairs.dispatchEvent(new Event('change', { bubbles: true }));
  }
  refDb.addEventListener('change', loadRefTables);
  refTable.addEventListener('change', loadRefCols);
  await loadRefTables();
  addPair();

  const body = h('div', { class: 'form' }, field('Nom', name, 'Vide = nom automatique.'),
    field('Base référencée', refDb), field('Table référencée', refTable),
    field('Colonnes', h('div', null, pairs, h('div', { style: { marginTop: '8px' } }, btn('Colonne', 'sm', () => { addPair(); pairs.dispatchEvent(new Event('change', { bubbles: true })); }, 'plus')))),
    field('ON DELETE', onDelete), field('ON UPDATE', onUpdate));

  return sqlForm({
    server, db, title: `Nouvelle clé étrangère sur « ${table} »`, body, confirmLabel: 'Créer', size: 'wide',
    note: 'Les types des colonnes liées doivent être identiques, et la colonne référencée indexée. Les données existantes doivent déjà respecter la contrainte.',
    build() {
      const rowsEls = [...pairs.children];
      if (!rowsEls.length) return { error: 'Ajoutez au moins une paire de colonnes.' };
      if (!refTable.value) return { error: 'Aucune table à référencer.' };
      const nm = name.value.trim() || `fk_${table}_${rowsEls.map((r) => r.l.value).join('_')}`.slice(0, 60);
      return `ALTER TABLE ${qt(db, table)}\n  ADD CONSTRAINT ${q(nm)} FOREIGN KEY (${rowsEls.map((r) => q(r.l.value)).join(', ')})\n  REFERENCES ${qt(refDb.value, refTable.value)} (${rowsEls.map((r) => q(r.r.value)).join(', ')})\n  ON DELETE ${onDelete.value} ON UPDATE ${onUpdate.value};`;
    },
  });
}

export function dlgDropFk(server, db, table, fk) {
  return sqlForm({
    server, db, danger: true, confirmLabel: 'Supprimer la clé', title: `Supprimer la clé étrangère « ${fk.name} »`,
    build: () => `ALTER TABLE ${qt(db, table)} DROP FOREIGN KEY ${q(fk.name)};`,
  });
}

// ── Nouvelle table ───────────────────────────────────────────────────────────
export async function dlgCreateTable(server, db) {
  typesList();
  const meta = await getMeta(server);
  const name = h('input', { type: 'text', placeholder: 'nom_de_la_table' });
  const engine = h('select', null, meta.engines.map((x) => h('option', null, x))); engine.value = meta.engines.includes('InnoDB') ? 'InnoDB' : meta.engines[0];
  const cs = h('select', null, meta.charsets.map((c) => h('option', { value: c.name }, c.name))); cs.value = 'utf8mb4';
  const co = h('select');
  const fillCo = () => { clear(co); const c = meta.charsets.find((x) => x.name === cs.value); c?.collations.forEach((x) => co.append(h('option', null, x))); co.value = cs.value === 'utf8mb4' ? 'utf8mb4_unicode_ci' : c?.default; };
  cs.addEventListener('change', fillCo); fillCo();
  const comment = h('input', { type: 'text' });
  const grid = h('table', { class: 'list' }, h('thead', null, h('tr', null, ['Nom', 'Type', 'Non null', 'Défaut', 'A.I.', 'PK', ''].map((x) => h('th', null, x)))));
  const tb = h('tbody'); grid.append(tb);
  const addCol = (v = {}) => {
    const r = h('tr', null,
      h('td', null, h('input', { type: 'text', value: v.name || '', style: { width: '150px' } })),
      h('td', null, h('input', { type: 'text', value: v.type || 'varchar(255)', list: 'dba-types', style: { width: '150px' } })),
      h('td', null, h('input', { type: 'checkbox', checked: v.nn !== false })),
      h('td', null, h('input', { type: 'text', value: v.def || '', placeholder: '(aucun)', style: { width: '120px' } })),
      h('td', null, h('input', { type: 'checkbox', checked: !!v.ai })),
      h('td', null, h('input', { type: 'checkbox', checked: !!v.pk })),
      h('td', null, btn('', 'sm ghost icon', () => { r.remove(); tb.dispatchEvent(new Event('change', { bubbles: true })); }, 'close')));
    r.f = [...r.querySelectorAll('input')]; tb.append(r);
  };
  addCol({ name: 'id', type: 'int unsigned', ai: true, pk: true }); addCol({ name: 'nom' });
  const body = h('div', null,
    h('div', { class: 'form' }, field('Nom', name), field('Moteur', engine), field('Jeu de caractères', cs), field('Interclassement', co), field('Commentaire', comment)),
    h('div', { style: { margin: '14px 0 6px', display: 'flex', alignItems: 'center', gap: '10px' } }, h('b', null, 'Colonnes'), btn('Colonne', 'sm', () => { addCol(); tb.dispatchEvent(new Event('change', { bubbles: true })); }, 'plus')),
    h('div', { style: { overflow: 'auto', maxHeight: '260px' } }, grid));

  const res = await sqlForm({
    server, db, title: 'Nouvelle table', body, confirmLabel: 'Créer la table', size: 'xl', affects: [db],
    build() {
      const n = name.value.trim();
      if (!n) return { error: 'Saisissez un nom de table.' };
      const lines = []; const pks = [];
      for (const r of tb.children) {
        const [cName, cType, nn, def, ai, pk] = r.f;
        if (!cName.value.trim()) continue;
        const d = def.value.trim();
        lines.push('  ' + columnDef({
          name: cName.value.trim(), type: cType.value.trim() || 'int', nullable: !nn.checked, autoInc: ai.checked,
          defMode: d === '' ? 'none' : d.toUpperCase() === 'NULL' ? 'null' : /^current_timestamp/i.test(d) ? 'expr' : 'value', defValue: d,
        }));
        if (pk.checked) pks.push(q(cName.value.trim()));
      }
      if (!lines.length) return { error: 'Ajoutez au moins une colonne.' };
      if (pks.length) lines.push(`  PRIMARY KEY (${pks.join(', ')})`);
      return `CREATE TABLE ${qt(db, n)} (\n${lines.join(',\n')}\n) ENGINE=${engine.value} DEFAULT CHARSET=${cs.value} COLLATE=${co.value}${comment.value ? ' COMMENT=' + qs(comment.value) : ''};`;
    },
  });
  if (res && name.value.trim()) openTable(server, db, name.value.trim(), 'structure');
  return res;
}

// ── Propriétés d'une table ───────────────────────────────────────────────────
export async function dlgTableProps(server, db, table, status) {
  const meta = await getMeta(server);
  const engine = h('select', null, meta.engines.map((x) => h('option', null, x))); engine.value = status.Engine;
  const allCo = meta.charsets.flatMap((c) => c.collations);
  const co = h('select', null, meta.charsets.map((c) => h('optgroup', { label: c.name }, c.collations.map((x) => h('option', null, x))))); co.value = allCo.includes(status.Collation) ? status.Collation : '';
  const ai = h('input', { type: 'number', min: 1, value: status.Auto_increment || '' });
  const comment = h('input', { type: 'text', value: status.Comment || '' });
  const conv = h('input', { type: 'checkbox' });
  const body = h('div', { class: 'form' }, field('Moteur', engine), field('Interclassement', co),
    field('', h('label', { class: 'chk' }, conv, 'Convertir aussi les colonnes existantes'), 'Recommandé pour passer une table latin1 / utf8 en utf8mb4 : les accents et emoji sont conservés.'),
    field('AUTO_INCREMENT', ai), field('Commentaire', comment));
  const tq = qt(db, table);
  return sqlForm({
    server, db, title: `Propriétés de « ${table} »`, body, confirmLabel: 'Appliquer',
    build() {
      const out = [];
      if (conv.checked && co.value) out.push(`ALTER TABLE ${tq} CONVERT TO CHARACTER SET ${meta.charsets.find((c) => c.collations.includes(co.value))?.name} COLLATE ${co.value};`);
      const parts = [];
      if (engine.value !== status.Engine) parts.push(`ENGINE=${engine.value}`);
      if (!conv.checked && co.value && co.value !== status.Collation) parts.push(`COLLATE=${co.value}`);
      if (ai.value && String(ai.value) !== String(status.Auto_increment || '')) parts.push(`AUTO_INCREMENT=${+ai.value}`);
      if (comment.value !== (status.Comment || '')) parts.push(`COMMENT=${qs(comment.value)}`);
      if (parts.length) out.push(`ALTER TABLE ${tq} ${parts.join(', ')};`);
      return out.length ? out.join('\n') : { error: 'Aucune modification.' };
    },
  });
}
