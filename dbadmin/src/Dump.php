<?php
declare(strict_types=1);

/**
 * Export SQL au format mysqldump : réimportable par DB Admin, par « mysql < fichier »,
 * par HeidiSQL, TablePlus… Écrit en flux (jamais plus d'un lot en mémoire).
 */
final class Dump
{
    private const BATCH_BYTES = 1_000_000;

    private PDO $meta;
    private PDO $data;

    /**
     * @param array{db:string,tables:list<string>,structure:bool,data:bool,drop:bool,createDb:bool,extras:bool} $o
     * @param Closure(string):void $write
     */
    public function __construct(private string $server, private array $o, private Closure $write)
    {
        $this->meta = Db::connect($server);
        $this->data = Db::connect($server, false);    // lecture en flux, sur sa propre connexion
    }

    public function run(): void
    {
        $o = $this->o;
        $db = $o['db'];
        $this->w("-- DB Admin — export SQL\n-- Serveur : " . Db::server($this->server)['label'] . "  ·  Base : {$db}  ·  " . date('Y-m-d H:i:s') . "\n\n");
        $this->w("/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;\n"
            . "/*!40101 SET NAMES utf8mb4 */;\n"
            . "/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;\n"
            . "/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;\n"
            . "/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;\n\n");

        if ($o['createDb']) {
            $create = (string)$this->meta->query('SHOW CREATE DATABASE ' . Db::q($db))->fetch()[1];
            $this->w(preg_replace('/^CREATE DATABASE /', 'CREATE DATABASE IF NOT EXISTS ', $create) . ";\nUSE " . Db::q($db) . ";\n\n");
        }

        $objects = $this->meta->query(
            'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ' . Db::lit($this->meta, $db) . ' ORDER BY TABLE_NAME'
        )->fetchAll();
        $wanted = $o['tables'] ? array_flip($o['tables']) : null;
        $tables = [];
        $views = [];
        foreach ($objects as [$name, $type]) {
            if ($wanted !== null && !isset($wanted[$name])) {
                continue;
            }
            if ($type === 'VIEW') {
                $views[] = $name;
            } else {
                $tables[] = $name;
            }
        }

        foreach ($tables as $t) {
            if ($o['structure']) {
                $ddl = (string)$this->meta->query('SHOW CREATE TABLE ' . Db::qt($db, $t))->fetch()[1];
                $this->w("--\n-- Structure de la table " . Db::q($t) . "\n--\n\n");
                if ($o['drop']) {
                    $this->w('DROP TABLE IF EXISTS ' . Db::q($t) . ";\n");
                }
                $this->w($ddl . ";\n\n");
            }
            if ($o['data']) {
                $this->dumpData($db, $t);
            }
        }

        if ($o['structure']) {
            foreach ($views as $v) {
                $ddl = (string)$this->meta->query('SHOW CREATE VIEW ' . Db::qt($db, $v))->fetch()[1];
                $this->w("--\n-- Vue " . Db::q($v) . "\n--\n\n");
                if ($o['drop']) {
                    $this->w('DROP VIEW IF EXISTS ' . Db::q($v) . ";\n");
                }
                $this->w($this->unqualified($ddl, $db) . ";\n\n");
            }
        }

        if ($o['extras'] && $o['structure']) {
            foreach (self::programs($this->meta, $db, $wanted === null ? null : $tables) as $p) {
                $this->w("--\n-- {$p['kind']} " . Db::q($p['name']) . "\n--\n\n");
                if ($o['drop']) {
                    $this->w('DROP ' . strtoupper($p['kind']) . ' IF EXISTS ' . Db::q($p['name']) . ";\n");
                }
                $this->w("DELIMITER ;;\n" . $this->unqualified($p['sql'], $db) . ";;\nDELIMITER ;\n\n");
            }
        }

        $this->w("/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;\n/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;\n"
            . "/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;\n/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;\n\n-- Fin de l'export\n");
    }

