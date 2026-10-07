// Page « Bases de données » : serveurs MySQL / MariaDB, bases, versions.
import {
  h, icon, get, post, put, del, store, refresh, replace, toast, errorToast, modal, menu, confirmDialog,
  field, statusPill, codeValue, fmtBytes, passwordValue,
} from '../lib.js';
import { pageHeader } from './projects.js';

function engineLabel(e) {
  return store.catalog.db[e]?.label || e;
}

function versionSelect(engine, value) {
  const s = h('select.input', store.catalog.db[engine].versions.map((v) => h('option', { value: v }, `${engineLabel(engine)} ${v}`)));
  if (value) s.value = value;
  return s;
}

function engineSeg(value, onChange) {
  const btns = Object.keys(store.catalog.db).map((e) => h('button', { type: 'button', onclick: () => set(e) }, icon('database', 15), engineLabel(e)));
  const seg = h('div.seg.seg-wide', btns);
  function set(e) {
    Object.keys(store.catalog.db).forEach((k, i) => btns[i].classList.toggle('active', k === e));
    onChange(e);
  }
  set(value);
  return seg;
}

function newServer() {
  const ov = store.overview;
  let engine = 'mysql';
  const verBox = h('div');
  let ver = null;
  const id = h('input.input', { placeholder: 'mysql8' });
  let idTouched = false;
  id.addEventListener('input', () => { idTouched = true; });
  const suggest = () => {
    if (idTouched) return;
    const base = `${engine}${(ver?.value || '').split('.')[0]}`;
    let s = base;
    let i = 2;
    while (ov.mysql.some((m) => m.id === s)) s = `${base}-${i++}`;
    id.value = s;
  };
  const paintVer = () => {
    ver = versionSelect(engine);
    ver.addEventListener('change', suggest);
    replace(verBox, field('Version', ver));
    suggest();
  };
  const strict = h('select.input',
    h('option', { value: 'permissive' }, 'Permissif — compatible anciens projets (recommandé)'),
    h('option', { value: 'strict' }, 'Strict — comportement par défaut de MySQL'));
  const seg = engineSeg(engine, (e) => { engine = e; paintVer(); });
  paintVer();
  modal({
    title: 'Nouveau serveur de base de données',
    subtitle: 'Il tourne à côté des autres : chaque projet choisit le sien.',
    icon: 'database',
    body: h('div.form-stack', seg, h('div.grid-2', verBox, field('Identifiant', id, 'C\'est aussi le nom d\'hôte à utiliser depuis les projets.')), field('Mode SQL', strict)),
    actions: [{ label: 'Annuler' }, {
      label: 'Créer le serveur', variant: 'primary', icon: 'plus', onClick: async () => {
        await post('/api/mysql', { id: id.value.trim(), engine, version: ver.value, sqlMode: strict.value });
        toast('Création du serveur en cours…');
        await refresh();
      },
    }],
  });
}

function changeVersion(inst) {
  let engine = inst.engine;
  const verBox = h('div');
  let ver = null;
  const paintVer = () => { ver = versionSelect(engine, engine === inst.engine ? inst.version : null); replace(verBox, field('Nouvelle version', ver)); };
  const strict = h('select.input',
    h('option', { value: 'permissive' }, 'Permissif — compatible anciens projets'),
    h('option', { value: 'strict' }, 'Strict — comportement par défaut de MySQL'));
  strict.value = inst.sqlMode || 'permissive';
  const seg = engineSeg(engine, (e) => { engine = e; paintVer(); });
  paintVer();
  modal({
    title: `Changer la version de ${inst.label}`,
    icon: 'refresh',
    body: h('div.form-stack',
      seg, h('div.grid-2', verBox, field('Mode SQL', strict)),
      h('div.banner.banner-info', icon('shield', 18), h('div.banner-body',
        h('strong', 'Vos données sont protégées'),
        h('p', 'Les bases sont d\'abord sauvegardées dans data/backups, le nouveau serveur est créé, puis elles sont réimportées automatiquement. L\'ancien volume de données est conservé.')))),
    actions: [{ label: 'Annuler' }, {
      label: 'Changer de version', variant: 'primary', onClick: async () => {
        if (engine === inst.engine && ver.value === inst.version && strict.value === inst.sqlMode) return true;
        await put(`/api/mysql/${inst.id}`, { engine, version: ver.value, sqlMode: strict.value });
        toast('Changement de version en cours…');
        await refresh();
      },
    }],
  });
}

