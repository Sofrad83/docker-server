# docker-server — fonctions communes pour le fichier hosts (chargées par start, hosts et hosts-agent).
$HostsFile = Join-Path $env:windir 'System32\drivers\etc\hosts'

# Noms déclarés vers 127.0.0.1 / ::1 dans le fichier hosts.
function Get-HostsNames {
  $known = @{}
  foreach ($line in [IO.File]::ReadAllLines($HostsFile)) {
    $l = ($line -split '#', 2)[0].Trim()
    if (-not $l) { continue }
    $parts = @($l -split '\s+')
    if ($parts.Count -lt 2 -or ($parts[0] -ne '127.0.0.1' -and $parts[0] -ne '::1')) { continue }
    foreach ($n in $parts[1..($parts.Count - 1)]) { $known[$n.ToLower()] = $true }
  }
  return $known
}

# Adresses attendues par le tableau de bord (tout ce qui ne finit pas par .localhost).
function Get-WantedHosts([int]$Port) {
  $st = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/hosts" -TimeoutSec 5
  return @($st.entries)
}

function Get-HttpPort([string]$Root) {
  $envFile = Join-Path $Root '.env'
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match '^\s*HTTP_PORT\s*=\s*(\d+)') { return [int]$Matches[1] }
    }
  }
  return 80
}
