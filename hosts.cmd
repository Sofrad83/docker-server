@echo off
rem ==========================================================================
rem  docker-server - met a jour le fichier hosts avec les adresses
rem  personnalisees des projets (celles qui ne finissent pas par .localhost).
rem  Normalement inutile : start.cmd lance un agent qui le fait tout seul.
rem  Windows demande une confirmation (droits administrateur).
rem ==========================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\hosts.ps1" %*
if errorlevel 1 pause
