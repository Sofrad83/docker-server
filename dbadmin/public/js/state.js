// État partagé + petit bus d'événements. Les vues s'y abonnent pour se rafraîchir toutes seules
// quand une autre vue modifie la structure (création de table, suppression de base…).
import { api } from './api.js';

export const state = {
  servers: [],          // [{id, label, up, version}]
  server: null,         // serveur affiché dans la barre latérale
  cfg: { pageSize: 100, resultLimit: 1000 },
  dbs: [],              // bases du serveur courant
  tables: {},           // base → tables (chargées à la demande)
  meta: {},             // serveur → {charsets, engines, …}
};

const bus = new EventTarget();
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

export async function loadServers() {
  const r = await api('servers');
  state.servers = r.servers;                     // {id, label} — l'état up / version vient de ping()
  state.cfg = { pageSize: r.pageSize, resultLimit: r.resultLimit };
  state.defaultServer = r.default;
  return r;
}

/** Sonde un serveur et met à jour state.servers (up, version, error). */
export async function ping(id) {
  const s = state.servers.find((x) => x.id === id);
  const r = await api('ping', { s: id });
  delete s.error;
  Object.assign(s, { up: r.up, version: r.version, error: r.error });
  emit('servers');
  return s;
}

export async function loadDbs() {
  const r = await api('dbs', { s: state.server });
  state.dbs = r.dbs;
  emit('dbs');
  return r.dbs;
}

export async function loadTables(db, force = false) {
  if (!force && state.tables[db]) return state.tables[db];
  const r = await api('tables', { s: state.server, db });
  state.tables[db] = r.tables;
  emit('tables', { db });
  return r.tables;
}

export function setServer(id) {
  state.server = id;
  state.dbs = [];
  state.tables = {};
  try { localStorage.setItem('dba.server', id); } catch { /* stockage indisponible */ }
}

/** Jeux de caractères, moteurs… (mis en cache par serveur). */
export async function getMeta(server = state.server) {
  return (state.meta[server] ??= await api('meta', { s: server }));
}

/**
 * À appeler après toute modification de structure : met à jour l'arbre et les onglets concernés.
 * schemaChanged({server, db}) pour une base ; schemaChanged({server}) pour la liste des bases.
 */
export function schemaChanged({ server, db } = {}) {
  server ??= state.server;
  emit('schema', { server, db });
}
