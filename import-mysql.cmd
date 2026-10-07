@echo off
rem ==========================================================================
rem  docker-server - copie toutes les bases (donnees, vues, procedures,
rem  comptes) d'un autre container MySQL / MariaDB vers docker-server.
rem  Exemple : les bases d'un ancien environnement Docker.
rem  La source n'est jamais modifiee.
rem ==========================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\import-mysql.ps1" %*
echo.
pause
