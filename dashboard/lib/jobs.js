'use strict';
/**
 * Tâches longues (construction d'image, changement de version MySQL, composer…)
 * avec étapes et journal suivis en direct par l'interface (SSE).
 * Les tâches d'une même cible (« project:blog ») s'exécutent l'une après l'autre.
 */
const { EventEmitter } = require('events');

const MAX_LINES = 4000;
const KEEP = 60;
const jobs = new Map();
const queues = new Map();
let seq = 0;

class Job extends EventEmitter {
  constructor(title, meta = {}) {
    super();
    this.setMaxListeners(50);
    this.id = `${Date.now().toString(36)}${(++seq).toString(36)}`;
    this.title = title;
    this.meta = meta;
    this.status = 'queued';
    this.steps = [];
    this.lines = [];
    this.error = null;
    this.result = null;
    this.createdAt = Date.now();
    this.endedAt = null;
  }

  emitEvent(ev) {
    this.emit('event', ev);
  }

  log(text) {
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
      if (!line.trim()) continue;
      this.lines.push(line);
      if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
      this.emitEvent({ type: 'log', line });
    }
  }

  step(label) {
    const cur = this.steps[this.steps.length - 1];
    if (cur && cur.status === 'running') cur.status = 'done';
    this.steps.push({ label, status: 'running' });
    this.emitEvent({ type: 'steps', steps: this.steps });
    this.log(`▸ ${label}`);
  }

  summary() {
    const cur = [...this.steps].reverse().find((s) => s.status === 'running');
    return {
      id: this.id,
      title: this.title,
      meta: this.meta,
      status: this.status,
      step: cur ? cur.label : null,
      steps: this.steps,
      error: this.error,
      result: this.result,
      createdAt: this.createdAt,
      endedAt: this.endedAt,
    };
  }

  finish(error, result) {
    for (const s of this.steps) if (s.status === 'running') s.status = error ? 'failed' : 'done';
    this.status = error ? 'failed' : 'done';
    this.error = error ? cleanMessage(error.message || String(error)) : null;
    this.result = result ?? null;
    this.endedAt = Date.now();
    if (error) this.log(`✖ ${this.error}`);
    this.emitEvent({ type: 'end', job: this.summary() });
    this.emit('ended');
  }
}

/**
 * Message d'erreur lisible : sans la page HTML qu'un serveur distant renvoie parfois
 * (GitHub, miroirs…), sur une ligne, de longueur raisonnable. Le journal garde le détail.
 */
function cleanMessage(msg) {
  let m = String(msg);
  const html = m.search(/<!DOCTYPE|<html/i);
  if (html >= 0) m = `${m.slice(0, html).trim()} (le serveur distant a renvoyé une page d'erreur)`;
  m = m.replace(/\s+/g, ' ').trim();
  return m.length > 400 ? `${m.slice(0, 400)}…` : m;
}

function prune() {
  const ended = [...jobs.values()].filter((j) => j.endedAt).sort((a, b) => a.endedAt - b.endedAt);
  while (jobs.size > KEEP && ended.length) jobs.delete(ended.shift().id);
}

/**
 * Lance une tâche. fn(job) est async ; sa valeur de retour devient job.result.
 * meta.key : clé de sérialisation (une seule tâche à la fois par clé).
 */
function run(title, meta, fn) {
  const job = new Job(title, meta);
  jobs.set(job.id, job);
  const key = meta?.key || job.id;
  const previous = queues.get(key) || Promise.resolve();
  const current = previous.then(async () => {
    job.status = 'running';
    job.emitEvent({ type: 'status', status: 'running' });
    try {
      const result = await fn(job);
      job.finish(null, result);
    } catch (e) {
      console.error(`[job] ${title} :`, e.message);
      job.finish(e);
    }
  });
  queues.set(key, current);
  current.finally(() => {
    if (queues.get(key) === current) queues.delete(key);
    prune();
  });
  return job;
}

/** Variante qui attend la fin de la tâche. */
async function runAndWait(title, meta, fn) {
  const job = run(title, meta, fn);
  if (!job.endedAt) await new Promise((resolve) => job.once('ended', resolve));
  return job;
}

function get(id) {
  return jobs.get(id) || null;
}

function all() {
  return [...jobs.values()].map((j) => j.summary()).sort((a, b) => b.createdAt - a.createdAt);
}

function active() {
  return all().filter((j) => j.status === 'running' || j.status === 'queued');
}

/** Tâche en cours pour une cible donnée (ex. « project:blog »). */
function activeFor(key) {
  return active().find((j) => j.meta?.key === key) || null;
}

module.exports = { run, runAndWait, get, all, active, activeFor };
