// Visionneuse de logs en direct : niveaux, recherche, ordre, pause, téléchargement.
import { h, icon, replace } from '../lib.js';

const MAX = 10000;
const ACCESS = /^(\S+) \S+ (\S+) \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) (\S+)(?: (\d+))? "([^"]*)" "([^"]*)"/;
const APACHE_ERR = /^\[[^\]]+\] \[(?:([\w-]+):)?(\w+)\] \[pid [^\]]+\](?: \[client [^\]]+\])? ?(.*)$/;

const LEVELS = [
  { id: 'all', label: 'Tout' },
  { id: 'error', label: 'Erreurs' },
  { id: 'warning', label: 'Alertes' },
  { id: 'access', label: 'Accès' },
  { id: 'info', label: 'Infos' },
];

/** Classe une ligne : erreur, alerte, accès HTTP ou info. */
function parse(raw) {
  const line = raw.l;
  const a = line.match(ACCESS);
  if (a) {
    const code = Number(a[6]);
    return {
      ...raw,
      level: code >= 500 ? 'error' : code >= 400 ? 'warning' : 'access',
      access: { ip: a[1], method: a[4], path: a[5], status: code, size: a[7], dur: a[8] ? Number(a[8]) : null },
    };
  }
  // Journal d'erreurs Apache : « [date] [module:niveau] [pid …] [client …] message »
  const ap = line.match(APACHE_ERR);
  if (ap) {
    const [, mod, lv, msg] = ap;
    let level = /emerg|alert|crit|error/.test(lv) ? 'error' : /warn/.test(lv) ? 'warning' : 'info';
    if (/^PHP (Fatal|Parse|Recoverable fatal) error/i.test(msg)) level = 'error';
    else if (/^PHP (Warning|Deprecated|Notice)/i.test(msg)) level = 'warning';
    return { ...raw, level, l: msg.replace(/, referer: \S+$/, ''), tag: mod || null, raw: line };
  }
  let level = 'info';
  if (line.startsWith('{')) {
    try {
      const j = JSON.parse(line);
      const lv = String(j.level || '').toLowerCase();
      level = /err|fatal|panic/.test(lv) ? 'error' : /warn/.test(lv) ? 'warning' : 'info';
      return { ...raw, level, l: j.msg ? `${j.msg}${j.error ? ` — ${j.error}` : ''}${j.logger ? ` (${j.logger})` : ''}` : line };
    } catch { /* pas du JSON */ }
  }
  if (/PHP (Fatal|Parse) error|\b(fatal|emerg|alert|crit|critical)\b|\[(\w+:)?error\]|\[ERROR\]|\bERROR\b|Uncaught|Exception/i.test(line)) level = 'error';
  else if (/PHP (Warning|Notice|Deprecated)|\[(\w+:)?warn(ing)?\]|\[Warning\]|\bWARN(ING)?\b|deprecated/i.test(line)) level = 'warning';
  return { ...raw, level };
}

function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour12: false });
}

function statusCls(code) {
  if (code >= 500) return 'err';
  if (code >= 400) return 'warn';
  if (code >= 300) return 'redir';
  return 'ok';
}

/**
 * LogViewer(container, { tail, compact })
 * Renvoie { el, destroy }.
 */
