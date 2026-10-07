<?php
declare(strict_types=1);

/**
 * L'API. Une méthode publique `a_<action>` = une action (« row.update » → a_row_update).
 * Pour ajouter une fonctionnalité : ajoutez une méthode ici, appelez-la depuis le JS avec api('mon.action', {...}).
 *
 * Paramètres communs : s = identifiant du serveur (clé de config.php), db, table.
 * Réponse : tableau PHP → JSON {ok:true, …} ; UserError / erreur SQL → HTTP 400 {ok:false, error}.
 */
final class Actions
{
    private const SYSTEM_DBS = ['information_schema', 'mysql', 'performance_schema', 'sys'];

    // ═════════════════════════════════════════════════════════════════════════
    //  Serveur
    // ═════════════════════════════════════════════════════════════════════════

    /** Serveurs configurés (instantané : aucune connexion — voir a_ping). */
    public static function a_servers(array $r): array
    {
        $list = [];
        foreach (Config::get('servers', []) as $id => $s) {
            $list[] = ['id' => $id, 'label' => $s['label']];
        }
        return [
            'ok' => true, 'servers' => $list, 'default' => Config::get('default_server'),
            'pageSize' => Config::get('page_size', 100), 'resultLimit' => Config::get('result_limit', 1000),
        ];
    }

    /**
     * Sonde UN serveur. À part de a_servers parce que résoudre le nom d'un container arrêté peut prendre
     * plusieurs secondes : l'interface ne doit jamais attendre ça pour démarrer.
     */
    public static function a_ping(array $r): array
    {
        try {
            return ['ok' => true, 'up' => true, 'version' => self::scalar(self::pdo($r), 'SELECT VERSION()')];
        } catch (Throwable $e) {
            return ['ok' => true, 'up' => false, 'error' => Db::message($e)[0]];
        }
    }

    /** Jeux de caractères / interclassements / moteurs, pour les formulaires. */
    public static function a_meta(array $r): array
    {
        $pdo = self::pdo($r);
        $charsets = [];
        foreach ($pdo->query('SHOW COLLATION')->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $cs = $c['Charset'];
            $charsets[$cs] ??= ['name' => $cs, 'default' => null, 'collations' => []];
            $charsets[$cs]['collations'][] = $c['Collation'];
            if ($c['Default'] === 'Yes') {
                $charsets[$cs]['default'] = $c['Collation'];
            }
        }
        ksort($charsets);
        $engines = [];
        foreach ($pdo->query('SHOW ENGINES')->fetchAll(PDO::FETCH_ASSOC) as $e) {
            if (in_array($e['Support'], ['YES', 'DEFAULT'], true)) {
                $engines[] = $e['Engine'];
            }
        }
        $defaults = $pdo->query('SELECT @@character_set_server, @@collation_server')->fetch();
        return ['ok' => true, 'charsets' => array_values($charsets), 'engines' => $engines,
                'defaultCharset' => $defaults[0], 'defaultCollation' => $defaults[1]];
    }

    public static function a_processlist(array $r): array
    {
        $rows = self::pdo($r)->query('SHOW FULL PROCESSLIST')->fetchAll(PDO::FETCH_ASSOC);
        return ['ok' => true, 'rows' => $rows];
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Bases et tables
    // ═════════════════════════════════════════════════════════════════════════

    public static function a_dbs(array $r): array
    {
        $rows = self::pdo($r)->query(
            'SELECT s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME, COUNT(t.TABLE_NAME),
                    COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0)
             FROM information_schema.SCHEMATA s
             LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
             GROUP BY s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME
             ORDER BY s.SCHEMA_NAME'
        )->fetchAll();
        $dbs = array_map(static fn(array $x): array => [
            'name' => $x[0], 'charset' => $x[1], 'collation' => $x[2], 'tables' => (int)$x[3], 'size' => (int)$x[4],
            'system' => in_array(strtolower($x[0]), self::SYSTEM_DBS, true),
        ], $rows);
        return ['ok' => true, 'dbs' => $dbs];
    }

    public static function a_tables(array $r): array
    {
        $pdo = self::pdo($r);
        $rows = $pdo->query(
            'SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, TABLE_COLLATION,
                    TABLE_COMMENT, CREATE_TIME, UPDATE_TIME, AUTO_INCREMENT
             FROM information_schema.TABLES WHERE TABLE_SCHEMA = ' . Db::lit($pdo, self::need($r, 'db')) . ' ORDER BY TABLE_NAME'
        )->fetchAll();
        $tables = array_map(static fn(array $x): array => [
            'name' => $x[0], 'view' => $x[1] !== 'BASE TABLE', 'engine' => $x[2], 'rows' => $x[3] === null ? null : (int)$x[3],
            'data' => (int)$x[4], 'index' => (int)$x[5], 'collation' => $x[6], 'comment' => $x[7],
            'created' => $x[8], 'updated' => $x[9], 'autoInc' => $x[10],
        ], $rows);
        return ['ok' => true, 'tables' => $tables];
    }

