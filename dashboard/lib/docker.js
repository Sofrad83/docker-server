'use strict';
/**
 * Client minimal de l'API Docker Engine, via le socket monté dans le container.
 * Aucune dépendance : http.request({ socketPath }).
 */
const http = require('http');

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

class DockerError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function request(method, path, { body, headers = {}, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let payload = body;
    const h = { ...headers };
    if (payload !== undefined && !Buffer.isBuffer(payload) && typeof payload !== 'string') {
      payload = JSON.stringify(payload);
      h['Content-Type'] = 'application/json';
    }
    if (payload !== undefined) h['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request({ socketPath: SOCKET, method, path, headers: h, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new DockerError(`Docker ne répond pas (${method} ${path})`, 504)));
    req.on('error', (e) => reject(e.code === 'ENOENT' || e.code === 'EACCES'
      ? new DockerError(`Socket Docker inaccessible (${SOCKET}) : ${e.message}`, 503) : e));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function errorMessage(res) {
  try {
    return JSON.parse(res.body.toString()).message || res.body.toString();
  } catch {
    return res.body.toString() || `HTTP ${res.status}`;
  }
}

/** Requête JSON. `allow` : statuts acceptés en plus des 2xx (ex. 304, 404). */
async function json(method, path, body, { allow = [], timeout } = {}) {
  const res = await request(method, path, { body, timeout });
  if (res.status >= 400 && !allow.includes(res.status)) throw new DockerError(errorMessage(res), res.status);
  if (allow.includes(res.status) && res.status >= 300) return null;
  const text = res.body.toString();
  return text ? JSON.parse(text) : null;
}

/** Flux de lignes JSON (build, pull). onEvent est appelé pour chaque objet. */
function streamJson(method, path, { body, headers = {}, onEvent, timeout = 3600000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET, method, path, headers: { ...headers, ...(body ? { 'Content-Length': body.length } : {}) }, timeout }, (res) => {
      let buf = '';
      let lastError = null;
      if (res.statusCode >= 400) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => reject(new DockerError(errorMessage({ status: res.statusCode, body: Buffer.concat(chunks) }), res.statusCode)));
        return;
      }
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.error) lastError = ev.errorDetail?.message || ev.error;
            onEvent?.(ev);
          } catch { /* ligne partielle ou non JSON */ }
        }
      });
      res.on('end', () => (lastError ? reject(new DockerError(lastError, 500)) : resolve()));
    });
    req.on('timeout', () => req.destroy(new DockerError('Délai dépassé', 504)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Démultiplexeur des flux stdout/stderr (logs, exec sans TTY) :
 * en-tête de 8 octets [type, 0, 0, 0, taille(4)] puis la charge.
 */
class Demuxer {
  constructor(onFrame) {
    this.buf = Buffer.alloc(0);
    this.onFrame = onFrame;
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 8) {
      const size = this.buf.readUInt32BE(4);
      if (this.buf.length < 8 + size) break;
      const type = this.buf[0];
      this.onFrame(type === 2 ? 'err' : 'out', this.buf.subarray(8, 8 + size));
      this.buf = this.buf.subarray(8 + size);
    }
  }
}

/** Découpe un flux d'octets en lignes complètes, par flux. */
class LineSplitter {
  constructor(onLine) {
    this.rest = { out: '', err: '' };
    this.onLine = onLine;
  }

  push(stream, data) {
    const text = this.rest[stream] + data.toString('utf8');
    const lines = text.split(/\r?\n/);
    this.rest[stream] = lines.pop();
    for (const l of lines) this.onLine(stream, l);
  }

  flush() {
    for (const s of ['out', 'err']) {
      if (this.rest[s]) this.onLine(s, this.rest[s]);
      this.rest[s] = '';
    }
  }
}

const enc = encodeURIComponent;

// ── Containers ────────────────────────────────────────────────────────────

async function inspect(name) {
  return json('GET', `/containers/${enc(name)}/json`, undefined, { allow: [404] });
}

async function list(labelFilter) {
  const filters = labelFilter ? `&filters=${enc(JSON.stringify({ label: [labelFilter] }))}` : '';
  return json('GET', `/containers/json?all=1${filters}`);
}

async function create(name, spec, platform) {
  const q = `name=${enc(name)}${platform ? `&platform=${enc(platform)}` : ''}`;
  return json('POST', `/containers/create?${q}`, spec);
}

async function start(name) {
  return json('POST', `/containers/${enc(name)}/start`, undefined, { allow: [304] });
}

async function stop(name, t = 5) {
  return json('POST', `/containers/${enc(name)}/stop?t=${t}`, undefined, { allow: [304, 404], timeout: (t + 30) * 1000 });
}

async function restart(name, t = 5) {
  return json('POST', `/containers/${enc(name)}/restart?t=${t}`, undefined, { timeout: (t + 60) * 1000 });
}

async function remove(name, { volumes = false } = {}) {
  return json('DELETE', `/containers/${enc(name)}?force=1&v=${volumes ? 1 : 0}`, undefined, { allow: [404] });
}

// ── Images, volumes, réseau ───────────────────────────────────────────────

async function imageExists(ref) {
  const res = await request('GET', `/images/${enc(ref)}/json`);
  return res.status === 200;
}

async function removeImage(ref) {
  return json('DELETE', `/images/${enc(ref)}`, undefined, { allow: [404, 409] });
}

async function listImages(reference) {
  return json('GET', `/images/json?filters=${enc(JSON.stringify({ reference: [reference] }))}`);
}

async function pull(image, { platform, onEvent } = {}) {
  const [repo, tag = 'latest'] = splitImage(image);
  const q = `fromImage=${enc(repo)}&tag=${enc(tag)}${platform ? `&platform=${enc(platform)}` : ''}`;
  return streamJson('POST', `/images/create?${q}`, { onEvent });
}

function splitImage(image) {
  const i = image.lastIndexOf(':');
  if (i > 0 && !image.slice(i).includes('/')) return [image.slice(0, i), image.slice(i + 1)];
  return [image, 'latest'];
}

/** Construit une image à partir d'un contexte tar (Buffer). */
async function build(tarBuffer, tag, { onEvent, labels } = {}) {
  const q = `t=${enc(tag)}&rm=1&forcerm=1${labels ? `&labels=${enc(JSON.stringify(labels))}` : ''}`;
  return streamJson('POST', `/build?${q}`, { body: tarBuffer, headers: { 'Content-Type': 'application/x-tar' }, onEvent });
}

async function removeVolume(name) {
  return json('DELETE', `/volumes/${enc(name)}`, undefined, { allow: [404, 409] });
}

async function volumeExists(name) {
  const res = await request('GET', `/volumes/${enc(name)}`);
  return res.status === 200;
}

let infoCache = null;
async function info() {
  infoCache ??= await json('GET', '/info');
  return infoCache;
}

// ── Exec ──────────────────────────────────────────────────────────────────

async function execCreate(container, cmd, { user, env, workdir, tty = false, stdin = false } = {}) {
  const spec = {
    AttachStdin: stdin, AttachStdout: true, AttachStderr: true, Tty: tty, Cmd: cmd,
  };
  if (user) spec.User = String(user);
  if (env) spec.Env = env;
  if (workdir) spec.WorkingDir = workdir;
  const res = await json('POST', `/containers/${enc(container)}/exec`, spec);
  return res.Id;
}

/**
 * Exécute une commande et attend sa fin.
 * onLine(stream, line) reçoit la sortie au fil de l'eau (facultatif).
 */
async function exec(container, cmd, opts = {}) {
  const id = await execCreate(container, cmd, opts);
  let stdout = '';
  let stderr = '';
  await new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: SOCKET, method: 'POST', path: `/exec/${id}/start`, headers: { 'Content-Type': 'application/json' }, timeout: opts.timeout || 0,
    }, (res) => {
      if (res.statusCode >= 400) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => reject(new DockerError(errorMessage({ status: res.statusCode, body: Buffer.concat(chunks) }), res.statusCode)));
        return;
      }
      const lines = new LineSplitter((s, l) => opts.onLine?.(s, l));
      const demux = new Demuxer((stream, data) => {
        if (stream === 'out') stdout += data.toString('utf8'); else stderr += data.toString('utf8');
        lines.push(stream, data);
      });
      res.on('data', (c) => demux.push(c));
      res.on('end', () => { lines.flush(); resolve(); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new DockerError('Délai dépassé', 504)));
    req.end(JSON.stringify({ Detach: false, Tty: false }));
  });
  const state = await json('GET', `/exec/${id}/json`);
  return { code: state.ExitCode, stdout, stderr };
}

