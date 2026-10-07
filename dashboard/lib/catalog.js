'use strict';
/** Ce que l'interface propose : versions PHP, extensions, moteurs de base de données. */

const PHP_VERSIONS = [
  { v: '8.5', tag: 'Dernière' },
  { v: '8.4', tag: 'Recommandée' },
  { v: '8.3', tag: '' },
  { v: '8.2', tag: '' },
  { v: '8.1', tag: 'Fin de vie' },
  { v: '8.0', tag: 'Fin de vie' },
  { v: '7.4', tag: 'Fin de vie' },
  { v: '7.3', tag: 'Fin de vie' },
  { v: '7.2', tag: 'Fin de vie' },
  { v: '7.1', tag: 'Fin de vie' },
  { v: '7.0', tag: 'Fin de vie' },
  { v: '5.6', tag: 'Fin de vie' },
];

/** Compare deux versions « X.Y[.Z] ». */
function cmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Extensions installables (via install-php-extensions).
 * min / max : bornes de versions PHP supportées.
 */
const EXTENSIONS = [
  { id: 'pdo_mysql', label: 'PDO MySQL', group: 'Bases de données', desc: 'MySQL / MariaDB via PDO (Laravel, Symfony…)' },
  { id: 'mysqli', label: 'MySQLi', group: 'Bases de données', desc: 'MySQL / MariaDB, API classique (WordPress…)' },
  { id: 'pdo_pgsql', label: 'PDO PostgreSQL', group: 'Bases de données', desc: 'PostgreSQL via PDO' },
  { id: 'pgsql', label: 'PostgreSQL', group: 'Bases de données', desc: 'PostgreSQL, API native' },
  { id: 'mongodb', label: 'MongoDB', group: 'Bases de données', desc: 'Pilote MongoDB' },
  { id: 'mysql', label: 'mysql (ancienne API)', group: 'Bases de données', desc: 'mysql_connect() — PHP 5 uniquement', max: '5.6' },

  { id: 'opcache', label: 'OPcache', group: 'Performance & cache', desc: 'Accélère PHP en gardant le code compilé' },
  { id: 'apcu', label: 'APCu', group: 'Performance & cache', desc: 'Cache mémoire partagé' },
  { id: 'redis', label: 'Redis', group: 'Performance & cache', desc: 'Client Redis (phpredis)' },
  { id: 'memcached', label: 'Memcached', group: 'Performance & cache', desc: 'Client Memcached' },
  { id: 'igbinary', label: 'igbinary', group: 'Performance & cache', desc: 'Sérialisation binaire compacte' },

  { id: 'gd', label: 'GD', group: 'Images', desc: 'Redimensionner, recadrer, miniatures' },
  { id: 'imagick', label: 'Imagick', group: 'Images', desc: 'ImageMagick : formats et traitements avancés' },
  { id: 'exif', label: 'EXIF', group: 'Images', desc: 'Métadonnées des photos' },

  { id: 'intl', label: 'Intl', group: 'Texte & langues', desc: 'Dates, nombres et tri selon la langue' },
  { id: 'gettext', label: 'Gettext', group: 'Texte & langues', desc: 'Traductions .po / .mo' },
  { id: 'tidy', label: 'Tidy', group: 'Texte & langues', desc: 'Nettoyage de HTML' },
  { id: 'xsl', label: 'XSL', group: 'Texte & langues', desc: 'Transformations XSLT' },

  { id: 'zip', label: 'Zip', group: 'Fichiers', desc: 'Archives .zip (Composer, exports…)' },
  { id: 'bz2', label: 'Bzip2', group: 'Fichiers', desc: 'Compression .bz2' },
  { id: 'yaml', label: 'YAML', group: 'Fichiers', desc: 'Lecture / écriture YAML' },

  { id: 'bcmath', label: 'BCMath', group: 'Calcul', desc: 'Calcul en précision arbitraire' },
  { id: 'gmp', label: 'GMP', group: 'Calcul', desc: 'Grands nombres entiers' },
  { id: 'calendar', label: 'Calendar', group: 'Calcul', desc: 'Conversions de calendriers' },

  { id: 'soap', label: 'SOAP', group: 'Réseau & services', desc: 'Web services SOAP' },
  { id: 'sockets', label: 'Sockets', group: 'Réseau & services', desc: 'Sockets bas niveau' },
  { id: 'ldap', label: 'LDAP', group: 'Réseau & services', desc: 'Annuaires LDAP / Active Directory' },
  { id: 'imap', label: 'IMAP', group: 'Réseau & services', desc: 'Lecture de boîtes mail', max: '8.3' },
  { id: 'ssh2', label: 'SSH2', group: 'Réseau & services', desc: 'SSH / SFTP' },
  { id: 'amqp', label: 'AMQP', group: 'Réseau & services', desc: 'RabbitMQ' },
  { id: 'xmlrpc', label: 'XML-RPC', group: 'Réseau & services', desc: 'Appels XML-RPC', max: '7.4' },

  { id: 'pcntl', label: 'PCNTL', group: 'Système', desc: 'Processus (workers, queues)' },
  { id: 'mcrypt', label: 'Mcrypt', group: 'Système', desc: 'Chiffrement historique', max: '7.1' },
];