    /**
     * Triggers (des tables données, ou de toute la base si $tables est null) puis procédures / fonctions
     * (base entière seulement). @return list<array{kind:string,name:string,sql:string}>
     */
    public static function programs(PDO $pdo, string $db, ?array $tables): array
    {
        $out = [];
        $triggers = $pdo->query('SHOW TRIGGERS FROM ' . Db::q($db))->fetchAll(PDO::FETCH_ASSOC);
        foreach ($triggers as $t) {
            if ($tables !== null && !in_array($t['Table'], $tables, true)) {
                continue;
            }
            $row = $pdo->query('SHOW CREATE TRIGGER ' . Db::qt($db, $t['Trigger']))->fetch();
            if (!empty($row[2])) {
                $out[] = ['kind' => 'trigger', 'name' => $t['Trigger'], 'sql' => (string)$row[2]];
            }
        }
        if ($tables === null) {
            foreach (['PROCEDURE', 'FUNCTION'] as $kind) {
                $list = $pdo->query("SHOW {$kind} STATUS WHERE Db = " . Db::lit($pdo, $db))->fetchAll();
                foreach ($list as $r) {
                    $row = $pdo->query("SHOW CREATE {$kind} " . Db::qt($db, $r[1]))->fetch();
                    if (!empty($row[2])) {
                        $out[] = ['kind' => strtolower($kind), 'name' => $r[1], 'sql' => (string)$row[2]];
                    }
                }
            }
        }
        return $out;
    }

    /** Colonnes exportables (hors colonnes générées) : [nom => genre] avec genre = num | str. */
    public static function dumpColumns(PDO $pdo, string $db, string $table): array
    {
        $cols = [];
        foreach ($pdo->query('SHOW COLUMNS FROM ' . Db::qt($db, $table))->fetchAll(PDO::FETCH_ASSOC) as $c) {
            if (preg_match('/(VIRTUAL|STORED) GENERATED/i', (string)$c['Extra'])) {
                continue;
            }
            // BIT : le pilote rend la valeur en entier décimal (« 5 »), qui s'écrit tel quel dans un INSERT.
            $cols[$c['Field']] = preg_match('/^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|year|bit)\b/', strtolower((string)$c['Type']))
                ? 'num' : 'str';
        }
        return $cols;
    }

    private function dumpData(string $db, string $table): void
    {
        $cols = self::dumpColumns($this->meta, $db, $table);
        if (!$cols) {
            return;
        }
        $kinds = array_values($cols);
        $list = implode(',', array_map([Db::class, 'q'], array_keys($cols)));
        $head = 'INSERT INTO ' . Db::q($table) . " ({$list}) VALUES\n";

        $this->w("--\n-- Données de la table " . Db::q($table) . "\n--\n\n");
        $st = $this->data->query("SELECT {$list} FROM " . Db::qt($db, $table));
        $batch = '';
        while (($row = $st->fetch(PDO::FETCH_NUM)) !== false) {
            $vals = [];
            foreach ($row as $k => $v) {
                $vals[] = $this->value($v, $kinds[$k]);
            }
            $batch .= ($batch === '' ? $head : ",\n") . '(' . implode(',', $vals) . ')';
            if (strlen($batch) >= self::BATCH_BYTES) {
                $this->w($batch . ";\n");
                $batch = '';
            }
        }
        $st->closeCursor();
        if ($batch !== '') {
            $this->w($batch . ";\n");
        }
        $this->w("\n");
    }

    /**
     * Retire le préfixe `base`. des définitions (vues surtout, que le serveur qualifie entièrement),
     * pour que l'export se réimporte dans une base de NOM DIFFÉRENT — comme le fait mysqldump.
     */
    private function unqualified(string $sql, string $db): string
    {
        return str_replace(Db::q($db) . '.', '', $sql);
    }

    private function value(?string $v, string $kind): string
    {
        if ($v === null) {
            return 'NULL';
        }
        if ($kind === 'num' && is_numeric($v)) {
            return $v;
        }
        if ($v === '') {
            return "''";
        }
        if (!mb_check_encoding($v, 'UTF-8')) {
            return '0x' . bin2hex($v);
        }
        return $this->data->quote($v);
    }

    private function w(string $s): void
    {
        ($this->write)($s);
    }
}
