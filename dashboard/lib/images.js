'use strict';
/**
 * Images PHP des projets : un Dockerfile généré à partir de (version PHP,
 * extensions, outils). Deux projets avec la même configuration partagent la
 * même image — la construction n'a lieu qu'une fois.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const catalog = require('./catalog');
const docker = require('./docker');
const { tar } = require('./tar');

const APACHE_CONF = path.join(cfg.SERVER_DIR, 'php', 'apache.conf');
const CACHE_DIR = path.join(cfg.DATA_DIR, 'cache');
const DAY = 24 * 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Outils téléchargés (install-php-extensions, Composer) ──────────────────
// Téléchargés par le tableau de bord (plusieurs sources, nouvelles tentatives),
// gardés 24 h dans data/cache, puis ajoutés au contexte de construction :
// une panne passagère de GitHub ne fait plus échouer la construction.
const script = (b) => b.length > 10000 && b.subarray(0, 2).toString() === '#!';
const TOOLS = {
  'install-php-extensions': [
    'https://github.com/mlocati/docker-php-extension-installer/releases/latest/download/install-php-extensions',
    'https://cdn.jsdelivr.net/gh/mlocati/docker-php-extension-installer/install-php-extensions',
    'https://raw.githubusercontent.com/mlocati/docker-php-extension-installer/master/install-php-extensions',
  ],
  'composer-latest-stable.phar': [
    'https://getcomposer.org/download/latest-stable/composer.phar',
    'https://github.com/composer/composer/releases/latest/download/composer.phar',
  ],
  'composer-latest-2.2.x.phar': [
    'https://getcomposer.org/download/latest-2.2.x/composer.phar',
  ],
};

const downloads = new Map();

async function download(name, job) {
  const file = path.join(CACHE_DIR, name);
  let cached = null;
  try {
    cached = { data: fs.readFileSync(file), fresh: Date.now() - fs.statSync(file).mtimeMs < DAY };
  } catch { /* pas encore en cache */ }
  if (cached?.fresh && script(cached.data)) return cached.data;

  const errors = [];
  for (const url of TOOLS[name]) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = Buffer.from(await res.arrayBuffer());
        if (!script(data)) throw new Error('contenu inattendu');
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(file, data);
        return data;
      } catch (e) {
        errors.push(`${new URL(url).host} : ${e.message}`);
        if (attempt === 1) await sleep(2000);
      }
    }
  }
  if (cached && script(cached.data)) {
    job?.log(`⚠ ${name} : sources injoignables, version en cache utilisée.`);
    return cached.data;
  }
  throw new Error(`Téléchargement de ${name} impossible (${errors.join(' ; ')}).`);
}

/** Un seul téléchargement à la fois par outil, partagé entre les constructions simultanées. */
function tool(name, job) {
  if (!downloads.has(name)) downloads.set(name, download(name, job).finally(() => downloads.delete(name)));
  return downloads.get(name);
}

/** Composer 2.3+ exige PHP 7.2.5 : la branche LTS 2.2 couvre les versions plus anciennes. */
function composerChannel(php) {
  return catalog.cmp(php, '7.2') < 0 ? 'latest-2.2.x' : 'latest-stable';
}

/**
 * remote : les outils sont téléchargés par Docker pendant la construction (ADD).
 * Solution de secours si le tableau de bord n'a pas pu les télécharger lui-même
 * (proxy d'entreprise, par exemple) ; le tag de l'image ne change pas.
 */
