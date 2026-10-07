'use strict';
/**
 * Projets : un dossier de repo/ servi par un container PHP + Apache,
 * joignable sur http(s)://<nom>.localhost.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const catalog = require('./catalog');
const detect = require('./detect');
const docker = require('./docker');
const images = require('./images');
const jobs = require('./jobs');
const mysql = require('./mysql');
const proxy = require('./proxy');
const store = require('./store');

const RESERVED = ['proxy', 'dashboard', 'dbadmin', 'mailpit', 'ftp', 'mysql', 'localhost', 'www'];
const RESERVED_HOSTS = ['localhost', 'dbadmin.localhost', 'mailpit.localhost', 'ds-dashboard'];
// Toute adresse est permise : « blog.localhost », « blog.test », ou un nom seul comme « local-blog ».
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const WEBROOT = '/var/www/html';

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const containerName = (p) => `ds-${p.slug}`;
const iniPath = (slug) => path.join(cfg.DATA_DIR, 'projects', slug, 'php.ini');
const key = (slug) => `project:${slug}`;

function get(slug) {
  const p = store.get().projects[slug];
  if (!p) throw httpError(404, `Projet « ${slug} » introuvable.`);
  return p;
}

function docrootPath(p) {
  return p.docroot ? `${WEBROOT}/${p.docroot}` : WEBROOT;
}

/** Propriétaire du dossier (Linux) : Apache et le terminal tournent sous cet utilisateur. */
function owner(folder) {
  try {
    const st = fs.statSync(path.join(cfg.REPO_DIR, folder));
    return { uid: st.uid, gid: st.gid };
  } catch {
    return { uid: 0, gid: 0 };
  }
}

function writeIni(p) {
  store.writeInPlace(iniPath(p.slug), images.phpIni({ ...p, timezone: store.get().settings.timezone }));
}

function containerSpec(p, tag) {
  const own = owner(p.folder);
  const env = [
    `APACHE_DOCUMENT_ROOT=${docrootPath(p)}`,
    `PHP_IDE_CONFIG=serverName=${p.domains[0] || `${p.slug}.localhost`}`,
    `TZ=${store.get().settings.timezone}`,
  ];
  if (own.uid) env.push(`APACHE_RUN_USER=#${own.uid}`, `APACHE_RUN_GROUP=#${own.gid}`);
  const spec = {
    Image: tag,
    Hostname: p.slug.slice(0, 63),
    Env: env,
    Labels: { [cfg.LABEL]: 'project', 'docker-server.slug': p.slug },
    HostConfig: {
      Mounts: [
        { Type: 'bind', Source: `${cfg.hostRoot}/repo/${p.folder}`, Target: WEBROOT },
        { Type: 'bind', Source: `${cfg.hostRoot}/data/projects/${p.slug}/php.ini`, Target: '/usr/local/etc/php/conf.d/zz-docker-server.ini', ReadOnly: true },
      ],
      RestartPolicy: { Name: 'unless-stopped' },
      ExtraHosts: ['host.docker.internal:host-gateway'],
      NetworkMode: cfg.NETWORK,
    },
  };
  spec.Labels['docker-server.spec'] = crypto.createHash('sha1').update(JSON.stringify(spec)).digest('hex').slice(0, 12);
  return spec;
}

/** Construit l'image si besoin, (re)crée le container si sa définition a changé, le démarre. */
async function ensureRunning(p, job, { restart = false } = {}) {
  job.step(`Image PHP ${p.php}`);
  const tag = await images.ensure(p, job);
  writeIni(p);
  const spec = containerSpec(p, tag);
  const name = containerName(p);
  const c = await docker.inspect(name);
  if (c && c.Config.Labels?.['docker-server.spec'] === spec.Labels['docker-server.spec']) {
    job.step('Démarrage du container');
    if (restart && c.State.Running) await docker.restart(name);
    else await docker.start(name);
  } else {
    job.step(c ? 'Recréation du container' : 'Création du container');
    await docker.remove(name);
    await docker.create(name, spec);
    await docker.start(name);
  }
  store.update((s) => {
    if (!s.projects[p.slug]) return;
    s.projects[p.slug].image = tag;
    s.projects[p.slug].stopped = false;
    delete s.projects[p.slug].error;
  });
  job.step('Routage http / https');
  await proxy.apply();
  job.log(`En ligne : ${proxy.url(p.domains[0], true)}`);
}

