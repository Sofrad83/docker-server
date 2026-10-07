# ─────────────────────────────────────────────────────────────────────────────
#  docker-server — met à jour le fichier hosts de Windows avec les adresses
#  personnalisées des projets (tout ce qui ne finit pas par .localhost) et
#  « ds-dashboard ». Seul le bloc docker-server est réécrit, le reste du fichier
#  n'est pas touché. Demande les droits administrateur (confirmation Windows).
#
#  Lancé automatiquement par l'agent (scripts\hosts-agent.ps1), ou à la main :
#  double-clic sur hosts.cmd.
# ─────────────────────────────────────────────────────────────────────────────
param([int]$Port = 0, [switch]$Quiet)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'hosts-lib.ps1')
if (-not $Port) { $Port = Get-HttpPort $Root }

function Say($m, $c = 'Gray') { if (-not $Quiet) { Write-Host "  $m" -ForegroundColor $c } }

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Say 'Windows va demander l''autorisation de modifier le fichier hosts : répondez « Oui ».' DarkGray
  try {
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Port', $Port, '-Quiet')
    $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList $argList
    if ($p.ExitCode -eq 0) { Say 'OK  Fichier hosts à jour.' Green } else { Say '!!  Le fichier hosts n''a pas pu être mis à jour.' Yellow }
    if (-not $Quiet) { Start-Sleep -Seconds 2 }
    exit $p.ExitCode
  } catch {
    Say '!!  Modification refusée : le fichier hosts n''a pas été changé.' Yellow
    if (-not $Quiet) { Start-Sleep -Seconds 3 }
    exit 2
  }
}

# ── Droits administrateur : réécriture du bloc ──────────────────────────────
try {
  $names = Get-WantedHosts $Port
} catch {
  Say "XX  Tableau de bord injoignable sur le port $Port : lancez d'abord start." Red
  exit 1
}

$begin = '# >>> docker-server (bloc gere automatiquement, ne pas modifier)'
$end = '# <<< docker-server'
$enc = [Text.Encoding]::Default
$text = [IO.File]::ReadAllText($HostsFile, $enc)
$text = [regex]::Replace($text, '(?ms)^# >>> docker-server.*?^# <<< docker-server[^\r\n]*\r?\n?', '')
$text = $text.TrimEnd("`r", "`n") + "`r`n"
if ($names.Count) {
  $lines = $names | ForEach-Object { "127.0.0.1  $_" }
  $text += "`r`n$begin`r`n" + ($lines -join "`r`n") + "`r`n$end`r`n"
}
[IO.File]::WriteAllText($HostsFile, $text, $enc)
ipconfig /flushdns | Out-Null
exit 0
