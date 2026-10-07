// Dialogues : formulaire à aperçu SQL, bases (créer / supprimer / copier), export, import, opérations sur les tables.
import { h, btn, icon, modal, toast, q, qt, fmtBytes, fmtNum, fmtMs, fmtDate, cellText, clear, append } from './lib.js';
import { api, uploadImport, downloadExport } from './api.js';
import { state, getMeta, schemaChanged, loadDbs } from './state.js';

export const errBox = (text) => h('div', { class: 'errbox' }, text);

/** Petit tableau en lecture seule pour un résultat de requête (OPTIMIZE, CHECK, SHOW…). */
export function miniTable(res) {
  return h('div', { style: { overflow: 'auto', maxHeight: '260px', marginTop: '10px', border: '1px solid var(--border)', borderRadius: '6px' } },
    h('table', { class: 'list' },
      h('thead', null, h('tr', null, res.cols.map((c) => h('th', null, c.name)))),
      h('tbody', null, res.rows.map((r) => h('tr', null, r.map((v) => h('td', { class: 'mono' }, v === null ? 'NULL' : cellText(v))))))));
}

/** Affiche une valeur complète (lecture seule) avec bouton Copier. */
export function showValue(title, text) {
  const ta = h('textarea', { class: 'sqlbox mono', readonly: true, rows: 14, style: { minHeight: '260px' } }); ta.value = text;
  const m = modal({ title, size: 'wide', body: ta });
  m.setFoot([btn('Copier', '', () => { navigator.clipboard?.writeText(text); toast('Copié', 'ok'); }, 'copy'), btn('Fermer', 'primary', () => m.close())]);
}

/**
 * Formulaire à aperçu SQL en direct : `body` contient les champs, `build()` en tire le SQL (ou null /
 * {error} tant que le formulaire est incomplet). Le SQL reste modifiable à la main avant exécution.
 * Rend une promesse : le résultat de l'exécution, ou null si annulé.
 */
export function sqlForm({ server, db, title, size = '', body = null, build, confirmLabel = 'Exécuter', danger = false, note = null, affects = null, typeToConfirm = null }) {
  return new Promise((resolve) => {
    let manual = false; let outcome = null;
    const ta = h('textarea', { class: 'sqlbox mono', spellcheck: 'false', rows: 4 });
    const hint = h('div', { class: 'hint', style: { marginTop: '4px' } });
    const out = h('div');
    const typed = typeToConfirm ? h('input', { type: 'text', placeholder: typeToConfirm, style: { width: '100%', marginTop: '6px' } }) : null;
    const run = btn(confirmLabel, danger ? 'danger' : 'primary', go, 'play');
    const regen = h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { manual = false; update(); } }, '↺ régénérer');

    const content = h('div', null,
      note ? h('div', { class: 'infobox' }, note) : null,
      body,
      h('div', { style: { margin: '14px 0 6px', display: 'flex', alignItems: 'center', gap: '8px' } },
        h('b', null, 'SQL exécuté'), h('span', { class: 'hint' }, '— modifiable'), h('span', { class: 'spacer' }), regen),
      ta, hint,
      typed ? h('div', { style: { marginTop: '10px' } }, h('div', { class: 'warnbox' }, `Pour confirmer, tapez : ${typeToConfirm}`), typed) : null,
      out);

    function enabled() { run.disabled = !ta.value.trim() || (typed && typed.value !== typeToConfirm); }
    function update() {
      if (manual) return;
      let r;
      try { r = build(); } catch (e) { r = { error: e.message }; }
      if (r && r.error) { ta.value = ''; hint.textContent = r.error; } else { ta.value = r || ''; hint.textContent = ''; }
      ta.rows = Math.max(3, Math.min(16, ta.value.split('\n').length + 1));
      enabled();
    }
    ta.addEventListener('input', () => { manual = true; enabled(); });
    typed?.addEventListener('input', enabled);
    content.addEventListener('input', update);
    content.addEventListener('change', update);

    const m = modal({ title, size, body: content, foot: [btn('Annuler', '', () => m.close()), run] });
    m.closed.then(() => resolve(outcome));
    update();

    async function go() {
      run.disabled = true; clear(out);
      try {
        const sql = ta.value;
        const r = await api('sql', { s: server, db: db || undefined, sql, limit: 200 });
        const bad = r.results.find((x) => x.type === 'error');
        if (/\b(create|drop|alter|rename|truncate)\b/i.test(sql)) {
          for (const d of affects ?? [db || null]) schemaChanged({ server, db: d || undefined });
        }
        if (bad) {
          const done = r.results.length - 1;
          out.append(errBox(bad.error + (bad.code ? `  [${bad.code}]` : '') + (done ? `\n\n${done} instruction(s) déjà exécutée(s) avant l'erreur.` : '')));
          run.disabled = false;
          return;
        }
        outcome = r;
        const sets = r.results.filter((x) => x.type === 'rows');
        if (sets.length) {
          append(out, sets.map(miniTable));
          m.setFoot([btn('Fermer', 'primary', () => m.close())]);
        } else {
          const n = r.results.reduce((a, x) => a + (x.affected || 0), 0);
          toast(`Exécuté (${r.results.length} instruction${r.results.length > 1 ? 's' : ''}${n ? ', ' + fmtNum(n) + ' ligne(s)' : ''})`, 'ok');
          m.close();
        }
      } catch (e) {
        out.append(errBox(e.message)); run.disabled = false;
      }
    }
  });
}

