#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
#  docker-server — outil exécuté DANS un container MySQL / MariaDB par
#  import-mysql.ps1 (copié dans /tmp, puis supprimé). Mot de passe : MYSQL_PWD.
#
#    ping           version du serveur
#    list           bases utilisateur : nom, nombre de tables, taille (octets)
#    dump           /tmp/ds-import/data.sql  (bases, données, vues, procédures…)
#                   /tmp/ds-import/users.sql (comptes et droits, hors root)
#    import FICHIER importe un fichier SQL (arrêt à la première erreur)
#    import-force   idem, mais continue malgré les erreurs (comptes)
#    clean          supprime /tmp/ds-import
# ─────────────────────────────────────────────────────────────────────────────
set -e
if command -v mariadb >/dev/null 2>&1; then C=mariadb; D=mariadb-dump; else C=mysql; D=mysqldump; fi
SYS="'mysql','information_schema','performance_schema','sys'"
q() { $C -uroot -N -B --raw -e "$1"; }

case "$1" in
  ping)
    q 'SELECT VERSION()'
    ;;
  list)
    q "SELECT s.schema_name, COUNT(t.table_name), COALESCE(SUM(t.data_length + t.index_length), 0)
       FROM information_schema.schemata s
       LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name
       WHERE s.schema_name NOT IN ($SYS)
       GROUP BY s.schema_name ORDER BY s.schema_name"
    ;;
  dump)
    rm -rf /tmp/ds-import
    mkdir -p /tmp/ds-import
    DBS=$(q "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ($SYS)")
    OPTS="--single-transaction --quick --routines --events --triggers --add-drop-database --default-character-set=utf8mb4 --max-allowed-packet=512M"
    # MySQL avec GTID : ne pas exporter l'état GTID (refusé à l'import sur un autre serveur).
    if $D --help 2>/dev/null | grep -q 'set-gtid-purged'; then OPTS="$OPTS --set-gtid-purged=OFF"; fi
    # shellcheck disable=SC2086
    [ -n "$DBS" ] && $D -uroot $OPTS --databases $DBS > /tmp/ds-import/data.sql
    # Comptes et droits (sauf root et comptes système). Facultatif : jamais bloquant.
    (
      q "SELECT CONCAT('''', user, '''@''', host, '''') FROM mysql.user
         WHERE user NOT IN ('root', '', 'mysql.sys', 'mysql.session', 'mysql.infoschema', 'mariadb.sys')" |
      while read -r u; do
        echo "DROP USER IF EXISTS $u;"
        echo "$(q "SHOW CREATE USER $u");"
        q "SHOW GRANTS FOR $u" | sed 's/$/;/'
      done
    ) > /tmp/ds-import/users.sql 2>/dev/null || true
    ;;
  import)
    $C -uroot --max-allowed-packet=512M < "$2"
    ;;
  import-force)
    $C -uroot --max-allowed-packet=512M --force < "$2"
    ;;
  clean)
    rm -rf /tmp/ds-import
    ;;
  *)
    echo "usage : $0 ping|list|dump|import FICHIER|import-force FICHIER|clean" >&2
    exit 2
    ;;
esac
