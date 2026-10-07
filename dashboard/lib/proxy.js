'use strict';
/**
 * Routage HTTP/HTTPS des projets : génère data/proxy/sites.caddy à partir de
 * l'état, puis recharge Caddy (sans coupure ; une config invalide est refusée
 * et l'ancienne reste active).
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const docker = require('./docker');
const store = require('./store');

const SITES = path.join(cfg.DATA_DIR, 'proxy', 'sites.caddy');

/** URL publique d'un domaine, avec le port s'il n'est pas standard. */
function url(host, https = false) {
  const port = https ? cfg.httpsPort : cfg.httpPort;
  const std = https ? 443 : 80;
  return `${https ? 'https' : 'http'}://${host}${port === std ? '' : `:${port}`}`;
}

function generate(state) {
  const out = ['# Généré par docker-server — ne pas modifier : régénéré à chaque changement de projet.', ''];
  for (const p of Object.values(state.projects).sort((a, b) => a.slug.localeCompare(b.slug))) {
    const domains = (p.domains || []).filter(Boolean);
    if (!domains.length) continue;
    const upstream = `ds-${p.slug}`;
    out.push(`# ${p.name}`);
    if (p.httpsRedirect) {
      const port = cfg.httpsPort === 443 ? '' : `:${cfg.httpsPort}`;
      out.push(`${domains.map((d) => `http://${d}`).join(', ')} {`, `\tredir https://{host}${port}{uri} 302`, '}');
      out.push(`${domains.map((d) => `https://${d}`).join(', ')} {`, `\timport projet ${upstream}`, '}', '');
    } else {
      out.push(`${domains.flatMap((d) => [`http://${d}`, `https://${d}`]).join(', ')} {`, `\timport projet ${upstream}`, '}', '');
    }
  }
  return out.join('\n');
}

let pending = null;

/** Écrit la configuration et recharge Caddy. Les appels rapprochés sont regroupés. */
async function apply() {
  if (pending) return pending;
  pending = (async () => {
    await new Promise((r) => setTimeout(r, 150));
    pending = null;
    const content = generate(store.get());
    fs.mkdirSync(path.dirname(SITES), { recursive: true });
    fs.writeFileSync(SITES, content);
    const res = await docker.exec(cfg.PROXY, ['caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']);
    if (res.code !== 0) {
      const msg = (res.stderr || res.stdout).split('\n').filter((l) => /error/i.test(l)).pop() || res.stderr;
      throw new Error(`Le proxy a refusé la configuration : ${msg.trim()}`);
    }
  })();
  return pending;
}

/** Au démarrage, Caddy peut ne pas être encore prêt : on réessaie quelques fois. */
async function applyWithRetry(tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      await apply();
      return true;
    } catch (e) {
      if (i === tries - 1) {
        console.error('[proxy]', e.message);
        return false;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return false;
}

/** Certificat racine de l'autorité locale de Caddy (à installer pour un HTTPS sans avertissement). */
const ROOT_CA = path.join(cfg.DATA_DIR, 'caddy', 'caddy', 'pki', 'authorities', 'local', 'root.crt');

function rootCa() {
  try {
    return fs.readFileSync(ROOT_CA);
  } catch {
    return null;
  }
}

module.exports = { url, generate, apply, applyWithRetry, rootCa };