// ── Bases ────────────────────────────────────────────────────────────────────
function charsetSelects(meta, charset = meta.defaultCharset, collation = meta.defaultCollation) {
  const cs = h('select', null, meta.charsets.map((c) => h('option', { value: c.name }, c.name)));
  const co = h('select');
  const fill = (name, pick) => {
    clear(co);
    const c = meta.charsets.find((x) => x.name === name);
    (c?.collations || []).forEach((x) => co.append(h('option', { value: x }, x)));
    co.value = pick && (c?.collations || []).includes(pick) ? pick : c?.default || '';
  };
  cs.value = charset; fill(charset, collation);
  cs.addEventListener('change', () => fill(cs.value));
  return { cs, co };
}

export async function dlgCreateDb(server = state.server) {
  const meta = await getMeta(server);
  const name = h('input', { type: 'text', placeholder: 'nom_de_la_base' });
  const { cs, co } = charsetSelects(meta, 'utf8mb4', 'utf8mb4_unicode_ci');
  return sqlForm({
    server, title: 'Nouvelle base de données', confirmLabel: 'Créer', affects: [null],
    body: h('div', { class: 'form' }, h('label', null, 'Nom'), name, h('label', null, 'Jeu de caractères'), cs, h('label', null, 'Interclassement'), co),
    build: () => (name.value.trim() ? `CREATE DATABASE ${q(name.value.trim())} CHARACTER SET ${cs.value} COLLATE ${co.value};` : { error: 'Saisissez un nom.' }),
  });
}

export function dlgDropDb(server, db) {
  return sqlForm({
    server, title: `Supprimer la base « ${db} »`, danger: true, confirmLabel: 'Supprimer définitivement', affects: [null], typeToConfirm: db,
    note: 'Toutes les tables et leurs données seront perdues. Pensez à exporter la base avant.',
    build: () => `DROP DATABASE ${q(db)};`,
  });
}

