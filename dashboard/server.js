'use strict';
/**
 * docker-server — tableau de bord.
 * Serveur HTTP sans dépendance : API JSON, flux SSE (logs, tâches), WebSocket (terminal).
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
const cfg = require('./lib/config');
const catalog = require('./lib/catalog');
const detect = require('./lib/detect');
const docker = require('./lib/docker');
const ftp = require('./lib/ftp');
const hosts = require('./lib/hosts');
const jobs = require('./lib/jobs');
const mysql = require('./lib/mysql');
const projects = require('./lib/projects');
const proxy = require('./lib/proxy');
const store = require('./lib/store');
const ws = require('./lib/ws');

const boot = { ready: false, error: null };

// ── Outils HTTP ───────────────────────────────────────────────────────────

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'object' && !Buffer.isBuffer(data) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(Object.assign(new Error('Requête trop volumineuse'), { status: 413 })); req.destroy(); }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('JSON invalide'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function sse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  let open = true;
  req.on('close', () => { open = false; clearInterval(ping); });
  return {
    send: (event, data) => open && res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    onClose: (fn) => req.on('close', fn),
    end: () => { clearInterval(ping); res.end(); },
  };
}

/**
 * Pas d'authentification (outil local) : on refuse les hôtes inconnus (DNS
 * rebinding) et les requêtes d'écriture venant d'un autre site (CSRF).
 */
function allowedHost(req) {
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return ['localhost', '127.0.0.1', '[::1]', 'ds-dashboard', 'dashboard'].includes(host);
}

function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== 'null' && origin.replace(/^https?:\/\//, '') !== req.headers.host) return false;
  return true;
}

// ── Routes ────────────────────────────────────────────────────────────────

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, handler });
};

const VALID_CONTAINER = /^ds-[a-z0-9][a-z0-9-]*$/;

