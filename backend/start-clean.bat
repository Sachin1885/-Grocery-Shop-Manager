@echo off
cd /d "%~dp0"
node scripts\free-port.js
node server.js
pause
