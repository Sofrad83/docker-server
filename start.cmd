@echo off
rem ==========================================================================
rem  docker-server - demarrage. Double-cliquez sur ce fichier, c'est tout.
rem  (-ExecutionPolicy Bypass ne vaut que pour ce lancement : rien n'est
rem  modifie sur le poste, aucun droit administrateur n'est requis.)
rem ==========================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
if errorlevel 1 pause
