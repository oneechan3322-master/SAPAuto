@echo off
setlocal
pushd "%~dp0"
call pm2 start ecosystem.config.cjs
if errorlevel 1 (
  echo Could not start V8. Run INSTALL.bat first and check "pm2 status".
  popd
  exit /b 1
)
call pm2 save
popd
