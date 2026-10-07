# ─────────────────────────────────────────────────────────────────────────────
#  docker-server — copie TOUTES les bases d'un autre container MySQL / MariaDB
#  (ancien environnement Docker, autre stack…) vers un serveur de docker-server :
#  tables, données, vues, procédures, déclencheurs, événements, comptes et droits.
#
#  Lancé par import-mysql.cmd. La source n'est jamais modifiée ; si elle était
#  arrêtée, elle est démarrée le temps de la copie puis arrêtée à nouveau.
#  Une copie du fichier SQL est gardée dans data\backups\.
#
#  Options : -Source <container>  -Target <container docker-server>  -Yes (sans questions)
# ─────────────────────────────────────────────────────────────────────────────
param([string]$Source, [string]$Target, [switch]$Yes)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Root = Split-Path -Parent $PSScriptRoot
$Tool = Join-Path $PSScriptRoot 'mysql-tool.sh'
# Root sans mot de passe ; « root » pour un serveur pas encore converti (ancienne version).
$TargetPasswords = @('', 'root')
$TargetPassword = ''

function Step($m) { Write-Host "  ..  $m" -ForegroundColor DarkGray }
function Ok($m)   { Write-Host "  OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  !!  $m" -ForegroundColor Yellow }
function Fail($m) { Cleanup; Write-Host ""; Write-Host "  XX  $m" -ForegroundColor Red; Write-Host ""; exit 1 }

function Ask($question) {
  if ($Yes) { return $true }
  $r = Read-Host "  $question [O/n]"
  return ($r -eq '' -or $r -match '^[oOyY]')
}

function Choose($title, $items) {
  Write-Host "  $title" -ForegroundColor White
  for ($i = 0; $i -lt $items.Count; $i++) { Write-Host ("    {0}. {1}" -f ($i + 1), $items[$i].Label) }
  if ($Yes) { return $items[0] }
  while ($true) {
    $r = Read-Host '  Numéro'
    if ($r -match '^\d+$' -and [int]$r -ge 1 -and [int]$r -le $items.Count) { return $items[[int]$r - 1] }
  }
}

# Commande dans un container, avec le mot de passe root en variable d'environnement.
function InContainer([string]$Container, [string]$Password, [string[]]$Arguments) {
  $out = & docker exec -e "MYSQL_PWD=$Password" $Container sh /tmp/ds-mysql-tool.sh @Arguments 2>&1 | ForEach-Object { "$_" }
  return [pscustomobject]@{ Code = $LASTEXITCODE; Out = @($out) }
}

function Size([double]$n) {
  if ($n -ge 1GB) { return '{0:N1} Go' -f ($n / 1GB) }
  if ($n -ge 1MB) { return '{0:N1} Mo' -f ($n / 1MB) }
  if ($n -ge 1KB) { return '{0:N0} Ko' -f ($n / 1KB) }
  return "$n o"
}

function Version($v) {
  if ("$v" -match '^(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2])" }
  return [version]'0.0'
}

$script:startedSource = $null
$script:unpaused = @()
function Cleanup {
  foreach ($c in @($script:src, $script:tgt)) {
    if ($c) { & docker exec $c rm -rf /tmp/ds-mysql-tool.sh /tmp/ds-import *> $null }
  }
  if ($script:startedSource) {
    Step "Arrêt de $($script:startedSource), comme avant la copie"
    & docker stop $script:startedSource *> $null
  }
  foreach ($c in $script:unpaused) {
    Step "Remise en pause de $c, comme avant la copie"
    & docker pause $c *> $null
  }
  $script:unpaused = @()
  $script:startedSource = $null
}

# Un container en pause ne répond pas : on le reprend le temps de la copie.
function Resume($name, $state) {
  if ($state -ne 'paused') { return }
  if (-not (Ask "Le container « $name » est en pause. Le reprendre le temps de la copie ?")) { Fail 'Annulé.' }
  & docker unpause $name *> $null
  if ($LASTEXITCODE -ne 0) { Fail "Impossible de reprendre $name." }
  $script:unpaused += $name
}

Write-Host ""
Write-Host "  docker-server" -ForegroundColor Magenta -NoNewline
Write-Host "  — copie de bases MySQL vers docker-server" -ForegroundColor DarkGray
Write-Host ""

# ── 1. Destination : un serveur MySQL de docker-server ─────────────────────
& docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail 'Docker ne répond pas. Lancez Docker Desktop puis recommencez.' }

