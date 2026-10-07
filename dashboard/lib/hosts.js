'use strict';
/**
 * Adresses personnalisées : tout nom qui ne finit pas par .localhost doit figurer
 * dans le fichier hosts de la machine. Le container ne peut pas l'écrire lui-même ;
 * un petit agent lancé par start (scripts/hosts-agent.ps1) le fait, avec une
 * confirmation Windows, et nous dit ce qui est déjà en place.
 */
const store = require('./store');

const DASHBOARD_HOST = 'ds-dashboard';
const AGENT_TIMEOUT = 15000;

let report = { at: 0, present: new Set() };
let retry = 0;

/** Les noms à déclarer dans le fichier hosts. */
function entries() {
  const names = new Set([DASHBOARD_HOST]);
  for (const p of Object.values(store.get().projects)) {
    for (const d of p.domains || []) if (needsHosts(d)) names.add(d);
  }
  return [...names].sort();
}

function needsHosts(host) {
  return host !== 'localhost' && !host.endsWith('.localhost');
}

/** L'agent signale les noms déjà présents dans le fichier hosts. */
function setReport(present) {
  report = { at: Date.now(), present: new Set((present || []).map((n) => String(n).toLowerCase())) };
}

function status() {
  const all = entries();
  const agent = Date.now() - report.at < AGENT_TIMEOUT;
  return {
    agent,
    entries: all,
    // Sans agent, on ne sait pas : null plutôt qu'une affirmation fausse.
    missing: agent ? all.filter((n) => !report.present.has(n)) : null,
    retry,
  };
}

/** Redemande la confirmation (après un refus). */
function askAgain() {
  retry += 1;
}

module.exports = { entries, needsHosts, setReport, status, askAgain, DASHBOARD_HOST };
