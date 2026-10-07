// DB Admin — VOTRE code. Chargé une fois l'application démarrée ; une erreur ici ne casse rien.
//
// `window.DBA` donne accès aux briques de l'application :
//   DBA.api(action, params)      appelle le backend (voir src/Actions.php : « row.update » → a_row_update)
//   DBA.state                    serveur courant, bases, tables chargées, configuration
//   DBA.openTab(kind, params)    ouvre un onglet : 'query' | 'db' | 'table' | 'schema' | 'server'
//   DBA.toast(message, kind)     notification ('ok' | 'error' | 'info')
//   DBA.h(tag, attrs, ...kids)   fabrique un élément DOM
//
// Exemples :
//   DBA.on('keydown', e => {});            // (rien de spécial : c'est du JS ordinaire)
//   document.title = 'Mes bases';
//
//   // Ouvrir une requête toute prête au démarrage :
//   // DBA.openTab('query', { server: 'mysql', db: 'blog', sql: 'SELECT COUNT(*) FROM users' });
