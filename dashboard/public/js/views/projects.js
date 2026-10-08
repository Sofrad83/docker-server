// Page « Projets » : dossiers détectés, cartes des projets, création.
import {
  h, icon, post, get, del, store, refresh, replace, toast, errorToast, modal, field, toggle,
  statusPill, avatar, copyBtn, stackLabel, cleanHost, hostHint, HOST_OK,
} from '../lib.js';
import { extensionPicker } from '../components/extensions.js';

function pageHeader(title, subtitle, actions) {
  return h('header.page-header', h('div', h('h1', title), subtitle ? h('p.page-sub', subtitle) : null), h('div.page-actions', actions));
}

export { pageHeader };

async function quickAdd(folder, btn) {
  btn?.classList.add('busy');
  try {
    const { job } = await post('/api/projects', { folder });
    toast(`« ${folder} » est en préparation…`, { type: 'info' });
    await refresh();
    return job;
  } catch (e) {
    errorToast(e);
    btn?.classList.remove('busy');
    return null;
  }
}

/** Ignore un dossier (ce n'est pas un site) ou le propose à nouveau. */
async function setIgnored(folder, on, btn) {
  btn?.classList.add('busy');
  const url = `/api/folders/${encodeURIComponent(folder)}/ignore`;
  try {
    await (on ? post(url) : del(url));
    toast(on ? `« ${folder} » est ignoré` : `« ${folder} » est de nouveau proposé`, {
      type: 'success',
      action: on ? { label: 'Annuler', onClick: () => setIgnored(folder, false) } : null,
    });
    await refresh();
  } catch (e) {
    errorToast(e);
    btn?.classList.remove('busy');
  }
}

async function action(slug, what) {
  try {
    await post(`/api/projects/${slug}/${what}`);
    await refresh();
  } catch (e) { errorToast(e); }
}

function iconBtn(ico, title, onClick, { disabled = false } = {}) {
  return h('button.btn.btn-ghost.btn-icon.btn-sm', {
    type: 'button', title, 'aria-label': title, disabled,
    onclick: (e) => { e.stopPropagation(); onClick(e); },
  }, icon(ico, 16));
}

function projectCard(p) {
  const url = p.urls[0];
  const failed = p.error && p.status !== 'running' && p.status !== 'working';
  const running = p.status === 'running';
  return h('article.project-card', {
    tabindex: '0',
    onclick: (e) => { if (!e.target.closest('a,button')) location.hash = `#/projects/${p.slug}`; },
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) location.hash = `#/projects/${p.slug}`; },
  },
  h('div.pc-head',
    avatar(p.framework, 40),
    h('div.pc-title', h('h3', p.name), h('div.pc-sub', stackLabel(p))),
    statusPill(failed ? 'error' : p.status)),
  url ? h('a.pc-url', { href: url.https, target: '_blank', rel: 'noopener', title: `Ouvrir ${url.https}` },
    icon('lock', 13), h('span', url.host), icon('external', 12, 'pc-url-ext')) : null,
  p.job ? h('div.pc-note.pc-job', icon('loader', 14, 'spin'), h('span', p.job.step || p.job.title))
    : failed ? h('div.pc-note.pc-error', icon('alert', 14), h('span', p.error)) : null,
  h('div.pc-foot',
    h('div.pc-tags',
      p.xdebug && p.xdebug !== 'off' ? h('span.tag.tag-accent', icon('bug', 12), p.xdebug === 'on' ? 'Xdebug' : 'Xdebug (demande)') : null,
      p.database ? h('span.tag', icon('database', 12), p.database.name) : null,
      !p.folderExists ? h('span.tag.tag-warn', icon('alert', 12), 'Dossier absent') : null),
    h('div.pc-actions',
      running ? iconBtn('stop', 'Arrêter', () => action(p.slug, 'stop'))
        : iconBtn('play', 'Démarrer', () => action(p.slug, 'start'), { disabled: p.status === 'working' }),
      iconBtn('restart', 'Redémarrer', () => action(p.slug, 'restart'), { disabled: !running }),
      iconBtn('terminal', 'Terminal', () => { location.hash = `#/projects/${p.slug}/terminal`; }, { disabled: !running }),
      iconBtn('logs', 'Logs', () => { location.hash = `#/projects/${p.slug}/logs`; }))));
}