/** Copie complète d'une base (structure, données, vues, triggers, procédures) — côté serveur. */
export function dlgCopyDb(server, db) {
  return new Promise((resolve) => {
    const name = h('input', { type: 'text', value: db + '_copy' });
    const data = h('input', { type: 'checkbox', checked: true });
    const out = h('div');
    const run = btn('Copier', 'primary', go, 'copy');
    const m = modal({
      title: `Dupliquer la base « ${db} »`,
      body: h('div', null,
        h('div', { class: 'form' }, h('label', null, 'Nouvelle base'), name, h('label', null, 'Contenu'),
          h('label', { class: 'chk' }, data, 'Copier aussi les données')),
        h('p', { class: 'hint' }, 'Copie les tables (index, clés étrangères), les vues, les déclencheurs et les procédures. Sur une grosse base, cela peut durer plusieurs minutes.'), out),
      foot: [btn('Annuler', '', () => m.close()), run],
    });
    let result = null;
    m.closed.then(() => resolve(result));
    async function go() {
      const to = name.value.trim();
      if (!to) return;
      run.disabled = name.disabled = true; clear(out);
      out.append(h('div', { class: 'progress indet', style: { marginTop: '12px' } }, h('i')), h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Copie en cours…'));
      try {
        const r = await api('db.copy', { s: server, from: db, to, data: data.checked });
        result = r;
        schemaChanged({ server });
        clear(out);
        append(out, h('div', { class: 'okbox' }, `Base « ${to} » créée : ${r.tables} table(s), ${r.views} vue(s), ${r.programs} déclencheur(s)/procédure(s) en ${r.seconds} s.`),
          r.warnings.length ? h('div', { class: 'warnbox' }, h('b', null, `${r.warnings.length} avertissement(s) :`), h('br'), r.warnings.join('\n')) : null);
        m.setFoot([btn('Fermer', 'primary', () => m.close())]);
      } catch (e) { clear(out); out.append(errBox(e.message)); run.disabled = name.disabled = false; }
    }
  });
}

// ── Export ───────────────────────────────────────────────────────────────────
/** Export SQL d'une base entière, ou de quelques tables ({tables:[…]}). */
export async function dlgExport({ server, db, tables = null }) {
  const list = (await api('tables', { s: server, db })).tables;
  const checks = list.map((t) => ({ t, el: h('input', { type: 'checkbox', checked: !tables || tables.includes(t.name) }) }));
  const opt = (label, on = true) => { const el = h('input', { type: 'checkbox', checked: on }); return { el, row: h('label', { class: 'chk' }, el, label) }; };
  const structure = opt('Structure (CREATE TABLE)'), data = opt('Données (INSERT)'), drop = opt('Ajouter DROP TABLE IF EXISTS'),
    extras = opt('Vues, déclencheurs, procédures'), createDb = opt('Ajouter CREATE DATABASE + USE', false), gzip = opt('Compresser (.sql.gz)', false);
  const dest = { download: h('input', { type: 'radio', name: 'dest', value: 'download', checked: true }), backups: h('input', { type: 'radio', name: 'dest', value: 'backups' }) };
  const count = h('span', { class: 'hint' });
  const refreshCount = () => { count.textContent = `${checks.filter((c) => c.el.checked).length} / ${checks.length} sélectionnée(s)`; };
  checks.forEach((c) => c.el.addEventListener('change', refreshCount)); refreshCount();
  const setAll = (v) => { checks.forEach((c) => (c.el.checked = v)); refreshCount(); };

  const m = modal({
    title: `Exporter « ${db} »`, size: 'wide',
    body: h('div', null,
      h('div', { class: 'form', style: { gridTemplateColumns: '1fr 1fr' } }, structure.row, data.row, drop.row, extras.row, createDb.row, gzip.row),
      h('div', { style: { margin: '14px 0 6px', display: 'flex', alignItems: 'center', gap: '10px' } }, h('b', null, 'Tables'), count, h('span', { class: 'spacer' }),
        btn('Toutes', 'sm ghost', () => setAll(true)), btn('Aucune', 'sm ghost', () => setAll(false))),
      h('div', { class: 'checklist' }, checks.map((c) => h('label', null, c.el, h('span', { class: 'mono', style: c.t.view ? { color: 'var(--warn)' } : null }, c.t.name)))),
      h('div', { style: { marginTop: '14px', display: 'flex', gap: '22px' } },
        h('label', { class: 'chk' }, dest.download, 'Télécharger'),
        h('label', { class: 'chk' }, dest.backups, 'Enregistrer dans data\\backups (serveur)'))),
  });
  const go = btn('Exporter', 'primary', async () => {
    const sel = checks.filter((c) => c.el.checked).map((c) => c.t.name);
    if (!sel.length) return toast('Sélectionnez au moins une table.', 'error');
    const opts = {
      s: server, db, tables: sel.length === checks.length ? [] : sel,
      structure: structure.el.checked, data: data.el.checked, drop: drop.el.checked,
      extras: extras.el.checked, createDb: createDb.el.checked, gzip: gzip.el.checked,
      dest: dest.backups.checked ? 'backups' : 'download',
    };
    if (opts.dest === 'download') { downloadExport(opts); toast('Téléchargement lancé…'); return m.close(); }
    go.disabled = true; go.lastChild.textContent = 'Export en cours…';
    try {
      const r = await api('export', opts);
      toast(`Enregistré : data\\backups\\${r.file} (${fmtBytes(r.bytes)})`, 'ok', 7000);
      m.close();
    } catch (e) { toast(e.message, 'error'); go.disabled = false; go.lastChild.textContent = 'Exporter'; }
  }, 'download');
  m.setFoot([btn('Annuler', '', () => m.close()), go]);
}

// ── Import ───────────────────────────────────────────────────────────────────
/** Import d'un fichier .sql / .sql.gz (de votre PC, ou déjà dans data\backups), exécuté instruction par instruction. */
export async function dlgImport({ server, db = '' }) {
  const dbs = state.server === server && state.dbs.length ? state.dbs : (await api('dbs', { s: server })).dbs;
  const target = h('select', { style: { width: '100%' } },
    h('option', { value: '' }, '— celle du fichier (USE / CREATE DATABASE) —'),
    dbs.filter((d) => !d.system).map((d) => h('option', { value: d.name }, d.name)));
  target.value = db;
  let file = null; let mode = 'file';
  const fileInput = h('input', { type: 'file', accept: '.sql,.gz,.txt', style: { display: 'none' } });
  const dropZone = h('div', { class: 'drop' }, icon('upload', 22), h('div', { style: { marginTop: '6px' } }, 'Glissez un fichier .sql / .sql.gz ici, ou cliquez pour choisir'));
  const setFile = (f) => { file = f; clear(dropZone); dropZone.append(icon('db', 22), h('div', { style: { marginTop: '6px' } }, h('b', null, f.name), '  ·  ' + fmtBytes(f.size))); };
  dropZone.onclick = () => fileInput.click();
  fileInput.onchange = () => fileInput.files[0] && setFile(fileInput.files[0]);
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('over'); };
  dropZone.ondragleave = () => dropZone.classList.remove('over');
  dropZone.ondrop = (e) => { e.preventDefault(); dropZone.classList.remove('over'); e.dataTransfer.files[0] && setFile(e.dataTransfer.files[0]); };

  const backupsBox = h('div', { class: 'hidden' });
  let chosen = null;
  api('backups', { s: server }).then(({ files }) => {
    backupsBox.append(files.length
      ? h('div', { class: 'checklist', style: { columns: 1, maxHeight: '240px' } }, files.map((f) =>
        h('label', null, h('input', { type: 'radio', name: 'bk', onchange: () => (chosen = f.name) }), h('span', { class: 'mono' }, f.name), h('span', { class: 'hint' }, `  ${fmtBytes(f.size)} · ${new Date(f.time * 1000).toLocaleString('fr-FR')}`))))
      : h('div', { class: 'hint' }, 'Aucun fichier .sql / .sql.gz dans data\\backups.'));
  }).catch((e) => backupsBox.append(errBox(e.message)));

  const tabFile = btn('Fichier de mon PC', 'sm', () => setMode('file')); const tabBk = btn('Dossier data\\backups', 'sm ghost', () => setMode('backups'));
  function setMode(x) { mode = x; dropZone.classList.toggle('hidden', x !== 'file'); backupsBox.classList.toggle('hidden', x !== 'backups'); tabFile.className = 'btn sm ' + (x === 'file' ? '' : 'ghost'); tabBk.className = 'btn sm ' + (x === 'backups' ? '' : 'ghost'); }
  const stop = h('input', { type: 'checkbox', checked: true }), noFk = h('input', { type: 'checkbox', checked: true });
  const bar = h('i'); const prog = h('div', { class: 'progress hidden', style: { marginTop: '14px' } }, bar);
  const status = h('div', { class: 'hint', style: { marginTop: '6px' } }); const out = h('div');
  const run = btn('Importer', 'primary', go, 'upload');

  const m = modal({
    title: 'Importer un fichier SQL', size: 'wide',
    body: h('div', null,
      h('div', { class: 'form' }, h('label', null, 'Base de destination'), target),
      h('div', { style: { display: 'flex', gap: '6px', margin: '14px 0 8px' } }, tabFile, tabBk),
      dropZone, fileInput, backupsBox,
      h('div', { style: { marginTop: '14px', display: 'flex', gap: '22px', flexWrap: 'wrap' } },
        h('label', { class: 'chk' }, stop, 'S\'arrêter à la première erreur'), h('label', { class: 'chk' }, noFk, 'Désactiver les contrôles de clés étrangères')),
      prog, status, out),
    foot: [btn('Annuler', '', () => m.close()), run],
  });

  async function go() {
    if (mode === 'file' && !file) return toast('Choisissez un fichier.', 'error');
    if (mode === 'backups' && !chosen) return toast('Choisissez une sauvegarde.', 'error');
    run.disabled = true; clear(out); prog.classList.remove('hidden'); prog.classList.toggle('indet', mode === 'backups');
    status.textContent = mode === 'file' ? 'Envoi du fichier…' : 'Exécution…';
    const fields = { s: server, db: target.value || '', stop: stop.checked, noFk: noFk.checked };
    try {
      const r = mode === 'file'
        ? await uploadImport(fields, file, (p) => { bar.style.width = Math.round(p * 100) + '%'; if (p >= 1) { prog.classList.add('indet'); status.textContent = 'Exécution des instructions…'; } })
        : await api('import', { ...fields, backup: chosen });
      prog.classList.add('hidden'); status.textContent = '';
      append(out, h('div', { class: r.errors.length ? 'warnbox' : 'okbox' },
        `${fmtNum(r.statements)} instruction(s) exécutée(s) en ${r.seconds} s (${fmtBytes(r.bytes)} lus)` + (r.halted ? ' — INTERROMPU sur une erreur.' : r.errors.length ? ` — ${r.errors.length} erreur(s).` : '. Aucune erreur.')),
      r.errors.map((e) => errBox(`#${e.n} ${e.sql}\n→ ${e.error}`)));
      schemaChanged({ server, db: target.value || undefined }); schemaChanged({ server });
      m.setFoot([btn('Fermer', 'primary', () => m.close())]);
    } catch (e) {
      prog.classList.add('hidden'); status.textContent = ''; out.append(errBox(e.message)); run.disabled = false;
    }
  }
  setMode('file');
}