export function logViewer(container, { tail = 1000, compact = false } = {}) {
  let entries = [];
  let level = 'all';
  let query = '';
  let follow = true;
  let newestFirst = false;
  let paused = false;
  let wrap = false;
  let buffer = [];
  let es = null;

  const counts = {};
  const levelBtns = {};
  const levelBar = h('div.seg.seg-sm', LEVELS.map((l) => {
    const count = h('span.seg-count');
    const b = h('button', { type: 'button', onclick: () => { level = l.id; paint(); } }, l.label, count);
    levelBtns[l.id] = { b, count };
    return b;
  }));
  const search = h('input.input.input-sm', { type: 'search', placeholder: 'Rechercher…', oninput: () => { query = search.value.toLowerCase(); paint(); } });
  const total = h('span.muted.logs-total');
  const followBtn = h('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Suivre les nouvelles lignes', onclick: () => { follow = !follow; syncBtns(); if (follow) scrollEdge(); } });
  const orderBtn = h('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Ordre d\'affichage', onclick: () => { newestFirst = !newestFirst; syncBtns(); paint(); } });
  const pauseBtn = h('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Mettre le flux en pause', onclick: () => { paused = !paused; if (!paused) { add(buffer); buffer = []; } syncBtns(); } });
  const wrapBtn = h('button.btn.btn-sm.btn-ghost.btn-icon', { type: 'button', title: 'Retour à la ligne', onclick: () => { wrap = !wrap; list.classList.toggle('wrap', wrap); syncBtns(); } }, icon('wrap', 14));
  const clearBtn = h('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Vider l\'affichage', onclick: () => { entries = []; paint(); } }, icon('trash', 14), 'Vider');
  const dlBtn = h('button.btn.btn-sm.btn-ghost.btn-icon', { type: 'button', title: 'Télécharger', onclick: download }, icon('download', 14));
  const list = h('div.logs-list', { role: 'log' });
  const empty = h('div.logs-empty');
  const live = h('span.live', h('span.live-dot'), 'En direct');

  const el = h(`div.logs${compact ? '.logs-compact' : ''}`,
    h('div.logs-toolbar',
      h('div.logs-toolbar-left', levelBar, h('div.input-icon', icon('search', 14), search)),
      h('div.logs-toolbar-right', live, total, pauseBtn, followBtn, orderBtn, wrapBtn, dlBtn, clearBtn)),
    h('div.logs-body', list, empty));

  function syncBtns() {
    replace(followBtn, icon(newestFirst ? 'arrow-up' : 'arrow-down', 14), follow ? 'Suivi actif' : 'Suivre');
    followBtn.classList.toggle('active', follow);
    replace(orderBtn, newestFirst ? 'Récents en haut' : 'Récents en bas');
    replace(pauseBtn, icon(paused ? 'play' : 'pause', 14), paused ? `Reprendre${buffer.length ? ` (${buffer.length})` : ''}` : 'Pause');
    pauseBtn.classList.toggle('active', paused);
    wrapBtn.classList.toggle('active', wrap);
    live.classList.toggle('paused', paused);
  }

  const visible = (e) => (level === 'all' || e.level === level || (level === 'info' && e.level === 'info'))
    && (!query || e.l.toLowerCase().includes(query));

  function row(e) {
    let msg;
    if (e.access) {
      const a = e.access;
      msg = h('span.log-msg.log-access',
        h(`span.method.m-${a.method.toLowerCase()}`, a.method),
        h('span.path', a.path),
        h(`span.code.code-${statusCls(a.status)}`, a.status),
        a.dur !== null ? h('span.dur', `${(a.dur / 1000).toFixed(a.dur < 10000 ? 1 : 0)} ms`) : null);
    } else {
      msg = h('span.log-msg', e.tag ? h('span.log-tag', e.tag) : null, e.l);
    }
    const r = h(`div.log-row.lv-${e.level}${e.s === 'err' ? '.stderr' : ''}`, {
      title: e.access || e.raw ? (e.raw || e.l) : null,
      onclick: () => r.classList.toggle('expanded'),
    }, h('span.log-time', fmtTime(e.t)), h(`span.log-level.lvl-${e.level}`), msg);
    return r;
  }

  function updateCounts() {
    for (const l of LEVELS) counts[l.id] = 0;
    for (const e of entries) counts[e.level] = (counts[e.level] || 0) + 1;
    counts.all = entries.length;
    for (const l of LEVELS) levelBtns[l.id].count.textContent = counts[l.id] ? counts[l.id].toLocaleString('fr-FR') : '';
    for (const l of LEVELS) levelBtns[l.id].b.classList.toggle('active', l.id === level);
    total.textContent = `${entries.length.toLocaleString('fr-FR')} lignes`;
  }

  function paint() {
    updateCounts();
    const items = entries.filter(visible);
    const frag = document.createDocumentFragment();
    const ordered = newestFirst ? items.slice().reverse() : items;
    for (const e of ordered.slice(newestFirst ? 0 : -3000, newestFirst ? 3000 : undefined)) frag.append(row(e));
    replace(list, frag);
    empty.textContent = entries.length ? (items.length ? '' : 'Aucune ligne ne correspond au filtre.') : 'En attente de logs…';
    empty.hidden = !!items.length;
    if (follow) scrollEdge();
  }

  function scrollEdge() {
    const body = list.parentElement;
    requestAnimationFrame(() => { body.scrollTop = newestFirst ? 0 : body.scrollHeight; });
  }

  function add(lines) {
    if (!lines.length) return;
    const parsed = lines.map(parse);
    entries.push(...parsed);
    let trimmed = false;
    if (entries.length > MAX) { entries.splice(0, entries.length - MAX); trimmed = true; }
    if (trimmed || newestFirst) { paint(); return; }
    updateCounts();
    const frag = document.createDocumentFragment();
    for (const e of parsed) if (visible(e)) frag.append(row(e));
    if (frag.childNodes.length) {
      list.append(frag);
      empty.hidden = true;
      while (list.childNodes.length > 3000) list.firstChild.remove();
      if (follow) scrollEdge();
    }
  }

  function download() {
    const blob = new Blob([entries.map((e) => `${e.t || ''} ${e.s === 'err' ? '[stderr] ' : ''}${e.l}`).join('\n')], { type: 'text/plain' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${container}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log` });
    document.body.append(a);
    a.click();
    a.remove();
  }

  function connect() {
    es?.close();
    es = new EventSource(`/api/logs/${encodeURIComponent(container)}?tail=${tail}`);
    es.addEventListener('lines', (e) => {
      const lines = JSON.parse(e.data);
      if (paused) { buffer.push(...lines); syncBtns(); } else add(lines);
    });
    es.addEventListener('end', (e) => {
      const { error } = JSON.parse(e.data);
      es.close();
      live.classList.add('off');
      live.lastChild.textContent = error ? 'Indisponible' : 'Container arrêté';
      // Le container peut redémarrer : on se reconnecte un peu plus tard.
      setTimeout(() => {
        if (!el.isConnected) return;
        live.classList.remove('off');
        live.lastChild.textContent = 'En direct';
        entries = [];
        paint();
        connect();
      }, 4000);
    });
  }

  list.parentElement.addEventListener('scroll', () => {
    const body = list.parentElement;
    const atEdge = newestFirst ? body.scrollTop < 30 : body.scrollHeight - body.scrollTop - body.clientHeight < 30;
    if (follow !== atEdge) { follow = atEdge; syncBtns(); }
  });

  syncBtns();
  paint();
  connect();
  return { el, destroy: () => es?.close() };
}
