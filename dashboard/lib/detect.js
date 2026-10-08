'use strict';
/**
 * Détection automatique d'un dossier de repo/ : framework, version de PHP,
 * dossier public, extensions, base de données. Tout est modifiable ensuite.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const catalog = require('./catalog');

const read = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'projet';
}

// ── Contraintes Composer (« ^7.4 || ^8.0 », « >=8.1 <8.4 », « 7.4.* »…) ─────

function parseVer(s) {
  const m = String(s).trim().replace(/^v/, '').match(/^(\d+)(?:\.(\d+|\*|x))?(?:\.(\d+|\*|x))?/);
  if (!m) return null;
  return [Number(m[1]), m[2] && /\d/.test(m[2]) ? Number(m[2]) : null, m[3] && /\d/.test(m[3]) ? Number(m[3]) : null];
}

const vcmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

function atomOk(v, atom) {
  const m = atom.match(/^(\^|~|>=|<=|>|<|==|=|!=)?\s*(.+)$/);
  if (!m) return true;
  const op = m[1] || '';
  const p = parseVer(m[2]);
  if (!p) return true;
  const [M, mi, pa] = p;
  const lo = [M, mi ?? 0, pa ?? 0];
  switch (op) {
    case '^': return vcmp(v, lo) >= 0 && v[0] === M;
    case '~': return mi === null ? v[0] === M
      : vcmp(v, lo) >= 0 && (pa === null ? v[0] === M : v[0] === M && v[1] === mi);
    case '>=': return vcmp(v, lo) >= 0;
    case '>': return vcmp(v, lo) > 0;
    case '<=': return vcmp(v, [M, mi ?? 999, pa ?? 999]) <= 0;
    case '<': return vcmp(v, lo) < 0;
    case '!=': return !(v[0] === M && (mi === null || v[1] === mi));
    default: // version exacte ou joker
      return v[0] === M && (mi === null || v[1] === mi);
  }
}

/** Une version PHP « X.Y » (dernier correctif) satisfait-elle la contrainte ? */
function satisfies(php, constraint) {
  const [M, mi] = php.split('.').map(Number);
  const v = [M, mi, 999];
  return String(constraint).split(/\s*\|\|?\s*/).some((group) => {
    const atoms = group.trim().replace(/\s*,\s*/g, ' ').split(/\s+/).filter(Boolean)
      .reduce((acc, a) => {
        // « >= 8.1 » écrit avec un espace
        if (/^(\^|~|>=|<=|>|<|==|=|!=)$/.test(a)) { acc.push(a); return acc; }
        if (acc.length && /^(\^|~|>=|<=|>|<|==|=|!=)$/.test(acc[acc.length - 1])) acc[acc.length - 1] += a;
        else acc.push(a);
        return acc;
      }, []);
    if (atoms.some((a) => / - /.test(a))) return true;
    return atoms.every((a) => a === '*' || atomOk(v, a));
  });
}

/** Choisit la version PHP : la recommandée si elle convient, sinon la plus proche en dessous, sinon au-dessus. */
function pickPhp(constraint, preferred) {
  const all = catalog.PHP_VERSIONS.map((p) => p.v);
  if (!constraint) return preferred;
  const ok = all.filter((v) => satisfies(v, constraint));
  if (!ok.length) return preferred;
  if (ok.includes(preferred)) return preferred;
  const below = ok.filter((v) => catalog.cmp(v, preferred) <= 0);
  return below[0] || ok[ok.length - 1];
}

// ── Frameworks ────────────────────────────────────────────────────────────

function lockVersion(lock, name) {
  const pkg = (lock?.packages || []).find((p) => p.name === name);
  const m = pkg && String(pkg.version).match(/v?(\d+)(?:\.(\d+))?/);
  return m ? m[1] : null;
}

