<?php
/**
 * DB Admin — configuration. Fichier PHP ordinaire : modifiez-le librement.
 *
 * Les serveurs MySQL / MariaDB sont lus dans l'état du tableau de bord
 * (data/state.json, monté en lecture seule sur /state) : un serveur créé depuis
 * le tableau de bord apparaît ici automatiquement.
 */
$servers = [];
$default = 'mysql';
$state = @json_decode((string)@file_get_contents('/state/state.json'), true);
foreach ((array)($state['mysql'] ?? []) as $id => $inst) {
    $engine = ($inst['engine'] ?? 'mysql') === 'mariadb' ? 'MariaDB' : 'MySQL';
    $servers[$id] = [
        'label'    => $engine . ' ' . ($inst['version'] ?? '') . ($id !== 'mysql' ? " ({$id})" : ''),
        'host'     => $id,
        'port'     => 3306,
        'user'     => 'root',
        'password' => '',
    ];
    if (!empty($inst['default'])) {
        $default = $id;
    }
}
if (!$servers) {
    $servers['mysql'] = ['label' => 'MySQL', 'host' => 'mysql', 'port' => 3306, 'user' => 'root', 'password' => ''];
}

return [
    // Serveurs proposés dans la liste en haut de l'interface. La clé sert d'identifiant.
    // Pour en ajouter un à la main (le container doit être sur le réseau « docker-server ») :
    //   $servers['autre'] = ['label' => 'Autre', 'host' => 'autre', 'port' => 3306, 'user' => 'root', 'password' => ''];
    'servers' => $servers,
    'default_server' => $default,

    // Lignes par page dans l'onglet « Données » d'une table.
    'page_size' => 100,

    // Nombre maximum de lignes renvoyées par une requête de la console SQL.
    'result_limit' => 1000,

    // Dossier des sauvegardes (monté depuis data/backups) : import depuis le serveur, export vers le serveur.
    'backups_dir' => '/backups',

    // Noms d'hôte autorisés dans l'URL. Protège contre le « DNS rebinding » : une page web
    // quelconque ne peut pas piloter cet outil (il n'y a pas d'authentification, c'est un root SQL).
    'allowed_hosts' => ['dbadmin.localhost', '127.0.0.1', 'localhost', '[::1]'],
];
