'use strict';
/**
 * Serveurs MySQL / MariaDB. Un serveur « mysql » est créé au premier démarrage ;
 * on peut en ajouter d'autres et changer de version (les bases sont alors
 * sauvegardées puis réimportées, l'ancien volume est conservé).
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const catalog = require('./catalog');
const docker = require('./docker');
const store = require('./store');
const jobs = require('./jobs');

const SYSTEM_DBS = ['mysql', 'information_schema', 'performance_schema', 'sys'];

function containerName(inst) {
  return inst.default ? 'ds-mysql' : `ds-db-${inst.id}`;
}

function engine(inst) {
  return catalog.DB_ENGINES[inst.engine] || catalog.DB_ENGINES.mysql;
}

function image(inst) {
  return `${engine(inst).image}:${inst.version}`;
}

async function platformFor(inst) {
  if (!engine(inst).amd64Only.includes(inst.version)) return undefined;
  const info = await docker.info().catch(() => ({}));
  return /arm|aarch/i.test(info.Architecture || '') ? 'linux/amd64' : undefined;
}

function label(inst) {
  return `${engine(inst).label} ${inst.version}`;
}

function args(inst) {
  const a = ['--character-set-server=utf8mb4', '--collation-server=utf8mb4_unicode_ci', '--max-allowed-packet=512M'];
  if (inst.sqlMode === 'permissive') a.push('--sql-mode=');
  if (inst.engine === 'mysql') {
    // Comptes compatibles avec les anciennes versions de PHP (mysqlnd < 7.4).
    if (inst.version === '8.0') a.push('--default-authentication-plugin=mysql_native_password');
    if (catalog.cmp(inst.version, '8.4') >= 0) a.push('--mysql-native-password=ON');
  }
  return a;
}

/** Client en ligne de commande : « mariadb » sur les images récentes, sinon « mysql ». */
function sh(script) {
  return ['sh', '-c', `if command -v mariadb >/dev/null 2>&1; then C=mariadb; D=mariadb-dump; else C=mysql; D=mysqldump; fi; ${script}`];
}

const ENV = [`MYSQL_PWD=${cfg.dbPassword}`];

function run(inst, sql, password) {
  return docker.exec(containerName(inst), sh(`$C -uroot -h127.0.0.1 --protocol=TCP -N -B -e "$1"`).concat(['sh', sql]), { env: [`MYSQL_PWD=${password}`] });
}

async function query(inst, sql) {
  let res = await run(inst, sql, cfg.dbPassword);
  if (res.code !== 0 && /Access denied/i.test(res.stderr) && await resetLegacyPassword(inst)) {
    res = await run(inst, sql, cfg.dbPassword);
  }
  if (res.code !== 0) throw new Error((res.stderr || res.stdout).replace(/^.*Warning.*\n?/gm, '').trim() || 'Requête refusée');
  return res.stdout.split('\n').filter(Boolean).map((l) => l.split('\t'));
}

/**
 * Serveur créé par une ancienne version de docker-server (root / root) :
 * on remet le mot de passe root à vide, sans toucher aux données.
 */
async function resetLegacyPassword(inst) {
  for (const old of cfg.legacyDbPasswords) {
    const hosts = await run(inst, "SELECT host FROM mysql.user WHERE user = 'root'", old);
    if (hosts.code !== 0) continue;
    for (const host of hosts.stdout.split('\n').filter(Boolean)) {
      const account = `'root'@'${host.replace(/'/g, '')}'`;
      const r = await run(inst, `ALTER USER ${account} IDENTIFIED BY '${cfg.dbPassword}'`, old);
      // MySQL 5.6 ne connaît pas ALTER USER … IDENTIFIED BY.
      if (r.code !== 0) await run(inst, `SET PASSWORD FOR ${account} = PASSWORD('${cfg.dbPassword}')`, old);
    }
    await run(inst, 'FLUSH PRIVILEGES', old);
    console.log(`[mysql] ${inst.id} : mot de passe root remis à vide (ancienne configuration).`);
    return true;
  }
  return false;
}