/** Lance une tâche sur un projet et mémorise l'erreur éventuelle pour l'afficher. */
function runJob(p, title, fn) {
  const job = jobs.run(title, { key: key(p.slug), project: p.slug }, fn);
  job.once('ended', () => {
    if (job.status === 'failed') store.update((s) => { if (s.projects[p.slug]) s.projects[p.slug].error = job.error; });
  });
  return job;
}

// ── Validation ────────────────────────────────────────────────────────────

function validFolder(folder) {
  if (!folder || /[\\/]|^\.\.?$/.test(folder) || folder.startsWith('.')) return false;
  try {
    return fs.statSync(path.join(cfg.REPO_DIR, folder)).isDirectory();
  } catch {
    return false;
  }
}

function freeSlug(base, except) {
  const projects = store.get().projects;
  let slug = base;
  let i = 2;
  while (RESERVED.includes(slug) || /^db-/.test(slug) || (projects[slug] && slug !== except)) slug = `${base}-${i++}`;
  return slug;
}

function normalizeDomains(list, slug) {
  const out = [];
  for (const raw of list || []) {
    const d = String(raw).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
    if (!d) continue;
    if (!HOST_RE.test(d)) throw httpError(400, `Adresse invalide : « ${d} ».`);
    if (RESERVED_HOSTS.includes(d)) throw httpError(400, `L'adresse « ${d} » est réservée au tableau de bord.`);
    const other = Object.values(store.get().projects).find((p) => p.slug !== slug && (p.domains || []).includes(d));
    if (other) throw httpError(409, `L'adresse « ${d} » est déjà utilisée par le projet « ${other.name} ».`);
    if (!out.includes(d)) out.push(d);
  }
  if (!out.length) out.push(`${slug}.localhost`);
  return out;
}

