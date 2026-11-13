@echo off
cd /d "%~dp0"
node --env-file-if-exists=data/admin.env start-admin.cjs
if errorlevel 1 pause
