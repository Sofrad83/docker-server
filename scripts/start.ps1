# ─────────────────────────────────────────────────────────────────────────────
#  docker-server — démarrage (Windows). Lancé par start.cmd.
#  1. vérifie Docker (et lance Docker Desktop si besoin)
#  2. choisit des ports libres
#  3. démarre les containers
#  4. installe le certificat HTTPS local (magasin de l'utilisateur, sans droits admin)
#  5. ouvre le tableau de bord
# ─────────────────────────────────────────────────────────────────────────────
param([switch]$NoBrowser, [switch]$NoCert)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$EnvFile = Join-Path $Root '.env'

function Step($m) { Write-Host "  ..  $m" -ForegroundColor DarkGray }
function Ok($m)   { Write-Host "  OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  !!  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host ""; Write-Host "  XX  $m" -ForegroundColor Red; Write-Host ""; exit 1 }

function Get-EnvValue($Key, $Default) {
  if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile) {
      if ($line -match "^\s*$Key\s*=\s*(.*?)\s*$") { if ($Matches[1]) { return $Matches[1] } }
    }
  }
  return $Default
}

function Set-EnvValue($Key, $Value) {
  $lines = @()
  if (Test-Path $EnvFile) { $lines = @(Get-Content $EnvFile) }
  $found = $false
  $lines = $lines | ForEach-Object { if ($_ -match "^\s*$Key\s*=") { $found = $true; "$Key=$Value" } else { $_ } }
  if (-not $found) { $lines = @($lines) + "$Key=$Value" }
  Set-Content -Path $EnvFile -Value $lines -Encoding ASCII
}

function Test-PortFree([int]$Port) {
  foreach ($ip in @([Net.IPAddress]::Loopback, [Net.IPAddress]::Any)) {
    try {
      $l = New-Object Net.Sockets.TcpListener($ip, $Port)
      $l.ExclusiveAddressUse = $true
      $l.Start(); $l.Stop()
    } catch { return $false }
  }
  return $true
}

Write-Host ""
Write-Host "  docker-server" -ForegroundColor Magenta -NoNewline
Write-Host "  — serveur de développement local" -ForegroundColor DarkGray
Write-Host ""

# ── 1. Docker ───────────────────────────────────────────────────────────────
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Docker n'est pas installé. Installez Docker Desktop (gratuit) : https://www.docker.com/products/docker-desktop/ puis relancez start."
}
$ErrorActionPreference = 'Continue'
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $desktop) {
    Step 'Démarrage de Docker Desktop (jusqu''à 2 minutes la première fois)…'
    Start-Process $desktop
    for ($i = 0; $i -lt 90; $i++) {
      Start-Sleep -Seconds 2
      docker info *> $null
      if ($LASTEXITCODE -eq 0) { break }
    }
  }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'Docker ne répond pas. Ouvrez Docker Desktop, attendez qu''il soit prêt, puis relancez start.' }
}
$ErrorActionPreference = 'Stop'
Ok 'Docker est prêt'

# ── 2. Ports ────────────────────────────────────────────────────────────────
$proxyRunning = (docker ps --filter 'name=^ds-proxy$' --format '{{.Names}}') -eq 'ds-proxy'
if (-not $proxyRunning) {
  foreach ($p in @(@('HTTP_PORT', 80, 8080), @('HTTPS_PORT', 443, 8443), @('FTP_PORT', 21, 2121))) {
    $port = [int](Get-EnvValue $p[0] $p[1])
    if (-not (Test-PortFree $port)) {
      $alt = [int]$p[2]
      while (-not (Test-PortFree $alt)) { $alt++ }
      Set-EnvValue $p[0] $alt
      Warn "Le port $port est déjà utilisé sur ce poste : docker-server prend le port $alt."
    }
  }
}
$HttpPort = [int](Get-EnvValue 'HTTP_PORT' 80)
$HttpsPort = [int](Get-EnvValue 'HTTPS_PORT' 443)
$Url = if ($HttpPort -eq 80) { 'http://localhost' } else { "http://localhost:$HttpPort" }
# Contrôle de santé en IPv4 : « localhost » peut d'abord tenter ::1 et attendre.
$Health = "http://127.0.0.1:$HttpPort/api/health"
Ok "Ports : HTTP $HttpPort, HTTPS $HttpsPort"

