<?php
declare(strict_types=1);

/**
 * Découpe un script SQL en instructions, SANS le charger en mémoire : on l'alimente par blocs
 * (feed) et il rend les instructions complètes au fur et à mesure. Reprend là où il s'est arrêté
 * quand une construction (chaîne, commentaire…) est coupée en deux par la limite d'un bloc.
 *
 * Gère : 'chaînes' "chaînes" `identifiants` (avec \échappements), commentaires  -- …  # …  / * … * /,
 * commentaires conditionnels de mysqldump (conservés tels quels : c'est le serveur qui les lit),
 * et la commande DELIMITER (routines, triggers).
 *
 * Chaque instruction rendue : ['sql' => texte, 'from' => offset, 'to' => offset] (octets, dans
 * l'ensemble du flux) — utile pour retrouver « l'instruction sous le curseur ».
 */
final class SqlSplitter
{
    private string $buf = '';
    private int $i = 0;           // position de lecture dans $buf
    private int $start = 0;       // début de l'instruction en cours dans $buf
    private int $base = 0;        // offset absolu de $buf[0]
    private string $mode = '';    // '' | ' | " | ` | line | block
    private string $delim = ';';
    private bool $atStart = true; // rien de significatif lu depuis le début de l'instruction
    private bool $eof = false;

    /** Découpe un texte complet. @return list<array{sql:string,from:int,to:int}> */
    public static function split(string $sql): array
    {
        $s = new self();
        return array_merge($s->feed($sql), $s->finish());
    }

    /** @return list<array{sql:string,from:int,to:int}> */
    public function feed(string $chunk): array
    {
        $this->buf .= $chunk;
        return $this->scan();
    }

    /** À appeler une fois le flux terminé : rend la dernière instruction (sans « ; » final). */
    public function finish(): array
    {
        $this->eof = true;
        $out = $this->scan();
        if ($this->mode === '' || $this->mode === 'line') {
            $this->emit($out, strlen($this->buf));
        } elseif (trim(substr($this->buf, $this->start)) !== '') {
            $this->emit($out, strlen($this->buf));   // chaîne / commentaire non refermé : on laisse le serveur juger
        }
        return $out;
    }

    private function scan(): array
    {
        $out = [];
        $buf = $this->buf;
        $n = strlen($buf);
        $i = $this->i;
        $d = $this->delim;
        $dl = strlen($d);
        $special = "'\"`#-/" . $d[0];

        while ($i < $n) {
            switch ($this->mode) {
                case "'":
                case '"':
                case '`':
                    $q = $this->mode;
                    $j = $i + strcspn($buf, $q === '`' ? '`' : $q . '\\', $i);
                    if ($j >= $n) {
                        $i = $n;
                        break 2;
                    }
                    if ($buf[$j] === '\\') {
                        if ($j + 1 >= $n) {
                            $i = $j;
                            break 2;
                        }
                        $i = $j + 2;
                        break;
                    }
                    $this->mode = '';      // « '' » (apostrophe doublée) = fin puis début de chaîne : sans incidence
                    $i = $j + 1;
                    break;

                case 'line':
                    $j = strpos($buf, "\n", $i);
                    if ($j === false) {
                        $i = $n;
                        break 2;
                    }
                    $this->mode = '';
                    $i = $j + 1;
                    break;

                case 'block':
                    $j = strpos($buf, '*/', $i);
                    if ($j === false) {
                        $i = max($i, $n - 1);
                        break 2;
                    }
                    $this->mode = '';
                    $i = $j + 2;
                    break;

                default:
                    if ($this->atStart) {
                        // En début d'instruction : on saute espaces et commentaires, et on reconnaît DELIMITER.
                        $j = $i + strspn($buf, " \t\r\n", $i);
                        if ($j >= $n) {
                            $i = $j;
                            break 2;
                        }
                        $skip = $this->leadingComment($buf, $j, $n);
                        if ($skip === false) {          // pas assez de données pour décider
                            $i = $j;
                            break 2;
                        }
                        if ($skip !== null) {           // commentaire de tête : on l'ignore
                            $i = $this->start = $skip;
                            break;
                        }
                        $m = $this->delimiterLine($buf, $j, $n);
                        if ($m === false) {
                            $i = $j;
                            break 2;
                        }
                        if ($m !== null) {
                            $this->delim = $d = $m[0];
                            $dl = strlen($d);
                            $special = "'\"`#-/" . $d[0];
                            $i = $this->start = $m[1];
                            break;
                        }
                        $i = $this->start = $j;
                        $this->atStart = false;
                    }

                    $j = $i + strcspn($buf, $special, $i);
                    if ($j >= $n) {
                        $i = $n;
                        break 2;
                    }
                    $c = $buf[$j];

                    if ($c === $d[0]) {
                        if ($j + $dl > $n && !$this->eof) {
                            $i = $j;
                            break 2;
                        }
                        if (substr($buf, $j, $dl) === $d) {
                            $this->emit($out, $j, $j + $dl);
                            $i = $this->start = $j + $dl;
                            $this->atStart = true;
                            break;
                        }
                    }
                    if ($c === "'" || $c === '"' || $c === '`') {
                        $this->mode = $c;
                        $i = $j + 1;
                    } elseif ($c === '#') {
                        $this->mode = 'line';
                        $i = $j + 1;
                    } elseif ($c === '-') {
                        $dash = $this->dashComment($buf, $j, $n);
                        if ($dash === false) {
                            $i = $j;
                            break 2;
                        }
                        if ($dash) {
                            $this->mode = 'line';
                        }
                        $i = $j + ($dash ? 2 : 1);
                    } elseif ($c === '/') {
                        if ($j + 1 >= $n && !$this->eof) {
                            $i = $j;
                            break 2;
                        }
                        if (($buf[$j + 1] ?? '') === '*') {
                            $this->mode = 'block';
                            $i = $j + 2;
                        } else {
                            $i = $j + 1;
                        }
                    } else {
                        $i = $j + 1;
                    }
            }
        }

        // Compactage : on ne garde que l'instruction en cours.
        $this->i = $i - $this->start;
        $this->base += $this->start;
        $this->buf = substr($buf, $this->start);
        $this->start = 0;
        return $out;
    }

