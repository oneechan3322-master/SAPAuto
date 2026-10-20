@echo off
setlocal
set "ROOT=%~dp0"
pushd "%ROOT%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or later is required.
  popd
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
  echo Node.js 24 or later is required.
  popd
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  node -e "const fs=require('fs'),p='.env';let s=fs.readFileSync(p,'utf8');s=s.replace(/^V8_SESSION_SECRET=.*$/m,'V8_SESSION_SECRET='+require('crypto').randomBytes(32).toString('hex'));fs.writeFileSync(p,s)"
  if errorlevel 1 (
    echo Could not create the local environment file.
    popd
    exit /b 1
  )
  echo Created .env with a generated session secret. Add authorized portal credentials before enabling scans.
)

echo Installing V8 services...
call npm ci
if errorlevel 1 goto failed
pushd launcher
call npm ci
if errorlevel 1 goto failed
for /f "tokens=1,* delims==" %%A in ('findstr /b "V8_SESSION_SECRET=" "%ROOT%.env"') do set "V8_SESSION_SECRET=%%B"
set "V8_ROOT=%ROOT%"
call npm run build
if errorlevel 1 goto failed
popd

echo Installing browser automation for the V8-native scraper...
call npx playwright install chromium
if errorlevel 1 goto failed

call npm run db:migrate
if errorlevel 1 goto failed
where pm2 >nul 2>nul
if errorlevel 1 call npm install --global pm2
if errorlevel 1 goto failed
if not exist "%ROOT%..\pet\models\gemma-4-E2B-it-Q4_0.gguf" (
  echo Existing local Gemma 4 model was not found at "%ROOT%..\pet\models".
  echo Configure V8_LOCAL_MODEL_HOME and AI_PROVIDER in .env before using local AI.
)
where uv >nul 2>nul
if errorlevel 1 echo uv was not found. Install uv or configure V8_UV_BIN before starting the local Gemma service.
call pm2 start ecosystem.config.cjs
if errorlevel 1 goto failed
call pm2 save
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SAPAutoV8.bat"
> "%STARTUP%" echo @echo off
>>"%STARTUP%" echo pushd "%ROOT%"
>>"%STARTUP%" echo call pm2 resurrect
>>"%STARTUP%" echo popd
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
netsh advfirewall firewall delete rule name="SAPAuto V8 Launcher" >nul
echo.
echo V8 services are running in local read-only mode. Open http://localhost:3000 on this PC.
echo The current Windows user's Startup folder will restore saved PM2 processes at logon.
echo See README.md for local operation and backup guidance.
popd
exit /b 0

:failed
echo Installation failed. Review the error above; existing .env was not overwritten.
popd
exit /b 1
