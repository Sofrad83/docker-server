# ─────────────────────────────────────────────────────────────────────────────
#  docker-server — agent du fichier hosts. Lancé en arrière-plan par start.cmd,
#  arrêté par stop.cmd.
#
#  Toutes les 3 secondes : si une adresse personnalisée manque dans le fichier
#  hosts (projet créé ou modifié dans le tableau de bord), il demande à Windows
#  l'autorisation de l'ajouter — une seule confirmation « Oui ». En cas de refus,
#  il ne redemande pas tant que le tableau de bord ne le sollicite pas
#  (bouton « Réessayer »). Il signale au tableau de bord ce qui est en place.
# ─────────────────────────────────────────────────────────────────────────────
param([int]$Port = 80)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'hosts-lib.ps1')
$api = "http://127.0.0.1:$Port/api/hosts"
$declined = $null
$lastRetry = -1
$failures = 0

while ($true) {
  try {
    $st = Invoke-RestMethod -Uri $api -TimeoutSec 3
    $failures = 0
    $wanted = @($st.entries)
    $known = Get-HostsNames
    $missing = @($wanted | Where-Object { -not $known.ContainsKey($_) })

    if ($st.retry -ne $lastRetry) { $lastRetry = $st.retry; $declined = $null }
    if ($missing.Count -gt 0) {
      $key = $missing -join ','
      if ($key -ne $declined) {
        & (Join-Path $PSScriptRoot 'hosts.ps1') -Port $Port -Quiet
        if ($LASTEXITCODE -ne 0) { $declined = $key }
        $known = Get-HostsNames
      }
    }

    $present = @($wanted | Where-Object { $known.ContainsKey($_) })
    $body = @{ present = $present } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri "$api/report" -Headers @{ 'X-DS' = '1' } -ContentType 'application/json' -Body $body -TimeoutSec 3 | Out-Null
  } catch {
    # Tableau de bord arrêté : on attend, puis on abandonne au bout de ~20 minutes.
    $failures++
    if ($failures -gt 400) { break }
  }
  Start-Sleep -Seconds 3
}
