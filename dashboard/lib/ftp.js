'use strict';
/**
 * FTP local : un serveur vsftpd, autant de comptes que voulu, chacun enfermé
 * dans le dossier de son choix (n'importe où sur la machine).
 * Ajouter / modifier un compte recrée le container (quelques secondes).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const docker = require('./docker');
const store = require('./store');
const jobs = require('./jobs');
const { tar } = require('./tar');

const CONTEXT = path.join(cfg.SERVER_DIR, 'ftp');
const FILES = ['Dockerfile', 'entrypoint.sh', 'vsftpd.conf'];

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function password(len = 14) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(len), (b) => chars[b % chars.length]).join('');
}

/** Nettoie un chemin collé par l'utilisateur (guillemets de « Copier en tant que chemin »…). */
function cleanPath(p) {
  return String(p || '').trim().replace(/^["']|["']$/g, '').replace(/[\\/]+$/, '');
}

/** Chemin relatif à docker-server (repo/x, data/ftp/x) ou chemin absolu de la machine ? */
function isAbsolute(p) {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');
}

function hostPath(account) {
  const p = cleanPath(account.path);
  return isAbsolute(p) ? p.replace(/\\/g, '/') : `${cfg.hostRoot}/${p.replace(/\\/g, '/')}`;
}

function imageTag() {
  const h = crypto.createHash('sha1');
  for (const f of FILES) h.update(fs.readFileSync(path.join(CONTEXT, f)));
  return `ds-ftp:${h.digest('hex').slice(0, 10)}`;
}

async function ensureImage(job) {
  const tag = imageTag();
  if (await docker.imageExists(tag)) return tag;
  job.step('Construction de l\'image FTP');
  const files = {};
  for (const f of FILES) files[f] = { content: fs.readFileSync(path.join(CONTEXT, f)), mode: f.endsWith('.sh') ? 0o755 : 0o644 };
  await docker.build(tar(files), tag, { labels: { [cfg.LABEL]: 'ftp-image' }, onEvent: (ev) => ev.stream && job.log(ev.stream) });
  return tag;
}

function spec(tag, accounts) {
  const users = Buffer.from(accounts.map((a) => `${a.user}:${a.password}`).join('\n')).toString('base64');
  const exposed = { '21/tcp': {} };
  const bindings = { '21/tcp': [{ HostIp: cfg.bindIp, HostPort: String(cfg.ftpPort) }] };
  for (let p = cfg.ftpPasvMin; p <= cfg.ftpPasvMax; p++) {
    exposed[`${p}/tcp`] = {};
    bindings[`${p}/tcp`] = [{ HostIp: cfg.bindIp, HostPort: String(p) }];
  }
  return {
    Image: tag,
    Env: [`FTP_USERS=${users}`, `PASV_MIN=${cfg.ftpPasvMin}`, `PASV_MAX=${cfg.ftpPasvMax}`, 'PASV_ADDRESS=127.0.0.1', `TZ=${cfg.timezone}`],
    Labels: { [cfg.LABEL]: 'ftp' },
    ExposedPorts: exposed,
    HostConfig: {
      Mounts: accounts.map((a) => ({ Type: 'bind', Source: hostPath(a), Target: `/ftp/${a.user}` })),
      PortBindings: bindings,
      RestartPolicy: { Name: 'unless-stopped' },
      NetworkMode: cfg.NETWORK,
    },
    NetworkingConfig: { EndpointsConfig: { [cfg.NETWORK]: { Aliases: ['ftp'] } } },
  };
}

function friendly(e, accounts) {
  const m = e.message || '';
  const bad = accounts.find((a) => m.includes(hostPath(a)));
  if (/bind source path does not exist|no such file or directory|invalid mount config/i.test(m)) {
    return `Le dossier ${bad ? `« ${bad.path} » ` : ''}est introuvable sur votre machine. Vérifiez le chemin (il doit déjà exister).`;
  }
  if (/port is already allocated|address already in use/i.test(m)) {
    return `Le port FTP ${cfg.ftpPort} (ou un port passif ${cfg.ftpPasvMin}-${cfg.ftpPasvMax}) est déjà utilisé sur votre machine. Changez FTP_PORT dans le fichier .env puis relancez docker-server.`;
  }
  if (/mounts denied|not shared/i.test(m)) {
    return 'Docker n\'a pas accès à ce dossier : ajoutez-le dans Docker Desktop → Settings → Resources → File sharing.';
  }
  return m;
}

/** (Re)crée le serveur FTP avec les comptes de l'état. */
async function apply(job) {
  const accounts = Object.values(store.get().ftp);
  for (const a of accounts) {
    if (isAbsolute(cleanPath(a.path))) continue;
    const dir = path.join(cfg.WORKSPACE, cleanPath(a.path));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      require('./projects').giveToOwner(dir, cfg.REPO_DIR);
    }
  }
  await docker.remove(cfg.FTP);
  if (!accounts.length) {
    job.log('Aucun compte : serveur FTP arrêté.');
    return;
  }
  const tag = await ensureImage(job);
  job.step('Démarrage du serveur FTP');
  try {
    await docker.create(cfg.FTP, spec(tag, accounts));
    await docker.start(cfg.FTP);
  } catch (e) {
    await docker.remove(cfg.FTP);
    throw new Error(friendly(e, accounts));
  }
  job.log(`Serveur FTP prêt : 127.0.0.1:${cfg.ftpPort} — ${accounts.length} compte(s).`);
}

/** Applique une modification de l'état ; l'annule si le serveur refuse de démarrer. */
async function change(title, mutate) {
  const before = JSON.parse(JSON.stringify(store.get().ftp));
  store.update(mutate);
  const job = await jobs.runAndWait(title, { key: 'ftp', ftp: true }, apply);
  if (job.status === 'failed') {
    store.update((s) => { s.ftp = before; });
    await jobs.runAndWait('Restauration du serveur FTP', { key: 'ftp', ftp: true }, apply);
    throw httpError(400, job.error);
  }
  return job;
}

function validate({ user, password: pass, path: p }, isNew) {
  if (isNew && !/^[a-z][a-z0-9_-]{1,31}$/.test(user || '')) {
    throw httpError(400, 'Identifiant invalide : lettres minuscules, chiffres, _ et - (2 à 32 caractères, commence par une lettre).');
  }
  if (isNew && store.get().ftp[user]) throw httpError(409, `Le compte « ${user} » existe déjà.`);
  if (['root', 'ftp', 'nobody', 'daemon', 'bin'].includes(user)) throw httpError(400, 'Cet identifiant est réservé.');
  if (pass !== undefined && (!pass || /[\n\r]/.test(pass) || pass.length > 128)) throw httpError(400, 'Mot de passe invalide.');
  if (p !== undefined) {
    const c = cleanPath(p);
    if (!c) throw httpError(400, 'Choisissez un dossier.');
    if (!isAbsolute(c)) {
      if (c.split(/[\\/]/).includes('..')) throw httpError(400, 'Chemin invalide.');
      if (!/^(repo|data\/ftp)([\\/]|$)/.test(c.replace(/\\/g, '/'))) throw httpError(400, 'Chemin relatif attendu dans repo/ ou data/ftp/.');
    }
  }
}

async function create({ user, password: pass, path: p, label }) {
  const account = { user, password: pass || password(), path: cleanPath(p || `data/ftp/${user}`), label: label || '', createdAt: new Date().toISOString() };
  validate(account, true);
  await change(`Création du compte FTP « ${user} »`, (s) => { s.ftp[user] = account; });
  return account;
}

async function update(user, { password: pass, path: p, label }) {
  const cur = store.get().ftp[user];
  if (!cur) throw httpError(404, 'Compte inconnu.');
  validate({ user, password: pass, path: p }, false);
  const next = { ...cur, ...(pass ? { password: pass } : {}), ...(p ? { path: cleanPath(p) } : {}), ...(label !== undefined ? { label } : {}) };
  await change(`Modification du compte FTP « ${user} »`, (s) => { s.ftp[user] = next; });
  return next;
}

async function remove(user) {
  if (!store.get().ftp[user]) throw httpError(404, 'Compte inconnu.');
  await change(`Suppression du compte FTP « ${user} »`, (s) => { delete s.ftp[user]; });
}

async function status() {
  const c = await docker.inspect(cfg.FTP).catch(() => null);
  return c ? (c.State.Running ? 'running' : 'stopped') : 'missing';
}

/** Au démarrage : recrée le serveur s'il manque ou si son image a changé (mise à jour de docker-server). */
async function reconcile() {
  if (!Object.keys(store.get().ftp).length) return;
  const c = await docker.inspect(cfg.FTP).catch(() => null);
  if (c && c.Config.Image === imageTag()) {
    if (!c.State.Running) await docker.start(cfg.FTP).catch((e) => console.error('[ftp]', e.message));
    return;
  }
  jobs.run('Démarrage du serveur FTP', { key: 'ftp', ftp: true }, apply);
}

/** Recrée le serveur FTP (bouton « Redémarrer »). */
async function restart() {
  const job = await jobs.runAndWait('Redémarrage du serveur FTP', { key: 'ftp', ftp: true }, apply);
  if (job.status === 'failed') throw httpError(500, job.error);
}

/** Fichier d'import pour FileZilla (Fichier → Importer). */
function filezilla(user) {
  const a = store.get().ftp[user];
  if (!a) throw httpError(404, 'Compte inconnu.');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<FileZilla3>
  <Servers>
    <Server>
      <Host>127.0.0.1</Host>
      <Port>${cfg.ftpPort}</Port>
      <Protocol>0</Protocol>
      <Type>0</Type>
      <User>${esc(a.user)}</User>
      <Pass encoding="base64">${Buffer.from(a.password).toString('base64')}</Pass>
      <Logontype>1</Logontype>
      <PasvMode>MODE_PASSIVE</PasvMode>
      <EncodingType>UTF-8</EncodingType>
      <BypassProxy>0</BypassProxy>
      <Name>docker-server — ${esc(a.label || a.user)}</Name>
      <SyncBrowsing>0</SyncBrowsing>
      <DirectoryComparison>0</DirectoryComparison>
    </Server>
  </Servers>
</FileZilla3>
`;
}

function publicAccount(a) {
  return { ...a, hostPath: hostPath(a), relative: !isAbsolute(cleanPath(a.path)) };
}

module.exports = { create, update, remove, status, reconcile, restart, filezilla, password, publicAccount };
