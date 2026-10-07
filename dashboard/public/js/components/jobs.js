// Tâches longues : panneau d'activité (bas d'écran), fenêtre de journal, suivi en direct.
import { h, icon, modal, replace, toast, refresh } from '../lib.js';

/** Suit une tâche en direct (SSE). Renvoie une fonction d'arrêt. */
export function followJob(id, { onInit, onLog, onSteps, onEnd }) {
  const es = new EventSource(`/api/jobs/${id}/stream`);
  es.addEventListener('init', (e) => onInit?.(JSON.parse(e.data)));
  es.addEventListener('log', (e) => onLog?.(JSON.parse(e.data)));
  es.addEventListener('steps', (e) => onSteps?.(JSON.parse(e.data)));
  es.addEventListener('end', (e) => { es.close(); onEnd?.(JSON.parse(e.data)); });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) onEnd?.(null); };
  return () => es.close();
}

function stepIcon(status) {
  if (status === 'running') return icon('loader', 15, 'spin');
  if (status === 'failed') return icon('circle-x', 15);
  return icon('circle-check', 15);
}

export function renderSteps(steps) {
  return h('ol.steps', steps.map((s) => h(`li.step.step-${s.status}`, stepIcon(s.status), h('span', s.label))));
}

/** Console sombre qui défile toute seule tant qu'on est en bas. */
export function consoleView({ height } = {}) {
  const pre = h('pre.console', { style: height ? { height } : {} });
  return {
    el: pre,
    set(lines) { pre.textContent = lines.length ? `${lines.join('\n')}\n` : ''; pre.scrollTop = pre.scrollHeight; },
    push(line) {
      const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
      pre.append(`${line}\n`);
      if (atBottom) pre.scrollTop = pre.scrollHeight;
    },
  };
}

/** Fenêtre de journal d'une tâche. */
export function openJob(id, title) {
  const stepsBox = h('div');
  const cons = consoleView({ height: '360px' });
  const status = h('span');
  const m = modal({
    title: title || 'Tâche',
    icon: 'logs',
    size: 'lg',
    body: h('div.job-modal', h('div.job-head', status, stepsBox), cons.el),
    actions: [{ label: 'Fermer' }],
    onClose: () => stop(),
  });
  const setStatus = (job) => {
    if (!job) return;
    m.el.querySelector('h2').textContent = job.title;
    const map = { running: ['busy', 'En cours'], queued: ['busy', 'En attente'], done: ['ok', 'Terminé'], failed: ['err', 'Échec'] };
    const [cls, label] = map[job.status] || map.running;
    replace(status, h(`span.status.status-${cls}`, h('span.status-dot'), label), job.error ? h('div.job-error', job.error) : null);
  };
  const stop = followJob(id, {
    onInit: ({ job, lines }) => { setStatus(job); replace(stepsBox, renderSteps(job.steps)); cons.set(lines); },
    onLog: (line) => cons.push(line),
    onSteps: (steps) => replace(stepsBox, renderSteps(steps)),
    onEnd: (job) => { if (job) { setStatus(job); replace(stepsBox, renderSteps(job.steps)); } },
  });
  return m;
}

/**
 * Panneau « Activité » en bas à droite : tâches en cours, et notification à la fin
 * de chacune (avec accès au journal).
 */
export function createTray() {
  const el = h('div.tray', { 'aria-live': 'polite' });
  document.body.append(el);
  const known = new Map();
  let first = true;

  return {
    update(list) {
      const active = list.filter((j) => j.status === 'running' || j.status === 'queued');
      // Notifications de fin (pas pour l'historique chargé au démarrage).
      for (const j of list) {
        const prev = known.get(j.id);
        if (!first && prev && (prev === 'running' || prev === 'queued') && (j.status === 'done' || j.status === 'failed')) {
          if (j.status === 'done') {
            toast(`${j.title} — terminé`, { type: 'success', action: { label: 'Journal', onClick: () => openJob(j.id, j.title) } });
          } else {
            toast(h('div', h('strong', j.title), h('div', j.error || 'Échec')), { type: 'error', duration: 15000, action: { label: 'Journal', onClick: () => openJob(j.id, j.title) } });
          }
          refresh();
        }
        known.set(j.id, j.status);
      }
      first = false;
      replace(el, active.slice(0, 4).map((j) => h('button.tray-item', { onclick: () => openJob(j.id, j.title) },
        icon('loader', 16, 'spin'),
        h('span.tray-text', h('strong', j.title), h('span', j.step || (j.status === 'queued' ? 'En attente…' : 'Démarrage…'))),
        icon('chevron-right', 14))));
      el.classList.toggle('show', active.length > 0);
    },
  };
}

/** Progression d'une tâche affichée dans une page (bandeau). */
export function inlineJob(id, { onEnd } = {}) {
  const stepsBox = h('div.inline-steps');
  const last = h('div.inline-last');
  const el = h('div.banner.banner-busy',
    icon('loader', 18, 'spin'),
    h('div.banner-body', stepsBox, last),
    h('button.btn.btn-sm.btn-ghost', { onclick: () => openJob(id) }, icon('logs', 14), 'Journal'));
  const stop = followJob(id, {
    onInit: ({ job, lines }) => { replace(stepsBox, renderSteps(job.steps)); last.textContent = lines[lines.length - 1] || ''; },
    onLog: (line) => { last.textContent = line; },
    onSteps: (steps) => replace(stepsBox, renderSteps(steps)),
    onEnd: (job) => onEnd?.(job),
  });
  return { el, stop };
}