async function waitReady(inst, job, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const c = await docker.inspect(containerName(inst));
    if (!c) throw new Error('Le container a disparu');
    if (!c.State.Running) {
      const logs = await tailLogs(containerName(inst));
      throw new Error(`Le serveur s'est arrêté au démarrage.\n${logs}`);
    }
    try {
      await query(inst, 'SELECT 1');
      return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Le serveur ne répond pas après 3 minutes');
}

async function tailLogs(name, n = 15) {
  const lines = [];
  await new Promise((resolve) => {
    docker.logs(name, { tail: n, follow: false, onLine: (s, l) => lines.push(l.replace(/^\S+Z /, '')), onEnd: resolve });
  });
  return lines.join('\n');
}

function spec(inst) {
  return {
    Image: image(inst),
    Cmd: args(inst),
    // Root sans mot de passe (cfg.dbPassword vide), accessible depuis les projets.
    Env: inst.engine === 'mariadb'
      ? [cfg.dbPassword ? `MARIADB_ROOT_PASSWORD=${cfg.dbPassword}` : 'MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1', 'MARIADB_ROOT_HOST=%', `TZ=${cfg.timezone}`]
      : [cfg.dbPassword ? `MYSQL_ROOT_PASSWORD=${cfg.dbPassword}` : 'MYSQL_ALLOW_EMPTY_PASSWORD=yes', 'MYSQL_ROOT_HOST=%', `TZ=${cfg.timezone}`],
    Labels: { [cfg.LABEL]: 'mysql', 'docker-server.id': inst.id },
    ExposedPorts: { '3306/tcp': {} },
    HostConfig: {
      Mounts: [
        { Type: 'volume', Source: inst.volume, Target: '/var/lib/mysql' },
        { Type: 'bind', Source: `${cfg.hostRoot}/data/backups`, Target: '/backups' },
      ],
      PortBindings: { '3306/tcp': [{ HostIp: cfg.bindIp, HostPort: String(inst.port) }] },
      RestartPolicy: { Name: 'unless-stopped' },
      NetworkMode: cfg.NETWORK,
    },
    NetworkingConfig: { EndpointsConfig: { [cfg.NETWORK]: { Aliases: [inst.id] } } },
  };
}

function usedPorts(exceptId) {
  return Object.values(store.get().mysql).filter((i) => i.id !== exceptId).map((i) => i.port);
}

/**
 * Crée le container (image téléchargée si besoin) et le démarre. Si le port est
 * déjà pris sur la machine, on prend le suivant et on le dit.
 */
async function provision(inst, job) {
  const name = containerName(inst);
  fs.mkdirSync(path.join(cfg.DATA_DIR, 'backups'), { recursive: true });
  const platform = await platformFor(inst);
  if (!(await docker.imageExists(image(inst)))) {
    job.step(`Téléchargement de ${label(inst)}`);
    let last = '';
    await docker.pull(image(inst), {
      platform,
      onEvent: (ev) => {
        if (ev.status && ev.status !== last && !ev.progressDetail?.current) { last = ev.status; job.log(ev.id ? `${ev.id} : ${ev.status}` : ev.status); }
      },
    });
  }
  job.step(`Démarrage de ${label(inst)}`);
  for (let attempt = 0; attempt < 15; attempt++) {
    await docker.remove(name);
    await docker.create(name, spec(inst), platform);
    try {
      await docker.start(name);
      break;
    } catch (e) {
      if (!/port is already allocated|address already in use|bind/i.test(e.message) || attempt === 14) throw e;
      const used = usedPorts(inst.id);
      let next = inst.port + 1;
      while (used.includes(next)) next++;
      job.log(`Le port ${inst.port} est déjà utilisé sur votre machine : passage au port ${next}.`);
      inst.port = next;
      store.update((s) => { if (s.mysql[inst.id]) s.mysql[inst.id].port = next; });
    }
  }
  job.step('Attente de la disponibilité du serveur');
  await waitReady(inst, job);
  job.log(`${label(inst)} prêt sur 127.0.0.1:${inst.port} (depuis les projets : ${inst.id}:3306).`);
}

/** Crée le serveur par défaut au tout premier démarrage. */
function ensureDefault() {
  const s = store.get();
  if (Object.values(s.mysql).some((i) => i.default)) return null;
  const [eng, ver] = cfg.mysqlVersion.includes(':') ? cfg.mysqlVersion.split(':') : ['mysql', cfg.mysqlVersion];
  const inst = {
    id: 'mysql', engine: catalog.DB_ENGINES[eng] ? eng : 'mysql', version: ver, port: cfg.mysqlPort,
    volume: 'ds-mysql-data', sqlMode: 'permissive', default: true, createdAt: new Date().toISOString(),
  };
  store.update((st) => { st.mysql[inst.id] = inst; });
  return jobs.run(`Préparation de ${label(inst)}`, { key: `mysql:${inst.id}`, mysql: inst.id }, (job) => provision(inst, job));
}

/** Recrée les containers manquants (dossier copié sur un autre poste, container supprimé…). */
async function reconcile() {
  for (const inst of Object.values(store.get().mysql)) {
    const c = await docker.inspect(containerName(inst)).catch(() => null);
    if (!c) jobs.run(`Préparation de ${label(inst)}`, { key: `mysql:${inst.id}`, mysql: inst.id }, (job) => provision(inst, job));
    else if (!c.State.Running) await docker.start(containerName(inst)).catch((e) => console.error(`[mysql] ${inst.id} :`, e.message));
    // En arrière-plan : dès que le serveur répond, une éventuelle ancienne configuration est convertie.
    if (c) waitReady(inst, null, 120000).catch(() => null);
  }
}

function validateId(id) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) throw httpError(400, 'Identifiant invalide : lettres minuscules, chiffres et tirets (2 à 31 caractères).');
  if (store.get().mysql[id] || id === 'mysql') throw httpError(409, `Un serveur « ${id} » existe déjà.`);
  // L'identifiant devient le nom réseau du serveur : il ne doit pas masquer le nom réseau d'un projet.
  const project = Object.values(store.get().projects).find((p) => (p.aliases || []).includes(id));
  if (project) throw httpError(409, `« ${id} » est déjà le nom réseau du projet « ${project.name} ».`);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function create({ id, engine: eng, version, sqlMode }) {
  const e = catalog.DB_ENGINES[eng];
  if (!e || !e.versions.includes(version)) throw httpError(400, 'Moteur ou version inconnus.');
  validateId(id);
  const used = usedPorts();
  let port = Math.max(cfg.mysqlPort + 1, 3307);
  while (used.includes(port)) port++;
  const inst = {
    id, engine: eng, version, port, volume: `ds-db-${id}-${eng}${version.replace(/\./g, '')}`,
    sqlMode: sqlMode === 'strict' ? 'strict' : 'permissive', default: false, createdAt: new Date().toISOString(),
  };
  store.update((s) => { s.mysql[id] = inst; });
  return jobs.run(`Création du serveur ${label(inst)}`, { key: `mysql:${id}`, mysql: id }, (job) => provision(inst, job));
}

