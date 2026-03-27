@echo off
title Install Tailscale + cloudflared
echo Tailscale (private access) + cloudflared (optional quick tunnel)
echo Agar winget error de to in pages se manually install karo:
echo   https://tailscale.com/download
echo   https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
echo.
where winget >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo winget nahi mila — upar wale links se install karein.
  pause
  exit /b 1
)
winget install --id Tailscale.Tailscale -e --source winget --accept-package-agreements --accept-source-agreements
winget install --id Cloudflare.cloudflared -e --source winget --accept-package-agreements --accept-source-agreements
echo.
echo Ho gaya. Steps: REMOTE-ACCESS.txt
pause
