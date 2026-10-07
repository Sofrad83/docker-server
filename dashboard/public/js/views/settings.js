// Page « Réglages » : HTTPS, valeurs par défaut, services, maintenance.
import {
  h, icon, post, put, store, refresh, replace, toast, errorToast, modal, field, statusPill, codeValue, snippetTabs,
  hostState, HOSTS_TOOL,
} from '../lib.js';
import { pageHeader } from './projects.js';
import { logViewer } from '../components/logs.js';

function showLogs(container, label) {
  const v = logViewer(container, { tail: 500, compact: true });
  modal({ title: `Logs — ${label}`, icon: 'logs', size: 'xl', body: h('div.modal-logs', v.el), actions: [{ label: 'Fermer' }], onClose: v.destroy });
}

export function mount(root) {
  const httpsBox = h('div');
  const hostsBox = h('div');
  const defaultsBox = h('div');
  const servicesBox = h('div');
  const infoBox = h('div');
  root.append(h('div.page',
    pageHeader('Réglages', 'Tout fonctionne sans y toucher. Ici, les détails pour aller plus loin.', []),
    h('div.settings-stack', httpsBox, hostsBox, servicesBox, defaultsBox, infoBox)));

  let painted = false;
  let sig = '';

  function paintHttps(ov) {
    const ps = 'Import-Certificate -FilePath "$env:USERPROFILE\\Downloads\\docker-server-ca.crt" -CertStoreLocation Cert:\\CurrentUser\\Root';
    replace(httpsBox, h('section.card',
      h('div.card-head', h('h3.card-title', icon('shield', 17), 'HTTPS sans avertissement'),
        ov.ca.available ? h('span.tag.tag-ok', icon('check', 12), 'Certificat local prêt') : h('span.tag.tag-warn', 'Certificat pas encore généré')),
      h('p', 'Tous les sites ont déjà une adresse https://. Pour que le navigateur leur fasse confiance, installez une fois le certificat de l\'autorité locale de docker-server. ',
        h('strong', 'Le script start le fait pour vous sous Windows et macOS.')),
      h('div.card-actions',
        h('a.btn.btn-primary', { href: '/api/ca.crt', download: 'docker-server-ca.crt', 'aria-disabled': String(!ov.ca.available) }, icon('download', 15), 'Télécharger le certificat')),
      snippetTabs([
        { label: 'Windows', lang: 'PowerShell (sans droits admin)', text: ps },
        { label: 'macOS', lang: 'Terminal', text: 'sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/Downloads/docker-server-ca.crt' },
        { label: 'Linux', lang: 'Terminal', text: 'sudo cp ~/Downloads/docker-server-ca.crt /usr/local/share/ca-certificates/docker-server.crt && sudo update-ca-certificates\n# Firefox / Chrome sous Linux : importez aussi le fichier dans les paramètres du navigateur (Certificats › Autorités).' },
      ]),
      h('p.card-hint', 'Redémarrez le navigateur après l\'installation. Le certificat n\'est valable que pour les sites de cette machine.')));
  }

  function paintDefaults(ov) {
    const cat = store.catalog;
    const php = h('select.input', cat.php.map((p) => h('option', { value: p.v }, `PHP ${p.v}${p.tag ? ` — ${p.tag}` : ''}`)));
    php.value = ov.settings.php;
    const tz = h('input.input', { value: ov.settings.timezone, placeholder: 'Europe/Paris' });
    replace(defaultsBox, h('section.card',
      h('h3.card-title', 'Valeurs par défaut'),
      h('div.grid-2',
        field('Version de PHP des nouveaux projets', php, 'Utilisée quand le projet n\'indique rien (composer.json).'),
        field('Fuseau horaire', tz, 'date.timezone de PHP, pour tous les projets.')),
      h('div.form-actions', h('button.btn.btn-primary', {
        type: 'button',
        onclick: async (e) => {
          const b = e.currentTarget;
          b.classList.add('busy');
          try { await put('/api/settings', { php: php.value, timezone: tz.value.trim() }); toast('Réglages enregistrés', { type: 'success' }); await refresh(); } catch (err) { errorToast(err); }
          b.classList.remove('busy');
        },
      }, icon('check', 15), 'Enregistrer'))));
  }

  function paintServices(ov) {
    const rows = [
      ...ov.services,
      ...ov.mysql.map((i) => ({ id: `mysql:${i.id}`, container: i.container, label: i.label, status: i.status, href: '#/databases' })),
      ov.ftp.accounts ? { id: 'ftp', container: 'ds-ftp', label: 'Serveur FTP', status: ov.ftp.status, href: '#/ftp' } : null,
    ].filter(Boolean);
    replace(servicesBox, h('section.card',
      h('div.card-head', h('h3.card-title', 'Services'), h('span.muted', 'Les containers qui font tourner docker-server.')),
      h('table.table',
        h('thead', h('tr', h('th', 'Service'), h('th', 'Container'), h('th', 'État'), h('th'))),
        h('tbody', rows.map((s) => h('tr',
          h('td', s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.label, ' ', icon('external', 12)) : s.href ? h('a', { href: s.href }, s.label) : s.label),
          h('td', h('code', s.container)),
          h('td', statusPill(s.status)),
          h('td.row-actions',
            h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => showLogs(s.container, s.label) }, icon('logs', 14), 'Logs'),
            ['proxy', 'dbadmin', 'mailpit', 'ftp'].includes(s.id) ? h('button.btn.btn-ghost.btn-sm', {
              type: 'button',
              onclick: async (e) => {
                const b = e.currentTarget;
                b.classList.add('busy');
                try { await post(`/api/services/${s.id}/restart`); toast(`${s.label} redémarré`, { type: 'success' }); await refresh(); } catch (err) { errorToast(err); }
                b.classList.remove('busy');
              },
            }, icon('restart', 14), 'Redémarrer') : null)))))));
  }

  function paintHosts(ov) {
    const st = ov.hosts;
    const port = ov.config.httpPort === 80 ? '' : `:${ov.config.httpPort}`;
    const label = { ok: ['tag.tag-ok', 'active'], missing: ['tag.tag-warn', 'en attente'], unknown: ['tag', 'non vérifiée'] };
    replace(hostsBox, h('section.card',
      h('div.card-head', h('h3.card-title', icon('globe', 17), 'Adresses personnalisées'),
        st.agent ? h('span.tag.tag-ok', icon('check', 12), 'Fichier hosts géré automatiquement') : h('span.tag', 'Agent non lancé')),
      h('p', 'Les adresses en ', h('code', '.localhost'), ' fonctionnent toutes seules. Les autres (',
        h('code', 'mon-site.test'), ', ', h('code', 'local-mon-site'), '…) sont ajoutées au fichier hosts de la machine. ',
        st.agent ? 'C’est automatique : Windows demande simplement une confirmation.'
          : h('span', 'Lancez ', h('code', HOSTS_TOOL), ' dans le dossier docker-server après en avoir ajouté une, ou démarrez avec start.cmd pour que ce soit automatique.')),
      h('table.table',
        h('thead', h('tr', h('th', 'Adresse'), h('th', 'Utilisée par'), h('th', 'État'))),
        h('tbody', st.entries.map((name) => {
          const users = name === 'ds-dashboard' ? [h('span', 'Tableau de bord')]
            : ov.projects.filter((p) => p.domains.includes(name)).map((p) => h('a.tag', { href: `#/projects/${p.slug}` }, p.name));
          const [cls, text] = label[hostState(name, ov)] || label.unknown;
          return h('tr',
            h('td', h('a', { href: `http://${name}${port}`, target: '_blank', rel: 'noopener' }, h('code', name))),
            h('td', users),
            h('td', h(`span.${cls}`, text)));
        }))),
      st.agent && st.missing?.length ? h('div.card-actions', h('button.btn.btn-sm', {
        type: 'button',
        onclick: async () => { try { await post('/api/hosts/retry'); toast('Nouvelle demande envoyée à Windows'); } catch (e) { errorToast(e); } },
      }, icon('refresh', 14), 'Redemander l’autorisation à Windows')) : null));
  }

  function paintInfo(ov) {
    const c = ov.config;
    replace(infoBox, h('section.card',
      h('h3.card-title', 'Ports et emplacements'),
      h('dl.kv',
        h('dt', 'Tableau de bord'), h('dd', codeValue(c.dashboardUrl)),
        h('dt', 'Adresse courte'), h('dd', codeValue(`http://ds-dashboard${c.httpPort === 80 ? '' : `:${c.httpPort}`}`)),
        h('dt', 'HTTP / HTTPS'), h('dd', `${c.httpPort} / ${c.httpsPort}`),
        h('dt', 'FTP'), h('dd', `${c.ftpPort} (passif ${c.ftpPasv})`),
        h('dt', 'Dossier des projets'), h('dd', codeValue(c.repoPath)),
        h('dt', 'Sauvegardes SQL'), h('dd', codeValue(`${c.hostRoot}/data/backups`)),
        h('dt', 'Docker'), h('dd', c.platform || '—'),
        h('dt', 'Version'), h('dd', `${ov.app.name} ${ov.app.version}`)),
      h('p.card-hint', 'Les ports se changent dans le fichier .env à la racine de docker-server (voir .env.example), puis relancez start.'),
      h('div.card-actions',
        h('button.btn.btn-sm', {
          type: 'button',
          onclick: async (e) => {
            const b = e.currentTarget;
            b.classList.add('busy');
            try {
              const { removed } = await post('/api/maintenance/prune');
              toast(removed.length ? `${removed.length} image(s) inutilisée(s) supprimée(s)` : 'Rien à nettoyer', { type: 'success' });
            } catch (err) { errorToast(err); }
            b.classList.remove('busy');
          },
        }, icon('trash', 14), 'Nettoyer les images PHP inutilisées'))));
  }

  return {
    update(ov) {
      const s = JSON.stringify([ov.ca, ov.services, ov.mysql.map((i) => [i.id, i.status]), ov.ftp, ov.hosts, ov.projects.map((p) => p.domains)]);
      if (!painted) { paintDefaults(ov); paintInfo(ov); painted = true; }
      if (s !== sig) { sig = s; paintHttps(ov); paintHosts(ov); paintServices(ov); }
    },
  };
}