$targets = @(& docker ps -a --filter 'label=docker-server.kind=mysql' --format '{{.Names}}|{{.Image}}|{{.State}}' | ForEach-Object {
  $n, $img, $state = "$_".Split('|')
  [pscustomobject]@{ Name = $n; Image = $img; State = $state; Label = "$n  ($img)" }
})
if (-not $targets.Count) { Fail 'Aucun serveur MySQL docker-server. Lancez d''abord start.cmd.' }
if ($Target) {
  $t = $targets | Where-Object { $_.Name -eq $Target }
  if (-not $t) { Fail "Le serveur « $Target » n'existe pas dans docker-server." }
} elseif ($targets.Count -eq 1) {
  $t = $targets[0]
} else {
  $t = Choose 'Vers quel serveur de docker-server ?' ($targets | Sort-Object { $_.Name -ne 'ds-mysql' })
}
$script:tgt = $t.Name
Resume $t.Name $t.State
if ($t.State -notin @('running', 'paused')) { Fail "Le serveur $($t.Name) est arrêté : démarrez-le depuis le tableau de bord (Bases de données)." }

# ── 2. Source : un autre container MySQL / MariaDB ─────────────────────────
$sources = @(& docker ps -a --format '{{.Names}}|{{.Image}}|{{.State}}' | ForEach-Object {
  $n, $img, $state = "$_".Split('|')
  if ($n -notmatch '^ds-' -and $img -match '(^|/)(mysql|mariadb|percona)(-server)?(:|@|$)') {
    $etat = @{ running = 'démarré'; paused = 'en pause' }[$state]
    if (-not $etat) { $etat = 'arrêté' }
    [pscustomobject]@{ Name = $n; Image = $img; State = $state; Label = "$n  ($img, $etat)" }
  }
})
if ($Source) {
  $s = $sources | Where-Object { $_.Name -eq $Source }
  if (-not $s) {
    $state = & docker inspect --format '{{.State.Status}}' $Source 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "Container « $Source » introuvable." }
    $s = [pscustomobject]@{ Name = $Source; Image = '?'; State = "$state"; Label = $Source }
  }
} elseif (-not $sources.Count) {
  Fail 'Aucun autre container MySQL / MariaDB trouvé sur cette machine.'
} elseif ($sources.Count -eq 1) {
  $s = $sources[0]
  if (-not (Ask "Copier depuis le container « $($s.Name) » ($($s.Image)) ?")) { Fail 'Annulé.' }
} else {
  $s = Choose 'Depuis quel container ?' $sources
}
$script:src = $s.Name

Resume $s.Name $s.State
if ($s.State -notin @('running', 'paused')) {
  Step "Démarrage de $($s.Name) le temps de la copie…"
  & docker start $s.Name *> $null
  if ($LASTEXITCODE -ne 0) { Fail "Impossible de démarrer $($s.Name) (port déjà utilisé ?)." }
  $script:startedSource = $s.Name
}

& docker cp $Tool "$($s.Name):/tmp/ds-mysql-tool.sh" *> $null
if ($LASTEXITCODE -ne 0) { Fail "Impossible de copier l'outil dans $($s.Name)." }
& docker cp $Tool "$($t.Name):/tmp/ds-mysql-tool.sh" *> $null

