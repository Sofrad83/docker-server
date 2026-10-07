// Fiche d'un projet : aperçu, PHP, Xdebug, adresses, commandes, logs, terminal.
import {
  h, icon, get, post, put, del, store, refresh, replace, toast, errorToast, modal, menu, confirmDialog,
  field, toggle, statusPill, avatar, copyBtn, stackLabel, codeValue, codeBlock, snippetTabs,
  cleanHost, HOST_OK, hostState, HOSTS_TOOL,
} from '../lib.js';
import { extensionPicker } from '../components/extensions.js';
import { inlineJob, followJob, consoleView } from '../components/jobs.js';
import { logViewer } from '../components/logs.js';
import { terminal } from '../components/terminal.js';

const TABS = [
  { id: 'overview', label: 'Aperçu', icon: 'layers' },
  { id: 'php', label: 'PHP', icon: 'cpu' },
  { id: 'xdebug', label: 'Xdebug', icon: 'bug' },
  { id: 'domains', label: 'Adresses', icon: 'globe' },
  { id: 'commands', label: 'Commandes', icon: 'package' },
  { id: 'logs', label: 'Logs', icon: 'logs' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
];

// Mémoire entre deux visites : dernière commande lancée, commande à taper dans le terminal.
const lastCommand = new Map();
const terminalCommand = new Map();

// ── Adresses personnalisées (fichier hosts) ──
const HOST_TAGS = {
  auto: ['tag', 'automatique'],
  ok: ['tag.tag-ok', 'active'],
  missing: ['tag.tag-warn', 'en attente'],
  unknown: ['tag', 'fichier hosts'],
  unsaved: ['tag', 'à enregistrer'],
};

function hostTag(host, saved) {
  const state = hostState(host);
  const [cls, label] = HOST_TAGS[saved.includes(host) || state === 'auto' ? state : 'unsaved'];
  return h(`span.${cls}`, label);
}

/** Lignes à ajouter à la main, si l'automatisme n'est pas disponible. */
function manualHosts(names) {
  return h('details.manual-hosts',
    h('summary', 'Ajouter à la main'),
    codeBlock(names.map((d) => `127.0.0.1  ${d}`).join('\n'), { lang: 'fichier hosts' }),
    snippetTabs([
      { label: 'Windows', lang: 'PowerShell (administrateur)', text: names.map((d) => `Add-Content -Path "$env:windir\\System32\\drivers\\etc\\hosts" -Value "127.0.0.1  ${d}"`).join('\n') },
      { label: 'macOS / Linux', lang: 'terminal', text: names.map((d) => `echo "127.0.0.1  ${d}" | sudo tee -a /etc/hosts`).join('\n') },
    ]));
}

/** Bandeau d'aide pour les adresses qui ne fonctionnent pas encore (null si tout va bien). */
function hostsHelp(names) {
  const missing = names.filter((d) => hostState(d) === 'missing');
  const unknown = names.filter((d) => hostState(d) === 'unknown');
  if (missing.length) {
    return h('div.banner.banner-warn', icon('shield', 18), h('div.banner-body',
      h('strong', `Activation de ${missing.map((d) => `« ${d} »`).join(', ')}`),
      h('p', 'Windows demande l\'autorisation d\'ajouter cette adresse au fichier hosts : répondez « Oui ». Vous avez refusé, ou rien ne s\'est affiché ?'),
      h('div.card-actions',
        h('button.btn.btn-sm', {
          type: 'button',
          onclick: async (e) => {
            const b = e.currentTarget;
            b.classList.add('busy');
            try { await post('/api/hosts/retry'); toast('Nouvelle demande envoyée à Windows'); } catch (err) { errorToast(err); }
            setTimeout(() => b.classList.remove('busy'), 3000);
          },
        }, icon('refresh', 14), 'Redemander')),
      manualHosts(missing)));
  }
  if (unknown.length) {
    return h('div.banner.banner-info', icon('info', 18), h('div.banner-body',
      h('strong', 'Adresses personnalisées : une ligne dans le fichier hosts'),
      h('p', 'Les adresses en .localhost fonctionnent toutes seules. Les autres doivent figurer dans le fichier hosts de la machine : lancez ',
        h('code', HOSTS_TOOL), ' dans le dossier docker-server, ou relancez start (il s\'en occupe ensuite automatiquement).'),
      manualHosts(unknown)));
  }
  return null;
}

// L'onglet Adresses se rafraîchit quand l'agent signale un changement du fichier hosts.
let onHostsChange = null;

const card = (title, ...children) => h('section.card', title ? h('h3.card-title', title) : null, ...children);
const kv = (rows) => h('dl.kv', rows.filter(Boolean).map(([k, v]) => [h('dt', k), h('dd', v)]));

export function mount(root, params) {
  const slug = params.slug;
  let tab = params.tab || 'overview';
  let p = null;
  let details = null;
  let destroyTab = null;
  let jobBanner = null;
  let lastSig = '';
  let lastHosts = '';

  const head = h('div.project-head');
  const banners = h('div.banners');
  const tabbar = h('nav.tabs', { role: 'tablist' });
  const body = h('div.tab-body');
  root.append(h('div.page.page-project',
    h('a.back', { href: '#/' }, icon('arrow-left', 15), 'Projets'),
    head, banners, tabbar, body));

  for (const t of TABS) {
    tabbar.append(h('a.tab', { href: `#/projects/${slug}/${t.id}`, role: 'tab', dataset: { tab: t.id } }, icon(t.icon, 15), t.label));
  }

  async function loadDetails() {
    try {
      details = await get(`/api/projects/${slug}`);
      p = details;
    } catch (e) {
      replace(body, h('div.empty', h('h2', 'Projet introuvable'), h('p.muted', e.message), h('a.btn', { href: '#/' }, 'Retour aux projets')));
      return false;
    }
    return true;
  }

  // ── En-tête ──
  function paintHead() {
    const running = p.status === 'running';
    const failed = p.error && !running && p.status !== 'working';
    const url = p.urls[0];
    const moreBtn = h('button.btn.btn-icon', { type: 'button', title: 'Plus d\'actions', 'aria-label': 'Plus d\'actions' }, icon('more', 18));
    moreBtn.addEventListener('click', () => menu(moreBtn, [
      { label: 'Redémarrer', icon: 'restart', disabled: !running, onClick: () => act('restart') },
      { label: 'Reconstruire l\'image', icon: 'hammer', onClick: () => act('rebuild') },
      { label: 'Voir le Dockerfile', icon: 'code', onClick: showDockerfile },
      'sep',
      { label: 'Retirer le projet', icon: 'trash', danger: true, onClick: removeProject },
    ]));
    replace(head,
      avatar(p.framework, 52),
      h('div.ph-main',
        h('div.ph-title', h('h1', p.name), statusPill(failed ? 'error' : p.status)),
        h('div.ph-meta',
          h('span', stackLabel(p)),
          h('span.ph-folder', icon('folder', 13), `repo/${p.folder}`),
          p.xdebug !== 'off' ? h('span.tag.tag-accent', icon('bug', 12), `Xdebug ${p.xdebug === 'on' ? 'actif' : 'sur demande'}`) : null)),
      h('div.ph-actions',
        url ? h('a.btn.btn-primary', { href: url.https, target: '_blank', rel: 'noopener' }, icon('external', 15), 'Ouvrir le site') : null,
        running
          ? h('button.btn', { type: 'button', onclick: (e) => act('stop', e.currentTarget) }, icon('stop', 15), 'Arrêter')
          : h('button.btn', { type: 'button', disabled: p.status === 'working', onclick: (e) => act('start', e.currentTarget) }, icon('play', 15), 'Démarrer'),
        moreBtn));
  }

  function paintBanners() {
    if (p.job) {
      if (jobBanner?.id !== p.job.id) {
        jobBanner?.stop();
        const ij = inlineJob(p.job.id, { onEnd: async () => { await refresh(); await loadDetails(); paintAll(true); } });
        jobBanner = { id: p.job.id, ...ij };
      }
      replace(banners, jobBanner.el);
      return;
    }
    jobBanner?.stop();
    jobBanner = null;
    const items = [];
    if (p.error && p.status !== 'running') {
      items.push(h('div.banner.banner-error', icon('circle-x', 18),
        h('div.banner-body', h('strong', 'La dernière opération a échoué'), h('p', p.error)),
        h('button.btn.btn-sm', { type: 'button', onclick: (e) => act('start', e.currentTarget) }, icon('refresh', 14), 'Réessayer')));
    }
    const waiting = p.domains.filter((d) => hostState(d) === 'missing');
    if (waiting.length) items.push(hostsHelp(waiting));
    if (!p.folderExists) {
      items.push(h('div.banner.banner-warn', icon('alert', 18), h('div.banner-body', h('strong', `Le dossier repo/${p.folder} est introuvable`),
        h('p', 'Il a été déplacé ou renommé. Remettez-le en place, ou retirez ce projet.'))));
    }
    if (p.status === 'stopped' || (p.status === 'missing' && !p.error)) {
      items.push(h('div.banner.banner-info', icon('power', 18), h('div.banner-body', h('strong', 'Ce projet est arrêté'), h('p', 'Démarrez-le pour accéder au site, aux logs et au terminal.')),
        h('button.btn.btn-sm.btn-primary', { type: 'button', onclick: (e) => act('start', e.currentTarget) }, icon('play', 14), 'Démarrer')));
    }
    replace(banners, items);
  }

  function paintTabs() {
    tabbar.querySelectorAll('.tab').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    destroyTab?.();
    destroyTab = null;
    onHostsChange = null;
    replace(body);
    const render = { overview, php: phpTab, xdebug: xdebugTab, domains: domainsTab, commands: commandsTab, logs: logsTab, terminal: terminalTab }[tab] || overview;
    destroyTab = render(body) || null;
  }

  function paintAll(withTab = false) {
    paintHead();
    paintBanners();
    if (withTab) paintTabs();
  }

  async function act(what, btn) {
    btn?.classList.add('busy');
    try {
      await post(`/api/projects/${slug}/${what}`);
      if (what === 'stop') toast(`« ${p.name} » arrêté`, { type: 'success' });
      if (what === 'restart') toast(`« ${p.name} » redémarré`, { type: 'success' });
      await refresh();
    } catch (e) { errorToast(e); } finally { btn?.classList.remove('busy'); }
  }

  async function removeProject() {
    const r = await confirmDialog({
      title: `Retirer « ${p.name} » ?`,
      message: `Le container et la configuration sont supprimés. Vos fichiers dans repo/${p.folder} ne sont PAS touchés : le dossier réapparaîtra dans les dossiers détectés.`,
      confirmLabel: 'Retirer le projet',
      danger: true,
      checkbox: p.database ? { label: `Supprimer aussi la base « ${p.database.name} »`, checked: false } : null,
    });
    if (!r) return;
    try {
      await del(`/api/projects/${slug}${r.checked ? '?dropDatabase=1' : ''}`);
      toast(`« ${p.name} » retiré`, { type: 'success' });
      await refresh();
      location.hash = '#/';
    } catch (e) { errorToast(e); }
  }

  function showDockerfile() {
    modal({
      title: 'Dockerfile généré',
      subtitle: `Image ${details.image} — partagée par tous les projets ayant la même configuration.`,
      icon: 'code',
      size: 'lg',
      body: h('div.form-stack', codeBlock(details.dockerfile, { lang: 'Dockerfile' }), h('h4', 'php.ini du projet'), codeBlock(details.phpIni, { lang: 'php.ini' })),
      actions: [{ label: 'Fermer' }],
    });
  }

  // ── Aperçu ──
  function overview(el) {
    const d = details;
    const ov = store.overview;
    const urls = card('Adresses', h('div.url-list', p.urls.map((u) => h('div.url-row',
      h('a.url-main', { href: u.https, target: '_blank', rel: 'noopener' }, icon('lock', 14), u.https.replace(/^https:\/\//, '')),
      h('div.url-alt', h('a', { href: u.https, target: '_blank', rel: 'noopener' }, 'https'), h('a', { href: u.http, target: '_blank', rel: 'noopener' }, 'http')),
      ['missing', 'unknown'].includes(hostState(u.host)) ? hostTag(u.host, p.domains) : null,
      copyBtn(u.https)))),
    h('a.card-link', { href: `#/projects/${slug}/domains` }, 'Gérer les adresses', icon('chevron-right', 14)));

    const files = card('Fichiers', kv([
      ['Sur votre machine', codeValue(d.hostFolder)],
      ['Dossier public', h('code', p.docroot ? `${p.docroot}/` : '(racine du projet)')],
      ['Dans le container', h('code', d.docrootPath)],
    ]));

    let db;
    if (d.database) {
      const x = d.database;
      const inst = ov.mysql.find((i) => i.id === x.instance);
      const sv = inst?.engine === 'mariadb' ? `mariadb-${inst.version}.0` : (inst?.version || '5.7');
      db = card('Base de données',
        kv([
          ['Serveur', `${x.label}`],
          ['Base', h('code', x.name)],
          ['Hôte (depuis le projet)', codeValue(`${x.host}:${x.port}`)],
          ['Hôte (depuis votre PC)', codeValue(`127.0.0.1:${x.hostPort}`)],
          ['Utilisateur', codeValue(x.user)],
          ['Mot de passe', codeValue(x.password)],
        ]),
        h('p.card-hint', 'À copier dans la configuration de votre projet :'),
        snippetTabs([
          { label: 'Laravel', lang: '.env', text: `DB_CONNECTION=mysql\nDB_HOST=${x.host}\nDB_PORT=${x.port}\nDB_DATABASE=${x.name}\nDB_USERNAME=${x.user}\nDB_PASSWORD=${x.password}` },
          { label: 'Symfony', lang: '.env', text: `DATABASE_URL="mysql://${x.user}:${x.password}@${x.host}:${x.port}/${x.name}?serverVersion=${sv}&charset=utf8mb4"` },
          { label: 'WordPress', lang: 'wp-config.php', text: `define( 'DB_NAME', '${x.name}' );\ndefine( 'DB_USER', '${x.user}' );\ndefine( 'DB_PASSWORD', '${x.password}' );\ndefine( 'DB_HOST', '${x.host}' );` },
          { label: 'PHP (PDO)', lang: 'php', text: `$pdo = new PDO('mysql:host=${x.host};port=${x.port};dbname=${x.name};charset=utf8mb4', '${x.user}', '${x.password}');` },
        ]),
        h('div.card-actions', h('a.btn.btn-sm', { href: `${ov.config.dbadminUrl}/?server=${encodeURIComponent(x.instance)}&db=${encodeURIComponent(x.name)}`, target: '_blank', rel: 'noopener' }, icon('table', 14), 'Ouvrir dans DB Admin')));
    } else {
      db = card('Base de données', h('p.muted', 'Aucune base associée à ce projet.'),
        h('button.btn.btn-sm', { type: 'button', onclick: attachDatabase }, icon('plus', 14), 'Associer une base'));
    }

    const env = card('Environnement', kv([
      ['PHP', `${p.php} · ${p.extensions.length} extensions`],
      ['Xdebug', p.xdebug === 'off' ? 'Désactivé' : p.xdebug === 'on' ? 'Toujours actif' : 'Sur demande'],
      ['Composer', 'Inclus'],
      ['Node.js', p.node ? 'Inclus' : 'Non'],
      ['Container', codeValue(p.container)],
    ]), h('a.card-link', { href: `#/projects/${slug}/php` }, 'Configurer PHP', icon('chevron-right', 14)));

    const mails = card('Mails', h('p.muted', 'Tous les mails envoyés par PHP sont interceptés : rien ne part vraiment, vous les lisez dans Mailpit.'),
      h('a.btn.btn-sm', { href: ov.config.mailpitUrl, target: '_blank', rel: 'noopener' }, icon('mail', 14), 'Ouvrir Mailpit'));

    el.append(h('div.overview-grid', h('div.col', urls, db), h('div.col', files, env, mails)));
  }

  function attachDatabase() {
    const ov = store.overview;
    const name = h('input.input', { value: p.slug.replace(/-/g, '_') });
    const inst = h('select.input', ov.mysql.map((i) => h('option', { value: i.id }, i.label)));
    modal({
      title: 'Associer une base de données',
      icon: 'database',
      size: 'sm',
      body: h('div.form-stack', field('Nom de la base', name, 'Créée si elle n\'existe pas.'), ov.mysql.length > 1 ? field('Serveur', inst) : null),
      actions: [{ label: 'Annuler' }, {
        label: 'Associer', variant: 'primary', onClick: async () => {
          await put(`/api/projects/${slug}`, { database: { instance: inst.value, name: name.value.trim() } });
          await refresh();
          await loadDetails();
          paintAll(true);
        },
      }],
    });
  }

  // ── PHP ──
  function phpTab(el) {
    const cat = store.catalog;
    const base = { php: p.php, extensions: [...p.extensions], node: !!p.node, docroot: p.docroot || '', ini: { ...cat.iniDefaults, ...(p.ini || {}) }, iniExtra: p.iniExtra || '' };
    const st = JSON.parse(JSON.stringify(base));

    const applyBar = h('div.apply-bar');
    const check = () => {
      const build = st.php !== base.php || st.node !== base.node || JSON.stringify([...st.extensions].sort()) !== JSON.stringify([...base.extensions].sort());
      const recreate = st.docroot !== base.docroot;
      const restart = JSON.stringify(st.ini) !== JSON.stringify(base.ini) || st.iniExtra !== base.iniExtra;
      const dirty = build || recreate || restart;
      applyBar.classList.toggle('show', dirty);
      if (!dirty) return;
      const impact = build ? ['hammer', 'L\'image sera reconstruite (1 à 3 min la première fois, instantané si elle existe déjà).']
        : recreate ? ['refresh', 'Le container sera recréé (quelques secondes).']
          : ['restart', 'Le container sera redémarré (2 secondes).'];
      replace(applyBar,
        h('div.apply-text', icon(impact[0], 16), h('span', h('strong', 'Modifications non appliquées. '), impact[1])),
        h('div.apply-actions',
          h('button.btn.btn-ghost', { type: 'button', onclick: () => paintTabs() }, 'Annuler'),
          h('button.btn.btn-primary', {
            type: 'button',
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.classList.add('busy');
              try {
                const r = await put(`/api/projects/${slug}`, st);
                toast(r.job ? 'Modifications en cours d\'application…' : 'Modifications enregistrées', { type: r.job ? 'info' : 'success' });
                await refresh();
                await loadDetails();
                paintAll(true);
              } catch (err) { errorToast(err); btn.classList.remove('busy'); }
            },
          }, icon('check', 15), 'Appliquer')));
    };

    // Version
    const versions = h('div.version-grid', cat.php.map((v) => {
      const input = h('input', { type: 'radio', name: 'php', value: v.v, checked: st.php === v.v, onchange: () => { st.php = v.v; picker.setPhp(v.v); nodeRow(); check(); } });
      return h(`label.version-tile${v.tag === 'Fin de vie' ? '.eol' : ''}`, input, h('strong', v.v), v.tag ? h('span', v.tag) : null);
    }));

    const picker = extensionPicker({ selected: st.extensions, php: st.php, onChange: (list) => { st.extensions = list; check(); } });

    const nodeBox = h('div');
    const nodeRow = () => {
      const ok = !['5.6', '7.0'].includes(st.php);
      if (!ok) st.node = false;
      replace(nodeBox, h('div.option-row',
        h('div', h('strong', 'Node.js 22 et npm'), h('span.muted', ok ? 'Pour npm install, Vite, Webpack… directement dans le container.' : 'Indisponible avec PHP 5.6 et 7.0.')),
        toggle(st.node, (v) => { st.node = v; check(); }, { disabled: !ok })));
    };
    nodeRow();

    const iniSelect = (key, options, label, hint) => {
      const s = h('select.input', { onchange: () => { st.ini[key] = s.value; check(); } },
        [...new Set([...options, st.ini[key]])].map((o) => h('option', { value: o }, o === '-1' ? 'Illimitée' : o === '0' ? 'Illimitée' : o)));
      s.value = st.ini[key];
      return field(label, s, hint);
    };
    const errSelect = h('select.input', { onchange: () => { st.ini.error_reporting = errSelect.value; check(); } },
      [
        ['E_ALL', 'Tout (recommandé en développement)'],
        ['E_ALL & ~E_DEPRECATED & ~E_STRICT', 'Tout sauf « deprecated »'],
        ['E_ALL & ~E_NOTICE & ~E_WARNING & ~E_DEPRECATED & ~E_STRICT', 'Erreurs seulement (anciens projets)'],
      ].concat([[st.ini.error_reporting, st.ini.error_reporting]]).filter((v, i, a) => a.findIndex((x) => x[0] === v[0]) === i)
        .map(([v, l]) => h('option', { value: v }, l)));
    errSelect.value = st.ini.error_reporting;

    const docroot = h('input.input', { value: st.docroot, placeholder: '(racine du projet)', oninput: () => { st.docroot = docroot.value.trim().replace(/^\/+|\/+$/g, ''); check(); } });
    const extra = h('textarea.input.mono', { rows: 4, placeholder: 'opcache.enable = 0\nsession.gc_maxlifetime = 7200', oninput: () => { st.iniExtra = extra.value; check(); } }, st.iniExtra);

    el.append(
      h('div.settings-stack',
        h('section.card', h('div.card-head', h('h3.card-title', 'Version de PHP'), h('span.muted', 'Changer de version reconstruit l\'image du projet.')), versions),
        h('section.card', h('div.card-head', h('h3.card-title', 'Extensions'), h('span.muted', 'Cochez, appliquez : c\'est installé.')), picker.el),
        h('section.card', h('h3.card-title', 'Outils'), h('div.option-row', h('div', h('strong', 'Composer'), h('span.muted', 'Toujours inclus (version adaptée à PHP).')), h('span.tag.tag-ok', icon('check', 12), 'Inclus')), nodeBox),
        h('section.card', h('div.card-head', h('h3.card-title', 'Réglages php.ini'), h('span.muted', 'Appliqués par un simple redémarrage.')),
          h('div.grid-3',
            iniSelect('memory_limit', ['128M', '256M', '512M', '1G', '2G', '-1'], 'Mémoire maximale'),
            iniSelect('upload_max_filesize', ['2M', '8M', '32M', '128M', '512M', '1G', '2G'], 'Taille max. d\'un upload'),
            iniSelect('post_max_size', ['8M', '32M', '128M', '512M', '1G', '2G'], 'Taille max. d\'un formulaire'),
            iniSelect('max_execution_time', ['30', '60', '300', '600', '0'], 'Durée max. d\'un script (s)'),
            field('Affichage des erreurs', h('div.option-inline', toggle(st.ini.display_errors === 'On', (v) => { st.ini.display_errors = v ? 'On' : 'Off'; check(); }), h('span.muted', 'display_errors'))),
            field('Niveau d\'erreurs', errSelect)),
          field('Directives supplémentaires', extra, 'Une directive par ligne, ajoutées telles quelles au php.ini du projet.')),
        h('section.card', h('h3.card-title', 'Serveur web'),
          field('Dossier public (DocumentRoot)', docroot, h('span', 'Relatif au dossier du projet. Exemples : ', h('code', 'public'), ', ', h('code', 'web'), ', ', h('code', 'htdocs'), '. Les .htaccess sont actifs.'))),
        h('details.card.details-card',
          h('summary', icon('code', 15), 'Voir la configuration générée (Dockerfile, php.ini)'),
          h('div.form-stack', codeBlock(details.dockerfile, { lang: 'Dockerfile' }), codeBlock(details.phpIni, { lang: 'php.ini' })))),
      applyBar);
    check();
  }

  // ── Xdebug ──
  function xdebugTab(el) {
    const major = details.xdebugMajor;
    const domain = p.domains[0];
    const modes = [
      { id: 'off', icon: 'zap', title: 'Désactivé', desc: 'Xdebug n\'est pas chargé : PHP tourne à pleine vitesse.' },
      { id: 'trigger', icon: 'bug', title: 'Sur demande', desc: 'Le débogage démarre seulement quand vous le déclenchez (extension du navigateur ou paramètre d\'URL).', badge: 'Recommandé' },
      { id: 'on', icon: 'bug', title: 'Toujours', desc: 'Chaque requête lance une session de débogage. Pratique pour les API et les scripts.' },
    ];
    const tiles = h('div.mode-grid', modes.map((m) => h(`button.mode-tile${p.xdebug === m.id ? '.active' : ''}`, {
      type: 'button',
      onclick: async (e) => {
        if (p.xdebug === m.id) return;
        const t = e.currentTarget;
        t.classList.add('busy');
        try {
          await put(`/api/projects/${slug}`, { xdebug: m.id });
          toast(m.id === 'off' ? 'Xdebug désactivé' : `Xdebug activé (${m.title.toLowerCase()})`, { type: 'success' });
          await refresh();
          await loadDetails();
          paintAll(true);
        } catch (err) { errorToast(err); t.classList.remove('busy'); }
      },
    }, h('span.mode-icon', icon(m.icon, 20)), h('strong', m.title, m.badge ? h('span.tag.tag-accent', m.badge) : null), h('span.muted', m.desc), h('span.mode-check', icon('check', 14)))));

    const trigger = major === 3 ? 'XDEBUG_TRIGGER=1' : 'XDEBUG_SESSION_START=PHPSTORM';
    const launch = JSON.stringify({
      version: '0.2.0',
      configurations: [{ name: `Xdebug — ${p.name}`, type: 'php', request: 'launch', port: 9003, pathMappings: { '/var/www/html': '${workspaceFolder}' } }],
    }, null, 2);

    el.append(h('div.settings-stack',
      h('section.card', h('div.card-head', h('h3.card-title', 'Mode'), h('span.muted', `Xdebug ${major} · port 9003 · appliqué en 2 secondes`)), tiles),
      p.xdebug === 'trigger' ? h('section.card', h('h3.card-title', 'Déclencher une session'),
        h('p', 'Installez l\'extension ', h('strong', 'Xdebug Helper'), ' (Chrome, Edge, Firefox) et cliquez sur « Debug », ou ajoutez ce paramètre à l\'adresse :'),
        h('div.url-row', h('code', `?${trigger}`), copyBtn(`?${trigger}`),
          h('a.btn.btn-sm', { href: `${p.urls[0].https}/?${trigger}`, target: '_blank', rel: 'noopener' }, icon('external', 14), 'Ouvrir le site avec le déclencheur'))) : null,
      h('section.card', h('h3.card-title', 'Configurer votre éditeur'),
        snippetTabs([
          { label: 'VS Code', lang: '.vscode/launch.json', text: launch },
          {
            label: 'PhpStorm',
            lang: 'étapes',
            text: [
              '1. Settings › PHP › Debug : port Xdebug = 9003',
              `2. Settings › PHP › Servers › + : Name = ${domain}, Host = ${domain}, Port = 443`,
              `3. Cocher « Use path mappings » : repo/${p.folder}  →  /var/www/html`,
              '4. Cliquer sur « Start Listening for PHP Debug Connections » (icône téléphone)',
            ].join('\n'),
          },
        ]),
        h('p.card-hint', 'Pour VS Code : extension « PHP Debug » (xdebug.php-debug), puis ouvrez le dossier du projet et lancez la configuration.'))));
  }

  // ── Adresses ──
  function domainsTab(el) {
    const st = { domains: [...p.domains], httpsRedirect: !!p.httpsRedirect };
    const list = h('div.domain-list');
    const saveBtn = h('button.btn.btn-primary', { type: 'button', disabled: true, onclick: save }, icon('check', 15), 'Enregistrer');
    const dirty = () => { saveBtn.disabled = JSON.stringify(st) === JSON.stringify({ domains: p.domains, httpsRedirect: !!p.httpsRedirect }); };
    const input = h('input.input.mono', { placeholder: 'mon-site.localhost, mon-site.test ou local-mon-site', autocomplete: 'off', spellcheck: false, onkeydown: (e) => { if (e.key === 'Enter') add(); } });
    const hostsBox = h('div');

    function paint() {
      replace(list, st.domains.map((d, i) => h('div.domain-row',
        icon(d.endsWith('.localhost') ? 'globe' : 'link', 15),
        h('code', d),
        hostTag(d, p.domains),
        i === 0 ? h('span.tag.tag-accent', 'principale') : h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { st.domains.splice(i, 1); st.domains.unshift(d); paint(); dirty(); } }, 'Rendre principale'),
        h('span.spacer'),
        st.domains.length > 1 ? h('button.btn.btn-ghost.btn-icon.btn-sm', { type: 'button', title: 'Retirer', onclick: () => { st.domains.splice(i, 1); paint(); dirty(); } }, icon('x', 15)) : null)));
      // Seules les adresses enregistrées peuvent être activées.
      replace(hostsBox, hostsHelp(st.domains.filter((d) => p.domains.includes(d))));
    }
    onHostsChange = paint;

    function add() {
      const d = cleanHost(input.value);
      if (!d) return;
      if (!HOST_OK.test(d)) { toast('Adresse invalide : lettres, chiffres, tirets et points (ex. blog.localhost, local-blog)', { type: 'error' }); return; }
      if (!st.domains.includes(d)) st.domains.push(d);
      input.value = '';
      paint();
      dirty();
    }

    async function save() {
      saveBtn.classList.add('busy');
      try {
        await put(`/api/projects/${slug}`, st);
        toast('Adresses mises à jour', { type: 'success' });
        await refresh();
        await loadDetails();
        paintAll(true);
      } catch (e) { errorToast(e); saveBtn.classList.remove('busy'); }
    }

    paint();
    el.append(h('div.settings-stack',
      h('section.card',
        h('div.card-head', h('h3.card-title', 'Adresses du projet'), h('span.muted', 'Chacune répond en http:// et en https://')),
        list,
        h('div.add-row', h('div.input-icon', icon('plus', 14), input), h('button.btn', { type: 'button', onclick: add }, 'Ajouter'))),
      hostsBox,
      h('section.card',
        h('div.option-row',
          h('div', h('strong', 'Toujours rediriger vers HTTPS'), h('span.muted', 'Les visites en http:// sont renvoyées vers https://.')),
          toggle(st.httpsRedirect, (v) => { st.httpsRedirect = v; dirty(); })),
        h('div.option-row',
          h('div', h('strong', 'Certificat HTTPS'), h('span.muted', 'Pour éviter l\'avertissement du navigateur, installez une fois le certificat local.')),
          h('a.btn.btn-sm', { href: '#/settings' }, icon('shield', 14), 'Réglages HTTPS'))),
      h('div.form-actions', saveBtn)));
  }

  // ── Commandes ──
  function commandsTab(el) {
    const t = details.tooling;
    const running = p.status === 'running';
    const out = consoleView({ height: '320px' });
    const outHead = h('div.console-head');
    let stopFollow = null;

    function follow(job) {
      stopFollow?.();
      lastCommand.set(slug, job.id);
      replace(outHead, icon('loader', 14, 'spin'), h('code', job.title));
      out.set([]);
      stopFollow = followJob(job.id, {
        onInit: ({ job: j, lines }) => { out.set(lines); paintHeadState(j); },
        onLog: (l) => out.push(l),
        onEnd: async (j) => {
          paintHeadState(j);
          // Une commande peut créer composer.json, vendor/, package.json… : on actualise les boutons.
          const before = JSON.stringify(details.tooling);
          if (await loadDetails() && JSON.stringify(details.tooling) !== before && tab === 'commands') paintTabs();
        },
      });
    }
    function paintHeadState(j) {
      if (!j) return;
      const ico = j.status === 'done' ? icon('circle-check', 14) : j.status === 'failed' ? icon('circle-x', 14) : icon('loader', 14, 'spin');
      replace(outHead, h(`span.cmd-state.cmd-${j.status}`, ico), h('code', j.title), j.status === 'failed' ? h('span.muted', j.error) : null);
    }

    async function run(cmd) {
      if (!running) { toast('Démarrez le projet pour lancer des commandes.', { type: 'warning' }); return; }
      try {
        const { job } = await post(`/api/projects/${slug}/command`, { command: cmd });
        follow(job);
      } catch (e) { errorToast(e); }
    }
    function inTerminal(cmd) {
      terminalCommand.set(slug, cmd);
      location.hash = `#/projects/${slug}/terminal`;
    }
    const cmdBtn = (label, cmd, { danger = false, terminal: inTerm = false, hint } = {}) => h(`button.cmd-btn${danger ? '.danger' : ''}`, {
      type: 'button',
      title: cmd,
      disabled: !running,
      onclick: async () => {
        if (danger && !(await confirmDialog({ title: 'Confirmer', message: `Lancer « ${cmd} » ? ${hint || ''}`, confirmLabel: 'Lancer', danger: true }))) return;
        if (inTerm) inTerminal(cmd); else run(cmd);
      },
    }, h('strong', label), h('code', cmd), inTerm ? h('span.cmd-term', icon('terminal', 12), 'terminal') : null);

    const groups = [];
    if (t.composer) {
      const pkg = h('input.input.input-sm', { placeholder: 'vendor/paquet', onkeydown: (e) => { if (e.key === 'Enter' && pkg.value.trim()) run(`composer require ${pkg.value.trim()}`); } });
      groups.push(h('section.card', h('div.card-head', h('h3.card-title', 'Composer'), t.vendor ? h('span.tag.tag-ok', 'vendor/ présent') : h('span.tag.tag-warn', 'vendor/ absent : lancez composer install')),
        h('div.cmd-grid',
          cmdBtn('Installer les dépendances', 'composer install'),
          cmdBtn('Mettre à jour', 'composer update'),
          cmdBtn('Régénérer l\'autoload', 'composer dump-autoload -o')),
        h('div.add-row', h('div.input-icon', icon('package', 14), pkg), h('button.btn.btn-sm', { type: 'button', disabled: !running, onclick: () => pkg.value.trim() && run(`composer require ${pkg.value.trim()}`) }, 'composer require'))));
    }
    if (t.framework === 'laravel') {
      groups.push(h('section.card', h('h3.card-title', 'Laravel'), h('div.cmd-grid',
        !t.env && t.envExample ? cmdBtn('Créer le fichier .env', 'cp .env.example .env') : null,
        cmdBtn('Générer la clé', 'php artisan key:generate'),
        cmdBtn('Migrer la base', 'php artisan migrate --force'),
        cmdBtn('Lien storage', 'php artisan storage:link'),
        cmdBtn('Vider les caches', 'php artisan optimize:clear'),
        cmdBtn('Repartir de zéro', 'php artisan migrate:fresh --seed --force', { danger: true, hint: 'Toutes les tables seront supprimées puis recréées.' }))));
    }
    if (t.framework === 'symfony') {
      groups.push(h('section.card', h('h3.card-title', 'Symfony'), h('div.cmd-grid',
        cmdBtn('Vider le cache', 'php bin/console cache:clear'),
        cmdBtn('Créer la base', 'php bin/console doctrine:database:create --if-not-exists'),
        cmdBtn('Migrer la base', 'php bin/console doctrine:migrations:migrate -n'))));
    }
    if (t.npm) {
      const longRunning = /^(dev|watch|serve|start|hot)(:|$)/;
      groups.push(h('section.card', h('div.card-head', h('h3.card-title', 'npm'), p.node ? (t.nodeModules ? h('span.tag.tag-ok', 'node_modules/ présent') : h('span.tag.tag-warn', 'node_modules/ absent')) : null),
        p.node
          ? h('div.cmd-grid',
            cmdBtn('Installer les paquets', 'npm install'),
            t.scripts.map((s) => cmdBtn(`npm run ${s}`, `npm run ${s}`, { terminal: longRunning.test(s) })))
          : h('div.option-row', h('div', h('strong', 'Node.js n\'est pas installé dans ce projet'), h('span.muted', 'Activez-le pour lancer npm depuis le tableau de bord.')),
            h('button.btn.btn-sm', {
              type: 'button',
              onclick: async () => {
                try { await put(`/api/projects/${slug}`, { node: true }); toast('Ajout de Node.js : reconstruction de l\'image…'); await refresh(); await loadDetails(); paintAll(true); } catch (e) { errorToast(e); }
              },
            }, icon('plus', 14), 'Activer Node.js'))));
    }

    const custom = h('input.input.mono', { placeholder: 'php -v', onkeydown: (e) => { if (e.key === 'Enter' && custom.value.trim()) { run(custom.value.trim()); } } });
    el.append(h('div.settings-stack',
      !running ? h('div.banner.banner-info', icon('info', 18), h('div.banner-body', h('p', 'Le projet est arrêté : démarrez-le pour lancer des commandes.'))) : null,
      groups.length ? groups : null,
      h('section.card',
        h('h3.card-title', 'Lancer une commande'),
        h('div.add-row', h('div.input-icon.input-prompt', h('span.prompt', '$'), custom), h('button.btn.btn-primary', { type: 'button', disabled: !running, onclick: () => custom.value.trim() && run(custom.value.trim()) }, icon('play', 14), 'Exécuter')),
        h('p.card-hint', 'Exécutée dans /var/www/html. Pour une commande qui ne s\'arrête pas (serveur de dev, watch…), utilisez le ', h('a', { href: `#/projects/${slug}/terminal` }, 'terminal'), '.'),
        h('div.console-wrap', outHead, out.el))));

    const prev = lastCommand.get(slug);
    if (prev) follow({ id: prev, title: '…' });
    else replace(outHead, h('span.muted', 'La sortie des commandes s\'affiche ici.'));
    return () => stopFollow?.();
  }

  // ── Logs ──
  function logsTab(el) {
    const v = logViewer(p.container, { tail: 1000 });
    el.append(h('div.full-panel', v.el));
    return v.destroy;
  }

  // ── Terminal ──
  function terminalTab(el) {
    if (p.status !== 'running') {
      el.append(h('div.empty', icon('terminal', 28), h('h3', 'Le projet est arrêté'), h('p.muted', 'Démarrez-le pour ouvrir un terminal.'),
        h('button.btn.btn-primary', { type: 'button', onclick: (e) => act('start', e.currentTarget) }, icon('play', 14), 'Démarrer')));
      return null;
    }
    let asRoot = false;
    let t = null;
    const holder = h('div.term-holder');
    const open = () => {
      t?.destroy();
      const cmd = terminalCommand.get(slug);
      terminalCommand.delete(slug);
      t = terminal(p.container, { root: asRoot, command: cmd });
      replace(holder, t.el);
    };
    const rootToggle = toggle(false, (v) => { asRoot = v; open(); });
    const execCmd = `docker exec -it ${p.container} bash`;
    el.append(h('div.full-panel.term-panel',
      h('div.term-toolbar',
        h('span.muted', icon('folder', 13), '/var/www/html'),
        h('span.spacer'),
        h('label.option-inline', rootToggle, h('span', 'root')),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: open }, icon('refresh', 14), 'Nouvelle session'),
        h('span.term-cli', h('code', execCmd), copyBtn(execCmd, { title: 'Copier la commande pour votre propre terminal' }))),
      holder));
    open();
    return () => t?.destroy();
  }

  // ── Cycle de vie ──
  (async () => {
    if (!(await loadDetails())) return;
    paintAll(true);
  })();

  return {
    navigate(next) {
      if (next.tab && next.tab !== tab) {
        tab = next.tab;
        if (p) paintTabs();
      }
    },
    update(ov) {
      if (!p) return;
      const fresh = ov.projects.find((x) => x.slug === slug);
      if (!fresh) return;
      const hostsSig = JSON.stringify(fresh.domains.map((d) => hostState(d, ov)));
      if (hostsSig !== lastHosts) { lastHosts = hostsSig; onHostsChange?.(); }
      const sig = JSON.stringify([fresh.status, fresh.job?.id, fresh.error, fresh.folderExists, fresh.name, fresh.php, fresh.xdebug, fresh.urls, hostsSig]);
      if (sig === lastSig) return;
      const statusChanged = lastSig && JSON.parse(lastSig)[0] !== fresh.status;
      lastSig = sig;
      p = { ...p, ...fresh };
      paintHead();
      paintBanners();
      // Le terminal et les commandes dépendent de l'état « démarré ».
      if (statusChanged && ['terminal', 'commands'].includes(tab)) paintTabs();
    },
    destroy() {
      destroyTab?.();
      jobBanner?.stop();
    },
  };
}
