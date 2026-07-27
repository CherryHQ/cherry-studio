@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pipx.ps1" %*
exit /b %errorlevel%