# ── 3. Containers ───────────────────────────────────────────────────────────
Step 'Démarrage des containers (le premier lancement télécharge quelques images)…'
$ErrorActionPreference = 'Continue'
docker compose up -d 2>&1 | ForEach-Object { if ("$_" -match 'error|denied|rate limit') { Write-Host "      $_" -ForegroundColor Red } }
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($code -ne 0) {
  Fail "Le démarrage a échoué (voir ci-dessus). Si le message parle de « rate limit », connectez-vous à Docker Hub (docker login) ou réessayez dans une heure."
}

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -Uri $Health -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
  Start-Sleep -Seconds 1
}
if (-not $ready) { Fail "Le tableau de bord ne répond pas sur $Url. Consultez : docker logs ds-dashboard" }
Ok "Tableau de bord en ligne : $Url"

# ── 4. Certificat HTTPS ─────────────────────────────────────────────────────
if (-not $NoCert) {
  $crt = Join-Path $env:TEMP 'docker-server-ca.crt'
  $got = $false
  for ($i = 0; $i -lt 20 -and -not $got; $i++) {
    $ErrorActionPreference = 'Continue'
    docker cp ds-proxy:/data/caddy/pki/authorities/local/root.crt $crt *> $null
    $got = ($LASTEXITCODE -eq 0) -and (Test-Path $crt)
    $ErrorActionPreference = 'Stop'
    if (-not $got) { Start-Sleep -Seconds 1 }
  }
  if ($got) {
    $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2($crt)
    $known = Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
    if ($known) {
      Ok 'Certificat HTTPS local déjà installé'
    } else {
      Step 'Installation du certificat HTTPS local : Windows va demander confirmation, répondez « Oui ».'
      try {
        Import-Certificate -FilePath $crt -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
        Ok 'Certificat HTTPS installé (redémarrez le navigateur s''il était ouvert)'
      } catch {
        Warn 'Certificat non installé : les sites https:// afficheront un avertissement. Réessayez plus tard depuis Réglages › HTTPS.'
      }
    }
  } else {
    Warn 'Certificat HTTPS pas encore disponible : relancez start dans un instant, ou voyez Réglages › HTTPS.'
  }
}

# ── 5. Adresses personnalisées (fichier hosts) ──────────────────────────────
# Un agent discret tient le fichier hosts à jour : il demande confirmation à
# Windows dès qu'une adresse comme « ds-dashboard » ou « mon-site.test » manque.
. (Join-Path $PSScriptRoot 'hosts-lib.ps1')
$pidFile = Join-Path $Root 'data\hosts-agent.pid'
if (Test-Path $pidFile) {
  $old = Get-Process -Id ([int](Get-Content $pidFile -Raw)) -ErrorAction SilentlyContinue
  if ($old -and $old.ProcessName -eq 'powershell') { Stop-Process -Id $old.Id -Force -ErrorAction SilentlyContinue }
}
$agentArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$(Join-Path $PSScriptRoot 'hosts-agent.ps1')`"", '-Port', $HttpPort)
$agent = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList $agentArgs
Set-Content -Path $pidFile -Value $agent.Id -Encoding ASCII
try {
  $known = Get-HostsNames
  $missing = @(Get-WantedHosts $HttpPort | Where-Object { -not $known.ContainsKey($_) })
  if ($missing.Count) { Step "Windows va demander l'autorisation d'ajouter $($missing -join ', ') au fichier hosts : répondez « Oui »." }
  else { Ok 'Fichier hosts à jour' }
} catch { }
$Short = if ($HttpPort -eq 80) { 'http://ds-dashboard' } else { "http://ds-dashboard:$HttpPort" }

# ── 6. C'est parti ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Tout est prêt." -ForegroundColor Green
Write-Host "  Tableau de bord : $Url  (ou $Short)" -ForegroundColor White
Write-Host "  Vos projets     : $(Join-Path $Root 'repo')" -ForegroundColor White
Write-Host ""
if (-not $NoBrowser) { Start-Process $Url }
Start-Sleep -Seconds 6
