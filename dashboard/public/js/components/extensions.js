// Sélecteur d'extensions PHP : recherche, groupes, tuiles à cocher.
import { h, icon, replace, store } from '../lib.js';

function cmp(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  return (pa[0] - pb[0]) || (pa[1] - pb[1]);
}

export function availableFor(php) {
  return store.catalog.extensions.filter((e) => (!e.min || cmp(php, e.min) >= 0) && (!e.max || cmp(php, e.max) <= 0));
}

/**
 * extensionPicker({ selected: string[], php, onChange(list) }) → { el, setPhp(php), set(list) }
 */
export function extensionPicker({ selected, php, onChange }) {
  let current = new Set(selected);
  let version = php;
  let query = '';
  const search = h('input.input', { type: 'search', placeholder: 'Rechercher une extension (redis, imagick…)', oninput: () => { query = search.value.trim().toLowerCase(); paint(); } });
  const count = h('span.muted');
  const groups = h('div.ext-groups');
  const builtin = h('p.ext-builtin.muted',
    icon('check', 13), 'Toujours incluses : ',
    store.catalog.builtin.join(', '), '. Xdebug et Composer sont installés d\'office.');
  const el = h('div.ext-picker', h('div.ext-toolbar', h('div.input-icon', icon('search', 14), search), count), groups, builtin);

  function paint() {
    const avail = availableFor(version);
    const ids = new Set(avail.map((e) => e.id));
    for (const id of [...current]) if (!ids.has(id)) current.delete(id);
    count.textContent = `${current.size} sélectionnée${current.size > 1 ? 's' : ''}`;
    const byGroup = new Map();
    for (const e of avail) {
      if (query && !`${e.id} ${e.label} ${e.desc}`.toLowerCase().includes(query)) continue;
      if (!byGroup.has(e.group)) byGroup.set(e.group, []);
      byGroup.get(e.group).push(e);
    }
    replace(groups, [...byGroup].map(([g, list]) => h('div.ext-group',
      h('h4', g),
      h('div.ext-grid', list.map((e) => {
        const input = h('input', {
          type: 'checkbox',
          checked: current.has(e.id),
          onchange: () => {
            if (input.checked) current.add(e.id); else current.delete(e.id);
            tile.classList.toggle('on', input.checked);
            count.textContent = `${current.size} sélectionnée${current.size > 1 ? 's' : ''}`;
            onChange([...current].sort());
          },
        });
        const tile = h(`label.ext-tile${current.has(e.id) ? '.on' : ''}`, input,
          h('span.ext-check', icon('check', 12)),
          h('span.ext-text', h('strong', e.label), h('span', e.desc)));
        return tile;
      })))));
    if (!byGroup.size) groups.append(h('p.muted', 'Aucune extension ne correspond.'));
  }

  paint();
  return {
    el,
    setPhp(v) { version = v; paint(); onChange([...current].sort()); },
    set(list) { current = new Set(list); paint(); },
  };
}
