// Page « FTP » : comptes FTP locaux, chacun sur le dossier de son choix.
import {
  h, icon, get, post, put, del, store, refresh, replace, toast, errorToast, modal, confirmDialog,
  field, statusPill, codeValue, snippetTabs, copyBtn,
} from '../lib.js';
import { pageHeader } from './projects.js';

function connectionInfo(info, a) {
  return h('div.form-stack',
    h('div.conn-grid',
      h('div.conn', h('span.conn-label', 'Hôte'), codeValue(info.host)),
      h('div.conn', h('span.conn-label', 'Port'), codeValue(String(info.port))),
      h('div.conn', h('span.conn-label', 'Identifiant'), codeValue(a.user)),
      h('div.conn', h('span.conn-label', 'Mot de passe'), codeValue(a.password, { secret: true }))),
    snippetTabs([
      {
        label: '.env (depuis votre PC)',
        lang: '.env',
        text: `FTP_HOST=${info.host}\nFTP_PORT=${info.port}\nFTP_USERNAME=${a.user}\nFTP_PASSWORD=${a.password}\nFTP_ROOT=/\nFTP_PASSIVE=true`,
      },
      {
        label: '.env (depuis un projet)',
        lang: '.env',
        text: `FTP_HOST=ftp\nFTP_PORT=21\nFTP_USERNAME=${a.user}\nFTP_PASSWORD=${a.password}\nFTP_ROOT=/\nFTP_PASSIVE=true\n# PHP natif : ftp_set_option($ftp, FTP_USEPASVADDRESS, false);`,
      },
      { label: 'URL', lang: 'ftp://', text: `ftp://${a.user}:${encodeURIComponent(a.password)}@${info.host}:${info.port}/` },
    ]),
    h('div.card-actions',
      h('a.btn.btn-sm', { href: `/api/ftp/${encodeURIComponent(a.user)}/filezilla.xml`, download: `filezilla-${a.user}.xml` }, icon('download', 14), 'Fichier FileZilla'),
      h('span.muted.small', 'Dans FileZilla : Fichier › Importer…, puis Gestionnaire de sites.')));
}

function showConnection(info, a, title) {
  modal({
    title: title || `Connexion « ${a.user} »`,
    subtitle: a.hostPath,
    icon: 'ftp',
    body: connectionInfo(info, a),
    actions: [{ label: 'Fermer', variant: 'primary' }],
  });
}

