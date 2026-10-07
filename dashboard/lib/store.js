'use strict';
/**
 * État persistant : data/state.json — la seule source de vérité.
 * Tout le reste (Caddyfile, php.ini des projets, containers) en est déduit.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const FILE = path.join(cfg.DATA_DIR, 'state.json');
let state = null;

function defaults() {
  return {
    version: 1,
    projects: {},
    mysql: {},
    ftp: {},
    settings: { php: '8.4', timezone: cfg.timezone },
  };
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const d = defaults();
    state = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Fichier illisible : on le met de côté plutôt que de l'écraser en silence.
      const backup = `${FILE}.broken-${Date.now()}`;
      try { fs.copyFileSync(FILE, backup); } catch { /* rien */ }
      console.error(`[store] state.json illisible (${e.message}), copie dans ${backup}`);
    }
    state = defaults();
  }
  return state;
}

function get() {
  return state || load();
}

function save() {
  fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, FILE);
}

/** Modifie l'état puis l'enregistre. */
function update(fn) {
  const s = get();
  const r = fn(s);
  save();
  return r;
}

/** Écrit un fichier EN PLACE (même inode) : indispensable pour les fichiers montés seuls dans un container. */
function writeInPlace(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

module.exports = { get, update, save, writeInPlace, FILE };
