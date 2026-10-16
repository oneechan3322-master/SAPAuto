@echo off
setlocal
pushd "%~dp0"
call pm2 status
set "RESULT=%ERRORLEVEL%"
popd
exit /b %RESULT%