    /** Tout ce qu'il faut pour afficher la structure d'une table (ou d'une vue). */
    public static function a_table(array $r): array
    {
        $pdo = self::pdo($r);
        $db = self::need($r, 'db');
        $t = self::need($r, 'table');
        $qt = Db::qt($db, $t);

        $type = self::scalar($pdo, 'SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = '
            . Db::lit($pdo, $db) . ' AND TABLE_NAME = ' . Db::lit($pdo, $t));
        if ($type === null) {
            throw new UserError("« {$db}.{$t} » n'existe pas.");
        }
        $isView = $type !== 'BASE TABLE';

        $columns = self::columns($pdo, $db, $t);
        $create = $pdo->query(($isView ? 'SHOW CREATE VIEW ' : 'SHOW CREATE TABLE ') . $qt)->fetch()[1];

        $indexes = [];
        $fks = [];
        $refs = [];
        $status = null;
        $triggers = [];
        if (!$isView) {
            $groups = [];
            foreach ($pdo->query('SHOW INDEX FROM ' . $qt)->fetchAll(PDO::FETCH_ASSOC) as $i) {
                $g = &$groups[$i['Key_name']];
                $g ??= ['name' => $i['Key_name'], 'unique' => (int)$i['Non_unique'] === 0, 'method' => $i['Index_type'],
                        'cardinality' => $i['Cardinality'], 'comment' => $i['Index_comment'] ?? '', 'columns' => []];
                $g['columns'][] = ['name' => $i['Column_name'], 'sub' => $i['Sub_part']];
                unset($g);
            }
            foreach ($groups as $g) {
                $g['type'] = $g['name'] === 'PRIMARY' ? 'PRIMARY' : ($g['method'] === 'FULLTEXT' ? 'FULLTEXT'
                    : ($g['method'] === 'SPATIAL' ? 'SPATIAL' : ($g['unique'] ? 'UNIQUE' : 'INDEX')));
                $indexes[] = $g;
            }

            $fkSql = 'SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
                             r.UPDATE_RULE, r.DELETE_RULE, k.TABLE_NAME
                      FROM information_schema.KEY_COLUMN_USAGE k
                      JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
                      WHERE k.TABLE_SCHEMA = ' . Db::lit($pdo, $db) . ' AND ';
            foreach ($pdo->query($fkSql . 'k.TABLE_NAME = ' . Db::lit($pdo, $t) . ' AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION')->fetchAll() as $x) {
                $f = &$fks[$x[0]];
                $f ??= ['name' => $x[0], 'columns' => [], 'refDb' => $x[2], 'refTable' => $x[3], 'refColumns' => [], 'onUpdate' => $x[5], 'onDelete' => $x[6]];
                $f['columns'][] = $x[1];
                $f['refColumns'][] = $x[4];
                unset($f);
            }
            foreach ($pdo->query($fkSql . 'k.REFERENCED_TABLE_SCHEMA = ' . Db::lit($pdo, $db) . ' AND k.REFERENCED_TABLE_NAME = ' . Db::lit($pdo, $t) . ' ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION')->fetchAll() as $x) {
                $f = &$refs[$x[7] . '.' . $x[0]];
                $f ??= ['name' => $x[0], 'table' => $x[7], 'columns' => [], 'refColumns' => [], 'onUpdate' => $x[5], 'onDelete' => $x[6]];
                $f['columns'][] = $x[1];
                $f['refColumns'][] = $x[4];
                unset($f);
            }

            $status = $pdo->query('SHOW TABLE STATUS FROM ' . Db::q($db) . ' WHERE Name = ' . Db::lit($pdo, $t))->fetch(PDO::FETCH_ASSOC) ?: null;
            foreach ($pdo->query('SHOW TRIGGERS FROM ' . Db::q($db) . ' WHERE `Table` = ' . Db::lit($pdo, $t))->fetchAll(PDO::FETCH_ASSOC) as $g) {
                $triggers[] = ['name' => $g['Trigger'], 'timing' => $g['Timing'], 'event' => $g['Event'], 'statement' => $g['Statement']];
            }
        }

        return [
            'ok' => true, 'isView' => $isView, 'columns' => $columns, 'indexes' => $indexes,
            'fks' => array_values($fks), 'refs' => array_values($refs), 'create' => $create, 'status' => $status,
            'triggers' => $triggers, 'keyColumns' => self::keyColumns($pdo, $columns, $db, $t, $isView),
        ];
    }