/** Toujours présentes dans les images officielles PHP : rien à installer. */
const BUILTIN = [
  'ctype', 'curl', 'dom', 'fileinfo', 'filter', 'ftp', 'hash', 'iconv', 'json', 'libxml', 'mbstring',
  'mysqlnd', 'openssl', 'pcre', 'pdo', 'pdo_sqlite', 'phar', 'posix', 'readline', 'reflection', 'session',
  'simplexml', 'sodium', 'spl', 'sqlite3', 'standard', 'tokenizer', 'xml', 'xmlreader', 'xmlwriter', 'zlib',
];

/** Sélection par défaut d'un nouveau projet : couvre WordPress, Laravel, Symfony, Drupal, PrestaShop… */
const DEFAULT_EXTENSIONS = ['pdo_mysql', 'mysqli', 'opcache', 'gd', 'exif', 'intl', 'zip', 'bcmath'];

function extensionsFor(php) {
  return EXTENSIONS.filter((e) => (!e.min || cmp(php, e.min) >= 0) && (!e.max || cmp(php, e.max) <= 0));
}

/** Extensions de la liste valides pour cette version de PHP. */
function filterExtensions(list, php) {
  const allowed = new Set(extensionsFor(php).map((e) => e.id));
  return [...new Set(list)].filter((e) => allowed.has(e)).sort();
}

/** Xdebug 2 jusqu'à PHP 7.1, Xdebug 3 ensuite (install-php-extensions choisit la bonne version). */
function xdebugMajor(php) {
  return cmp(php, '7.2') < 0 ? 2 : 3;
}

const DB_ENGINES = {
  mysql: {
    label: 'MySQL',
    image: 'mysql',
    versions: ['8.4', '8.0', '5.7', '5.6'],
    amd64Only: ['5.6', '5.7'],
  },
  mariadb: {
    label: 'MariaDB',
    image: 'mariadb',
    versions: ['11.8', '11.4', '10.11', '10.6', '10.4'],
    amd64Only: [],
  },
};

const PHP_INI_DEFAULTS = {
  memory_limit: '512M',
  upload_max_filesize: '128M',
  post_max_size: '128M',
  max_execution_time: '300',
  display_errors: 'On',
  error_reporting: 'E_ALL',
};

module.exports = {
  PHP_VERSIONS, EXTENSIONS, BUILTIN, DEFAULT_EXTENSIONS, DB_ENGINES, PHP_INI_DEFAULTS,
  cmp, extensionsFor, filterExtensions, xdebugMajor,
};