function dockerfile({ php, extensions, node }, { remote = false } = {}) {
  const exts = catalog.filterExtensions(extensions, php);
  const composer = composerChannel(php);
  // Node 22 a besoin de glibc 2.28 (Debian buster) : indisponible avant PHP 7.1.
  const withNode = node && catalog.cmp(php, '7.1') >= 0;

  return `# Généré par docker-server — ne pas modifier : l'image est reconstruite depuis le tableau de bord.
FROM php:${php}-apache

# Outils de base : git et unzip (Composer), client MySQL, éditeur.
# Debian en fin de vie (anciennes versions de PHP) : paquets servis par archive.debian.org.
# Les versions déjà archivées y passent directement ; pour les autres, si l'installation
# échoue (paquets retirés des miroirs), on bascule sur l'archive et on réessaie.
RUN set -e; \\
    PKGS="git unzip default-mysql-client nano less"; \\
    apt_install() { apt-get update && apt-get install -y --no-install-recommends $PKGS; }; \\
    use_archive() { \\
      for f in /etc/apt/sources.list /etc/apt/sources.list.d/*; do \\
        if [ -f "$f" ]; then sed -ri 's#https?://(deb|security)\\.debian\\.org#http://archive.debian.org#g' "$f"; fi; \\
      done; \\
      printf 'Acquire::Check-Valid-Until "false";\\nAcquire::AllowInsecureRepositories "true";\\nAPT::Get::AllowUnauthenticated "true";\\n' > /etc/apt/apt.conf.d/99archive; \\
    }; \\
    . /etc/os-release; \\
    case "\${VERSION_CODENAME:-}" in jessie|stretch|buster|bullseye) use_archive ;; esac; \\
    if ! apt_install; then \\
      use_archive; \\
      apt_install || { sed -ri '/-updates/d' /etc/apt/sources.list; apt_install; }; \\
    fi; \\
    rm -rf /var/lib/apt/lists/*

# Extensions PHP (install-php-extensions choisit les bonnes versions, Xdebug compris).
# Xdebug est installé mais pas chargé : le php.ini du projet l'active à la demande.
${remote ? `ADD ${TOOLS['install-php-extensions'][0]} /usr/local/bin/install-php-extensions
ADD https://getcomposer.org/download/${composer}/composer.phar /usr/local/bin/composer` : `COPY install-php-extensions /usr/local/bin/install-php-extensions
COPY composer.phar /usr/local/bin/composer`}
RUN chmod +x /usr/local/bin/install-php-extensions /usr/local/bin/composer \\
 && install-php-extensions ${[...exts, 'xdebug'].join(' ')} \\
 && mkdir -p /usr/local/etc/php/disabled \\
 && mv "$PHP_INI_DIR"/conf.d/*xdebug*.ini /usr/local/etc/php/disabled/ \\
 && ln -s "$(php-config --extension-dir)/xdebug.so" /usr/local/lib/php/xdebug.so

# Les mails envoyés par PHP sont capturés par Mailpit.
COPY --from=axllent/mailpit:latest /mailpit /usr/local/bin/mailpit
${withNode ? `
# Node.js + npm
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \\
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \\
 && ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack
` : ''}
# Apache : réécriture d'URL, .htaccess, HTTPS derrière le proxy.
COPY apache.conf /etc/apache2/conf-available/docker-server.conf
RUN a2enmod rewrite headers expires remoteip setenvif >/dev/null \\
 && a2enconf docker-server >/dev/null \\
 && sed -ri -e 's!/var/www/html!\${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \\
 && sed -ri -e '/<Directory \\/var\\/www\\/>/,/<\\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

ENV APACHE_DOCUMENT_ROOT=/var/www/html \\
    COMPOSER_ALLOW_SUPERUSER=1 \\
    COMPOSER_HOME=/tmp/composer
WORKDIR /var/www/html
`;
}

function apacheConf() {
  return fs.readFileSync(APACHE_CONF, 'utf8');
}

/**
 * Ce qui définit le contenu d'une image pour l'utilisateur : PHP, extensions, Node.
 * Tant que cette clé ne change pas, l'image existante est réutilisée, même si le
 * modèle de Dockerfile a évolué entre deux versions de docker-server.
 */
function configKey({ php, extensions, node }) {
  return [php, catalog.filterExtensions(extensions || [], php).join(','), node && catalog.cmp(php, '7.1') >= 0 ? 'node' : ''].join('|');
}

/** Tag de l'image correspondant à une configuration. */
function tagFor(p) {
  const hash = crypto.createHash('sha1').update(dockerfile(p)).update(apacheConf()).digest('hex').slice(0, 10);
  return `ds-php:${p.php}-${hash}`;
}

// Erreurs passagères (réseau, serveur distant en panne) : la construction est relancée.
const TRANSIENT = /\b50[0-4]\b|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out|timed? ?out|Temporary failure|Could not resolve|Connection (reset|refused|closed)|unexpected EOF|TLS handshake|network is unreachable/i;

const building = new Map();

/** Construit l'image si elle n'existe pas encore. Renvoie le tag. */
async function ensure(p, job) {
  const tag = tagFor(p);
  if (await docker.imageExists(tag)) {
    job?.log(`Image ${tag} déjà disponible.`);
    return tag;
  }
  // Même image déjà en construction pour un autre projet : on attend plutôt que de la refaire.
  if (building.has(tag)) {
    job?.log(`Image ${tag} déjà en construction pour un autre projet : en attente…`);
    await building.get(tag).catch(() => null);
    if (await docker.imageExists(tag)) return tag;
  }
  const run = buildImage(p, tag, job);
  building.set(tag, run);
  try {
    await run;
  } finally {
    building.delete(tag);
  }
  return tag;
}

