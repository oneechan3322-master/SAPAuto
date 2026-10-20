@echo off
chcp 65001 >nul
title SapAuto V8 - Server Controller

echo ===================================================
echo             SapAuto V8 - Server Controller         
echo ===================================================
echo.

cd /d "c:\Users\Mega Store\Downloads\SapAuto\v8"

echo Checking and starting all SapAuto V8 services...
call npx pm2 start ecosystem.config.cjs 2>nul
call npx pm2 save >nul 2>&1

echo.
echo All services are active:
call npx pm2 list

echo.
echo ---------------------------------------------------
echo Access links:
echo   - From this PC:        http://localhost:3000
echo   - From Local Network:  http://192.168.1.111:3000
echo   - From Radmin VPN:     http://26.182.57.137:3000
echo ---------------------------------------------------
echo.
pause
