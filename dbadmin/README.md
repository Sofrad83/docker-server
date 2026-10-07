# DB Admin

Administration SQL intégrée à docker-server — une alternative légère à HeidiSQL / phpMyAdmin.
**http://dbadmin.localhost** · PHP 8.4 + JavaScript natif · aucune dépendance, aucun build.

Il est écrit pour être **modifié** : les sources de ce dossier sont montées dans le container.
On édite un fichier, on rafraîchit la page (Ctrl+F5 si besoin) — rien à reconstruire.
Seuls les changements de `php.ini` demandent `docker restart ds-dbadmin`.

## Ce que ça fait

| | |
|---|---|
| **Navigation** | arbre bases → tables, filtre global (cherche dans toutes les tables), onglets mémorisés |
| **Données** | tri, filtres par colonne, WHERE libre, édition en place, insérer / dupliquer / supprimer des lignes |
| **Structure** | colonnes, index, clés étrangères, propriétés, `CREATE TABLE` — avec aperçu SQL modifiable |
| **Tables** | créer, renommer / déplacer, dupliquer, vider, supprimer, optimiser (une ou plusieurs) |
| **Bases** | créer, supprimer, **dupliquer** (tables + données + vues + déclencheurs + procédures) |
| **Console SQL** | multi-instructions, instruction courante, sélection, historique, export CSV |
| **Import / export** | `.sql` et `.sql.gz`, en flux (gros fichiers), échange avec `data\backups` |
| **Schéma** | diagramme, relations déclarées et déduites des noms |
| **Serveur** | liste des bases, processus (KILL), plusieurs serveurs (tous ceux créés depuis le tableau de bord) |

Raccourcis : `Ctrl+Entrée` exécuter · `Ctrl+Maj+Entrée` instruction courante · `Alt+N` nouvelle requête ·
`Alt+W` fermer l'onglet · double-clic modifier une cellule · clic droit menus. Bouton `?` : aide.

Filtres de colonne : `texte` (contient) · `=x` · `!=x` · `>5` `<5` `>=5` `<=5` · `~regex` · `NULL` · `!NULL`.

## Personnaliser

| Je veux… | Je modifie |
|---|---|
| changer les couleurs, la taille de texte | `public/custom.css` (variables `--accent`, `--bg`, `--font-size`…) ou `public/css/app.css` |
| ajouter un comportement, un raccourci | `public/custom.js` — `window.DBA` donne `api`, `state`, `openTab`, `toast`, `h`… |
| ajouter un serveur hors tableau de bord, changer les limites | `config.php` |
| ajouter une fonctionnalité côté serveur | une méthode `a_xxx` dans `src/Actions.php` ; on l'appelle depuis le JS avec `api('xxx', {...})` |
| ajouter un type d'onglet | un fichier `public/js/v-xxx.js` qui appelle `registerView('xxx', fabrique)` (voir `v-db.js`, le plus simple), puis un `import` dans `main.js` |
| ajouter un item aux menus clic droit | `public/js/menus.js` |
| ajouter / modifier un formulaire de structure | `public/js/forms.js` (SQL fabriqué côté client, montré avant exécution par `sqlForm`) |

Les serveurs sont lus dans `data/state.json` : un serveur créé depuis le tableau de bord apparaît ici sans rien configurer.

## Organisation

```
dbadmin/
├─ start.sh              démarrage : php:8.4-apache officiel + pdo_mysql compilé au 1er lancement
├─ php.ini               limites PHP (uploads 4 Go, pas de limite de temps)
├─ config.php            serveurs, limites, hôtes autorisés
├─ src/
│   ├─ Actions.php       l'API : une méthode publique a_<action> par action
│   ├─ Db.php            connexion PDO, quoting, messages d'erreur
│   ├─ SqlSplitter.php   découpe un script SQL en flux (chaînes, commentaires, DELIMITER)
│   ├─ Dump.php          export au format mysqldump
│   ├─ Guard.php         refuse hôte / origine / requête inter-sites étrangers
│   └─ Http.php, Config.php, bootstrap.php
└─ public/
    ├─ index.html, api.php, custom.css, custom.js
    ├─ css/app.css       tout le thème, en variables
    └─ js/
        ├─ main.js       démarrage : barre du haut, arbre, onglets, raccourcis
        ├─ lib.js        DOM (h), icônes, formatage, modales, menus
        ├─ api.js, state.js, tabs.js
        ├─ grid.js       la grille (tri, filtres, sélection)
        ├─ tree.js, menus.js, dialogs.js, forms.js
        └─ v-server.js, v-db.js, v-table.js, v-query.js, v-schema.js     les onglets
```

## Choix de conception

* **Le SQL de structure est fabriqué côté client** (`forms.js`), montré, modifiable, puis envoyé à
  la console SQL du serveur. Le backend reste mince : métadonnées, pagination, lignes, import / export.
* **Les valeurs reviennent en chaînes** (`ATTR_STRINGIFY_FETCHES`) : aucune perte sur `BIGINT` / `DECIMAL`.
  Un texte trop long arrive sous la forme `{t, n}` (tronqué, taille réelle) et un binaire sous la
  forme `{b, n}` (aperçu hexadécimal) ; la valeur complète se demande à `cell`.
* **L'édition d'une ligne** s'appuie sur la clé primaire, à défaut sur un index unique sans NULL,
  à défaut sur toutes les valeurs de la ligne (`LIMIT 1`).
* **Import et export en flux** : `SqlSplitter` lit par blocs de 1 Mo (il reprend là où il s'est
  arrêté si une chaîne est coupée en deux), `Dump` écrit par lots de 1 Mo.
* **Pas d'authentification**, comme tout docker-server : l'outil est un root SQL, il ne doit jamais être
  exposé. Il n'est joignable que via le proxy local (`dbadmin.localhost`) et `Guard` refuse les requêtes qui ne viennent pas de sa propre page.

## Limites connues

* Les **routines** (procédures / fonctions) ne s'éditent pas dans une interface dédiée : on les crée
  avec la console SQL (`DELIMITER` est géré). Elles sont en revanche exportées, importées et copiées.
* Les colonnes **générées** et **binaires** sont en lecture seule dans la grille.
* Pas de gestion des utilisateurs / privilèges MySQL.