function pendingSection(pending) {
  const n = pending.length;
  return h('section.pending',
    h('div.pending-head',
      h('span.pending-icon', icon('sparkles', 18)),
      h('div',
        h('h2', n === 1 ? 'Nouveau dossier détecté' : `${n} nouveaux dossiers détectés`),
        h('p.muted', 'Ils sont dans repo/ mais pas encore en ligne. Tout est déjà configuré : un clic suffit.')),
      n > 1 ? h('button.btn.btn-sm', {
        type: 'button',
        onclick: async (e) => {
          e.currentTarget.classList.add('busy');
          for (const d of pending) await quickAdd(d.folder);
        },
      }, icon('plus', 14), 'Tout ajouter') : null),
    h('div.pending-list', pending.map((d) => {
      const add = h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => quickAdd(d.folder, add) }, icon('play', 13), 'Mettre en ligne');
      return h('div.pending-row',
        avatar(d.framework, 34),
        h('div.pending-info',
          h('strong', d.folder),
          h('span.muted', [stackLabel(d), d.docroot ? `dossier public : ${d.docroot}/` : null, d.database ? `base « ${d.database} »` : null].filter(Boolean).join(' · '))),
        h('span.pending-url.muted', `${d.slug}.localhost`),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Ce n\'est pas un site : ne plus le proposer', onclick: (e) => setIgnored(d.folder, true, e.currentTarget) }, 'Ignorer'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => openNewProject({ folder: d.folder }) }, 'Personnaliser'),
        add);
    })));
}

function ignoredSection(folders, open) {
  const n = folders.length;
  return h('details.advanced.ignored', { open },
    h('summary', icon('chevron-right', 15), `${n} dossier${n > 1 ? 's' : ''} ignoré${n > 1 ? 's' : ''}`, h('span.muted', '· pas proposés comme projets')),
    h('div.ignored-list', folders.map((f) => h('div.ignored-row',
      icon('folder', 15),
      h('code', f),
      h('span.spacer'),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: (e) => setIgnored(f, false, e.currentTarget) }, icon('eye', 14), 'Ne plus ignorer')))));
}

function emptyState(ov) {
  return h('section.empty-hero',
    h('div.empty-art', icon('folder-plus', 34)),
    h('h2', 'Votre premier site en 30 secondes'),
    h('p.muted', 'Pas de configuration, pas de fichier hosts : déposez vos sources, docker-server s\'occupe du reste.'),
    h('ol.empty-steps',
      h('li', h('span.step-num', '1'), h('div', h('strong', 'Copiez votre site dans le dossier repo'),
        h('div.path-line', h('code', ov.config.repoPath), copyBtn(ov.config.repoPath)))),
      h('li', h('span.step-num', '2'), h('div', h('strong', 'Il apparaît ici automatiquement'), h('span.muted', 'Framework, version de PHP et dossier public sont détectés.'))),
      h('li', h('span.step-num', '3'), h('div', h('strong', 'Un clic : il est en ligne'), h('span.muted', 'Sur https://votre-site.localhost, avec sa base de données.')))),
    h('div.empty-actions',
      h('button.btn.btn-primary', {
        type: 'button',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.classList.add('busy');
          try {
            const { job } = await post('/api/projects', { newFolder: 'bienvenue', template: 'welcome' });
            await refresh();
            location.hash = `#/projects/${job.meta.project}`;
          } catch (err) { errorToast(err); btn.classList.remove('busy'); }
        },
      }, icon('sparkles', 16), 'Créer un site de démonstration'),
      h('button.btn', { type: 'button', onclick: () => openNewProject({ mode: 'new' }) }, icon('plus', 16), 'Nouveau projet vide')));
}

export function mount(root) {
  const pendingBox = h('div');
  const grid = h('div.project-grid');
  const emptyBox = h('div');
  const ignoredBox = h('div');
  const sub = h('span');
  root.append(h('div.page',
    pageHeader('Projets', sub, [h('button.btn.btn-primary', { type: 'button', onclick: () => openNewProject() }, icon('plus', 16), 'Nouveau projet')]),
    pendingBox, grid, emptyBox, ignoredBox));

  const cards = new Map();
  let pendingSig = '';
  let ignoredSig = '';

  return {
    update(ov) {
      sub.textContent = ov.projects.length
        ? `${ov.projects.length} projet${ov.projects.length > 1 ? 's' : ''} · servis depuis ${ov.config.repoPath}`
        : 'Chaque dossier de repo/ devient un site local en un clic.';

      const sig = JSON.stringify(ov.pending.map((d) => [d.folder, d.php, d.framework, d.docroot]));
      if (sig !== pendingSig) {
        pendingSig = sig;
        replace(pendingBox, ov.pending.length ? pendingSection(ov.pending) : null);
      }

      const seen = new Set();
      ov.projects.forEach((p, i) => {
        seen.add(p.slug);
        const s = JSON.stringify([p.status, p.name, p.php, p.frameworkLabel, p.urls, p.xdebug, p.job?.step, p.error, p.folderExists, p.database]);
        let c = cards.get(p.slug);
        if (!c || c.sig !== s) {
          const el = projectCard(p);
          if (c) c.el.replaceWith(el);
          c = { sig: s, el };
          cards.set(p.slug, c);
        }
        if (grid.children[i] !== c.el) grid.insertBefore(c.el, grid.children[i] || null);
      });
      for (const [slug, c] of cards) if (!seen.has(slug)) { c.el.remove(); cards.delete(slug); }

      const showEmpty = !ov.projects.length && !ov.pending.length;
      if (showEmpty && !emptyBox.firstChild) replace(emptyBox, emptyState(ov));
      if (!showEmpty && emptyBox.firstChild) replace(emptyBox);

      const ignored = ov.ignored || [];
      if (JSON.stringify(ignored) !== ignoredSig) {
        ignoredSig = JSON.stringify(ignored);
        // Garde la liste ouverte si elle l'était (« Ne plus ignorer » plusieurs fois de suite).
        replace(ignoredBox, ignored.length ? ignoredSection(ignored, !!ignoredBox.querySelector('details[open]')) : null);
      }
    },
  };
}

