<?php
declare(strict_types=1);

final class Db
{
    /** @var array<string,PDO> */
    private static array $pool = [];

    /** @return array{label:string,host:string,port:int,user:string,password:string} */
    public static function server(string $id): array
    {
        $servers = Config::get('servers', []);
        if (!isset($servers[$id])) {
            throw new UserError("Serveur « {$id} » inconnu.");
        }
        return $servers[$id];
    }

    /**
     * Connexion au serveur (réutilisée pendant la requête).
     * $buffered = false : lecture en flux (exports, gros résultats) — la connexion est alors
     * monopolisée tant que le curseur n'est pas refermé.
     * Toutes les valeurs reviennent en chaînes (pas de perte sur les BIGINT / DECIMAL).
     */
    public static function connect(string $id, bool $buffered = true, bool $fresh = false): PDO
    {
        $key = $id . ($buffered ? ':b' : ':u');
        if (!$fresh && isset(self::$pool[$key])) {
            return self::$pool[$key];
        }
        $s = self::server($id);
        $pdo = new PDO("mysql:host={$s['host']};port={$s['port']};charset=utf8mb4", $s['user'], $s['password'], [
            PDO::ATTR_ERRMODE                  => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE       => PDO::FETCH_NUM,
            PDO::ATTR_STRINGIFY_FETCHES        => true,
            PDO::ATTR_EMULATE_PREPARES         => true,   // protocole texte : accepte toutes les instructions
            PDO::ATTR_TIMEOUT                  => 5,
            PDO::MYSQL_ATTR_USE_BUFFERED_QUERY => $buffered,
            PDO::MYSQL_ATTR_FOUND_ROWS         => true,   // rowCount() = lignes TROUVÉES, pas seulement modifiées
            PDO::MYSQL_ATTR_MULTI_STATEMENTS   => false,
        ]);
        return self::$pool[$key] = $pdo;
    }

    /** Interrompt la requête en cours d'une connexion (depuis une autre connexion). */
    public static function killQuery(string $server, int $connectionId): void
    {
        try {
            self::connect($server, true, true)->exec('KILL QUERY ' . $connectionId);
        } catch (Throwable) {
            // la requête s'est peut-être terminée entre-temps
        }
    }

    /** `identifiant` */
    public static function q(string $name): string
    {
        return '`' . str_replace('`', '``', $name) . '`';
    }

    /** `base`.`table` */
    public static function qt(string $db, string $table): string
    {
        return self::q($db) . '.' . self::q($table);
    }

    /** Littéral SQL : NULL, binaire {x: "HEX"} (clés BINARY / UUID) ou chaîne échappée. */
    public static function lit(PDO $pdo, mixed $value): string
    {
        if ($value === null) {
            return 'NULL';
        }
        if (is_array($value) && isset($value['x']) && preg_match('/^[0-9a-fA-F]+$/', (string)$value['x'])) {
            return '0x' . $value['x'];
        }
        return $pdo->quote((string)$value);
    }

    /** Message lisible d'une exception PDO : « [1146] Table 'x' doesn't exist ». */
    public static function message(Throwable $e): array
    {
        if ($e instanceof PDOException && isset($e->errorInfo[1])) {
            return [(string)($e->errorInfo[2] ?? $e->getMessage()), (int)$e->errorInfo[1]];
        }
        if ($e instanceof PDOException) {
            // Échec de connexion : « SQLSTATE[HY000] [2002] php_network_getaddresses… »
            return [trim((string)preg_replace('/^SQLSTATE\[[^\]]*\]\s*(\[\d+\])?\s*/', '', $e->getMessage())), (int)$e->getCode()];
        }
        return [$e->getMessage(), 0];
    }
}