function normalize(input, base) {
  const p = { ...base };
  if (input.name !== undefined) p.name = String(input.name).trim().slice(0, 60) || p.name;
  if (input.php !== undefined) {
    if (!catalog.PHP_VERSIONS.some((v) => v.v === input.php)) throw httpError(400, 'Version de PHP inconnue.');
    p.php = input.php;
  }
  if (input.extensions !== undefined) p.extensions = input.extensions;
  p.extensions = catalog.filterExtensions(p.extensions || [], p.php);
  if (input.node !== undefined) p.node = !!input.node;
  if (input.docroot !== undefined) {
    const d = String(input.docroot || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (d.split('/').includes('..')) throw httpError(400, 'Dossier public invalide.');
    p.docroot = d;
  }
  if (input.xdebug !== undefined) {
    if (!['off', 'trigger', 'on'].includes(input.xdebug)) throw httpError(400, 'Mode Xdebug inconnu.');
    p.xdebug = input.xdebug;
  }
  if (input.ini !== undefined) {
    const ini = {};
    for (const [k, v] of Object.entries(input.ini || {})) {
      if (k in catalog.PHP_INI_DEFAULTS && /^[A-Za-z0-9_&~|^ .-]{1,60}$/.test(String(v))) ini[k] = String(v).trim();
    }
    p.ini = ini;
  }
  if (input.iniExtra !== undefined) p.iniExtra = String(input.iniExtra || '').slice(0, 5000);
  if (input.domains !== undefined) p.domains = normalizeDomains(input.domains, p.slug);
  if (input.httpsRedirect !== undefined) p.httpsRedirect = !!input.httpsRedirect;
  if (input.database !== undefined) {
    if (input.database && input.database.name) {
      const inst = input.database.instance || mysql.defaultInstance()?.id;
      if (!store.get().mysql[inst]) throw httpError(400, 'Serveur de base de données inconnu.');
      if (!mysql.validDbName(input.database.name)) throw httpError(400, 'Nom de base invalide : lettres, chiffres, _ et -.');
      p.database = { instance: inst, name: input.database.name };
    } else {
      p.database = null;
    }
  }
  return p;
}

// ── Opérations ────────────────────────────────────────────────────────────

/** Crée un dossier dans repo/ (vide ou avec une page d'accueil). */
function createFolder(name, template) {
  const folder = String(name || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/.test(folder)) throw httpError(400, 'Nom de dossier invalide : lettres, chiffres, point, tiret et _.');
  const dir = path.join(cfg.REPO_DIR, folder);
  if (fs.existsSync(dir)) throw httpError(409, `Le dossier repo/${folder} existe déjà.`);
  fs.mkdirSync(dir, { recursive: true });
  if (template !== 'empty') {
    fs.copyFileSync(path.join(cfg.SERVER_DIR, 'templates', 'welcome.php'), path.join(dir, 'index.php'));
  }
  giveToOwner(dir, cfg.REPO_DIR);
  return folder;
}

/** Linux : ce que crée le tableau de bord (root) doit appartenir à l'utilisateur, comme le dossier parent. */
function giveToOwner(target, reference) {
  try {
    const { uid, gid } = fs.statSync(reference);
    if (!uid) return;
    const walk = (p) => {
      fs.chownSync(p, uid, gid);
      if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f));
    };
    walk(target);
  } catch { /* Windows / macOS : sans objet */ }
}

/** Ajoute un projet. Tout ce qui n'est pas fourni est détecté automatiquement. */
function create(input) {
  if (input.newFolder) input.folder = createFolder(input.newFolder, input.template);
  const folder = input.folder;
  if (!validFolder(folder)) throw httpError(400, `Le dossier repo/${folder || ''} est introuvable.`);
  const used = Object.values(store.get().projects).find((p) => p.folder === folder);
  if (used) throw httpError(409, `Ce dossier est déjà servi par le projet « ${used.name} ».`);

  const d = detect.detect(folder, store.get().settings.php);
  const slug = freeSlug(input.slug ? detect.slugify(input.slug) : d.slug);
  const defInst = mysql.defaultInstance();
  let p = {
    slug,
    name: d.name,
    folder,
    framework: d.framework,
    frameworkLabel: d.frameworkLabel,
    php: d.php,
    extensions: d.extensions,
    node: d.node,
    docroot: d.docroot,
    xdebug: 'trigger',
    ini: {},
    iniExtra: '',
    domains: [],
    httpsRedirect: false,
    database: d.database && defInst ? { instance: defInst.id, name: d.database } : null,
    createdAt: new Date().toISOString(),
  };
  p = normalize({ ...input, domains: input.domains || [] }, p);

  store.update((s) => { s.projects[slug] = p; });
  writeIni(p);
  return runJob(p, `Création du projet « ${p.name} »`, async (job) => {
    if (p.database) await ensureDatabase(p, job);
    await ensureRunning(p, job);
    return { slug, url: proxy.url(p.domains[0], true) };
  });
}

async function ensureDatabase(p, job) {
  const inst = store.get().mysql[p.database.instance];
  if (!inst) return;
  job.step(`Base de données « ${p.database.name} »`);
  try {
    await mysql.waitReady(inst, job, 120000);
    await mysql.createDatabase(inst.id, p.database.name);
    job.log(`Base « ${p.database.name} » prête sur ${mysql.label(inst)}.`);
  } catch (e) {
    // Non bloquant : le site peut fonctionner sans, et la base se crée aussi depuis l'onglet Bases.
    job.log(`⚠ Base non créée : ${e.message}`);
  }
}

