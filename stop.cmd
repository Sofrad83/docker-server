@echo off
rem docker-server - arret de tous les containers (les donnees sont conservees).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" %*
if errorlevel 1 pause