function framework(dir, composer, lock) {
  const req = { ...(composer?.require || {}), ...(composer?.['require-dev'] || {}) };
  if (req['laravel/framework'] || exists(dir, 'artisan')) {
    const v = lockVersion(lock, 'laravel/framework');
    return { id: 'laravel', label: `Laravel${v ? ` ${v}` : ''}`, docroot: 'public', ext: ['bcmath', 'intl', 'zip', 'pcntl'] };
  }
  if (req['symfony/framework-bundle'] || exists(dir, 'bin/console') || exists(dir, 'symfony.lock')) {
    const v = lockVersion(lock, 'symfony/framework-bundle');
    const legacy = exists(dir, 'web/app.php');
    return { id: 'symfony', label: `Symfony${v ? ` ${v}` : ''}`, docroot: legacy ? 'web' : 'public', ext: ['intl', 'zip'] };
  }
  if (exists(dir, 'web/wp') || (req['roots/wordpress'] && exists(dir, 'web'))) {
    return { id: 'wordpress', label: 'WordPress (Bedrock)', docroot: 'web', ext: ['mysqli', 'gd', 'exif', 'intl', 'zip', 'imagick'] };
  }
  if (exists(dir, 'wp-includes/version.php') || exists(dir, 'wp-config-sample.php') || exists(dir, 'wp-config.php')) {
    const m = (read(path.join(dir, 'wp-includes/version.php')) || '').match(/\$wp_version\s*=\s*'([\d.]+)'/);
    return { id: 'wordpress', label: `WordPress${m ? ` ${m[1]}` : ''}`, docroot: '', ext: ['mysqli', 'gd', 'exif', 'intl', 'zip', 'imagick'] };
  }
  if (exists(dir, 'web/core/lib/Drupal.php')) return { id: 'drupal', label: 'Drupal', docroot: 'web', ext: ['gd', 'pdo_mysql', 'opcache'] };
  if (exists(dir, 'core/lib/Drupal.php')) return { id: 'drupal', label: 'Drupal', docroot: '', ext: ['gd', 'pdo_mysql', 'opcache'] };
  if (exists(dir, 'classes/PrestaShopAutoload.php') || exists(dir, 'config/defines.inc.php')) {
    return { id: 'prestashop', label: 'PrestaShop', docroot: '', ext: ['gd', 'intl', 'zip', 'pdo_mysql', 'soap'] };
  }
  if (exists(dir, 'libraries/src/Version.php') || exists(dir, 'administrator/index.php')) {
    return { id: 'joomla', label: 'Joomla', docroot: '', ext: ['mysqli', 'gd', 'zip', 'intl'] };
  }
  if (exists(dir, 'spark') && exists(dir, 'public/index.php')) return { id: 'codeigniter', label: 'CodeIgniter 4', docroot: 'public', ext: ['intl'] };
  if (exists(dir, 'system/core/CodeIgniter.php')) return { id: 'codeigniter', label: 'CodeIgniter 3', docroot: '', ext: [] };
  if (exists(dir, 'bin/cake') && exists(dir, 'webroot')) return { id: 'cakephp', label: 'CakePHP', docroot: 'webroot', ext: ['intl'] };
  if (exists(dir, 'yii') && exists(dir, 'web/index.php')) return { id: 'yii', label: 'Yii', docroot: 'web', ext: ['intl'] };
  const hasPhp = (() => {
    try { return fs.readdirSync(dir).some((f) => f.endsWith('.php')); } catch { return false; }
  })();
  if (!hasPhp && !composer && exists(dir, 'index.html')) return { id: 'static', label: 'Site statique', docroot: '', ext: [] };
  return { id: 'php', label: 'PHP', docroot: null, ext: [] };
}

function guessDocroot(dir) {
  for (const d of ['public', 'web', 'htdocs', 'www', 'public_html', 'webroot']) {
    if (exists(dir, `${d}/index.php`) || exists(dir, `${d}/index.html`)) return d;
  }
  return '';
}

