<?php
declare(strict_types=1);

/**
 * Cet outil est un root SQL sans mot de passe : il ne doit répondre qu'à SON interface,
 * jamais à une page web tierce ouverte dans le même navigateur.
 *  - Host        : refuse tout nom autre que localhost / 127.0.0.1 (DNS rebinding) ;
 *  - Sec-Fetch   : refuse les requêtes déclenchées depuis un autre site ;
 *  - Origin      : idem pour les navigateurs qui n'envoient pas Sec-Fetch.
 */
final class Guard
{
    public static function check(): void
    {
        $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
        $name = preg_replace('/:\d+$/', '', $host);
        if (!in_array($name, Config::get('allowed_hosts', []), true)) {
            Http::fail("Hôte « {$host} » non autorisé (allowed_hosts dans config.php).", 403);
        }

        $site = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? null;
        if ($site !== null && !in_array($site, ['same-origin', 'none'], true)) {
            Http::fail('Requête inter-sites refusée.', 403);
        }

        $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
        if ($origin !== null && $origin !== 'null' && preg_replace('~^https?://~i', '', $origin) !== $host) {
            Http::fail('Origine refusée.', 403);
        }
    }
}
