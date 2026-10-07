// Menus contextuels partagés (arbre, liste des bases, liste des tables, onglet table).
import { q, qt, copyText, toast } from './lib.js';
import { openTab } from './tabs.js';
import { state, schemaChanged } from './state.js';
import * as D from './dialogs.js';
import * as F from './forms.js';

export function openTable(server, db, table, sub) {
  const tab = openTab('table', { server, db, table });
  if (sub) tab.view?.setSub?.(sub);
  return tab;
}

export const newQuery = (server, db, sql = '') => openTab('query', { server, db, sql });

export function dbMenu(server, db, system = false) {
  return [
    { label: 'Ouvrir', icon: 'db', onClick: () => openTab('db', { server, db }) },
    { label: 'Nouvelle requête SQL', icon: 'sql', onClick: () => newQuery(server, db) },
    { label: 'Schéma (diagramme)', icon: 'schema', onClick: () => openTab('schema', { server, db }) },
    '-',
    { label: 'Nouvelle table…', icon: 'plus', onClick: () => F.dlgCreateTable(server, db) },
    { label: 'Importer un fichier SQL…', icon: 'upload', onClick: () => D.dlgImport({ server, db }) },
    { label: 'Exporter…', icon: 'download', onClick: () => D.dlgExport({ server, db }) },
    { label: 'Dupliquer la base…', icon: 'copy', onClick: () => D.dlgCopyDb(server, db) },
    '-',
    { label: 'Actualiser', icon: 'refresh', onClick: () => schemaChanged({ server, db }) },
    { label: 'Supprimer la base…', icon: 'trash', danger: true, disabled: system, onClick: () => D.dlgDropDb(server, db) },
  ];
}

/** t = {name, view} */
export function tableMenu(server, db, t) {
  const sub = t.view ? [] : [
    { label: 'Structure', icon: 'list', onClick: () => openTable(server, db, t.name, 'structure') },
  ];
  return [
    { label: t.view ? 'Ouvrir la vue' : 'Ouvrir (données)', icon: 'table', onClick: () => openTable(server, db, t.name, 'data') },
    ...sub,
    { label: 'SELECT dans une requête', icon: 'sql', onClick: () => newQuery(server, db, `SELECT *\nFROM ${q(t.name)}\nLIMIT 100;`) },
    '-',
    { label: 'Renommer / déplacer…', icon: 'edit', onClick: () => D.dlgRenameTable(server, db, t.name) },
    { label: 'Dupliquer…', icon: 'copy', disabled: t.view, onClick: () => D.dlgCopyTable(server, db, t.name) },
    { label: 'Exporter…', icon: 'download', onClick: () => D.dlgExport({ server, db, tables: [t.name] }) },
    { label: 'Copier le nom', onClick: () => { copyText(t.name); toast('Nom copié', 'ok'); } },
    '-',
    { label: 'Optimiser', disabled: t.view, onClick: () => D.dlgMaintenance(server, db, [t.name], 'OPTIMIZE') },
    { label: 'Vider la table…', icon: 'trash', danger: true, disabled: t.view, onClick: () => D.dlgTruncate(server, db, [t.name]) },
    { label: t.view ? 'Supprimer la vue…' : 'Supprimer la table…', icon: 'trash', danger: true, onClick: () => D.dlgDropTables(server, db, [t]) },
  ];
}