    /** Copie complète d'une base : structure, données, vues, triggers, procédures. */
    public static function a_db_copy(array $r): array
    {
        ignore_user_abort(true);
        $server = self::s($r);
        $pdo = Db::connect($server);
        $from = self::need($r, 'from');
        $to = self::need($r, 'to');
        $withData = (bool)($r['data'] ?? true);
        if ($from === $to) {
            throw new UserError('La base de destination doit avoir un autre nom.');
        }
        $src = $pdo->query('SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ' . Db::lit($pdo, $from))->fetch();
        if (!$src) {
            throw new UserError("La base « {$from} » n'existe pas.");
        }
        if (self::scalar($pdo, 'SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ' . Db::lit($pdo, $to)) !== '0') {
            throw new UserError("La base « {$to} » existe déjà.");
        }

        $t0 = microtime(true);
        $pdo->exec('CREATE DATABASE ' . Db::q($to) . ' CHARACTER SET ' . $src[0] . ' COLLATE ' . $src[1]);
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0, UNIQUE_CHECKS = 0');
        $pdo->exec('USE ' . Db::q($to));

        $warnings = [];
        $counts = ['tables' => 0, 'views' => 0, 'programs' => 0];
        $objects = $pdo->query('SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ' . Db::lit($pdo, $from) . ' ORDER BY TABLE_NAME')->fetchAll();
        foreach ($objects as [$name, $type]) {
            if ($type === 'VIEW') {
                continue;
            }
            try {
                $pdo->exec((string)$pdo->query('SHOW CREATE TABLE ' . Db::qt($from, $name))->fetch()[1]);
                $counts['tables']++;
                if ($withData) {
                    $list = implode(',', array_map([Db::class, 'q'], array_keys(Dump::dumpColumns($pdo, $from, $name))));
                    if ($list !== '') {
                        $pdo->exec('INSERT INTO ' . Db::qt($to, $name) . " ({$list}) SELECT {$list} FROM " . Db::qt($from, $name));
                    }
                }
            } catch (Throwable $e) {
                $warnings[] = "Table {$name} : " . Db::message($e)[0];
            }
        }
        foreach ($objects as [$name, $type]) {
            if ($type !== 'VIEW') {
                continue;
            }
            try {
                $ddl = (string)$pdo->query('SHOW CREATE VIEW ' . Db::qt($from, $name))->fetch()[1];
                $pdo->exec(str_replace(Db::q($from) . '.', Db::q($to) . '.', $ddl));
                $counts['views']++;
            } catch (Throwable $e) {
                $warnings[] = "Vue {$name} : " . Db::message($e)[0];
            }
        }
        try {
            foreach (Dump::programs($pdo, $from, null) as $p) {
                try {
                    $pdo->exec(str_replace(Db::q($from) . '.', Db::q($to) . '.', $p['sql']));
                    $counts['programs']++;
                } catch (Throwable $e) {
                    $warnings[] = ucfirst($p['kind']) . " {$p['name']} : " . Db::message($e)[0];
                }
            }
        } catch (Throwable $e) {
            $warnings[] = 'Triggers / routines : ' . Db::message($e)[0];
        }
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 1, UNIQUE_CHECKS = 1');

        return ['ok' => true] + $counts + ['warnings' => $warnings, 'seconds' => round(microtime(true) - $t0, 1)];
    }