async function userDatabases(inst) {
  const rows = await query(inst, 'SHOW DATABASES');
  return rows.map((r) => r[0]).filter((d) => !SYSTEM_DBS.includes(d));
}

/** Sauvegarde des bases d'un serveur dans data/backups. Renvoie le nom du fichier (ou null si aucune base). */
async function dump(inst, job, suffix = '') {
  const dbs = await userDatabases(inst);
  if (!dbs.length) {
    job.log('Aucune base à sauvegarder.');
    return null;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = `${inst.id}-${inst.engine}${inst.version}-${stamp}${suffix}.sql`;
  job.log(`Sauvegarde de ${dbs.length} base(s) : ${dbs.join(', ')}`);
  const list = dbs.map((d) => `'${d.replace(/'/g, '')}'`).join(' ');
  const res = await docker.exec(containerName(inst), sh(
    `$D -uroot -h127.0.0.1 --protocol=TCP --single-transaction --routines --events --triggers --add-drop-database --databases ${list} > /backups/${file}`,
  ), { env: ENV });
  if (res.code !== 0) throw new Error(`Sauvegarde impossible : ${res.stderr.trim()}`);
  job.log(`Sauvegarde : data/backups/${file}`);
  return file;
}

function backup(id) {
  const inst = store.get().mysql[id];
  if (!inst) throw httpError(404, 'Serveur inconnu.');
  return jobs.run(`Sauvegarde de ${label(inst)}`, { key: `mysql:${id}`, mysql: id }, async (job) => {
    job.step('Export des bases');
    const file = await dump(inst, job);
    return { file };
  });
}

/** Changement de version / de moteur : sauvegarde → nouveau volume → réimport. */
function changeVersion(id, { engine: eng, version, sqlMode }) {
  const inst = store.get().mysql[id];
  if (!inst) throw httpError(404, 'Serveur inconnu.');
  const e = catalog.DB_ENGINES[eng || inst.engine];
  if (!e || !e.versions.includes(version)) throw httpError(400, 'Version inconnue.');
  const target = {
    ...inst, engine: eng || inst.engine, version,
    sqlMode: sqlMode || inst.sqlMode,
    volume: `${inst.default ? 'ds-mysql' : `ds-db-${id}`}-${eng || inst.engine}${version.replace(/\./g, '')}`,
  };
  const sameVolume = target.volume === inst.volume || (target.engine === inst.engine && target.version === inst.version);

  return jobs.run(`Passage de ${label(inst)} à ${label(target)}`, { key: `mysql:${id}`, mysql: id }, async (job) => {
    let file = null;
    const c = await docker.inspect(containerName(inst));
    if (c && !sameVolume) {
      if (!c.State.Running) {
        job.step('Démarrage de l\'ancien serveur pour la sauvegarde');
        await docker.start(containerName(inst));
        await waitReady(inst, job);
      }
      job.step('Sauvegarde des bases');
      file = await dump(inst, job, `-avant-${target.engine}${target.version}`);
    }
    if (sameVolume) target.volume = inst.volume;
    store.update((s) => { s.mysql[id] = target; });
    await provision(target, job);
    if (file) {
      job.step('Réimport des bases');
      const res = await docker.exec(containerName(target), sh(`$C -uroot -h127.0.0.1 --protocol=TCP < /backups/${file}`), { env: ENV });
      if (res.code !== 0) throw new Error(`Réimport incomplet : ${res.stderr.trim()} — la sauvegarde reste dans data/backups/${file}`);
      job.log('Bases réimportées.');
    }
    if (!sameVolume) job.log(`L'ancien volume « ${inst.volume} » est conservé (supprimable depuis Docker Desktop).`);
  });
}

async function remove(id, { purge = false } = {}) {
  const inst = store.get().mysql[id];
  if (!inst) throw httpError(404, 'Serveur inconnu.');
  if (inst.default) throw httpError(400, 'Le serveur par défaut ne peut pas être supprimé (changez plutôt sa version).');
  await docker.remove(containerName(inst));
  if (purge) {
    // Volume actuel + ceux conservés lors des changements de version.
    const prefix = `ds-db-${id}-`;
    const res = await docker.json('GET', `/volumes?filters=${encodeURIComponent(JSON.stringify({ name: [prefix] }))}`).catch(() => null);
    const names = new Set([inst.volume, ...(res?.Volumes || []).map((v) => v.Name).filter((n) => n.startsWith(prefix))]);
    for (const n of names) await docker.removeVolume(n);
  }
  store.update((s) => { delete s.mysql[id]; });
}

async function status(inst) {
  const c = await docker.inspect(containerName(inst)).catch(() => null);
  return c ? (c.State.Running ? 'running' : 'stopped') : 'missing';
}

async function databases(id) {
  const inst = store.get().mysql[id];
  if (!inst) throw httpError(404, 'Serveur inconnu.');
  const rows = await query(inst, `SELECT s.schema_name, COUNT(t.table_name), COALESCE(SUM(t.data_length + t.index_length), 0)
    FROM information_schema.schemata s LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name
    WHERE s.schema_name NOT IN ('${SYSTEM_DBS.join("','")}') GROUP BY s.schema_name ORDER BY s.schema_name`);
  return rows.map(([name, tables, size]) => ({ name, tables: Number(tables), size: Number(size) }));
}

function validDbName(name) {
  return /^[A-Za-z0-9_$-]{1,64}$/.test(name || '');
}

async function createDatabase(id, name) {
  const inst = store.get().mysql[id];
  if (!inst) throw httpError(404, 'Serveur inconnu.');
  if (!validDbName(name)) throw httpError(400, 'Nom de base invalide : lettres, chiffres, _ et - (64 caractères max).');
  await query(inst, `CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
}

async function dropDatabase(id, name) {
  const inst = store.get().mysql[id];
  if (!inst || !validDbName(name) || SYSTEM_DBS.includes(name)) throw httpError(400, 'Base invalide.');
  await query(inst, `DROP DATABASE IF EXISTS \`${name}\``);
}

function defaultInstance() {
  return Object.values(store.get().mysql).find((i) => i.default) || null;
}

module.exports = {
  containerName, label, image, ensureDefault, reconcile, create, changeVersion, remove, status,
  databases, createDatabase, dropDatabase, backup, waitReady, defaultInstance, validDbName, httpError,
};