/**
 * Applique une modification. Selon ce qui change : reconstruction de l'image,
 * recréation ou simple redémarrage du container, rechargement du proxy.
 */
async function update(slug, input) {
  const old = get(slug);
  const next = normalize(input, JSON.parse(JSON.stringify(old)));
  store.update((s) => { s.projects[slug] = next; });

  const imageChanged = images.tagFor(old) !== images.tagFor(next);
  const containerChanged = imageChanged || old.docroot !== next.docroot || old.domains[0] !== next.domains[0];
  const iniChanged = images.phpIni(old) !== images.phpIni(next);
  const proxyChanged = JSON.stringify(old.domains) !== JSON.stringify(next.domains) || old.httpsRedirect !== next.httpsRedirect;
  const dbChanged = JSON.stringify(old.database) !== JSON.stringify(next.database) && next.database;

  const c = await docker.inspect(containerName(next)).catch(() => null);
  const running = !!c?.State.Running;

  if (!containerChanged && !iniChanged && !dbChanged) {
    if (proxyChanged) await proxy.apply();
    return { job: null, impact: proxyChanged ? 'proxy' : 'none' };
  }

  const impact = imageChanged ? 'build' : containerChanged ? 'recreate' : iniChanged ? 'restart' : 'database';
  const title = imageChanged ? `Reconstruction de « ${next.name} » (PHP ${next.php})` : `Application des réglages de « ${next.name} »`;
  const job = runJob(next, title, async (j) => {
    if (dbChanged) await ensureDatabase(next, j);
    if (containerChanged && (running || !c)) {
      await ensureRunning(next, j);
      if (imageChanged) await pruneImages(j);
      return;
    }
    // php.ini / Xdebug : le fichier est monté, un redémarrage suffit (jamais de reconstruction).
    writeIni(next);
    if (proxyChanged) await proxy.apply();
    if (running && iniChanged) {
      j.step('Redémarrage du container');
      await docker.restart(containerName(next));
    } else if (!running) {
      j.log('Réglages enregistrés : ils s\'appliqueront au prochain démarrage.');
    }
  });
  return { job: job.summary(), impact };
}

async function pruneImages(job) {
  const used = Object.values(store.get().projects).map((p) => images.tagFor(p));
  const removed = await images.prune(used);
  if (removed.length) job?.log(`Images inutilisées supprimées : ${removed.join(', ')}`);
  return removed;
}

function start(slug) {
  const p = get(slug);
  return runJob(p, `Démarrage de « ${p.name} »`, (job) => ensureRunning(p, job));
}

async function stop(slug) {
  const p = get(slug);
  await docker.stop(containerName(p));
  store.update((s) => { s.projects[slug].stopped = true; });
}

async function restart(slug) {
  const p = get(slug);
  writeIni(p);
  await docker.restart(containerName(p));
}

function rebuild(slug) {
  const p = get(slug);
  return runJob(p, `Reconstruction de « ${p.name} »`, async (job) => {
    const tag = images.tagFor(p);
    const users = Object.values(store.get().projects).filter((x) => x.slug !== slug && images.tagFor(x) === tag);
    await docker.remove(containerName(p));
    if (!users.length) {
      job.step('Suppression de l\'ancienne image');
      await docker.removeImage(tag);
    } else {
      job.log(`Image partagée avec ${users.map((x) => x.name).join(', ')} : elle est réutilisée.`);
    }
    await ensureRunning(p, job);
  });
}

async function remove(slug, { dropDatabase = false } = {}) {
  const p = get(slug);
  await docker.remove(containerName(p));
  if (dropDatabase && p.database) {
    await mysql.dropDatabase(p.database.instance, p.database.name).catch(() => null);
  }
  store.update((s) => { delete s.projects[slug]; });
  fs.rmSync(path.join(cfg.DATA_DIR, 'projects', slug), { recursive: true, force: true });
  await proxy.apply().catch(() => null);
  await pruneImages().catch(() => null);
}