async function buildImage(p, tag, job) {
  job?.log(`Construction de ${tag} — la première fois peut prendre quelques minutes, les suivantes sont instantanées.`);
  let files = { Dockerfile: dockerfile(p), 'apache.conf': apacheConf() };
  try {
    files['install-php-extensions'] = { content: await tool('install-php-extensions', job), mode: 0o755 };
    files['composer.phar'] = { content: await tool(`composer-${composerChannel(p.php)}.phar`, job), mode: 0o755 };
  } catch (e) {
    job?.log(`⚠ ${e.message} Docker va les télécharger lui-même.`);
    files = { Dockerfile: dockerfile(p, { remote: true }), 'apache.conf': apacheConf() };
  }
  const context = tar(files);

  for (let attempt = 1; ; attempt++) {
    const tail = [];
    let lastStatus = '';
    try {
      await docker.build(context, tag, {
        labels: { [cfg.LABEL]: 'php-image', 'docker-server.php': p.php },
        onEvent: (ev) => {
          if (ev.stream) {
            job?.log(ev.stream);
            tail.push(ev.stream);
            if (tail.length > 40) tail.shift();
          } else if (ev.status && ev.status !== lastStatus) {
            lastStatus = ev.status;
            job?.log(ev.id ? `${ev.id} : ${ev.status}` : ev.status);
          }
        },
      });
      return;
    } catch (e) {
      if (attempt >= 3 || !TRANSIENT.test(`${e.message}\n${tail.join('\n')}`)) throw e;
      job?.log(`⚠ Erreur réseau passagère (tentative ${attempt}/3) : nouvel essai dans 15 secondes…`);
      await sleep(15000);
    }
  }
}

/** Contenu du php.ini propre au projet (monté dans le container). */
function phpIni(p) {
  const ini = { ...catalog.PHP_INI_DEFAULTS, ...(p.ini || {}) };
  const lines = [
    '; Généré par docker-server — modifiable depuis le tableau de bord (onglet PHP).',
    `memory_limit = ${ini.memory_limit}`,
    `upload_max_filesize = ${ini.upload_max_filesize}`,
    `post_max_size = ${ini.post_max_size}`,
    `max_execution_time = ${ini.max_execution_time}`,
    `max_input_vars = 5000`,
    `display_errors = ${ini.display_errors}`,
    `display_startup_errors = ${ini.display_errors}`,
    `error_reporting = ${ini.error_reporting}`,
    'log_errors = On',
    `date.timezone = ${p.timezone || cfg.timezone}`,
    `sendmail_path = "/usr/local/bin/mailpit sendmail -S ${cfg.MAILPIT}:1025"`,
    'opcache.validate_timestamps = 1',
    'opcache.revalidate_freq = 0',
    '',
  ];

  if (p.xdebug && p.xdebug !== 'off') {
    const start = p.xdebug === 'on';
    lines.push('; Xdebug', 'zend_extension = /usr/local/lib/php/xdebug.so');
    if (catalog.xdebugMajor(p.php) === 3) {
      lines.push(
        'xdebug.mode = debug,develop',
        `xdebug.start_with_request = ${start ? 'yes' : 'trigger'}`,
        'xdebug.client_host = host.docker.internal',
        'xdebug.client_port = 9003',
        'xdebug.log_level = 0',
      );
    } else {
      lines.push(
        'xdebug.remote_enable = 1',
        `xdebug.remote_autostart = ${start ? 1 : 0}`,
        'xdebug.remote_host = host.docker.internal',
        'xdebug.remote_port = 9003',
      );
    }
    lines.push('');
  }

  if (p.iniExtra && p.iniExtra.trim()) lines.push('; Directives personnalisées', p.iniExtra.trim(), '');
  return lines.join('\n');
}

/** Supprime les images de projet que plus aucun projet n'utilise. */
async function prune(usedTags) {
  const images = await docker.listImages('ds-php');
  const removed = [];
  for (const img of images) {
    for (const t of img.RepoTags || []) {
      if (!usedTags.includes(t)) {
        const r = await docker.removeImage(t).catch(() => null);
        if (r !== null) removed.push(t);
      }
    }
  }
  return removed;
}

module.exports = { dockerfile, tagFor, configKey, ensure, phpIni, prune };