async function accountForm(info, existing) {
  const ov = store.overview;
  const isNew = !existing;
  const suggestion = (() => { let i = 1; while (info.accounts.some((a) => a.user === `ftp${i}`)) i++; return `ftp${i}`; })();
  const user = h('input.input', { value: existing?.user || suggestion, disabled: !isNew, autocomplete: 'off' });
  const pass = h('input.input.mono', { value: existing?.password || (await get('/api/ftp-password')).password, autocomplete: 'off' });
  const regen = h('button.btn.btn-ghost.btn-icon', { type: 'button', title: 'Générer un autre mot de passe', onclick: async () => { pass.value = (await get('/api/ftp-password')).password; } }, icon('refresh', 15));
  const label = h('input.input', { value: existing?.label || '', placeholder: 'Ex. : dépôt de documents' });

  const folders = [...new Set([...ov.projects.map((p) => p.folder), ...ov.pending.map((d) => d.folder)])].sort();
  const cur = existing?.path || '';
  let kind = !existing ? 'dedicated' : cur.startsWith('data/ftp/') ? 'dedicated' : cur.startsWith('repo/') ? 'project' : 'custom';
  const projSel = h('select.input', folders.map((f) => h('option', { value: f }, `repo/${f}`)));
  if (kind === 'project') projSel.value = cur.replace(/^repo\//, '');
  const isWin = /windows/i.test(navigator.userAgent);
  const custom = h('input.input.mono', { value: kind === 'custom' ? cur : '', placeholder: isWin ? 'C:\\Users\\vous\\Documents\\mon-dossier' : '/Users/vous/Documents/mon-dossier' });
  const dedicatedPath = h('code');
  const syncDedicated = () => { dedicatedPath.textContent = `data/ftp/${user.value.trim() || '…'}`; };
  user.addEventListener('input', syncDedicated);
  syncDedicated();

  const option = (value, title, desc, control) => {
    const radio = h('input', { type: 'radio', name: 'ftp-kind', value, checked: kind === value, onchange: () => { kind = value; paint(); } });
    const box = h('div.radio-extra', control);
    const el = h('label.radio-card.radio-card-block', radio, h('span', h('strong', title), h('span.muted', desc), box));
    return { el, box, value };
  };
  const opts = [
    option('dedicated', 'Un dossier dédié', h('span', 'Créé automatiquement : ', dedicatedPath), null),
    option('project', 'Le dossier d\'un projet', 'Pour déposer des fichiers directement dans un site de repo/.', folders.length ? projSel : h('span.muted', 'Aucun dossier dans repo/.')),
    option('custom', 'N\'importe quel dossier de votre ordinateur', h('span', 'Collez son chemin complet', isWin ? ' (dans l\'Explorateur : clic droit › Copier en tant que chemin d\'accès).' : '.'), custom),
  ];
  function paint() { for (const o of opts) o.box.hidden = o.value !== kind; }
  paint();

  return new Promise((resolve) => {
    modal({
      title: isNew ? 'Nouveau compte FTP' : `Modifier « ${existing.user} »`,
      subtitle: 'Le compte ne voit que son dossier.',
      icon: 'ftp',
      body: h('div.form-stack',
        h('div.grid-2',
          field('Identifiant', user, isNew ? 'Lettres minuscules, chiffres, _ et -.' : null),
          field('Mot de passe', h('div.input-affix', pass, regen))),
        h('div.field', h('span.field-label', 'Dossier partagé'), h('div.radio-cards.radio-cards-col', opts.map((o) => o.el))),
        field('Libellé (facultatif)', label)),
      actions: [{ label: 'Annuler' }, {
        label: isNew ? 'Créer le compte' : 'Enregistrer',
        variant: 'primary',
        onClick: async () => {
          const path = kind === 'dedicated' ? `data/ftp/${user.value.trim()}` : kind === 'project' ? `repo/${projSel.value}` : custom.value.trim();
          if (kind === 'custom' && !path) throw new Error('Indiquez le chemin du dossier.');
          const body = { password: pass.value, path, label: label.value.trim() };
          const a = isNew
            ? await post('/api/ftp', { user: user.value.trim(), ...body })
            : await put(`/api/ftp/${encodeURIComponent(existing.user)}`, body);
          await refresh();
          resolve(a);
        },
      }],
      onClose: () => resolve(null),
    });
  });
}

export function mount(root) {
  const serverBox = h('div');
  const list = h('div.ftp-list');
  const page = h('div.page',
    pageHeader('FTP', 'Partagez n\'importe quel dossier de votre machine en FTP local, autant de comptes que nécessaire.', [
      h('button.btn.btn-primary', { type: 'button', onclick: () => create() }, icon('plus', 16), 'Nouveau compte'),
    ]),
    serverBox, list);
  root.append(page);
  let info = null;
  let sig = '';

  async function load() {
    try {
      info = await get('/api/ftp');
      paint();
    } catch (e) { errorToast(e); }
  }

  async function create() {
    if (!info) return;
    const a = await accountForm(info);
    if (a) { await load(); showConnection(info, a, `Compte « ${a.user} » prêt`); }
  }

  function paint() {
    replace(serverBox, h('section.card.ftp-server',
      h('div.db-head',
        h('span.db-icon', icon('server', 20)),
        h('div.db-title', h('h3', 'Serveur FTP'), h('span.muted', `Mode passif · ports ${info.pasv}`)),
        statusPill(info.accounts.length ? info.status : 'stopped', info.accounts.length ? null : 'Aucun compte'),
        info.accounts.length ? h('button.btn.btn-sm', {
          type: 'button',
          onclick: async (e) => { const b = e.currentTarget; b.classList.add('busy'); try { await post('/api/services/ftp/restart'); toast('Serveur FTP redémarré', { type: 'success' }); await load(); } catch (err) { errorToast(err); } b.classList.remove('busy'); },
        }, icon('restart', 14), 'Redémarrer') : null),
      h('div.conn-grid',
        h('div.conn', h('span.conn-label', 'Hôte'), codeValue(info.host)),
        h('div.conn', h('span.conn-label', 'Port'), codeValue(String(info.port))),
        h('div.conn', h('span.conn-label', 'Depuis un projet'), codeValue('ftp:21')),
        h('div.conn', h('span.conn-label', 'Chiffrement'), h('span', 'Aucun (FTP simple, local)')))));

    if (!info.accounts.length) {
      replace(list, h('div.empty',
        h('div.empty-art', icon('ftp', 30)),
        h('h3', 'Aucun compte FTP'),
        h('p.muted', 'Créez un compte, choisissez le dossier à partager : vous recevez aussitôt les identifiants pour FileZilla ou votre application.'),
        h('button.btn.btn-primary', { type: 'button', onclick: () => create() }, icon('plus', 16), 'Créer un compte')));
      return;
    }
    replace(list, info.accounts.map((a) => h('section.card.ftp-account',
      h('div.ftp-main',
        h('span.ftp-avatar', icon('user', 18)),
        h('div.ftp-id', h('strong', a.user), a.label ? h('span.muted', a.label) : null),
        h('div.ftp-path', icon('folder', 14), h('code', { title: a.hostPath }, a.path), copyBtn(a.hostPath, { title: 'Copier le chemin complet' })),
        h('div.ftp-pass', codeValue(a.password, { secret: true }))),
      h('div.ftp-actions',
        h('button.btn.btn-sm', { type: 'button', onclick: () => showConnection(info, a) }, icon('key', 14), 'Connexion'),
        h('a.btn.btn-sm.btn-ghost', { href: `/api/ftp/${encodeURIComponent(a.user)}/filezilla.xml`, download: `filezilla-${a.user}.xml` }, icon('download', 14), 'FileZilla'),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: async () => { if (await accountForm(info, a)) { await load(); toast('Compte mis à jour', { type: 'success' }); } } }, 'Modifier'),
        h('button.btn.btn-sm.btn-ghost.btn-icon', {
          type: 'button',
          title: 'Supprimer le compte',
          onclick: async () => {
            const ok = await confirmDialog({ title: `Supprimer le compte « ${a.user} » ?`, message: 'Le compte disparaît ; le dossier et ses fichiers ne sont pas touchés.', confirmLabel: 'Supprimer', danger: true });
            if (!ok) return;
            try { await del(`/api/ftp/${encodeURIComponent(a.user)}`); toast('Compte supprimé', { type: 'success' }); await load(); await refresh(); } catch (e) { errorToast(e); }
          },
        }, icon('trash', 14))))));
  }

  load();
  return {
    update(ov) {
      const s = JSON.stringify([ov.ftp.status, ov.ftp.accounts]);
      if (s !== sig) { sig = s; load(); }
    },
  };
}
