@echo off
title Grocery Shop — Firewall port 4000
echo.
echo Is file par RIGHT-CLICK karein — "Run as administrator" chunein.
echo (Bina admin ke Windows phone se port 4000 block kar sakta hai.)
echo.
pause
netsh advfirewall firewall delete rule name="Grocery Shop Manager TCP 4000" >nul 2>&1
netsh advfirewall firewall add rule name="Grocery Shop Manager TCP 4000" dir=in action=allow protocol=TCP localport=4000 profile=any
if %ERRORLEVEL% neq 0 (
  echo.
  echo Rule add nahi hui — pakka "Run as administrator" se chalaya?
  pause
  exit /b 1
)
echo.
echo Done: port 4000 ab LAN se allow hai. Phone se dubara URL try karein.
pause