    private function emit(array &$out, int $end, ?int $after = null): void
    {
        $raw = substr($this->buf, $this->start, $end - $this->start);
        $sql = trim($raw);
        if ($sql === '') {
            return;
        }
        $lead = strlen($raw) - strlen(ltrim($raw));
        $out[] = ['sql' => $sql, 'from' => $this->base + $this->start + $lead, 'to' => $this->base + ($after ?? $end)];
    }

    /** « -- » est un commentaire s'il est suivi d'un blanc. null = pas un commentaire, false = indécidable (bloc coupé). */
    private function dashComment(string $buf, int $j, int $n): bool|null
    {
        if ($j + 1 >= $n) {
            return $this->eof ? null : false;
        }
        if ($buf[$j + 1] !== '-') {
            return null;
        }
        if ($j + 2 >= $n) {
            return $this->eof ? true : false;
        }
        return strpbrk($buf[$j + 2], " \t\r\n") !== false ? true : null;
    }

    /**
     * Commentaire en tête d'instruction (les commentaires conditionnels « bloc + point d'exclamation »
     * sont du code, on n'y touche pas) : rend la position après lui, null s'il n'y en a pas,
     * false si la décision demande plus de données.
     */
    private function leadingComment(string $buf, int $j, int $n): int|false|null
    {
        $c = $buf[$j];
        if ($c === '#' || ($c === '-' && $this->dashComment($buf, $j, $n) === true)) {
            $e = strpos($buf, "\n", $j);
            if ($e === false) {
                return $this->eof ? $n : false;
            }
            return $e + 1;
        }
        if ($c === '-' && $this->dashComment($buf, $j, $n) === false) {
            return false;
        }
        if ($c === '/') {
            if ($j + 2 >= $n && !$this->eof) {
                return false;
            }
            if (($buf[$j + 1] ?? '') === '*' && ($buf[$j + 2] ?? '') !== '!') {
                $e = strpos($buf, '*/', $j + 2);
                if ($e === false) {
                    return $this->eof ? $n : false;
                }
                return $e + 2;
            }
        }
        return null;
    }

    /** Ligne « DELIMITER xx » : rend [nouveau délimiteur, position après la ligne], null si ce n'en est pas une, false si la ligne est coupée. */
    private function delimiterLine(string $buf, int $j, int $n): array|false|null
    {
        if (strncasecmp(substr($buf, $j, 9), 'DELIMITER', 9) !== 0) {
            return $j + 9 > $n && !$this->eof && strncasecmp(substr($buf, $j), 'DELIMITER', $n - $j) === 0 ? false : null;
        }
        if (!preg_match('/\GDELIMITER[ \t]+(\S+)[ \t]*(\r?\n|$)/Ai', $buf, $m, 0, $j)) {
            return $j + 9 >= $n && !$this->eof ? false : null;
        }
        if ($m[2] === '' && !$this->eof) {
            return false;                       // ligne pas encore terminée
        }
        return [$m[1], $j + strlen($m[0])];
    }
}