function instanceCard(inst, ov, onDbsChanged) {
  const running = inst.status === 'running';
  const dbBox = h('div.db-list');
  const moreBtn = h('button.btn.btn-icon.btn-ghost', { type: 'button', title: 'Plus d\'actions' }, icon('more', 18));
  moreBtn.addEventListener('click', () => menu(moreBtn, [
    { label: 'Changer de version…', icon: 'refresh', onClick: () => changeVersion(inst) },
    { label: 'Sauvegarder toutes les bases', icon: 'download', disabled: !running, onClick: () => post(`/api/mysql/${inst.id}/backup`).then(() => { toast('Sauvegarde en cours…'); refresh(); }, errorToast) },
    { label: 'Redémarrer', icon: 'restart', disabled: !running, onClick: () => post(`/api/mysql/${inst.id}/restart`).then(() => { toast('Serveur redémarré', { type: 'success' }); refresh(); }, errorToast) },
    'sep',
    { label: 'Supprimer le serveur', icon: 'trash', danger: true, disabled: inst.default, onClick: () => removeServer(inst) },
  ]));

  const startStop = running
    ? h('button.btn.btn-sm', { type: 'button', onclick: (e) => simple(e, `/api/mysql/${inst.id}/stop`) }, icon('stop', 14), 'Arrêter')
    : h('button.btn.btn-sm', { type: 'button', disabled: inst.status === 'working', onclick: (e) => simple(e, `/api/mysql/${inst.id}/start`) }, icon('play', 14), 'Démarrer');

  const el = h('section.card.db-card',
    h('div.db-head',
      h('span.db-icon', icon('database', 20)),
      h('div.db-title',
        h('h3', inst.label, inst.default ? h('span.tag', 'par défaut') : null),
        h('span.muted', `${inst.sqlMode === 'strict' ? 'Mode strict' : 'Mode permissif'} · conteneur ${inst.container}`)),
      statusPill(inst.status),
      startStop,
      moreBtn),
    h('div.conn-grid',
      h('div.conn', h('span.conn-label', 'Depuis vos projets'), codeValue(`${inst.id}:3306`)),
      h('div.conn', h('span.conn-label', 'Depuis votre PC'), codeValue(`127.0.0.1:${inst.port}`)),
      h('div.conn', h('span.conn-label', 'Utilisateur'), codeValue('root')),
      h('div.conn', h('span.conn-label', 'Mot de passe'), passwordValue(ov.config.dbPassword))),
    h('div.db-section-head',
      h('h4', 'Bases'),
      h('div.db-section-actions',
        h('button.btn.btn-sm', { type: 'button', disabled: !running, onclick: () => createDb(inst, onDbsChanged) }, icon('plus', 14), 'Créer une base'),
        h('a.btn.btn-sm', { href: `${ov.config.dbadminUrl}/?server=${encodeURIComponent(inst.id)}`, target: '_blank', rel: 'noopener' }, icon('table', 14), 'DB Admin'))),
    dbBox);

  async function loadDbs() {
    if (!running) { replace(dbBox, h('p.muted.db-empty', inst.status === 'working' ? 'Opération en cours…' : 'Serveur arrêté.')); return; }
    try {
      const dbs = await get(`/api/mysql/${inst.id}/databases`);
      const projects = store.overview.projects;
      replace(dbBox, dbs.length ? h('table.table',
        h('thead', h('tr', h('th', 'Nom'), h('th', 'Utilisée par'), h('th.num', 'Tables'), h('th.num', 'Taille'), h('th'))),
        h('tbody', dbs.map((d) => {
          const users = projects.filter((p) => p.database?.instance === inst.id && p.database?.name === d.name);
          return h('tr',
            h('td', h('code', d.name)),
            h('td', users.length ? users.map((p) => h('a.tag', { href: `#/projects/${p.slug}` }, p.name)) : h('span.muted', '—')),
            h('td.num', d.tables),
            h('td.num', fmtBytes(d.size)),
            h('td.row-actions',
              h('a.btn.btn-ghost.btn-sm', { href: `${ov.config.dbadminUrl}/?server=${encodeURIComponent(inst.id)}&db=${encodeURIComponent(d.name)}`, target: '_blank', rel: 'noopener', title: 'Ouvrir dans DB Admin' }, icon('external', 14)),
              h('button.btn.btn-ghost.btn-sm.btn-icon', { type: 'button', title: 'Supprimer la base', onclick: () => dropDb(inst, d.name, onDbsChanged) }, icon('trash', 14))));
        }))) : h('p.muted.db-empty', 'Aucune base pour l\'instant.'));
    } catch (e) {
      replace(dbBox, h('p.muted.db-empty', `Bases indisponibles : ${e.message}`));
    }
  }
  loadDbs();
  return el;
}