// ── Création d'un projet ─────────────────────────────────────────────────

export async function openNewProject({ folder, mode } = {}) {
  const ov = store.overview;
  const cat = store.catalog;
  const free = ov.pending.map((d) => d.folder);
  let current = mode || (folder || free.length ? 'existing' : 'new');
  const st = {
    folder: folder || free[0] || '',
    path: '',
    newFolder: '',
    template: 'welcome',
    name: '',
    address: '',
    php: ov.settings.php,
    docroot: '',
    extensions: cat.defaultExtensions,
    node: false,
    db: true,
    dbName: '',
    dbInstance: ov.mysql.find((i) => i.default)?.id || ov.mysql[0]?.id,
  };
  let addressTouched = false;

  const segBtns = {
    existing: h('button', { type: 'button', onclick: () => setMode('existing') }, icon('folder', 15), 'Dossier de repo/'),
    path: h('button', { type: 'button', onclick: () => setMode('path') }, icon('link', 15), 'Sous-dossier'),
    new: h('button', { type: 'button', onclick: () => setMode('new') }, icon('folder-plus', 15), 'Nouveau dossier'),
  };
  const seg = h('div.seg.seg-wide', segBtns.existing, segBtns.path, segBtns.new);
  const sourceBox = h('div');
  const detectBox = h('div');

  const nameInput = h('input.input', { value: st.name, placeholder: 'Mon site', oninput: () => { st.name = nameInput.value; } });
  // Adresse libre : « mon-site.localhost » par défaut, mais « mon-site.test » ou « local-mon-site » conviennent aussi.
  const addressInput = h('input.input.mono', {
    placeholder: 'mon-site.localhost',
    autocomplete: 'off',
    spellcheck: false,
    oninput: () => { addressTouched = true; st.address = cleanHost(addressInput.value); urlPreview(); },
  });
  const urlText = h('div.address-hint');
  const urlPreview = () => replace(urlText, st.address && HOST_OK.test(st.address) ? h('span.url-preview', `https://${st.address}`) : null, hostHint(st.address));
  const defaultAddress = (slug) => (slug ? `${slug}.localhost` : '');
  const setDefaultAddress = (slug) => {
    if (addressTouched) return;
    st.address = defaultAddress(slug);
    addressInput.value = st.address;
    urlPreview();
  };

  const phpSelect = h('select.input', {
    onchange: () => { st.php = phpSelect.value; picker.setPhp(st.php); nodeRow(); },
  }, cat.php.map((p) => h('option', { value: p.v }, `PHP ${p.v}${p.tag ? ` — ${p.tag}` : ''}`)));
  const docrootInput = h('input.input', { placeholder: '(racine du dossier)', list: 'docroots', oninput: () => { st.docroot = docrootInput.value.trim(); } });
  const docrootList = h('datalist#docroots', ['public', 'web', 'htdocs', 'www', 'public_html', 'webroot'].map((d) => h('option', { value: d })));

  const dbToggleBox = h('span');
  const dbNameInput = h('input.input', { oninput: () => { st.dbName = dbNameInput.value.trim(); } });
  const dbInstSelect = h('select.input', { onchange: () => { st.dbInstance = dbInstSelect.value; } },
    ov.mysql.map((i) => h('option', { value: i.id }, i.label + (i.default ? '' : ` (${i.id})`))));
  const dbFields = h('div.inline-fields', field('Nom de la base', dbNameInput), ov.mysql.length > 1 ? field('Serveur', dbInstSelect) : null);
  const paintDb = () => {
    replace(dbToggleBox, toggle(st.db, (v) => { st.db = v; dbFields.hidden = !v; }));
    dbFields.hidden = !st.db;
  };

  const nodeBox = h('div');
  const nodeRow = () => {
    const ok = Number(st.php.split('.')[0]) >= 8 || st.php >= '7.1';
    replace(nodeBox, h('div.option-row',
      h('div', h('strong', 'Node.js et npm'), h('span.muted', ok ? 'Pour compiler les assets (Vite, Webpack…).' : 'Indisponible avant PHP 7.1.')),
      toggle(st.node && ok, (v) => { st.node = v; }, { disabled: !ok })));
  };

  const extSummary = h('span.muted');
  const extEditor = h('div.ext-editor', { hidden: true });
  const picker = extensionPicker({
    selected: st.extensions,
    php: st.php,
    onChange: (list) => { st.extensions = list; extSummary.textContent = `${list.length} extensions : ${list.join(', ')}`; },
  });
  extEditor.append(picker.el);
  extSummary.textContent = `${st.extensions.length} extensions : ${st.extensions.join(', ')}`;

  const advanced = h('details.advanced',
    h('summary', icon('chevron-right', 14), 'Réglages avancés', h('span.muted', ' — extensions, Node.js, dossier public')),
    h('div.advanced-body',
      field('Dossier public', docrootInput, 'Le dossier servi par Apache, relatif au projet (souvent public/ ou web/).'),
      docrootList,
      nodeBox,
      h('div.option-row.option-col',
        h('div.option-row-head', h('div', h('strong', 'Extensions PHP'), extSummary),
          h('button.btn.btn-sm', { type: 'button', onclick: () => { extEditor.hidden = !extEditor.hidden; } }, 'Modifier')),
        extEditor)));

  function applyDetection(d) {
    st.name = d?.name || st.newFolder || '';
    st.php = d?.php || ov.settings.php;
    st.docroot = d?.docroot ?? '';
    st.extensions = d?.extensions || cat.defaultExtensions;
    st.node = !!d?.node;
    st.db = d ? !!d.database : true;
    st.dbName = d?.database || slugify(st.newFolder).replace(/-/g, '_');
    nameInput.value = st.name;
    phpSelect.value = st.php;
    docrootInput.value = st.docroot;
    dbNameInput.value = st.dbName;
    picker.set(st.extensions);
    picker.setPhp(st.php);
    setDefaultAddress(d?.slug || slugify(st.newFolder));
    paintDb();
    nodeRow();
    if (d) {
      replace(detectBox, h('div.detect',
        avatar(d.framework, 36),
        h('div',
          h('strong', d.framework === 'php' ? 'Projet PHP détecté' : `${d.frameworkLabel} détecté`),
          h('div.muted', [
            `PHP ${d.php}${d.phpConstraint ? ` (composer.json demande ${d.phpConstraint})` : ''}`,
            d.docroot ? `dossier public ${d.docroot}/` : 'servi depuis la racine',
            d.node ? 'package.json trouvé' : null,
          ].filter(Boolean).join(' · ')),
          d.unknownExtensions?.length ? h('div.muted', `Extensions à vérifier : ${d.unknownExtensions.join(', ')}`) : null)));
    } else replace(detectBox);
  }

  async function detect() {
    if (!st.folder) { applyDetection(null); return; }
    try { applyDetection(await get(`/api/detect?folder=${encodeURIComponent(st.folder)}`)); } catch (e) { errorToast(e); }
  }

  // Sous-dossier : détection à la volée, erreurs affichées sous le champ (pas de toast à chaque frappe).
  let pathTimer = null;
  let pathSeq = 0;
  async function detectPath() {
    const seq = ++pathSeq;
    if (!st.path) { applyDetection(null); return; }
    try {
      const d = await get(`/api/detect?folder=${encodeURIComponent(st.path)}`);
      if (seq !== pathSeq) return;
      st.folder = d.folder;
      applyDetection(d);
    } catch (e) {
      if (seq !== pathSeq) return;
      st.folder = '';
      replace(detectBox, h('div.banner.banner-warn', icon('alert', 16), h('div.banner-body', h('p', e.message))));
    }
  }

  function setMode(m) {
    current = m;
    for (const [k, b] of Object.entries(segBtns)) b.classList.toggle('active', k === m);
    if (m === 'path') {
      const list = h('datalist#subfolders');
      const input = h('input.input.mono', {
        placeholder: 'mon-client/site-web',
        value: st.path,
        list: 'subfolders',
        autocomplete: 'off',
        spellcheck: false,
        oninput: () => {
          st.path = input.value.trim();
          clearTimeout(pathTimer);
          pathTimer = setTimeout(detectPath, 350);
        },
      });
      replace(sourceBox, field('Chemin du dossier', h('div', input, list),
        h('span', 'Un dossier de ', h('code', 'repo/'), ' à n\'importe quelle profondeur, par exemple un site rangé dans le dossier d\'un client. Vous pouvez aussi coller son chemin complet.')));
      get('/api/folders').then(({ subfolders }) => replace(list, subfolders.map((f) => h('option', { value: f })))).catch(() => null);
      st.folder = '';
      detectPath();
      setTimeout(() => input.focus(), 50);
    } else if (m === 'existing') {
      st.folder = free.includes(st.folder) ? st.folder : free[0] || '';
      const sel = h('select.input', { onchange: () => { st.folder = sel.value; detect(); } },
        free.map((f) => h('option', { value: f }, `repo/${f}`)));
      sel.value = st.folder;
      replace(sourceBox, free.length
        ? field('Dossier', sel, 'Les dossiers de repo/ qui ne sont pas encore des projets.')
        : h('div.banner.banner-info', icon('info', 16), h('div.banner-body', h('strong', 'Aucun dossier libre dans repo/'),
          h('p', 'Copiez votre site dans ', h('code', ov.config.repoPath), ', il apparaîtra ici. Votre site est rangé dans un sous-dossier ? Utilisez ',
            h('a', { href: '#', onclick: (e) => { e.preventDefault(); setMode('path'); } }, 'Sous-dossier'), '.'))));
      detect();
    } else {
      const input = h('input.input', {
        placeholder: 'mon-site',
        value: st.newFolder,
        oninput: () => {
          st.newFolder = input.value.trim();
          setDefaultAddress(slugify(st.newFolder));
          st.name = st.newFolder; nameInput.value = st.name;
          st.dbName = slugify(st.newFolder).replace(/-/g, '_'); dbNameInput.value = st.dbName;
        },
      });
      const tpl = (value, title, desc) => h('label.radio-card',
        h('input', { type: 'radio', name: 'tpl', value, checked: st.template === value, onchange: () => { st.template = value; } }),
        h('span', h('strong', title), h('span.muted', desc)));
      replace(sourceBox,
        field('Nom du dossier', input, h('span', 'Créé dans ', h('code', 'repo/'), '.')),
        h('div.radio-cards', tpl('welcome', 'Page de démarrage', 'Une page qui vérifie PHP, la base et les mails.'), tpl('empty', 'Dossier vide', 'Pour y copier vos fichiers ensuite.')));
      applyDetection(null);
      setTimeout(() => input.focus(), 50);
    }
  }

  const body = h('div.form-stack',
    seg,
    sourceBox,
    detectBox,
    h('div.grid-2',
      field('Nom du projet', nameInput),
      field('Adresse', addressInput, urlText)),
    h('div.grid-2',
      field('Version de PHP', phpSelect),
      h('div.field', h('span.field-label', 'Base de données'), h('div.option-inline', dbToggleBox, h('span.muted', 'Créer une base MySQL dédiée')))),
    dbFields,
    advanced);

  setMode(current);
  paintDb();
  nodeRow();

  modal({
    title: 'Nouveau projet',
    subtitle: 'Tout est prérempli : vérifiez et lancez.',
    icon: 'plus',
    size: 'lg',
    body,
    actions: [
      { label: 'Annuler' },
      {
        label: 'Créer et mettre en ligne',
        variant: 'primary',
        icon: 'play',
        onClick: async () => {
          const payload = {
            name: st.name || undefined,
            php: st.php,
            docroot: st.docroot,
            extensions: st.extensions,
            node: st.node,
            database: st.db && st.dbName ? { instance: st.dbInstance, name: st.dbName } : null,
          };
          if (st.address) {
            if (!HOST_OK.test(st.address)) throw new Error(`Adresse invalide : « ${st.address} ».`);
            payload.domains = [st.address];
          }
          if (current === 'existing') {
            if (!st.folder) throw new Error('Choisissez un dossier.');
            payload.folder = st.folder;
          } else if (current === 'path') {
            if (!st.path) throw new Error('Indiquez le chemin du dossier.');
            payload.folder = st.path;
          } else {
            if (!st.newFolder) throw new Error('Donnez un nom au dossier.');
            payload.newFolder = st.newFolder;
            payload.template = st.template;
          }
          const { job } = await post('/api/projects', payload);
          await refresh();
          location.hash = `#/projects/${job.meta.project}`;
        },
      },
    ],
  });
}

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