/** Commande dans le container (composer, artisan, npm…), sortie en direct. */
function command(slug, cmd) {
  const p = get(slug);
  const line = String(cmd || '').trim();
  if (!line) throw httpError(400, 'Commande vide.');
  const own = owner(p.folder);
  const job = jobs.run(line, { key: `exec:${slug}`, project: slug, command: true }, async (j) => {
    j.log(`$ ${line}`);
    const res = await docker.exec(containerName(p), ['sh', '-lc', line], {
      user: own.uid ? `${own.uid}:${own.gid}` : undefined,
      env: ['HOME=/tmp', 'COMPOSER_HOME=/tmp/composer', 'COMPOSER_ALLOW_SUPERUSER=1', 'TERM=dumb', 'NO_COLOR=1', 'COMPOSER_NO_INTERACTION=1'],
      workdir: WEBROOT,
      onLine: (s, l) => j.log(l),
    });
    if (res.code !== 0) throw new Error(`La commande s'est terminée avec le code ${res.code}`);
    return { code: 0 };
  });
  return job;
}

/** Recrée ce qui manque au démarrage du tableau de bord. */
async function reconcile() {
  const list = await docker.list(`${cfg.LABEL}=project`).catch(() => []);
  const bySlug = new Map(list.map((c) => [c.Labels?.['docker-server.slug'], c]));
  for (const p of Object.values(store.get().projects)) {
    writeIni(p);
    if (p.stopped) continue;
    const c = bySlug.get(p.slug);
    if (!c) runJob(p, `Préparation de « ${p.name} »`, (job) => ensureRunning(p, job));
    else if (c.State !== 'running') await docker.start(containerName(p)).catch((e) => console.error(`[projects] ${p.slug} :`, e.message));
  }
}

/** Liste pour le tableau de bord, avec l'état réel des containers. */
async function list() {
  const containers = await docker.list(`${cfg.LABEL}=project`).catch(() => []);
  const byName = new Map(containers.map((c) => [c.Names[0].replace(/^\//, ''), c]));
  return Object.values(store.get().projects).map((p) => {
    const c = byName.get(containerName(p));
    const job = jobs.activeFor(key(p.slug));
    let status = c ? (c.State === 'running' ? 'running' : 'stopped') : 'missing';
    if (job) status = 'working';
    return {
      ...p,
      container: containerName(p),
      status,
      job: job ? { id: job.id, title: job.title, step: job.step } : null,
      urls: (p.domains || []).map((d) => ({ host: d, http: proxy.url(d, false), https: proxy.url(d, true) })),
      folderExists: fs.existsSync(path.join(cfg.REPO_DIR, p.folder)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Dossiers de repo/ qui ne sont pas encore des projets, avec leur détection. */
function pending() {
  const used = new Set(Object.values(store.get().projects).map((p) => p.folder));
  return detect.listFolders().filter((f) => !used.has(f)).map((f) => detect.detect(f, store.get().settings.php));
}

function details(slug) {
  const p = get(slug);
  const inst = p.database ? store.get().mysql[p.database.instance] : null;
  return {
    tooling: detect.tooling(p.folder),
    dockerfile: images.dockerfile(p),
    phpIni: images.phpIni({ ...p, timezone: store.get().settings.timezone }),
    image: images.tagFor(p),
    xdebugMajor: catalog.xdebugMajor(p.php),
    webroot: WEBROOT,
    docrootPath: docrootPath(p),
    hostFolder: `${cfg.hostRoot}/repo/${p.folder}`,
    database: inst ? {
      instance: inst.id,
      label: mysql.label(inst),
      name: p.database.name,
      host: inst.id,
      port: 3306,
      hostPort: inst.port,
      user: 'root',
      password: cfg.dbPassword,
    } : null,
  };
}

module.exports = {
  list, pending, details, create, update, start, stop, restart, rebuild, remove, command, reconcile,
  containerName, get, owner, pruneImages, createFolder, giveToOwner,
};
