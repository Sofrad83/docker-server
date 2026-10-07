# docker-server — arrêt (Windows). Lancé par stop.cmd.
# Arrête les projets, les bases et le FTP, puis le socle. Rien n'est supprimé :
# start relance tout dans le même état.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host ""
Write-Host "  Arrêt de docker-server…" -ForegroundColor Magenta
$pidFile = Join-Path (Get-Location) 'data\hosts-agent.pid'
if (Test-Path $pidFile) {
  $agent = Get-Process -Id ([int](Get-Content $pidFile -Raw)) -ErrorAction SilentlyContinue
  if ($agent -and $agent.ProcessName -eq 'powershell') { Stop-Process -Id $agent.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}
$ids = docker ps -q --filter 'label=docker-server.kind'
if ($ids) { docker stop -t 10 $ids | Out-Null }
docker compose stop 2>&1 | Out-Null
Write-Host "  OK  Tout est arrêté. Vos fichiers et vos bases sont conservés." -ForegroundColor Green
Write-Host ""
Start-Sleep -Seconds 2