# ── 3. Connexion à la source (mot de passe détecté automatiquement) ─────────
$envLines = @(& docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $s.Name)
$candidates = @('')
foreach ($l in $envLines) {
  if ($l -match '^(MYSQL_ROOT_PASSWORD|MARIADB_ROOT_PASSWORD)=(.*)$' -and $Matches[2]) { $candidates = @($Matches[2]) + $candidates }
}
$srcPassword = $null
$srcVersion = $null
$deadline = (Get-Date).AddSeconds($(if ($script:startedSource) { 90 } else { 5 }))
do {
  foreach ($pw in $candidates) {
    $r = InContainer $s.Name $pw @('ping')
    if ($r.Code -eq 0) { $srcPassword = $pw; $srcVersion = $r.Out[-1]; break }
  }
  if ($null -ne $srcPassword) { break }
  # Serveur encore en démarrage, ou mot de passe refusé : on distingue les deux.
  if ($r.Out -match 'Access denied') { break }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

if ($null -eq $srcPassword) {
  if (-not ($r.Out -match 'Access denied')) { Fail "Le serveur MySQL de $($s.Name) ne répond pas : $($r.Out -join ' ')" }
  if ($Yes) { Fail 'Mot de passe root de la source inconnu.' }
  $secure = Read-Host "  Mot de passe root de $($s.Name)" -AsSecureString
  $srcPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  $r = InContainer $s.Name $srcPassword @('ping')
  if ($r.Code -ne 0) { Fail 'Mot de passe refusé.' }
  $srcVersion = $r.Out[-1]
}

foreach ($pw in $TargetPasswords) {
  $r = InContainer $t.Name $pw @('ping')
  if ($r.Code -eq 0) { $TargetPassword = $pw; break }
}
if ($r.Code -ne 0) { Fail "Le serveur $($t.Name) ne répond pas : $($r.Out -join ' ')" }
$tgtVersion = $r.Out[-1]
Ok "Source      : $($s.Name) — $srcVersion"
Ok "Destination : $($t.Name) — $tgtVersion"
if (($srcVersion -match 'MariaDB') -eq ($tgtVersion -match 'MariaDB') -and (Version $srcVersion) -gt (Version $tgtVersion)) {
  Warn "La source est plus récente que la destination : certaines bases peuvent être refusées (classements utf8mb4_0900…)."
  Warn 'Au besoin, changez la version du serveur dans le tableau de bord (Bases de données) puis relancez.'
  if (-not (Ask 'Continuer quand même ?')) { Fail 'Annulé.' }
}

# ── 4. Ce qui va être copié ─────────────────────────────────────────────────
$r = InContainer $s.Name $srcPassword @('list')
if ($r.Code -ne 0) { Fail "Lecture des bases impossible : $($r.Out -join ' ')" }
$dbs = @($r.Out | Where-Object { $_ -match "`t" } | ForEach-Object {
  $n, $tables, $size = $_.Split("`t")
  [pscustomobject]@{ Name = $n; Tables = [int]$tables; Size = [double]$size }
})
if (-not $dbs.Count) { Cleanup; Ok "Aucune base à copier dans $($s.Name)."; exit 0 }

$existing = @((InContainer $t.Name $TargetPassword @('list')).Out | ForEach-Object { "$_".Split("`t")[0] })
Write-Host ""
Write-Host ("  {0} base(s), {1} au total :" -f $dbs.Count, (Size ($dbs | Measure-Object Size -Sum).Sum)) -ForegroundColor White
foreach ($d in $dbs) {
  $note = if ($existing -contains $d.Name) { '  ← existe déjà, sera remplacée' } else { '' }
  Write-Host ("    {0,-32} {1,5} tables  {2,10}{3}" -f $d.Name, $d.Tables, (Size $d.Size), $note)
}
Write-Host ""
$conflicts = @($dbs | Where-Object { $existing -contains $_.Name })
if ($conflicts.Count) { Warn "$($conflicts.Count) base(s) existent déjà dans $($t.Name) : leur contenu actuel sera remplacé par celui de la source." }
if (-not (Ask "Copier ces bases de $($s.Name) vers $($t.Name) ?")) { Fail 'Annulé : rien n''a été modifié.' }

# ── 5. Export → data\backups → import ──────────────────────────────────────
Step 'Export depuis la source (quelques minutes pour de grosses bases)…'
$r = InContainer $s.Name $srcPassword @('dump')
if ($r.Code -ne 0) { Fail "Export impossible : $($r.Out -join ' ')" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$folder = "import-$($s.Name)-$stamp"
$dest = Join-Path $Root "data\backups\$folder"
& docker cp "$($s.Name):/tmp/ds-import/." $dest *> $null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $dest 'data.sql'))) { Fail 'Récupération de l''export impossible.' }
Ok ("Export terminé : data\backups\$folder ({0})" -f (Size (Get-Item (Join-Path $dest 'data.sql')).Length))

Step "Import dans $($t.Name)…"
$r = InContainer $t.Name $TargetPassword @('import', "/backups/$folder/data.sql")
if ($r.Code -ne 0) { Fail "Import interrompu : $($r.Out -join ' ')`n      L'export reste disponible dans data\backups\$folder." }
Ok 'Bases importées'

$users = Join-Path $dest 'users.sql'
if ((Test-Path $users) -and (Get-Item $users).Length -gt 0) {
  $r = InContainer $t.Name $TargetPassword @('import-force', "/backups/$folder/users.sql")
  $n = @(Select-String -Path $users -Pattern '^DROP USER').Count
  if ($r.Code -eq 0) { Ok "$n compte(s) MySQL copiés avec leurs droits" }
  else { Warn "Comptes MySQL copiés en partie : $(($r.Out | Select-Object -First 2) -join ' ')" }
}

# ── 6. Vérification ─────────────────────────────────────────────────────────
$after = @{}
(InContainer $t.Name $TargetPassword @('list')).Out | Where-Object { $_ -match "`t" } | ForEach-Object {
  $cols = $_.Split("`t"); $after[$cols[0]] = [int]$cols[1]
}
$bad = 0
Write-Host ""
foreach ($d in $dbs) {
  if ($after.ContainsKey($d.Name) -and $after[$d.Name] -eq $d.Tables) {
    Write-Host ("  OK  {0,-32} {1,5} tables" -f $d.Name, $d.Tables) -ForegroundColor Green
  } else {
    $bad++
    Write-Host ("  !!  {0,-32} {1} tables attendues, {2} trouvées" -f $d.Name, $d.Tables, $after[$d.Name]) -ForegroundColor Yellow
  }
}

Cleanup
Write-Host ""
if ($bad) { Warn "$bad base(s) à vérifier." } else { Write-Host '  Copie terminée.' -ForegroundColor Green }
Write-Host "  Dans vos projets : hôte « $(if ($t.Name -eq 'ds-mysql') { 'mysql' } else { $t.Name -replace '^ds-db-', '' }) », utilisateur « root », sans mot de passe." -ForegroundColor White
Write-Host "  Copie de sécurité : data\backups\$folder (supprimable)." -ForegroundColor DarkGray
Write-Host ""
