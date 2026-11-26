@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\manage.ps1" -Action uninstall %*
if errorlevel 1 pause
exit /b %errorlevel%
