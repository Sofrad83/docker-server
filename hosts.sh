#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  docker-server — met à jour /etc/hosts avec les adresses personnalisées des
#  projets (celles qui ne finissent pas par .localhost) et « ds-dashboard ».
#  Seul le bloc docker-server est réécrit. Lancé par start.sh ; à relancer
#  (./hosts.sh) après avoir ajouté une adresse personnalisée. Demande sudo.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

port=$(grep -E '^\s*HTTP_PORT\s*=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]' || true)
entries=$(curl -fs "http://127.0.0.1:${port:-80}/api/hosts?format=text") \
  || { echo "  XX  Tableau de bord injoignable : lancez d'abord ./start.sh"; exit 1; }

HOSTS=/etc/hosts
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
awk '/^# >>> docker-server/{skip=1} !skip{print} /^# <<< docker-server/{skip=0}' "$HOSTS" > "$tmp"
if [ -n "$entries" ]; then
  {
    echo "# >>> docker-server (bloc gere automatiquement, ne pas modifier)"
    for e in $entries; do echo "127.0.0.1  $e"; done
    echo "# <<< docker-server"
  } >> "$tmp"
fi

if cmp -s "$tmp" "$HOSTS"; then
  echo "  OK  Fichier hosts à jour"
  exit 0
fi
echo "  ..  Mise à jour de $HOSTS (mot de passe administrateur demandé)…"
sudo tee "$HOSTS" < "$tmp" >/dev/null
if [ "$(uname)" = "Darwin" ]; then sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder 2>/dev/null || true; fi
echo "  OK  Fichier hosts à jour"
