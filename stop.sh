#!/usr/bin/env bash
# docker-server — arrêt (macOS / Linux) : ./stop.sh
# Arrête projets, bases, FTP puis le socle. Rien n'est supprimé : ./start.sh relance tout.
cd "$(dirname "$0")"
echo "  Arrêt de docker-server…"
ids=$(docker ps -q --filter 'label=docker-server.kind')
[ -n "$ids" ] && docker stop -t 10 $ids >/dev/null
docker compose stop >/dev/null 2>&1
echo "  OK  Tout est arrêté. Vos fichiers et vos bases sont conservés."
