@echo off
setlocal
pushd "%~dp0"
call pm2 stop sapauto-v8-harness sapauto-v8-channels sapauto-v8-launcher
set "RESULT=%ERRORLEVEL%"
popd
exit /b %RESULT%
