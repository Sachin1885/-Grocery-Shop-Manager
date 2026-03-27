@echo off
cd /d "%~dp0"
echo Pehle dusri window me server chalao: npm.cmd start
echo.
where cloudflared >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo cloudflared nahi mila. Run: install-remote-tools.bat
  echo Ya: winget install Cloudflare.cloudflared
  pause
  exit /b 1
)
echo Tunnel start... phone me jo https URL dikhe wahi kholo.
echo.
cloudflared tunnel --url http://127.0.0.1:4000
pause