async function services() {
  const list = await docker.json('GET', `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ name: ['ds-'] }))}`).catch(() => []);
  const byName = new Map(list.map((c) => [c.Names[0].replace(/^\//, ''), c]));
  const state = (n) => {
    const c = byName.get(n);
    return c ? (c.State === 'running' ? 'running' : 'stopped') : 'missing';
  };
  return { state, byName };
}

route('GET', '/api/health', async () => ({ ok: true, ready: boot.ready }));

route('GET', '/api/overview', async () => {
  const s = store.get();
  const svc = await services();
  const instances = Object.values(s.mysql).map((i) => ({
    ...i,
    label: mysql.label(i),
    container: mysql.containerName(i),
    status: jobs.activeFor(`mysql:${i.id}`) ? 'working' : svc.state(mysql.containerName(i)),
  }));
  return {
    app: { name: cfg.APP, version: cfg.VERSION },
    boot,
    config: {
      httpPort: cfg.httpPort,
      httpsPort: cfg.httpsPort,
      ftpPort: cfg.ftpPort,
      ftpPasv: `${cfg.ftpPasvMin}-${cfg.ftpPasvMax}`,
      hostRoot: cfg.hostRoot,
      repoPath: cfg.hostRoot ? `${cfg.hostRoot}/repo` : 'repo',
      dashboardUrl: proxy.url('localhost'),
      dbadminUrl: proxy.url('dbadmin.localhost'),
      mailpitUrl: proxy.url('mailpit.localhost'),
      dbPassword: cfg.dbPassword,
      platform: (await docker.info().catch(() => ({}))).OperatingSystem || '',
    },
    settings: s.settings,
    projects: await projects.list(),
    pending: projects.pending(),
    mysql: instances,
    ftp: { status: jobs.activeFor('ftp') ? 'working' : svc.state(cfg.FTP), accounts: Object.keys(s.ftp).length },
    services: [
      { id: 'proxy', container: cfg.PROXY, label: 'Proxy HTTP / HTTPS', status: svc.state(cfg.PROXY) },
      { id: 'dbadmin', container: 'ds-dbadmin', label: 'DB Admin', status: svc.state('ds-dbadmin'), url: proxy.url('dbadmin.localhost') },
      { id: 'mailpit', container: cfg.MAILPIT, label: 'Mailpit', status: svc.state(cfg.MAILPIT), url: proxy.url('mailpit.localhost') },
      { id: 'dashboard', container: cfg.SELF, label: 'Tableau de bord', status: 'running' },
    ],
    jobs: jobs.all().slice(0, 30),
    ca: { available: !!proxy.rootCa() },
    hosts: hosts.status(),
  };
});

route('GET', '/api/catalog', async () => ({
  php: catalog.PHP_VERSIONS,
  extensions: catalog.EXTENSIONS,
  builtin: catalog.BUILTIN,
  defaultExtensions: catalog.DEFAULT_EXTENSIONS,
  db: catalog.DB_ENGINES,
  iniDefaults: catalog.PHP_INI_DEFAULTS,
}));

route('GET', '/api/detect', async ({ query }) => detect.detect(query.get('folder'), store.get().settings.php));

// Projets
route('POST', '/api/projects', async ({ body }) => ({ job: projects.create(body).summary() }));
route('GET', '/api/projects/:slug', async ({ params }) => {
  const list = await projects.list();
  const p = list.find((x) => x.slug === params.slug);
  if (!p) throw Object.assign(new Error('Projet introuvable'), { status: 404 });
  return { ...p, ...projects.details(params.slug) };
});
route('PUT', '/api/projects/:slug', async ({ params, body }) => projects.update(params.slug, body));
route('DELETE', '/api/projects/:slug', async ({ params, query }) => {
  await projects.remove(params.slug, { dropDatabase: query.get('dropDatabase') === '1' });
  return { ok: true };
});
route('POST', '/api/projects/:slug/command', async ({ params, body }) => ({ job: projects.command(params.slug, body.command).summary() }));
route('POST', '/api/projects/:slug/:action', async ({ params }) => {
  const { slug, action } = params;
  if (action === 'start') return { job: projects.start(slug).summary() };
  if (action === 'rebuild') return { job: projects.rebuild(slug).summary() };
  if (action === 'stop') { await projects.stop(slug); return { ok: true }; }
  if (action === 'restart') { await projects.restart(slug); return { ok: true }; }
  throw Object.assign(new Error('Action inconnue'), { status: 404 });
});

// MySQL
route('POST', '/api/mysql', async ({ body }) => ({ job: mysql.create(body).summary() }));
route('PUT', '/api/mysql/:id', async ({ params, body }) => ({ job: mysql.changeVersion(params.id, body).summary() }));
route('DELETE', '/api/mysql/:id', async ({ params, query }) => {
  await mysql.remove(params.id, { purge: query.get('purge') === '1' });
  return { ok: true };
});
route('GET', '/api/mysql/:id/databases', async ({ params }) => mysql.databases(params.id));
route('POST', '/api/mysql/:id/databases', async ({ params, body }) => {
  await mysql.createDatabase(params.id, body.name);
  return { ok: true };
});
route('DELETE', '/api/mysql/:id/databases/:name', async ({ params }) => {
  await mysql.dropDatabase(params.id, decodeURIComponent(params.name));
  return { ok: true };
});
route('POST', '/api/mysql/:id/:action', async ({ params }) => {
  const inst = store.get().mysql[params.id];
  if (!inst) throw Object.assign(new Error('Serveur inconnu'), { status: 404 });
  const name = mysql.containerName(inst);
  if (params.action === 'backup') return { job: mysql.backup(params.id).summary() };
  if (params.action === 'start') await docker.start(name);
  else if (params.action === 'stop') await docker.stop(name, 20);
  else if (params.action === 'restart') await docker.restart(name, 20);
  else throw Object.assign(new Error('Action inconnue'), { status: 404 });
  return { ok: true };
});

// FTP
route('GET', '/api/ftp', async () => ({
  status: await ftp.status(),
  host: '127.0.0.1',
  port: cfg.ftpPort,
  pasv: `${cfg.ftpPasvMin}-${cfg.ftpPasvMax}`,
  accounts: Object.values(store.get().ftp).map(ftp.publicAccount).sort((a, b) => a.user.localeCompare(b.user)),
}));
route('GET', '/api/ftp-password', async () => ({ password: ftp.password() }));
route('POST', '/api/ftp', async ({ body }) => ftp.publicAccount(await ftp.create(body)));
route('PUT', '/api/ftp/:user', async ({ params, body }) => ftp.publicAccount(await ftp.update(params.user, body)));
route('DELETE', '/api/ftp/:user', async ({ params }) => { await ftp.remove(params.user); return { ok: true }; });
route('GET', '/api/ftp/:user/filezilla.xml', async ({ params }) => ({
  raw: ftp.filezilla(params.user),
  headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="filezilla-${params.user}.xml"` },
}));

// Dossiers, services, réglages
route('POST', '/api/folders', async ({ body }) => ({ folder: projects.createFolder(body.name, body.template) }));
route('POST', '/api/services/:id/restart', async ({ params }) => {
  const map = { proxy: cfg.PROXY, dbadmin: 'ds-dbadmin', mailpit: cfg.MAILPIT, ftp: cfg.FTP };
  if (!map[params.id]) throw Object.assign(new Error('Service inconnu'), { status: 404 });
  if (params.id === 'ftp') { await ftp.restart(); return { ok: true }; }
  await docker.restart(map[params.id]);
  if (params.id === 'proxy') await proxy.applyWithRetry(10);
  return { ok: true };
});
route('PUT', '/api/settings', async ({ body }) => {
  store.update((s) => {
    if (body.php && catalog.PHP_VERSIONS.some((v) => v.v === body.php)) s.settings.php = body.php;
    if (body.timezone && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(body.timezone)) s.settings.timezone = body.timezone;
  });
  return store.get().settings;
});
route('POST', '/api/maintenance/prune', async () => ({ removed: await projects.pruneImages() }));
route('GET', '/api/ca.crt', async () => {
  const crt = proxy.rootCa();
  if (!crt) throw Object.assign(new Error('Certificat pas encore généré : ouvrez une fois un site en https.'), { status: 404 });
  return { raw: crt, headers: { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="docker-server-ca.crt"' } };
});

// Fichier hosts (lu par scripts/hosts.ps1, hosts-agent.ps1 et hosts.sh)
route('GET', '/api/hosts', async ({ query }) => {
  if (query.get('format') === 'text') return { raw: `${hosts.entries().join('\n')}\n` };
  return hosts.status();
});
route('POST', '/api/hosts/report', async ({ body }) => { hosts.setReport(body.present); return { ok: true }; });
route('POST', '/api/hosts/retry', async () => { hosts.askAgain(); return { ok: true }; });

// Tâches
route('GET', '/api/jobs', async () => jobs.all());

// ── Flux SSE ──────────────────────────────────────────────────────────────

function streamJob(req, res, id) {
  const job = jobs.get(id);
  if (!job) return send(res, 404, { error: 'Tâche introuvable' });
  const s = sse(req, res);
  s.send('init', { job: job.summary(), lines: job.lines });
  if (job.endedAt) return s.end();
  const onEvent = (ev) => {
    if (ev.type === 'log') s.send('log', ev.line);
    else if (ev.type === 'steps') s.send('steps', ev.steps);
    else if (ev.type === 'end') { s.send('end', ev.job); s.end(); }
  };
  job.on('event', onEvent);
  s.onClose(() => job.off('event', onEvent));
  return null;
}

function streamLogs(req, res, container, query) {
  if (!VALID_CONTAINER.test(container)) return send(res, 400, { error: 'Container invalide' });
  const s = sse(req, res);
  const tail = Math.min(Math.max(parseInt(query.get('tail'), 10) || 500, 10), 5000);
  let batch = [];
  let timer = null;
  const flush = () => { timer = null; if (batch.length) { s.send('lines', batch); batch = []; } };
  const stop = docker.logs(container, {
    tail,
    follow: true,
    onLine: (stream, line) => {
      const m = line.match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z) ?(.*)$/);
      batch.push({ t: m ? m[1] : null, s: stream, l: m ? m[2] : line });
      if (batch.length >= 200) flush();
      else if (!timer) timer = setTimeout(flush, 120);
    },
    onEnd: (err) => { flush(); s.send('end', { error: err ? err.message : null }); s.end(); },
  });
  s.onClose(() => { stop(); clearTimeout(timer); });
  return null;
}

// ── Terminal (WebSocket) ──────────────────────────────────────────────────

async function terminal(req, socket, head, query) {
  const container = query.get('container') || '';
  if (!VALID_CONTAINER.test(container) || !allowedHost(req)) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const origin = req.headers.origin;
  if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const conn = ws.accept(req, socket, head);
  if (!conn) return;

  const project = Object.values(store.get().projects).find((p) => projects.containerName(p) === container);
  let user;
  if (project && query.get('root') !== '1') {
    const own = projects.owner(project.folder);
    if (own.uid) user = `${own.uid}:${own.gid}`;
  }
  const cols = parseInt(query.get('cols'), 10) || 100;
  const rows = parseInt(query.get('rows'), 10) || 30;
  let exec;
  try {
    exec = await docker.execAttach(container, ['/bin/sh', '-c', 'if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi'], {
      user,
      env: ['TERM=xterm-256color', 'COLORTERM=truecolor', 'LANG=C.UTF-8', `COLUMNS=${cols}`, `LINES=${rows}`, ...(user ? ['HOME=/tmp', 'COMPOSER_HOME=/tmp/composer'] : [])],
      workdir: project ? '/var/www/html' : undefined,
    });
  } catch (e) {
    conn.send(`\r\n\x1b[31mImpossible d'ouvrir le terminal : ${e.message}\x1b[0m\r\n`);
    conn.close();
    return;
  }
  docker.execResize(exec.id, cols, rows);
  exec.socket.on('data', (d) => conn.send(d));
  exec.socket.on('close', () => { conn.send('\r\n\x1b[90m[session terminée]\x1b[0m\r\n'); conn.close(); });
  exec.socket.on('error', () => conn.close());
  // Trames binaires : frappe clavier. Trames texte : messages de contrôle JSON.
  conn.on('message', (msg) => {
    if (typeof msg !== 'string') { exec.socket.write(msg); return; }
    try {
      const ctl = JSON.parse(msg);
      if (ctl.resize) docker.execResize(exec.id, ctl.resize[0], ctl.resize[1]);
    } catch { /* ignoré */ }
  });
  conn.on('close', () => exec.socket.destroy());
}

// ── Fichiers statiques ────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(cfg.PUBLIC_DIR, rel));
  if (!file.startsWith(cfg.PUBLIC_DIR)) return send(res, 403, 'Interdit');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Introuvable');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
  return null;
}

// ── Serveur ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!allowedHost(req)) return send(res, 403, 'Hôte non autorisé : ouvrez http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);

  try {
    let m = url.pathname.match(/^\/api\/jobs\/([^/]+)\/stream$/);
    if (m && req.method === 'GET') return streamJob(req, res, m[1]);
    m = url.pathname.match(/^\/api\/logs\/([^/]+)$/);
    if (m && req.method === 'GET') return streamLogs(req, res, m[1], url.searchParams);

    if (req.method !== 'GET' && (!sameOrigin(req) || req.headers['x-ds'] !== '1')) {
      return send(res, 403, { error: 'Requête refusée (origine)' });
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = url.pathname.match(r.re);
      if (!match) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const result = await r.handler({ params, query: url.searchParams, body, req });
      if (result && result.raw !== undefined) return send(res, 200, result.raw, result.headers);
      return send(res, 200, result ?? { ok: true });
    }
    return send(res, 404, { error: 'Route inconnue' });
  } catch (e) {
    const status = e.status && e.status < 600 ? e.status : 500;
    if (status >= 500) console.error(`[api] ${req.method} ${url.pathname} :`, e);
    return send(res, status, { error: e.message || 'Erreur interne' });
  }
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/terminal') terminal(req, socket, head, url.searchParams).catch(() => socket.destroy());
  else socket.destroy();
});

// ── Démarrage ─────────────────────────────────────────────────────────────

/** Chemin de la racine docker-server sur la machine hôte : on s'inspecte soi-même. */
async function findHostRoot() {
  for (const name of [cfg.SELF, os.hostname()]) {
    const self = await docker.inspect(name).catch(() => null);
    const mount = self?.Mounts?.find((m) => m.Destination === cfg.WORKSPACE);
    if (mount) return mount.Source.replace(/\\/g, '/').replace(/\/+$/, '');
  }
  return null;
}

async function start() {
  store.get();
  for (const d of ['backups', 'proxy', 'projects', 'ftp']) fs.mkdirSync(path.join(cfg.DATA_DIR, d), { recursive: true });
  fs.mkdirSync(cfg.REPO_DIR, { recursive: true });

  server.listen(cfg.PORT, () => console.log(`[docker-server] tableau de bord sur :${cfg.PORT}`));

  for (let i = 0; ; i++) {
    try {
      cfg.hostRoot = process.env.HOST_ROOT || await findHostRoot();
      if (cfg.hostRoot) break;
      boot.error = 'Impossible de trouver le dossier docker-server sur la machine (montage /workspace).';
    } catch (e) {
      boot.error = `Docker est injoignable : ${e.message}`;
    }
    if (i % 10 === 0) console.error('[boot]', boot.error);
    await new Promise((r) => setTimeout(r, 2000));
  }
  boot.error = null;
  console.log(`[boot] racine hôte : ${cfg.hostRoot}`);

  await proxy.applyWithRetry();
  if (!mysql.ensureDefault()) await mysql.reconcile();
  await ftp.reconcile().catch((e) => console.error('[ftp]', e.message));
  await projects.reconcile().catch((e) => console.error('[projects]', e.message));
  boot.ready = true;
}

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => process.exit(0));
start();