/** Nom de base indiqué par le projet lui-même (.env, wp-config.php). */
function guessDatabase(dir) {
  for (const f of ['.env', '.env.local', '.env.example']) {
    const txt = read(path.join(dir, f));
    if (!txt) continue;
    const m = txt.match(/^\s*DB_(?:DATABASE|NAME)\s*=\s*"?([A-Za-z0-9_$-]+)"?/m);
    if (m) return m[1];
    const u = txt.match(/^\s*DATABASE_URL\s*=\s*"?mysql:\/\/[^/]*\/([A-Za-z0-9_$-]+)/m);
    if (u) return u[1];
  }
  const wp = read(path.join(dir, 'wp-config.php'));
  const m = wp && wp.match(/define\(\s*['"]DB_NAME['"]\s*,\s*['"]([^'"]+)['"]/);
  if (m) return m[1];
  return null;
}

/** Analyse complète d'un dossier de repo/. */
function detect(folder, preferredPhp) {
  const dir = path.join(cfg.REPO_DIR, folder);
  const composer = readJson(path.join(dir, 'composer.json'));
  const lock = readJson(path.join(dir, 'composer.lock'));
  const pkg = readJson(path.join(dir, 'package.json'));
  const fw = framework(dir, composer, lock);

  const platform = composer?.config?.platform?.php;
  const constraint = platform ? `${String(platform).split('.').slice(0, 2).join('.')}.*` : composer?.require?.php;
  const php = pickPhp(constraint, preferredPhp);

  const required = Object.keys(composer?.require || {})
    .filter((k) => k.startsWith('ext-')).map((k) => k.slice(4).toLowerCase());
  const extensions = catalog.filterExtensions([...catalog.DEFAULT_EXTENSIONS, ...fw.ext, ...required], php);
  const unknown = required.filter((e) => !catalog.BUILTIN.includes(e) && !catalog.EXTENSIONS.some((x) => x.id === e));

  const db = guessDatabase(dir) || slugify(folder).replace(/-/g, '_');
  const needsDb = fw.id !== 'static';

  return {
    folder,
    name: folder,
    slug: slugify(folder),
    framework: fw.id,
    frameworkLabel: fw.label,
    php,
    phpConstraint: constraint || null,
    docroot: fw.docroot ?? guessDocroot(dir),
    extensions,
    unknownExtensions: unknown,
    node: !!pkg,
    composer: !!composer,
    database: needsDb ? db : null,
  };
}

/** Dossiers de repo/ (hors fichiers et dossiers cachés). */
function listFolders() {
  try {
    return fs.readdirSync(cfg.REPO_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

// Sous-dossiers qui ne sont jamais un site : pas proposés dans l'assistant.
const NOT_SITES = new Set(['vendor', 'node_modules', 'storage', 'var', 'cache', 'tmp', 'logs', 'tests', 'docs']);

/** Sous-dossiers de premier niveau des dossiers de repo/ (« client/site-web »), pour l'autocomplétion. */
function listSubfolders() {
  const out = [];
  for (const top of listFolders()) {
    try {
      for (const d of fs.readdirSync(path.join(cfg.REPO_DIR, top), { withFileTypes: true })) {
        if (d.isDirectory() && !d.name.startsWith('.') && !NOT_SITES.has(d.name.toLowerCase())) out.push(`${top}/${d.name}`);
      }
    } catch { /* dossier illisible : ignoré */ }
  }
  return out;
}

/** Informations utiles à l'onglet « Commandes » : scripts npm, composer, framework. */
function tooling(folder) {
  const dir = path.join(cfg.REPO_DIR, folder);
  const composer = readJson(path.join(dir, 'composer.json'));
  const pkg = readJson(path.join(dir, 'package.json'));
  const fw = framework(dir, composer, readJson(path.join(dir, 'composer.lock')));
  return {
    framework: fw.id,
    composer: !!composer,
    vendor: exists(dir, 'vendor'),
    npm: !!pkg,
    nodeModules: exists(dir, 'node_modules'),
    scripts: pkg?.scripts ? Object.keys(pkg.scripts) : [],
    env: exists(dir, '.env'),
    envExample: exists(dir, '.env.example'),
  };
}

module.exports = { detect, listFolders, listSubfolders, tooling, slugify, satisfies, pickPhp };