    /** Schéma d'une base pour le diagramme : colonnes + clés étrangères déclarées. */
    public static function a_schema(array $r): array
    {
        $pdo = self::pdo($r);
        $db = Db::lit($pdo, self::need($r, 'db'));
        $tables = [];
        foreach ($pdo->query("SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = {$db} ORDER BY TABLE_NAME, ORDINAL_POSITION")->fetchAll() as $c) {
            $tables[$c[0]]['name'] = $c[0];
            $tables[$c[0]]['columns'][] = ['name' => $c[1], 'type' => $c[2], 'key' => $c[3]];
        }
        $views = [];
        foreach ($pdo->query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = {$db} AND TABLE_TYPE <> 'BASE TABLE'")->fetchAll() as $v) {
            $views[$v[0]] = true;
        }
        $fks = [];
        foreach ($pdo->query("SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
                              FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = {$db} AND REFERENCED_TABLE_NAME IS NOT NULL")->fetchAll() as $k) {
            $fks[] = ['table' => $k[0], 'column' => $k[1], 'refDb' => $k[2], 'refTable' => $k[3], 'refColumn' => $k[4], 'name' => $k[5]];
        }
        foreach ($tables as $name => &$t) {
            $t['view'] = isset($views[$name]);
        }
        return ['ok' => true, 'tables' => array_values($tables), 'fks' => $fks];
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Données d'une table
    // ═════════════════════════════════════════════════════════════════════════

    public static function a_rows(array $r): array
    {
        $pdo = self::pdo($r);
        $db = self::need($r, 'db');
        $t = self::need($r, 'table');
        $cols = self::columns($pdo, $db, $t);
        $names = array_column($cols, 'name');
        $where = self::where($pdo, $names, (array)($r['filters'] ?? []), (string)($r['where'] ?? ''));

        $order = [];
        foreach (array_slice((array)($r['sort'] ?? []), 0, 3) as $s) {
            if (in_array($s['col'] ?? null, $names, true)) {
                $order[] = Db::q($s['col']) . (($s['dir'] ?? '') === 'desc' ? ' DESC' : ' ASC');
            }
        }
        $size = max(1, min(5000, (int)($r['size'] ?? Config::get('page_size', 100))));
        $page = max(1, (int)($r['page'] ?? 1));
        $qt = Db::qt($db, $t);

        $t0 = hrtime(true);
        $sql = "SELECT * FROM {$qt}{$where}" . ($order ? ' ORDER BY ' . implode(', ', $order) : '') . ' LIMIT ' . (($page - 1) * $size) . ", {$size}";
        $bin = array_map(static fn(array $c): bool => $c['binary'], $cols);
        $rows = array_map(static function (array $row) use ($bin): array {
            foreach ($row as $i => $v) {
                $row[$i] = self::cell($v, $bin[$i] ?? false);
            }
            return $row;
        }, $pdo->query($sql)->fetchAll());
        $ms = (int)round((hrtime(true) - $t0) / 1e6);

        $approx = false;
        if ($page === 1 && count($rows) < $size) {
            $total = count($rows);
        } else {
            $estimate = $where === '' ? (int)self::scalar($pdo, 'SELECT TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = '
                . Db::lit($pdo, $db) . ' AND TABLE_NAME = ' . Db::lit($pdo, $t)) : 0;
            if ($estimate > 500000 && empty($r['exact'])) {
                $total = $estimate;
                $approx = true;
            } else {
                $total = (int)self::scalar($pdo, "SELECT COUNT(*) FROM {$qt}{$where}");
            }
        }

        return ['ok' => true, 'columns' => $cols, 'rows' => $rows, 'total' => $total, 'approx' => $approx,
                'ms' => $ms, 'sql' => $sql, 'keyColumns' => self::keyColumns($pdo, $cols, $db, $t, false)];
    }

    /** Valeur complète d'une cellule (pour l'éditeur de texte long). */
    public static function a_cell(array $r): array
    {
        $pdo = self::pdo($r);
        $db = self::need($r, 'db');
        $t = self::need($r, 'table');
        $names = array_column(self::columns($pdo, $db, $t), 'name');
        $col = self::need($r, 'col');
        if (!in_array($col, $names, true)) {
            throw new UserError("Colonne « {$col} » inconnue.");
        }
        $v = self::scalar($pdo, 'SELECT ' . Db::q($col) . ' FROM ' . Db::qt($db, $t) . ' WHERE ' . self::keyWhere($pdo, $names, (array)($r['key'] ?? [])) . ' LIMIT 1');
        if ($v !== null && !mb_check_encoding($v, 'UTF-8')) {
            return ['ok' => true, 'value' => null, 'binary' => strtoupper(bin2hex($v)), 'size' => strlen($v)];
        }
        return ['ok' => true, 'value' => $v];
    }

    public static function a_row_update(array $r): array
    {
        $pdo = self::pdo($r);
        $db = self::need($r, 'db');
        $t = self::need($r, 'table');
        $cols = array_column(self::columns($pdo, $db, $t), null, 'name');
        $names = array_keys($cols);
        $set = [];
        foreach ((array)($r['set'] ?? []) as $c => $v) {
            if (!isset($cols[$c])) {
                throw new UserError("Colonne « {$c} » inconnue.");
            }
            $set[] = Db::q($c) . ' = ' . self::writeValue($pdo, $cols[$c], $v);
        }
        if (!$set) {
            throw new UserError('Aucune modification.');
        }
        $sql = 'UPDATE ' . Db::qt($db, $t) . ' SET ' . implode(', ', $set) . ' WHERE ' . self::keyWhere($pdo, $names, (array)($r['key'] ?? [])) . ' LIMIT 1';
        if ($pdo->exec($sql) === 0) {
            throw new UserError("Aucune ligne ne correspond : elle a peut-être été modifiée ou supprimée ailleurs. Rafraîchissez la table.");
        }
        return ['ok' => true, 'sql' => $sql];
    }

    public static function a_row_insert(array $r): array
    {
        $pdo = self::pdo($r);
        $db = self::need($r, 'db');
        $t = self::need($r, 'table');
        $known = array_column(self::columns($pdo, $db, $t), null, 'name');
        $cols = [];
        $vals = [];
        foreach ((array)($r['values'] ?? []) as $c => $v) {
            if (!isset($known[$c])) {
                throw new UserError("Colonne « {$c} » inconnue.");
            }
            $cols[] = Db::q($c);
            $vals[] = self::writeValue($pdo, $known[$c], $v);
        }
        $sql = 'INSERT INTO ' . Db::qt($db, $t) . ($cols ? ' (' . implode(', ', $cols) . ') VALUES (' . implode(', ', $vals) . ')' : ' () VALUES ()');
        $pdo->exec($sql);
        return ['ok' => true, 'sql' => $sql, 'insertId' => $pdo->lastInsertId()];
    }

    public static function a_row_delete(array $r): array
    {
        $pdo = self::pdo($r);
        $db = self::need($r, 'db');
        $t = self::need($r, 'table');
        $names = array_column(self::columns($pdo, $db, $t), 'name');
        $sqls = [];
        foreach ((array)($r['keys'] ?? []) as $key) {
            $sqls[] = 'DELETE FROM ' . Db::qt($db, $t) . ' WHERE ' . self::keyWhere($pdo, $names, (array)$key) . ' LIMIT 1';
        }
        if (!$sqls) {
            throw new UserError('Aucune ligne à supprimer.');
        }
        $pdo->beginTransaction();
        try {
            $n = 0;
            foreach ($sqls as $sql) {
                $n += (int)$pdo->exec($sql);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return ['ok' => true, 'deleted' => $n, 'sql' => count($sqls) > 3 ? implode(";\n", array_slice($sqls, 0, 3)) . ";\n-- … " . count($sqls) . ' DELETE' : implode(";\n", $sqls)];
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Console SQL
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Exécute un script. mode = all (tout le texte) | cursor (l'instruction sous le curseur).
     * Une entrée par instruction (et par jeu de résultats) ; arrêt à la première erreur.
     */
    public static function a_sql(array $r): array
    {
        $server = self::s($r);
        $pdo = Db::connect($server, false);
        if (!empty($r['db'])) {
            $pdo->exec('USE ' . Db::q((string)$r['db']));
        }
        $connId = (int)self::scalar($pdo, 'SELECT CONNECTION_ID()');
        $limit = max(1, min(100000, (int)($r['limit'] ?? Config::get('result_limit', 1000))));

        $sql = (string)($r['sql'] ?? '');
        $stmts = SqlSplitter::split($sql);
        if (($r['mode'] ?? 'all') === 'cursor' && $stmts) {
            $at = strlen(mb_substr($sql, 0, (int)($r['cursor'] ?? 0)));
            $pick = end($stmts);
            foreach ($stmts as $s) {
                if ($at <= $s['to']) {
                    $pick = $s;
                    break;
                }
            }
            $stmts = [$pick];
        }

        $results = [];
        foreach ($stmts as $st) {
            $t0 = hrtime(true);
            try {
                $q = $pdo->query($st['sql']);
                $first = true;
                $cut = false;
                do {
                    $item = ['sql' => $first ? $st['sql'] : '(jeu de résultats suivant)'];
                    $first = false;
                    if ($q->columnCount() > 0) {
                        $cols = [];
                        for ($i = 0, $n = $q->columnCount(); $i < $n; $i++) {
                            $m = $q->getColumnMeta($i);
                            $cols[] = ['name' => $m['name'], 'type' => $m['native_type'] ?? '', 'table' => $m['table'] ?? ''];
                        }
                        $rows = [];
                        while (($row = $q->fetch(PDO::FETCH_NUM)) !== false) {
                            if (count($rows) >= $limit) {
                                $cut = true;
                                break;
                            }
                            $rows[] = array_map(static fn($v) => self::cell($v, false), $row);
                        }
                        $item += ['type' => 'rows', 'cols' => $cols, 'rows' => $rows, 'truncated' => $cut];
                        if ($cut) {
                            Db::killQuery($server, $connId);   // inutile de laisser le serveur produire la suite
                        }
                    } else {
                        $item += ['type' => 'ok', 'affected' => $q->rowCount(), 'insertId' => $pdo->lastInsertId()];
                    }
                    $item['ms'] = (int)round((hrtime(true) - $t0) / 1e6);
                    $results[] = $item;
                } while (!$cut && $q->nextRowset());
                if ($cut) {
                    try {
                        $q->closeCursor();
                    } catch (Throwable) {
                        // interrompue par KILL QUERY : attendu
                    }
                    $pdo = self::reopen($server, $pdo);
                }
            } catch (Throwable $e) {
                [$msg, $code] = Db::message($e);
                $results[] = ['sql' => $st['sql'], 'type' => 'error', 'error' => $msg, 'code' => $code,
                              'ms' => (int)round((hrtime(true) - $t0) / 1e6)];
                break;
            }
        }
        return ['ok' => true, 'results' => $results];
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Import / export
    // ═════════════════════════════════════════════════════════════════════════

    /** Fichiers de sauvegarde du dossier partagé (data\backups). */
    public static function a_backups(array $r): array
    {
        $dir = rtrim((string)Config::get('backups_dir', '/backups'), '/');
        $files = [];
        foreach (array_merge(glob("{$dir}/*.sql*") ?: [], glob("{$dir}/*/*.sql*") ?: []) as $f) {
            if (is_file($f) && preg_match('/\.sql(\.gz)?$/i', $f)) {
                $files[] = ['name' => substr($f, strlen($dir) + 1), 'size' => filesize($f), 'time' => filemtime($f)];
            }
        }
        usort($files, static fn($a, $b) => $b['time'] <=> $a['time']);
        return ['ok' => true, 'files' => $files];
    }

    /** Exécute un fichier .sql / .sql.gz (téléversé, ou pris dans data\backups) instruction par instruction. */
    public static function a_import(array $r): array
    {
        ignore_user_abort(true);
        $pdo = self::pdo($r);
        if (!empty($r['db'])) {
            $pdo->exec('USE ' . Db::q((string)$r['db']));
        }

        if (!empty($r['backup'])) {
            $dir = realpath((string)Config::get('backups_dir', '/backups'));
            $path = realpath($dir . '/' . $r['backup']);
            if ($dir === false || $path === false || !str_starts_with($path, $dir . DIRECTORY_SEPARATOR) || !is_file($path)) {
                throw new UserError('Fichier de sauvegarde introuvable.');
            }
            $label = (string)$r['backup'];
        } else {
            $f = $_FILES['file'] ?? null;
            if (!$f || $f['error'] !== UPLOAD_ERR_OK) {
                $why = [UPLOAD_ERR_INI_SIZE => 'dépasse upload_max_filesize (dbadmin/php.ini)', UPLOAD_ERR_FORM_SIZE => 'trop gros',
                        UPLOAD_ERR_NO_FILE => 'aucun fichier reçu', UPLOAD_ERR_PARTIAL => 'envoi interrompu'];
                throw new UserError('Fichier non reçu : ' . ($why[$f['error'] ?? UPLOAD_ERR_NO_FILE] ?? 'erreur ' . ($f['error'] ?? '?')) . '.');
            }
            $path = $f['tmp_name'];
            $label = $f['name'];
        }
        $stop = !isset($r['stop']) || filter_var($r['stop'], FILTER_VALIDATE_BOOLEAN);
        $noFk = !isset($r['noFk']) || filter_var($r['noFk'], FILTER_VALIDATE_BOOLEAN);

        $fh = gzopen($path, 'rb');     // lit aussi bien un .sql brut qu'un .gz
        if ($fh === false) {
            throw new UserError('Impossible d\'ouvrir le fichier.');
        }
        $t0 = microtime(true);
        $pdo->exec('SET autocommit = 0');
        if ($noFk) {
            $pdo->exec('SET FOREIGN_KEY_CHECKS = 0, UNIQUE_CHECKS = 0');
        }

        $count = 0;
        $sinceCommit = 0;
        $errors = [];
        $halted = false;
        $run = static function (array $st) use ($pdo, $stop, &$count, &$sinceCommit, &$errors, &$halted): void {
            $count++;
            try {
                // query() + nextRowset() plutôt que exec() : un SELECT / CALL laisserait son résultat en
                // suspens et la requête suivante (COMMIT…) échouerait avec l'erreur 2014.
                $q = $pdo->query($st['sql']);
                while ($q->nextRowset()) {
                }
                $q->closeCursor();
            } catch (Throwable $e) {
                [$msg, $code] = Db::message($e);
                if (count($errors) < 50) {
                    $errors[] = ['n' => $count, 'sql' => mb_strimwidth($st['sql'], 0, 300, '…'), 'error' => $msg, 'code' => $code];
                }
                $halted = $stop;
            }
            if (++$sinceCommit >= 1000) {
                $pdo->exec('COMMIT');
                $sinceCommit = 0;
            }
        };

        $splitter = new SqlSplitter();
        $bytes = 0;
        while (!$halted && !gzeof($fh)) {
            $chunk = gzread($fh, 1 << 20);
            if ($chunk === false || $chunk === '') {
                break;
            }
            $bytes += strlen($chunk);
            foreach ($splitter->feed($chunk) as $st) {
                $run($st);
                if ($halted) {
                    break;
                }
            }
        }
        if (!$halted) {
            foreach ($splitter->finish() as $st) {
                $run($st);
            }
        }
        gzclose($fh);
        $pdo->exec('COMMIT');
        $pdo->exec('SET autocommit = 1');
        if ($noFk) {
            $pdo->exec('SET FOREIGN_KEY_CHECKS = 1, UNIQUE_CHECKS = 1');
        }

        return ['ok' => true, 'file' => $label, 'statements' => $count, 'errors' => $errors, 'halted' => $halted,
                'bytes' => $bytes, 'seconds' => round(microtime(true) - $t0, 1)];
    }

    /**
     * Export d'une base (ou de quelques tables). dest = download (flux vers le navigateur) |
     * backups (fichier dans data\backups, réponse JSON). Les options arrivent en JSON dans « opts ».
     */
    public static function a_export(array $r): ?array
    {
        ignore_user_abort(true);
        $o = is_string($r['opts'] ?? null) ? (array)json_decode($r['opts'], true) : $r;
        $server = self::s($o);
        $pdo = Db::connect($server);
        $db = self::need($o, 'db');
        if (self::scalar($pdo, 'SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ' . Db::lit($pdo, $db)) === '0') {
            throw new UserError("La base « {$db} » n'existe pas.");
        }
        $opts = [
            'db' => $db,
            'tables' => array_values(array_map('strval', (array)($o['tables'] ?? []))),
            'structure' => (bool)($o['structure'] ?? true),
            'data' => (bool)($o['data'] ?? true),
            'drop' => (bool)($o['drop'] ?? true),
            'createDb' => (bool)($o['createDb'] ?? false),
            'extras' => (bool)($o['extras'] ?? true),
        ];
        $gzip = (bool)($o['gzip'] ?? false);
        $name = preg_replace('/[^\w.-]+/u', '_', $db . (count($opts['tables']) === 1 ? '.' . $opts['tables'][0] : '')) . '-' . date('Ymd-His') . '.sql' . ($gzip ? '.gz' : '');

        $toServer = ($o['dest'] ?? 'download') === 'backups';
        if ($toServer) {
            $dir = rtrim((string)Config::get('backups_dir', '/backups'), '/');
            $path = "{$dir}/{$name}";
            $fh = fopen($path, 'wb');
            if ($fh === false) {
                throw new UserError("Impossible d'écrire dans {$dir}.");
            }
            $sink = static function (string $s) use ($fh): void {
                fwrite($fh, $s);
            };
        } else {
            while (ob_get_level() > 0) {
                ob_end_clean();
            }
            header('Content-Type: ' . ($gzip ? 'application/gzip' : 'application/sql; charset=utf-8'));
            header('Content-Disposition: attachment; filename="' . $name . '"');
            header('Cache-Control: no-store');
            $sink = static function (string $s): void {
                echo $s;
                flush();
            };
        }
        $zip = $gzip ? deflate_init(ZLIB_ENCODING_GZIP, ['level' => 6]) : null;
        $write = $zip === null ? $sink : static function (string $s) use ($zip, $sink): void {
            $sink((string)deflate_add($zip, $s, ZLIB_NO_FLUSH));
        };

        try {
            (new Dump($server, $opts, $write))->run();
        } catch (Throwable $e) {
            if ($toServer) {
                fclose($fh);
                @unlink($path);
                throw $e;
            }
            $write("\n-- ERREUR PENDANT L'EXPORT : " . str_replace("\n", ' ', Db::message($e)[0]) . "\n-- Ce fichier est INCOMPLET.\n");
        }
        if ($zip !== null) {
            $sink((string)deflate_add($zip, '', ZLIB_FINISH));
        }
        if ($toServer) {
            fclose($fh);
            return ['ok' => true, 'file' => $name, 'bytes' => filesize($path)];
        }
        exit;
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Outils internes
    // ═════════════════════════════════════════════════════════════════════════

    private static function s(array $r): string
    {
        return (string)($r['s'] ?? Config::get('default_server', 'mysql'));
    }

    private static function pdo(array $r): PDO
    {
        return Db::connect(self::s($r));
    }

    private static function need(array $r, string $key): string
    {
        $v = (string)($r[$key] ?? '');
        if ($v === '') {
            throw new UserError("Paramètre « {$key} » manquant.");
        }
        return $v;
    }

    /** Première colonne de la première ligne (la requête est refermée, même en lecture en flux). */
    private static function scalar(PDO $pdo, string $sql): ?string
    {
        $st = $pdo->query($sql);
        $v = $st->fetchColumn();
        $st->closeCursor();
        return $v === false ? null : (string)$v;
    }

    /** Après un KILL QUERY : la connexion est-elle encore saine ? sinon on en rouvre une. */
    private static function reopen(string $server, PDO $pdo): PDO
    {
        try {
            $db = self::scalar($pdo, 'SELECT DATABASE()');
            return $pdo;
        } catch (Throwable) {
            $fresh = Db::connect($server, false, true);
            return $fresh;
        }
    }

    /**
     * Colonnes d'une table, prêtes pour l'interface.
     * @return list<array{name:string,type:string,null:bool,key:string,default:?string,extra:string,collation:?string,comment:string,binary:bool,generated:bool}>
     */
    private static function columns(PDO $pdo, string $db, string $table): array
    {
        $out = [];
        foreach ($pdo->query('SHOW FULL COLUMNS FROM ' . Db::qt($db, $table))->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $out[] = [
                'name' => $c['Field'], 'type' => $c['Type'], 'null' => $c['Null'] === 'YES', 'key' => $c['Key'],
                'default' => $c['Default'], 'extra' => $c['Extra'], 'collation' => $c['Collation'], 'comment' => $c['Comment'],
                'binary' => (bool)preg_match('/blob|binary/i', $c['Type']),
                'generated' => (bool)preg_match('/(VIRTUAL|STORED) GENERATED/i', $c['Extra']),
            ];
        }
        return $out;
    }

    /** Colonnes qui identifient une ligne : clé primaire, sinon premier index unique sans NULL. */
    private static function keyColumns(PDO $pdo, array $columns, string $db, string $table, bool $isView): array
    {
        $pk = array_values(array_column(array_filter($columns, static fn($c) => $c['key'] === 'PRI'), 'name'));
        if ($pk || $isView) {
            return $pk;
        }
        $nullable = array_column(array_filter($columns, static fn($c) => $c['null']), 'name');
        $groups = [];
        foreach ($pdo->query('SHOW INDEX FROM ' . Db::qt($db, $table))->fetchAll(PDO::FETCH_ASSOC) as $i) {
            if ((int)$i['Non_unique'] === 0) {
                $groups[$i['Key_name']][] = $i['Column_name'];
            }
        }
        foreach ($groups as $cols) {
            if (!array_intersect($cols, $nullable)) {
                return $cols;
            }
        }
        return [];
    }

    /** Valeur à écrire dans une colonne. BIT : entier brut (une chaîne '5' y serait lue comme le caractère « 5 »). */
    private static function writeValue(PDO $pdo, array $col, mixed $v): string
    {
        if ($v !== null && preg_match('/^bit\(/i', $col['type']) && preg_match('/^\d+$/', (string)$v)) {
            return (string)$v;
        }
        return Db::lit($pdo, $v);
    }

    /** Clause WHERE identifiant UNE ligne : « colonne = valeur » (IS NULL pour NULL). */
    private static function keyWhere(PDO $pdo, array $names, array $key): string
    {
        if (!$key) {
            throw new UserError("Impossible d'identifier la ligne (la table n'a pas de clé).");
        }
        $parts = [];
        foreach ($key as $c => $v) {
            if (!in_array($c, $names, true)) {
                throw new UserError("Colonne « {$c} » inconnue.");
            }
            $parts[] = Db::q($c) . ($v === null ? ' IS NULL' : ' = ' . Db::lit($pdo, $v));
        }
        return implode(' AND ', $parts);
    }

    /** Filtres par colonne (paramétrés) + fragment WHERE libre. */
    private static function where(PDO $pdo, array $names, array $filters, string $raw): string
    {
        $parts = [];
        foreach ($filters as $f) {
            $c = $f['col'] ?? '';
            if (!in_array($c, $names, true)) {
                continue;
            }
            $q = Db::q($c);
            $v = (string)($f['val'] ?? '');
            $like = static fn(string $pre, string $post): string => $pdo->quote($pre . addcslashes($v, '\\%_') . $post);
            $parts[] = match ($f['op'] ?? 'contains') {
                'contains' => "{$q} LIKE " . $like('%', '%'),
                'starts'   => "{$q} LIKE " . $like('', '%'),
                'eq'       => "{$q} = " . $pdo->quote($v),
                'ne'       => "{$q} <> " . $pdo->quote($v),
                'gt'       => "{$q} > " . $pdo->quote($v),
                'ge'       => "{$q} >= " . $pdo->quote($v),
                'lt'       => "{$q} < " . $pdo->quote($v),
                'le'       => "{$q} <= " . $pdo->quote($v),
                'regex'    => "{$q} REGEXP " . $pdo->quote($v),
                'null'     => "{$q} IS NULL",
                'notnull'  => "{$q} IS NOT NULL",
                default    => throw new UserError('Opérateur de filtre inconnu.'),
            };
        }
        if (trim($raw) !== '') {
            $parts[] = '(' . $raw . ')';
        }
        return $parts ? ' WHERE ' . implode(' AND ', $parts) : '';
    }

    /**
     * Valeur → JSON : NULL, texte, ou objet {t, n} (texte tronqué, n = taille réelle) / {b, n} (binaire :
     * aperçu hexadécimal des 32 premiers octets).
     */
    private static function cell(?string $v, bool $binaryColumn): mixed
    {
        if ($v === null) {
            return null;
        }
        $len = strlen($v);
        if ($v !== '' && ($binaryColumn || !mb_check_encoding($v, 'UTF-8'))) {
            return ['b' => strtoupper(bin2hex(substr($v, 0, 32))), 'n' => $len];
        }
        if ($len > 4096) {
            return ['t' => mb_strcut($v, 0, 4096, 'UTF-8'), 'n' => $len];
        }
        return $v;
    }
}