/** Exec interactif (terminal) : renvoie le socket brut après « Upgrade: tcp ». */
async function execAttach(container, cmd, opts = {}) {
  const id = await execCreate(container, cmd, { ...opts, tty: true, stdin: true });
  const socket = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ Detach: false, Tty: true });
    const req = http.request({
      socketPath: SOCKET,
      method: 'POST',
      path: `/exec/${id}/start`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Connection: 'Upgrade', Upgrade: 'tcp' },
    });
    req.on('upgrade', (res, sock, head) => {
      if (head?.length) sock.unshift(head);
      resolve(sock);
    });
    req.on('response', (res) => {
      // Certains moteurs répondent 200 sans upgrade : on utilise alors le flux de réponse.
      if (res.statusCode >= 400) reject(new DockerError(`exec start : HTTP ${res.statusCode}`, res.statusCode));
      else resolve(res.socket);
    });
    req.on('error', reject);
    req.end(body);
  });
  return { id, socket };
}

async function execResize(id, cols, rows) {
  return json('POST', `/exec/${id}/resize?h=${rows}&w=${cols}`, undefined, { allow: [404, 409] }).catch(() => null);
}

/** Flux de logs d'un container. Renvoie une fonction d'arrêt. */
function logs(container, { tail = 500, follow = true, since, onLine, onEnd }) {
  const q = `stdout=1&stderr=1&timestamps=1&follow=${follow ? 1 : 0}&tail=${tail}${since ? `&since=${since}` : ''}`;
  const req = http.request({ socketPath: SOCKET, method: 'GET', path: `/containers/${enc(container)}/logs?${q}` }, (res) => {
    if (res.statusCode >= 400) {
      res.resume();
      onEnd?.(new DockerError(`Logs indisponibles (HTTP ${res.statusCode})`, res.statusCode));
      return;
    }
    // Les containers gérés ici n'ont pas de TTY : le flux est toujours multiplexé.
    const lines = new LineSplitter(onLine);
    const demux = new Demuxer((s, d) => lines.push(s, d));
    res.on('data', (c) => demux.push(c));
    res.on('end', () => { lines.flush(); onEnd?.(); });
    res.on('error', (e) => onEnd?.(e));
  });
  req.on('error', (e) => onEnd?.(e));
  req.end();
  return () => req.destroy();
}

module.exports = {
  DockerError, request, json, inspect, list, create, start, stop, restart, remove,
  imageExists, removeImage, listImages, pull, build, removeVolume, volumeExists, info,
  exec, execAttach, execResize, logs,
};
