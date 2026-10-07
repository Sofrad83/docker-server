// Onglet « schéma » : diagramme des tables et de leurs relations (clés étrangères déclarées, et
// relations DÉDUITES des noms de colonnes — utile pour les bases qui n'ont pas de FOREIGN KEY).
import { h, btn, icon, clear, fmtNum, debounce } from './lib.js';
import { api } from './api.js';
import { registerView, openTab } from './tabs.js';

const BOX_W = 230, HEAD_H = 30, ROW_H = 20, MAX_ROWS = 14, GAP_X = 90, GAP_Y = 36, LIMIT = 80;

registerView('schema', (ctx) => {
  const { server, db } = ctx.params;
  ctx.setTitle('Schéma · ' + db, 'schema');
  let tables = [], fks = [], loaded = false, filter = '', guess = true, views = false, selected = null;
  const pos = new Map();        // table → {x, y} (conservé entre deux rebuilds)

  const note = h('span', { class: 'hint' });
  const filterInput = h('input', { type: 'search', placeholder: 'Filtrer les tables…', style: { width: '220px' } });
  filterInput.addEventListener('input', debounce(() => { filter = filterInput.value.trim().toLowerCase(); build(true); }, 200));
  const guessChk = h('input', { type: 'checkbox', checked: true }); guessChk.addEventListener('change', () => { guess = guessChk.checked; build(); });
  const viewsChk = h('input', { type: 'checkbox' }); viewsChk.addEventListener('change', () => { views = viewsChk.checked; build(true); });
  const toolbar = h('div', { class: 'toolbar' }, filterInput,
    h('label', { class: 'chk', title: 'Relie id_xxx / xxx_id à la table xxx quand aucune clé étrangère n\'est déclarée' }, guessChk, 'Relations déduites des noms (pointillés)'),
    h('label', { class: 'chk' }, viewsChk, 'Vues'), btn('Réorganiser', 'sm', () => build(true), 'schema'), h('span', { class: 'spacer' }), note);
  const canvas = h('div', { class: 'schema' });
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
    h('div', { class: 'view-head' }, h('h2', null, icon('schema'), 'Schéma de ' + db)), toolbar, canvas);

  function relations() {
    const out = fks.filter((f) => f.refDb === db).map((f) => ({ from: { t: f.table, c: f.column }, to: { t: f.refTable, c: f.refColumn }, guess: false }));
    if (guess) {
      const declared = new Set(out.map((r) => r.from.t + '.' + r.from.c));
      const bases = new Map();                       // « user » → tables nommées user, users, xxx_user, xxx_users
      const index = (key, t) => { if (!bases.has(key)) bases.set(key, []); bases.get(key).push(t); };
      for (const t of tables) {
        if (t.view || !t.columns.some((c) => c.key === 'PRI')) continue;
        const parts = t.name.toLowerCase().split('_');
        for (let i = 0; i < parts.length; i++) index(parts.slice(i).join('_'), t);   // le nom entier, puis chaque suffixe : cwce_users → users
      }
      const find = (source, base) => {
        const hits = [...new Set([base, base + 's', base + 'es'].flatMap((k) => bases.get(k) || []))].filter((t) => t.name !== source.name);
        if (hits.length <= 1) return hits[0];
        const prefix = source.name.toLowerCase().split('_')[0] + '_';           // plusieurs candidats : on préfère le même préfixe de table
        const same = hits.filter((t) => t.name.toLowerCase().startsWith(prefix));
        return same.length ? same.sort((a, b) => a.name.length - b.name.length)[0] : undefined;
      };
      for (const t of tables) for (const c of t.columns) {
        if (declared.has(t.name + '.' + c.name)) continue;
        const m = c.name.match(/^id[_]?(.+)$/i) || c.name.match(/^(.+?)[_]?id$/i);
        const base = m ? m[1].toLowerCase() : '';
        const target = base ? find(t, base) : undefined;
        const pk = target?.columns.find((x) => x.key === 'PRI');
        if (target && pk) out.push({ from: { t: t.name, c: c.name }, to: { t: target.name, c: pk.name }, guess: true });
      }
    }
    return out;
  }

  function build(relayout = false) {
    if (!loaded) return;
    const rels = relations();
    const degree = new Map();
    rels.forEach((r) => { degree.set(r.from.t, (degree.get(r.from.t) || 0) + 1); degree.set(r.to.t, (degree.get(r.to.t) || 0) + 1); });
    let shown = tables.filter((t) => views || !t.view);
    let msg = '';
    if (filter) {
      const hit = new Set(shown.filter((t) => t.name.toLowerCase().includes(filter)).map((t) => t.name));
      rels.forEach((r) => { if (hit.has(r.from.t)) hit.add(r.to.t); if (hit.has(r.to.t)) hit.add(r.from.t); });
      shown = shown.filter((t) => hit.has(t.name));
    } else if (shown.length > LIMIT) {
      shown = shown.filter((t) => degree.has(t.name));
      msg = `${fmtNum(tables.length)} tables : seules celles qui ont des relations sont affichées — utilisez le filtre pour en voir d'autres.`;
    }
    if (shown.length > LIMIT) { shown = shown.sort((a, b) => (degree.get(b.name) || 0) - (degree.get(a.name) || 0)).slice(0, LIMIT); msg = `Affichage limité aux ${LIMIT} tables les plus reliées — affinez le filtre.`; }
    note.textContent = msg || `${fmtNum(shown.length)} table(s) · ${fmtNum(rels.filter((r) => !r.guess).length)} relation(s) déclarée(s) · ${fmtNum(rels.filter((r) => r.guess).length)} déduite(s)`;

    const visible = new Set(shown.map((t) => t.name));
    const shownRows = (t) => {                       // clés d'abord, puis le reste, plafonné
      const fkCols = new Set(rels.filter((r) => r.from.t === t.name).map((r) => r.from.c));
      const cols = [...t.columns].sort((a, b) => (b.key === 'PRI') - (a.key === 'PRI') || fkCols.has(b.name) - fkCols.has(a.name));
      return { cols: cols.slice(0, MAX_ROWS), more: Math.max(0, cols.length - MAX_ROWS), fkCols };
    };

    if (relayout || !shown.every((t) => pos.has(t.name))) {            // disposition « maçonnerie » : on remplit la colonne la plus courte
      const n = Math.max(1, Math.min(7, Math.round(Math.sqrt(shown.length) * 1.2)));
      const ys = Array(n).fill(30);
      [...shown].sort((a, b) => (degree.get(b.name) || 0) - (degree.get(a.name) || 0) || a.name.localeCompare(b.name)).forEach((t) => {
        const c = ys.indexOf(Math.min(...ys));
        pos.set(t.name, { x: 30 + c * (BOX_W + GAP_X), y: ys[c] });
        ys[c] += HEAD_H + ROW_H * (Math.min(t.columns.length, MAX_ROWS) + (t.columns.length > MAX_ROWS ? 1 : 0)) + GAP_Y;
      });
    }

    clear(canvas);
    if (!shown.length) {
      canvas.append(h('div', { class: 'empty-state' }, h('div', null, icon('schema'),
        h('div', null, filter ? 'Aucune table ne correspond au filtre.' : 'Aucune relation déclarée ni déduite des noms de colonnes.'),
        h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Saisissez un nom de table dans le filtre pour l\'afficher avec ses voisines.'))));
      return;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'links');
    canvas.append(svg);
    const boxes = new Map();
    shown.forEach((t) => {
      const { cols, more, fkCols } = shownRows(t); const p = pos.get(t.name);
      const box = h('div', { class: 'box' + (t.view ? ' view' : ''), style: { left: p.x + 'px', top: p.y + 'px' }, 'data-t': t.name },
        h('div', { class: 'bh', title: 'Glisser pour déplacer · double-clic pour ouvrir',
          onmousedown: (e) => startDrag(e, t.name, box), ondblclick: () => openTab('table', { server, db, table: t.name }) }, icon(t.view ? 'view' : 'table', 13), t.name),
        cols.map((c) => h('div', { class: 'bc' + (c.key === 'PRI' ? ' pk' : fkCols.has(c.name) ? ' fk' : '') }, h('span', { class: 'n' }, (c.key === 'PRI' ? '🔑 ' : '') + c.name), h('span', { class: 't' }, c.type))),
        more ? h('div', { class: 'bc' }, h('span', { class: 't' }, `… +${more} colonne(s)`)) : null);
      box.addEventListener('click', () => { selected = selected === t.name ? null : t.name; paintLinks(); });
      canvas.append(box); boxes.set(t.name, { box, cols });
    });

    function paintLinks() {
      clear(svg);
      let maxX = 0, maxY = 0;
      boxes.forEach(({ box }) => { maxX = Math.max(maxX, box.offsetLeft + BOX_W); maxY = Math.max(maxY, box.offsetTop + box.offsetHeight); });
      svg.setAttribute('width', maxX + 60); svg.setAttribute('height', maxY + 60);
      boxes.forEach(({ box }, name) => box.classList.toggle('hi', name === selected));
      for (const r of rels) {
        if (!visible.has(r.from.t) || !visible.has(r.to.t)) continue;
        const a = boxes.get(r.from.t), b = boxes.get(r.to.t);
        const yOf = (o, col) => { const i = o.cols.findIndex((c) => c.name === col); return o.box.offsetTop + (i < 0 ? HEAD_H / 2 : HEAD_H + ROW_H * i + ROW_H / 2); };
        const ya = yOf(a, r.from.c), yb = yOf(b, r.to.c);
        const ax = a.box.offsetLeft, bx = b.box.offsetLeft;
        let x1, x2, d1;
        if (ax + BOX_W + 20 <= bx) { x1 = ax + BOX_W; x2 = bx; d1 = 1; }
        else if (bx + BOX_W + 20 <= ax) { x1 = ax; x2 = bx + BOX_W; d1 = -1; }
        else { x1 = ax + BOX_W; x2 = bx + BOX_W; d1 = 1; }
        const k = Math.max(40, Math.abs(x2 - x1) / 2.2);
        const x2c = ax + BOX_W + 20 <= bx || bx + BOX_W + 20 <= ax ? x2 - d1 * k : x2 + k;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${x1} ${ya} C ${x1 + d1 * k} ${ya}, ${x2c} ${yb}, ${x2} ${yb}`);
        const hi = selected && (r.from.t === selected || r.to.t === selected);
        path.setAttribute('class', 'lnk' + (r.guess ? ' guess' : '') + (hi ? ' hi' : ''));
        svg.append(path);
      }
    }
    function startDrag(e, name, box) {
      e.preventDefault();
      const p = pos.get(name); const sx = e.clientX, sy = e.clientY, ox = p.x, oy = p.y;
      const move = (ev) => { p.x = Math.max(0, ox + ev.clientX - sx); p.y = Math.max(0, oy + ev.clientY - sy); box.style.left = p.x + 'px'; box.style.top = p.y + 'px'; paintLinks(); };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    }
    paintLinks();
  }

  async function reload() {
    try {
      const r = await api('schema', { s: server, db });
      tables = r.tables; fks = r.fks; loaded = true; pos.clear(); build(true);
    } catch (e) { clear(canvas); canvas.append(h('div', { class: 'msg err' }, e.message)); }
  }
  return { el, reload, onShow() { if (!loaded) reload(); } };
});
