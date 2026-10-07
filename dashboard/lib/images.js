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

function dockerfile({ php, extensions, node }) {
  const exts = catalog.filterExtensions(extensions, php);
  // Composer 2.3+ exige PHP 7.2.5 : la branche LTS 2.2 couvre les versions plus anciennes.
  const composer = catalog.cmp(php, '7.2') < 0 ? 'latest-2.2.x' : 'latest-stable';
  // Node 22 a besoin de glibc 2.28 (Debian buster) : indisponible avant PHP 7.1.
  const withNode = node && catalog.cmp(php, '7.1') >= 0;

  return `# Généré par docker-server — ne pas modifier : l'image est reconstruite depuis le tableau de bord.
FROM php:${php}-apache

# Outils de base : git et unzip (Composer), client MySQL, éditeur.
# Anciennes versions de PHP : Debian archivé, on bascule sur archive.debian.org si besoin.
RUN if ! apt-get update >/dev/null 2>&1; then \\
      sed -ri -e 's#(deb|security)\\.debian\\.org#archive.debian.org#g' -e '/-updates/d' /etc/apt/sources.list; \\
      printf 'Acquire::Check-Valid-Until "false";\\nAcquire::AllowInsecureRepositories "true";\\nAPT::Get::AllowUnauthenticated "true";\\n' > /etc/apt/apt.conf.d/99archive; \\
      apt-get update; \\
    fi \\
 && apt-get install -y --no-install-recommends git unzip default-mysql-client nano less \\
 && rm -rf /var/lib/apt/lists/*

# Extensions PHP (install-php-extensions choisit les bonnes versions, Xdebug compris).
# Xdebug est installé mais pas chargé : le php.ini du projet l'active à la demande.
ADD https://github.com/mlocati/docker-php-extension-installer/releases/latest/download/install-php-extensions /usr/local/bin/
ADD https://getcomposer.org/download/${composer}/composer.phar /usr/local/bin/composer
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

/** Tag de l'image correspondant à une configuration. */
function tagFor(p) {
  const hash = crypto.createHash('sha1').update(dockerfile(p)).update(apacheConf()).digest('hex').slice(0, 10);
  return `ds-php:${p.php}-${hash}`;
}

/** Construit l'image si elle n'existe pas encore. Renvoie le tag. */
async function ensure(p, job) {
  const tag = tagFor(p);
  if (await docker.imageExists(tag)) {
    job?.log(`Image ${tag} déjà disponible.`);
    return tag;
  }
  job?.log(`Construction de ${tag} — la première fois peut prendre quelques minutes, les suivantes sont instantanées.`);
  const context = tar({ Dockerfile: dockerfile(p), 'apache.conf': apacheConf() });
  let lastStatus = '';
  await docker.build(context, tag, {
    labels: { [cfg.LABEL]: 'php-image', 'docker-server.php': p.php },
    onEvent: (ev) => {
      if (ev.stream) job?.log(ev.stream);
      else if (ev.status && ev.status !== lastStatus) {
        lastStatus = ev.status;
        job?.log(ev.id ? `${ev.id} : ${ev.status}` : ev.status);
      }
    },
  });
  return tag;
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

module.exports = { dockerfile, tagFor, ensure, phpIni, prune };
