#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  docker-server — démarrage (macOS / Linux) : ./start.sh
#  Vérifie Docker, choisit des ports libres, démarre les containers,
#  installe le certificat HTTPS local (macOS), ouvre le tableau de bord.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
NO_BROWSER=0; [ "${1:-}" = "--no-browser" ] && NO_BROWSER=1
cd "$(dirname "$0")"
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env"

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_dim=$'\e[90m'; c_acc=$'\e[35m'; c_off=$'\e[0m'
step() { echo "  ${c_dim}..  $*${c_off}"; }
ok()   { echo "  ${c_ok}OK${c_off}  $*"; }
warn() { echo "  ${c_warn}!!  $*${c_off}"; }
fail() { echo; echo "  ${c_err}XX  $*${c_off}"; echo; exit 1; }

get_env() { # clé défaut
  local v=""
  [ -f "$ENV_FILE" ] && v=$(grep -E "^\s*$1\s*=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '[:space:]' || true)
  echo "${v:-$2}"
}
set_env() { # clé valeur
  touch "$ENV_FILE"
  if grep -qE "^\s*$1\s*=" "$ENV_FILE"; then
    sed -i.bak -E "s|^\s*$1\s*=.*|$1=$2|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "$1=$2" >> "$ENV_FILE"
  fi
}
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

echo
echo "  ${c_acc}docker-server${c_off}  ${c_dim}— serveur de développement local${c_off}"
echo

# ── 1. Docker ───────────────────────────────────────────────────────────────
command -v docker >/dev/null || fail "Docker n'est pas installé : https://www.docker.com/products/docker-desktop/ (ou Docker Engine sous Linux)."
if ! docker info >/dev/null 2>&1; then
  if [ "$(uname)" = "Darwin" ]; then
    step "Démarrage de Docker Desktop…"
    open -a Docker || true
    for _ in $(seq 1 90); do docker info >/dev/null 2>&1 && break; sleep 2; done
  fi
  docker info >/dev/null 2>&1 || fail "Docker ne répond pas. Démarrez Docker puis relancez ./start.sh (sous Linux : votre utilisateur doit être dans le groupe docker)."
fi
ok "Docker est prêt"

# ── 2. Ports ────────────────────────────────────────────────────────────────
if [ "$(docker ps --filter 'name=^ds-proxy$' --format '{{.Names}}')" != "ds-proxy" ]; then
  for spec in "HTTP_PORT 80 8080" "HTTPS_PORT 443 8443" "FTP_PORT 21 2121"; do
    set -- $spec
    port=$(get_env "$1" "$2")
    if port_busy "$port"; then
      alt=$3
      while port_busy "$alt"; do alt=$((alt + 1)); done
      set_env "$1" "$alt"
      warn "Le port $port est déjà utilisé : docker-server prend le port $alt."
    fi
  done
fi
HTTP_PORT=$(get_env HTTP_PORT 80)
HTTPS_PORT=$(get_env HTTPS_PORT 443)
URL="http://localhost"; [ "$HTTP_PORT" != "80" ] && URL="http://localhost:$HTTP_PORT"
ok "Ports : HTTP $HTTP_PORT, HTTPS $HTTPS_PORT"

# ── 3. Containers ───────────────────────────────────────────────────────────
step "Démarrage des containers (le premier lancement télécharge quelques images)…"
docker compose up -d || fail "Le démarrage a échoué. En cas de « rate limit » Docker Hub : docker login, ou réessayez dans une heure."
for _ in $(seq 1 60); do
  curl -fs "http://127.0.0.1:$HTTP_PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fs "http://127.0.0.1:$HTTP_PORT/api/health" >/dev/null 2>&1 || fail "Le tableau de bord ne répond pas sur $URL. Consultez : docker logs ds-dashboard"
ok "Tableau de bord en ligne : $URL"

# ── 4. Certificat HTTPS ─────────────────────────────────────────────────────
CRT="${TMPDIR:-/tmp}/docker-server-ca.crt"
for _ in $(seq 1 20); do
  docker cp ds-proxy:/data/caddy/pki/authorities/local/root.crt "$CRT" >/dev/null 2>&1 && break
  sleep 1
done
if [ -f "$CRT" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    if security verify-cert -c "$CRT" >/dev/null 2>&1; then
      ok "Certificat HTTPS local déjà installé"
    else
      step "Installation du certificat HTTPS local (macOS peut demander votre mot de passe)…"
      security add-trusted-cert -r trustRoot -k "$HOME/Library/Keychains/login.keychain-db" "$CRT" \
        && ok "Certificat HTTPS installé" \
        || warn "Certificat non installé : voir Réglages › HTTPS dans le tableau de bord."
    fi
  else
    warn "Linux : pour un HTTPS sans avertissement, voir Réglages › HTTPS dans le tableau de bord."
  fi
fi

# ── 5. Adresses personnalisées (fichier hosts) ──────────────────────────────
bash ./hosts.sh || warn "Fichier hosts non mis à jour : relancez ./hosts.sh plus tard."
SHORT="http://ds-dashboard"; [ "$HTTP_PORT" != "80" ] && SHORT="http://ds-dashboard:$HTTP_PORT"

# ── 6. C'est parti ──────────────────────────────────────────────────────────
echo
echo "  ${c_ok}Tout est prêt.${c_off}"
echo "  Tableau de bord : $URL  (ou $SHORT)"
echo "  Vos projets     : $ROOT/repo"
echo
if [ "$NO_BROWSER" = 0 ]; then
  if command -v open >/dev/null; then open "$URL"; elif command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1 || true; fi
fi