// ── Opérations sur les tables ────────────────────────────────────────────────
const dbList = async (server) => (state.server === server && state.dbs.length ? state.dbs : (await api('dbs', { s: server })).dbs);

/** Renommer, et/ou déplacer vers une autre base. */
export async function dlgRenameTable(server, db, table) {
  const dbs = await dbList(server);
  const name = h('input', { type: 'text', value: table });
  const target = h('select', { style: { width: '100%' } }, dbs.filter((d) => !d.system).map((d) => h('option', { value: d.name }, d.name))); target.value = db;
  return sqlForm({
    server, db, title: `Renommer / déplacer « ${table} »`, confirmLabel: 'Renommer', affects: [db, target.value],
    body: h('div', { class: 'form' }, h('label', null, 'Nouveau nom'), name, h('label', null, 'Base'), target),
    build: () => {
      const n = name.value.trim();
      if (!n) return { error: 'Saisissez un nom.' };
      if (n === table && target.value === db) return { error: 'Rien ne change.' };
      return `RENAME TABLE ${qt(db, table)} TO ${qt(target.value, n)};`;
    },
  });
}

/** Dupliquer une table (même base ou autre base), avec ou sans les données. */
export async function dlgCopyTable(server, db, table) {
  const dbs = await dbList(server);
  const name = h('input', { type: 'text', value: table + '_copy' });
  const target = h('select', { style: { width: '100%' } }, dbs.filter((d) => !d.system).map((d) => h('option', { value: d.name }, d.name))); target.value = db;
  const withData = h('input', { type: 'checkbox', checked: true });
  return sqlForm({
    server, db, title: `Dupliquer « ${table} »`, confirmLabel: 'Dupliquer', affects: [null],
    note: 'La copie reprend les colonnes et les index ; les clés étrangères et les déclencheurs ne sont pas copiés.',
    body: h('div', { class: 'form' }, h('label', null, 'Nom de la copie'), name, h('label', null, 'Base'), target, h('label', null, 'Contenu'), h('label', { class: 'chk' }, withData, 'Copier aussi les données')),
    build: () => {
      const n = name.value.trim();
      if (!n) return { error: 'Saisissez un nom.' };
      let s = `CREATE TABLE ${qt(target.value, n)} LIKE ${qt(db, table)};`;
      if (withData.checked) s += `\nINSERT INTO ${qt(target.value, n)} SELECT * FROM ${qt(db, table)};`;
      return s;
    },
  }).then((r) => { if (r) { schemaChanged({ server, db: target.value }); } return r; });
}