async function simple(e, url) {
  const btn = e.currentTarget;
  btn.classList.add('busy');
  try { await post(url); await refresh(); } catch (err) { errorToast(err); btn.classList.remove('busy'); }
}

function createDb(inst, done) {
  const name = h('input.input', { placeholder: 'ma_base' });
  modal({
    title: 'Créer une base',
    subtitle: `Sur ${inst.label} — encodage utf8mb4`,
    icon: 'database',
    size: 'sm',
    body: field('Nom', name, 'Lettres, chiffres, _ et -.'),
    actions: [{ label: 'Annuler' }, {
      label: 'Créer', variant: 'primary', onClick: async () => {
        await post(`/api/mysql/${inst.id}/databases`, { name: name.value.trim() });
        toast(`Base « ${name.value.trim()} » créée`, { type: 'success' });
        done();
      },
    }],
  });
}

async function dropDb(inst, name, done) {
  const ok = await confirmDialog({
    title: `Supprimer la base « ${name} » ?`,
    message: 'Toutes ses tables et données seront définitivement effacées. Pensez à la sauvegarder avant si besoin.',
    confirmLabel: 'Supprimer définitivement',
    danger: true,
  });
  if (!ok) return;
  try {
    await del(`/api/mysql/${inst.id}/databases/${encodeURIComponent(name)}`);
    toast(`Base « ${name} » supprimée`, { type: 'success' });
    done();
  } catch (e) { errorToast(e); }
}

async function removeServer(inst) {
  const r = await confirmDialog({
    title: `Supprimer le serveur ${inst.label} ?`,
    message: 'Le container est supprimé. Par défaut, les données sont conservées dans leur volume Docker.',
    confirmLabel: 'Supprimer le serveur',
    danger: true,
    checkbox: { label: 'Supprimer aussi toutes les données (irréversible)', checked: false },
  });
  if (!r) return;
  try {
    await del(`/api/mysql/${inst.id}${r.checked ? '?purge=1' : ''}`);
    toast('Serveur supprimé', { type: 'success' });
    await refresh();
  } catch (e) { errorToast(e); }
}

export function mount(root) {
  const list = h('div.db-cards');
  root.append(h('div.page',
    pageHeader('Bases de données', 'Serveurs MySQL et MariaDB. Utilisateur root, sans mot de passe.', [
      h('button.btn.btn-primary', { type: 'button', onclick: newServer }, icon('plus', 16), 'Nouveau serveur'),
    ]),
    list));
  let sig = '';
  const paint = (ov) => {
    replace(list, ov.mysql.length ? ov.mysql.map((i) => instanceCard(i, ov, () => paint(store.overview)))
      : h('div.empty', icon('database', 28), h('h3', 'Préparation du serveur MySQL…'), h('p.muted', 'Il sera prêt dans quelques instants.')));
  };
  return {
    update(ov) {
      const s = JSON.stringify(ov.mysql.map((i) => [i.id, i.status, i.version, i.engine, i.port, i.sqlMode]));
      if (s === sig) return;
      sig = s;
      paint(ov);
    },
  };
}