/** items = [{name, view}] */
export function dlgDropTables(server, db, items) {
  const tbl = items.filter((i) => !i.view).map((i) => qt(db, i.name)); const vw = items.filter((i) => i.view).map((i) => qt(db, i.name));
  return sqlForm({
    server, db, danger: true, confirmLabel: 'Supprimer', title: items.length > 1 ? `Supprimer ${items.length} tables` : `Supprimer « ${items[0].name} »`,
    note: 'Suppression définitive des données.',
    build: () => [tbl.length ? `DROP TABLE ${tbl.join(',\n  ')};` : '', vw.length ? `DROP VIEW ${vw.join(', ')};` : ''].filter(Boolean).join('\n'),
  });
}

export function dlgTruncate(server, db, names) {
  const fk = h('input', { type: 'checkbox' });
  return sqlForm({
    server, db, danger: true, confirmLabel: 'Vider', title: names.length > 1 ? `Vider ${names.length} tables` : `Vider « ${names[0]} »`,
    note: 'Toutes les lignes sont supprimées (le compteur AUTO_INCREMENT repart à 1).',
    body: h('label', { class: 'chk', style: { marginTop: '8px' } }, fk, 'Ignorer les clés étrangères pendant l\'opération'),
    build: () => (fk.checked ? 'SET FOREIGN_KEY_CHECKS = 0;\n' : '') + names.map((n) => `TRUNCATE TABLE ${qt(db, n)};`).join('\n') + (fk.checked ? '\nSET FOREIGN_KEY_CHECKS = 1;' : ''),
  });
}

/** op = OPTIMIZE | ANALYZE | CHECK | REPAIR */
export function dlgMaintenance(server, db, names, op) {
  return sqlForm({
    server, db, title: `${op} TABLE`, confirmLabel: 'Lancer', affects: [db],
    build: () => `${op} TABLE ${names.map((n) => qt(db, n)).join(', ')};`,
  });
}

export { loadDbs };
