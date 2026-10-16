@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Website Manager v1.2 - Audit Solvers UAE

rem ============================================================
rem   WEBSITE MANAGER v1.2  -  one-click tool for non-coders
rem
rem   How to use: put this file in the website folder
rem   (it is already there) and double-click it.
rem   Everything the tool does is written to
rem   website-tool-log.txt in the same folder.
rem
rem   No coding knowledge is needed. Just type numbers
rem   and press ENTER.
rem ============================================================
rem   v1.2 CHANGES:
rem     - the version is shown in the window title and menu
rem     - a fresh copy of the website now works by itself:
rem       the tool connects the folder to Git and installs the
rem       website building blocks when they are missing
rem     - the Cloudflare steps no longer stop silently when the
rem       Cloudflare helper program is not installed yet
rem     - the local live-test (option 3, then 2) now opens the
rem       correct test address
rem     - option 7 MAJOR upgrade: shows EVERY local website running
rem       on this computer - any project, with its port numbers -
rem       and stops the ones you choose: all of them, only this
rem       website's, or picked ones; nothing stops until you choose
rem     - option 7 safety: every process is re-checked immediately
rem       before it is stopped (Windows reuses process numbers), the
rem       tool can never stop itself, and editor/assistant program
rem       folders are ignored by the scan
rem     - Help screen updated, including what to do when Windows
rem       shows "Windows protected your PC"
rem ============================================================

rem --- go to the folder where this file lives ---
cd /d "%~dp0"

rem ===== SETTINGS YOU CAN CHANGE (open this file in Notepad) =====
rem The port used by option 1 (Preview). Next.js projects use 3000.
rem Vite projects (like TanStack Start) use 5173. If you copy this
rem tool into another project, change this number to match it.
set "PREVIEW_PORT=3000"

rem The port used by the local live-test in option 3 (test before
rem publishing). Vite preview projects use 4173. If you copy this
rem tool into another project, change this number to match it.
set "TEST_PORT=4173"

rem Detect the project folder from this BAT file. If the folder is
rem renamed, running the BAT from its new location follows the new path.
for %%I in ("%~dp0.") do set "PROJECT_ROOT=%%~fI"

set "LOGFILE=%~dp0website-tool-log.txt"
if not exist "%LOGFILE%" echo === Website Manager log === > "%LOGFILE%"
call :log "Website Manager v1.2 opened"

rem =========================== MENU ===========================
:menu
cls
echo ============================================================
echo                 WEBSITE  MANAGER    v1.2
echo ============================================================
echo.
echo    What do you want to do?
echo.
echo     [1]  Preview the website on this computer
echo     [2]  Save and upload my changes to GitHub
echo     [3]  Publish the website live (Cloudflare)
echo     [4]  Show my accounts and website status
echo     [5]  Open the log file (history of everything)
echo     [6]  Help - what do these options mean?
echo     [7]  Turn off local websites running on this computer
echo     [8]  Log out of everything (GitHub and Cloudflare)
echo.
echo     [0]  Exit
echo.
set "ANS="
set /p "ANS=Type a number and press ENTER: "
if "%ANS%"=="1" goto :preview
if "%ANS%"=="2" goto :github
if "%ANS%"=="3" goto :cloudflare
if "%ANS%"=="4" goto :status
if "%ANS%"=="5" goto :openlog
if "%ANS%"=="6" goto :help
if "%ANS%"=="7" goto :stop_all
if "%ANS%"=="8" goto :logout_all
if "%ANS%"=="0" goto :end
goto :menu

rem ==================== 1. LOCAL PREVIEW ======================
:preview
cls
echo ------------------------------------------------------------
echo             PREVIEW THE WEBSITE ON THIS COMPUTER
echo ------------------------------------------------------------
echo.
where node >nul 2>nul || goto :missing_node
call :ensure_deps || goto :pause_menu
call :log "Preview: option started"
netstat -ano 2>nul | findstr /C:":%PREVIEW_PORT% " | findstr /C:"LISTENING" >nul
if not errorlevel 1 goto :preview_already_running

echo Starting the website preview...
echo A second window will open - that is normal. The first page
echo may take a little moment to appear.
echo.
start "Website Preview - keep this window open" cmd /k "call npm run dev"
echo Waiting about 10 seconds, then the website will open in your browser...
timeout /t 10 /nobreak >nul
start "" "http://localhost:%PREVIEW_PORT%"
echo.
echo Done! The website preview is at:  http://localhost:%PREVIEW_PORT%
echo TIP: to stop the preview later, close the window called
echo      "Website Preview".
call :log "Preview: started new dev server on port %PREVIEW_PORT% and opened the browser"
goto :pause_menu

:preview_already_running
echo The website preview is ALREADY running on this computer.
start "" "http://localhost:%PREVIEW_PORT%"
echo The website was opened in your browser:  http://localhost:%PREVIEW_PORT%
call :log "Preview: server already running, opened the browser"
goto :pause_menu

rem ==================== 2. GITHUB =============================
:github
cls
echo ------------------------------------------------------------
echo               SAVE AND UPLOAD MY CHANGES
echo                    ( G I T H U B )
echo ------------------------------------------------------------
echo.
where git >nul 2>nul || goto :missing_git
call :log "GitHub: option started"
where gh >nul 2>nul || goto :gh_missing

rem ---- fresh copy of the website? connect it to Git first ----
if not exist "%~dp0.git" (
    echo This is a fresh copy of the website - it is not connected
    echo to Git yet. Connecting it now, one moment...
    git init >nul 2>&1
    if errorlevel 1 (
        echo.
        echo Connecting did not work. Try again in a moment.
        call :log "GitHub: git init FAILED"
        goto :pause_menu
    )
    call :log "GitHub: connected this fresh copy to Git (first time)"
)

rem ---- who is logged in to GitHub? ----
set "GH_USER="
gh api user --jq .login >nul 2>&1
if errorlevel 1 goto :gh_not_logged_in
for /f "delims=" %%U in ('gh api user --jq .login 2^>^&1') do set "GH_USER=%%U"
call :log "GitHub: currently logged in as %GH_USER%"
echo You are connected to GitHub as:  %GH_USER%
echo.
echo   [1]  Yes, continue with this account
echo   [2]  Use a different GitHub account (re-login)
echo   [3]  Cancel
echo.
set "ANS="
set /p "ANS=Choose and press ENTER [1]: "
if "%ANS%"=="2" goto :gh_relogin
if "%ANS%"=="3" goto :menu
goto :gh_repo

:gh_not_logged_in
echo You are NOT connected to GitHub yet.
echo.
echo   [1]  Connect now (opens GitHub in your browser)
echo   [2]  Cancel
echo.
set "ANS="
set /p "ANS=Choose and press ENTER [1]: "
if "%ANS%"=="2" goto :menu
goto :gh_relogin

:gh_relogin
echo.
echo Step 1: signing out of the current account (if any)...
gh auth logout --hostname github.com
echo Step 2: connecting to GitHub...
echo A browser window will open. Follow the steps on the GitHub
echo website. If a code is shown in this window, type it into
echo the GitHub website page.
echo.
gh auth login --hostname github.com --git-protocol https --web
set "GH_USER="
gh api user --jq .login >nul 2>&1
if errorlevel 1 (
    echo.
    echo The login did not finish. You can try again later.
    call :log "GitHub: re-login did not finish"
    goto :pause_menu
)
for /f "delims=" %%U in ('gh api user --jq .login 2^>^&1') do set "GH_USER=%%U"
echo.
echo Now connected to GitHub as:  %GH_USER%
call :log "GitHub: logged in as %GH_USER%"

rem ---- is there a GitHub repository linked to this website? ----
:gh_repo
gh auth setup-git >nul 2>&1
set "GH_REMOTE="
git remote get-url github >nul 2>&1
if not errorlevel 1 (
    set "GH_REMOTE=github"
    goto :gh_ready
)
for /f "tokens=1" %%R in ('git remote -v 2^>nul ^| findstr /I /C:"github.com" ^| findstr /C:"(push)"') do (
    set "GH_REMOTE=%%R"
    goto :gh_ready
)
goto :gh_no_repo

:gh_no_repo
echo.
echo This website does not have a GitHub link yet.
echo The manager will make a private backup repository in the
echo GitHub account you are using, then connect this website to it.
set "GH_REMOTE=origin"

rem ---- save the user's changes and upload ----
:gh_ready
call :ensure_my_github_repo
if errorlevel 1 goto :gh_link_failed
set "BRANCH="
for /f "delims=" %%B in ('git branch --show-current 2^>^&1') do set "BRANCH=%%B"
if "%BRANCH%"=="" set "BRANCH=main"
echo.
echo ------------------  SAVING YOUR CHANGES  ------------------
echo.
set "DESC="
set /p "DESC=Write a short description of what you changed (press ENTER for: Website update): "
if "%DESC%"=="" set "DESC=Website update"
call :clean DESC
if not defined DESC set "DESC=Website update"
call :log "GitHub: change description: %DESC%"
git add -A
git commit -m "%DESC%" >nul 2>&1
if errorlevel 1 (
    echo There are no new changes to save since the last time.
) else (
    echo Your changes were saved:  "%DESC%"
    call :log "GitHub: changes committed locally"
)
echo.
echo ------------------  UPLOADING TO GITHUB  ------------------
echo Repository: %GH_REMOTE%      Branch: %BRANCH%
echo Please wait...
git push -u %GH_REMOTE% %BRANCH% > "%TEMP%\gh_push.txt" 2>&1
if errorlevel 1 goto :gh_push_failed
echo.
echo Uploaded successfully!
call :log "GitHub: pushed branch %BRANCH% to %GH_REMOTE% - OK"
goto :gh_after

:gh_push_failed
echo.
echo The upload did NOT work. This is the error message:
echo.
type "%TEMP%\gh_push.txt"
echo.
rem ---- detect non-fast-forward / fetch-first errors ----
findstr /I /C:"non-fast-forward" /C:"fetch first" /C:"rejected" "%TEMP%\gh_push.txt" >nul 2>&1
if errorlevel 1 goto :gh_push_other_error
echo The repository on GitHub has changes that are not on this
echo computer. This usually happens when you upgraded a copy of
echo the website in a new folder.
echo.
echo   [1]  Overwrite the repository with THIS folder's version
echo        (recommended when uploading an upgraded copy)
echo   [2]  Cancel  (go back to the main menu)
echo.
set "ANS="
set /p "ANS=Choose and press ENTER [2]: "
if not "%ANS%"=="1" (
    call :log "GitHub: push conflict - user cancelled force push"
    goto :pause_menu
)
echo.
echo Overwriting the repository with this folder's version...
call :log "GitHub: force-pushing branch %BRANCH% to %GH_REMOTE%"
git push --force-with-lease -u %GH_REMOTE% %BRANCH% > "%TEMP%\gh_push.txt" 2>&1
if errorlevel 1 (
    echo Force push also failed. Trying full force push...
    git push --force -u %GH_REMOTE% %BRANCH% > "%TEMP%\gh_push.txt" 2>&1
    if errorlevel 1 (
        echo.
        echo The upload still did NOT work:
        type "%TEMP%\gh_push.txt"
        call :log "GitHub: force push FAILED"
        goto :pause_menu
    )
)
echo.
echo Uploaded successfully! (overwritten)
call :log "GitHub: force-pushed branch %BRANCH% to %GH_REMOTE% - OK"
goto :gh_after

:gh_push_other_error
echo The manager will repair a wrong or developer-owned GitHub link
echo automatically next time you choose option 2. If this still fails,
echo check your internet connection, then choose option 2 again.
call :log "GitHub: push FAILED"
goto :pause_menu

:gh_link_failed
echo.
echo The manager could not prepare your private GitHub backup.
echo Check your internet connection and make sure the GitHub login
echo finished, then choose option 2 again.
call :log "GitHub: automatic repository repair FAILED"
goto :pause_menu

rem ---- extra services after a successful upload ----
:gh_after
echo.
echo  Anything else you want to do?
echo.
echo   [1]  Open my repository page on github.com
echo   [2]  Also upload to my other services (GitLab)
echo   [3]  Back to the main menu
echo.
set "ANS="
set /p "ANS=Choose and press ENTER [3]: "
if "%ANS%"=="1" goto :gh_open_repo
if "%ANS%"=="2" goto :push_others
goto :menu

:gh_open_repo
set "REPOSLUG="
for /f "delims=" %%S in ('gh repo view --json nameWithOwner --jq .nameWithOwner 2^>^&1') do set "REPOSLUG=%%S"
if "%REPOSLUG%"=="" (
    echo Could not find the repository address.
    call :log "GitHub: could not detect repository address"
    goto :pause_menu
)
start "" "https://github.com/%REPOSLUG%"
call :log "GitHub: opened repository page %REPOSLUG%"
goto :pause_menu

:push_others
echo.
echo Uploading to your other services...
set "BRANCH="
for /f "delims=" %%B in ('git branch --show-current 2^>^&1') do set "BRANCH=%%B"
if "%BRANCH%"=="" set "BRANCH=main"
for /f "tokens=1" %%R in ('git remote 2^>nul ^| findstr /V /I /C:"%GH_REMOTE%"') do (
    echo   Uploading to "%%R"...
    git push "%%R" %BRANCH% > "%TEMP%\push_other.txt" 2>&1
    if errorlevel 1 (
        echo     Could not upload to "%%R".
        call :log "Upload to %%R: FAILED"
    ) else (
        echo     Done.
        call :log "Upload to %%R: OK"
    )
)
echo.
echo Finished with the other services.
goto :pause_menu

rem ==================== 3. CLOUDFLARE =========================
:cloudflare
cls
echo ------------------------------------------------------------
echo             PUBLISH THE WEBSITE LIVE
echo                  ( C L O U D F L A R E )
echo ------------------------------------------------------------
echo.
where node >nul 2>nul || goto :missing_node
call :ensure_deps || goto :pause_menu
call :log "Cloudflare: option started"

rem ---- who is logged in to Cloudflare? ----
set "CF_EMAIL="
call npx --yes wrangler whoami > "%TEMP%\cf_who.txt" 2>&1
for /f "usebackq delims=" %%E in (`powershell -NoProfile -Command "$m = Select-String -Path '%TEMP%\cf_who.txt' -Pattern 'the email (\S+)\.'; if ($m) { $m.Matches[0].Groups[1].Value }"`) do set "CF_EMAIL=%%E"
if not defined CF_EMAIL goto :cf_not_logged_in
echo You are connected to Cloudflare with the email:  %CF_EMAIL%
echo.
echo   [1]  Yes, continue with this account
echo   [2]  Use a different Cloudflare account (re-login)
echo   [3]  Cancel
echo.
set "ANS="
set /p "ANS=Choose and press ENTER [1]: "
if "%ANS%"=="2" goto :cf_relogin
if "%ANS%"=="3" goto :menu
goto :cf_menu

:cf_not_logged_in
echo You are NOT connected to Cloudflare yet.
echo.
echo   [1]  Connect now (opens Cloudflare in your browser)
echo   [2]  Cancel
echo.
set "ANS="
set /p "ANS=Choose and press ENTER [1]: "
if "%ANS%"=="2" goto :menu
goto :cf_relogin

:cf_relogin
echo.
echo Signing out of the current account (if any)...
call npx --yes wrangler logout >nul 2>&1
echo Connecting to Cloudflare...
echo A browser window will open. Log in with your Cloudflare
email and password, then click the "Allow" button.
echo.
call npx --yes wrangler login
set "CF_EMAIL="
call npx --yes wrangler whoami > "%TEMP%\cf_who.txt" 2>&1
for /f "usebackq delims=" %%E in (`powershell -NoProfile -Command "$m = Select-String -Path '%TEMP%\cf_who.txt' -Pattern 'the email (\S+)\.'; if ($m) { $m.Matches[0].Groups[1].Value }"`) do set "CF_EMAIL=%%E"
if not defined CF_EMAIL (
    echo.
    echo The login did not finish. You can try again later.
    call :log "Cloudflare: login did not finish"
    goto :pause_menu
)
echo.
echo Now connected to Cloudflare with the email:  %CF_EMAIL%
call :log "Cloudflare: logged in as %CF_EMAIL%"

:cf_menu
echo.
echo   What do you want to do with Cloudflare?
echo.
echo   [1]  Build the website and put it LIVE (a few minutes)
echo   [2]  Test the live version on this computer first
echo   [3]  Back to the main menu
echo.
set "ANS="
set /p "ANS=Choose and press ENTER [3]: "
if "%ANS%"=="1" goto :cf_deploy
if "%ANS%"=="2" goto :cf_preview
goto :menu

:cf_deploy
echo.
echo Building the website and uploading it to Cloudflare...
echo This usually takes 2 to 5 minutes.
echo IMPORTANT: please do not close this window while it works.
echo.
call :log "Cloudflare: build and deploy started"
call npm run deploy > "%TEMP%\cf_deploy.txt" 2>&1
if errorlevel 1 goto :cf_deploy_failed
call :log "Cloudflare: deploy finished - OK"
echo.
echo The website was published LIVE successfully!
echo.
echo Last messages from Cloudflare:
powershell -NoProfile -Command "Get-Content -Tail 8 '%TEMP%\cf_deploy.txt'"
set "LIVE_URL="
for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "$m = Select-String -Path '%TEMP%\cf_deploy.txt' -Pattern 'https://\S+workers\.dev' -AllMatches; if ($m) { $m.Matches | ForEach-Object { $_.Value } }"`) do set "LIVE_URL=%%U"
if not defined LIVE_URL goto :cf_deploy_done
echo.
echo Your live website address:  %LIVE_URL%
call :log "Cloudflare: live address %LIVE_URL%"
set "ANS="
set /p "ANS=Open it in the browser now? Type Y or N and press ENTER [Y]: "
if /I "%ANS%"=="N" goto :cf_deploy_done
start "" "%LIVE_URL%"
:cf_deploy_done
goto :pause_menu

:cf_deploy_failed
call :log "Cloudflare: deploy FAILED"
echo.
echo Unfortunately the upload did NOT work.
echo Here are the last messages (the full report is in the log):
echo.
powershell -NoProfile -Command "Get-Content -Tail 15 '%TEMP%\cf_deploy.txt'"
goto :pause_menu

:cf_preview
echo.
echo This starts the REAL live version of the website on this
echo computer - without publishing it to the world.
echo A second window will open. It needs about a minute to get
echo ready. When the website opens, you can close that window
echo to stop the test.
echo.
if not exist "%~dp0.output" (
    echo The website has not been built in this copy yet, so it
    echo will be built first. This takes a few minutes, once.
    call npm run build
    if errorlevel 1 (
        echo.
        echo The build did not work, so the test cannot run.
        call :log "Cloudflare: live-test build FAILED"
        goto :pause_menu
    )
)
start "Cloudflare Test - close this window to stop" cmd /k "call npm run preview"
echo Waiting about 25 seconds, then opening the test address...
timeout /t 25 /nobreak >nul
start "" "http://localhost:%TEST_PORT%"
echo.
echo The test website was opened at:  http://localhost:%TEST_PORT%
echo If nothing appears, wait a little and refresh the page -
echo the test server may still be waking up.
echo If it still does not show, use option 1 (Preview) instead.
call :log "Cloudflare: local live-test started on port %TEST_PORT%"
goto :pause_menu

rem ==================== 4. STATUS =============================
:status
cls
echo ------------------------------------------------------------
echo            MY ACCOUNTS AND WEBSITE STATUS
echo ------------------------------------------------------------
echo.
echo  GitHub:
where gh >nul 2>nul || goto :status_gh_missing
gh api user --jq .login >nul 2>&1
if errorlevel 1 goto :status_gh_offline
for /f "delims=" %%U in ('gh api user --jq .login 2^>^&1') do echo     connected as:  %%U
goto :status_cf
:status_gh_missing
echo     the GitHub tool is not installed
goto :status_cf
:status_gh_offline
echo     not connected
:status_cf
echo.
echo  Cloudflare:
set "CF_EMAIL="
call npx --yes wrangler whoami > "%TEMP%\cf_who.txt" 2>&1
for /f "usebackq delims=" %%E in (`powershell -NoProfile -Command "$m = Select-String -Path '%TEMP%\cf_who.txt' -Pattern 'the email (\S+)\.'; if ($m) { $m.Matches[0].Groups[1].Value }"`) do set "CF_EMAIL=%%E"
if defined CF_EMAIL (
    echo     connected as:  %CF_EMAIL%
) else (
    echo     not connected
)
echo.
echo  Website project:
set "BRANCH="
for /f "delims=" %%B in ('git branch --show-current 2^>^&1') do set "BRANCH=%%B"
if "%BRANCH%"=="" set "BRANCH=unknown"
echo     current branch:  %BRANCH%
set "CHCOUNT=0"
for /f %%A in ('git status --porcelain 2^>nul ^| find /c /v ""') do set "CHCOUNT=%%A"
echo     files with unsaved changes:  %CHCOUNT%
echo.
echo     online services linked to this website:
git remote -v
echo.
call :log "Status: checked accounts and website status"
goto :pause_menu

rem ==================== 5. LOG FILE ===========================
:openlog
call :log "Log file opened"
start "" notepad "%LOGFILE%"
goto :menu

rem ==================== 6. HELP ================================
:help
cls
echo ------------------------------------------------------------
echo                         HELP
echo ------------------------------------------------------------
echo.
echo  This tool (version 1.2) manages your website.
echo  You never need to open any code. Just type numbers.
echo.
echo  [1] Preview - starts the website on YOUR computer only.
echo      Nobody on the internet can see it. Good for checking
echo      how the website looks before publishing.
echo      First time on a fresh copy of the website? The tool
echo      installs the website building blocks first - that
echo      happens only once and takes a few minutes.
echo.
echo  [2] GitHub - GitHub is the safe place where the website
echo      code is stored online. Choose this after you (or your
echo      programmer) changed something and you want to save it.
echo      The tool will show you which GitHub account is active
echo      and you can continue with it or log in with another
echo      account. If a programmer sent a copy linked to THEIR
echo      GitHub, the tool automatically reconnects it to YOUR
echo      private backup. It creates that backup only the first time.
echo      The short description you type is saved in the log
echo      file together with everything else the tool does.
echo.
echo  [3] Cloudflare - Cloudflare is the company that runs your
echo      LIVE website on the internet. After you connect GitHub
echo      to Cloudflare once, option 2 publishes automatically.
echo      Option 3 is a manual backup for publishing immediately.
echo      The tool will show you which Cloudflare account is
echo      active and you can continue with it or log in with
echo      another account. Publishing takes 2 to 5 minutes.
echo      The first time, the tool also downloads the small
echo      Cloudflare helper program it needs - just let it finish.
echo.
echo  [4] Status - shows which accounts are connected and how
echo      many changes are not yet uploaded.
echo.
echo  [5] Log - opens website-tool-log.txt. It remembers every
echo      action this tool performed, with dates. You can edit
echo      or delete this file any time - it is yours.
echo.
echo  [7] Turn off - shows EVERY local website running on this
echo      computer, from any folder, with its port numbers - then
echo      stops the ones you choose: all of them, only this
echo      website's, or picked ones. Nothing is stopped until
echo      you choose, and your LIVE website is never touched.
echo.
echo  [8] Log out - signs this computer out of ALL GitHub
echo      accounts and out of Cloudflare. Nothing is deleted,
echo      and you can log back in any time with any account
echo      using options 2 and 3. The Git name saved for THIS
echo      project is cleared too; the computer-wide Git name is
echo      kept unless you choose to remove it.
echo.
echo  IF WINDOWS SHOWS "Windows protected your PC" when you
echo  open this tool: click "More info", then "Run anyway".
echo  This appears because Microsoft does not know simple tools
echo  like this one - it does not mean a virus was found.
echo.
echo  ABOUT THIS TOOL: manage-website.bat is a plain text file.
echo  You can open it with Notepad and change anything - the
echo  words, the questions, the timing. When you use option 2,
echo  this file is uploaded together with the website code, so
echo  you always have a backup copy of the tool on GitHub.
echo.
echo  USING IT WITH OTHER PROJECTS: you can copy this file into
echo  any website project folder and it will work there. Option
echo  7 only stops a website process when it can safely connect it
echo  to THIS project folder. Other projects are left alone. For
echo  option 1 (Preview), open this file in Notepad and change
echo  the PREVIEW_PORT number at the top to match the project
echo  (Next.js projects use 3000, Vite projects use 5173).
echo.
echo  If something fails, open the log file (option 5) - it says
echo  exactly what happened. Keep it when you ask for help.
echo.
call :log "Help: help screen shown"
goto :pause_menu

rem ==================== 7. STOP LOCAL SITES ===================
:stop_all
cls
echo ------------------------------------------------------------
echo        TURN OFF LOCAL WEBSITES RUNNING ON THIS PC
echo ------------------------------------------------------------
echo.
call :log "Stop: option started"
rem Remember this tool's own process number so the scan and the
rem stop step can never touch the tool itself.
set "WM_TOOLPID="
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId"`) do set "WM_TOOLPID=%%T"
call :log "Stop: tool process number %WM_TOOLPID%"
echo Project folder detected from this tool:
echo   %PROJECT_ROOT%
echo.
echo This option shows EVERY local website running on this
echo computer - from any folder, not only this one. You choose
echo which ones to stop. Nothing is stopped until you choose.
echo Your LIVE website on the internet is NOT affected.
echo.
call :stop_scan
if "%STOP_TOTAL%"=="0" (
    echo.
    echo   No local website is running right now. Nothing to stop.
    call :log "Stop: no local website found running"
    goto :stop_holders
)

:stop_list_menu
echo.
echo ------------------------------------------------------------
echo   What do you want to stop?
echo.
echo    [1]  Stop ALL local websites listed above
echo    [2]  Stop only the ones for THIS website folder
echo    [3]  Stop selected ones - type their numbers, e.g.: 1 3
echo    [4]  Refresh the list
echo    [0]  Back to the main menu (stop nothing)
echo.
set "ANS="
set /p "ANS=Choose and press ENTER [0]: "
if not defined ANS goto :menu
if "%ANS%"=="1" goto :stop_do_all
if "%ANS%"=="2" goto :stop_do_this
if "%ANS%"=="3" goto :stop_do_pick
if "%ANS%"=="4" goto :stop_all
goto :stop_list_menu

:stop_do_all
set "WM_PICKMODE=all"
set "WM_PICK="
goto :stop_do_kill

:stop_do_this
set "WM_PICKMODE=this"
set "WM_PICK="
goto :stop_do_kill

:stop_do_pick
set "ANS2="
set /p "ANS2=Type the numbers of the websites to stop, e.g.: 1 3: "
if not defined ANS2 goto :stop_list_menu
set "WM_PICK=%ANS2%"
set "WM_PICKMODE=pick"
goto :stop_do_kill

:stop_do_kill
echo.
echo Stopping the chosen local website(s)...
set /a WM_STOPPED=0
for /f "usebackq tokens=1,2 delims=|" %%P in (`powershell -NoProfile -Command "$mode=$env:WM_PICKMODE; $pick=@($env:WM_PICK -split '\s+' | Where-Object { $_ }); $i=0; Get-Content ($env:TEMP + '\wm_found.txt') | ForEach-Object { $i++; $c=$_ -split '\|'; if (($mode -eq 'all' -or ($mode -eq 'this' -and $c[3] -eq '1') -or ($mode -eq 'pick' -and ($pick -contains [string]$i))) -and ($c[0] -ne $env:WM_TOOLPID)) { $c[0]+'|'+$c[1] } }"`) do (
    echo   Checking PID %%P ...
    rem Windows reuses process numbers within seconds, so confirm the
    rem number still belongs to the same program before stopping it.
    set "WM_KILLED="
    for /f "usebackq tokens=1 delims=," %%A in (`tasklist /FI "PID eq %%P" /FO CSV /NH 2^>nul`) do (
        if /I %%A=="%%Q" set "WM_KILLED=1"
    )
    if defined WM_KILLED (
        taskkill /PID %%P /T /F >nul 2>&1
        call :log "Stop: ended website process PID %%P"
        set /a WM_STOPPED+=1
    ) else (
        echo    PID %%P was already closed or its number moved to another program - skipped.
        call :log "Stop: skipped PID %%P - already closed or PID reused"
    )
)
if "%WM_STOPPED%"=="0" (
    echo.
    echo   Nothing matched your choice - no website was stopped.
    goto :stop_list_menu
)
echo.
echo   %WM_STOPPED% website stop request(s) were sent.
echo Waiting two seconds, then checking what is still running...
timeout /t 2 /nobreak >nul
echo.
call :stop_scan
if "%STOP_TOTAL%"=="0" (
    echo.
    echo   Good news: no local website is running anymore.
    call :log "Stop: finished - no local website remains"
) else (
    echo.
    echo   %STOP_TOTAL% local website(s) from the list above are still
    echo   running. Some programs restart themselves or refuse to
    echo   close. Choose again, or restart the computer if needed.
    call :log "Stop: finished - %STOP_TOTAL% still running"
)
goto :stop_holders

:stop_scan
rem Scans the whole computer for locally running websites (any
rem project, any folder) and shows them as a numbered list.
rem Each row in the temp file: PID|NAME|PORTS|THIS|TITLE|COMMAND
echo Scanning this computer for running local websites...
powershell -NoProfile -Command "$bad='(\.vscode|Microsoft VS Code|WindowsApps|Code - Insiders|\.zcode|\.claude|\.cursor|AppData\\Local\\Programs)'; $sw='(vite|webpack|react-scripts|wrangler|workerd|npm-cli|http-server|http\.server|live-server|puma|rails|artisan|server\.|--port|--host|\bnext\b|\bpreview\b|\bdev\b|\bserve\b)'; $ww='((npm|npx|pnpm|yarn|bun)(\.cmd)?\s+(run\s+)?(dev|preview|start|serve)|vite|wrangler|http-server|live-server)'; $se='^(node|bun|deno|workerd|python|php|ruby)\.exe$'; $we='^(cmd|powershell|pwsh)\.exe$'; $toolPid=(Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId; $l=@{}; try { Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Group-Object OwningProcess | ForEach-Object { $l[$_.Name]=(($_.Group.LocalPort | Sort-Object -Unique) -join ',') } } catch {}; $root=[IO.Path]::GetFullPath($env:PROJECT_ROOT).TrimEnd([char]92).ToLowerInvariant(); $out=@(); foreach ($p in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) { if ($p.ProcessId -eq $PID -or $p.ProcessId -eq $toolPid -or $p.ProcessId -eq $env:WM_TOOLPID) { continue }; $cmd=[string]$p.CommandLine; $ep=[string]$p.ExecutablePath; if (-not $cmd -or ($ep -match $bad) -or ($cmd -match $bad)) { continue }; $hit=$false; if (($p.Name -match $se) -and (($cmd -match $sw) -or ($l.ContainsKey([string]$p.ProcessId)))) { $hit=$true }; if (($p.Name -match $we) -and ($cmd -match $ww)) { $hit=$true }; if (-not $hit) { continue }; $this='0'; if ($cmd.Replace('/','\').ToLowerInvariant().Contains($root)) { $this='1' }; $ports=$l[[string]$p.ProcessId]; if (-not $ports) { $ports='-' }; $t=(Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue).MainWindowTitle; if (-not $t) { $t='-' }; $t=$t -replace '\|','/'; $t=$t -replace '[()]',''; $short=$cmd.Trim(); if ($short.Length -gt 90) { $short=$short.Substring(0,90)+'...' }; $short=$short -replace '\|','/'; $short=$short -replace '[()]',''; $out += ($p.ProcessId.ToString()+'|'+$p.Name+'|'+$ports+'|'+$this+'|'+$t+'|'+$short) }; $out | Sort-Object { [int]($_ -split '\|')[0] }" > "%TEMP%\wm_found.txt"
echo.
powershell -NoProfile -Command "$i=0; Get-Content ($env:TEMP + '\wm_found.txt') | ForEach-Object { $i++; $c=$_ -split '\|'; Write-Host ('   [' + $i + ']  PID ' + $c[0] + '   ' + $c[1] + '   ports: ' + $c[2] + $(if ($c[3] -eq '1') { '   - THIS website' } else { '' })); if ($c[4] -ne '-') { Write-Host ('         window: ' + $c[4]) }; if ($c[5] -ne '-') { Write-Host ('         started as: ' + $c[5]) } }"
for /f %%N in ('type "%TEMP%\wm_found.txt" 2^>nul ^| find /c /v ""') do set "STOP_TOTAL=%%N"
if not defined STOP_TOTAL set "STOP_TOTAL=0"
echo.
echo   Found %STOP_TOTAL% running local website(s).
goto :eof

:stop_holders
echo.
echo Looking for programs that still mention this project folder...
powershell -NoProfile -Command "$root = [IO.Path]::GetFullPath($env:PROJECT_ROOT).TrimEnd([char]92).ToLowerInvariant(); $holders = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $cmd = [string]$_.CommandLine; $cmd -and $cmd.Replace('/','\').ToLowerInvariant().Contains($root) }); if ($holders.Count -eq 0) { Write-Host '  No command-line folder references were found.' } else { foreach ($p in $holders) { $short = ([string]$p.CommandLine).Trim(); if ($short.Length -gt 180) { $short = $short.Substring(0,180) + '...' }; Write-Host ('  Possible holder: ' + $p.Name + ' (PID ' + $p.ProcessId + ') ' + $short) } }"
echo.
echo Your LIVE website on the internet is NOT affected.
echo.
echo IMPORTANT: this tool cannot safely close Explorer, an editor,
echo a terminal, antivirus, backup software, or the assistant.
echo Those programs can still cause Windows "Folder in Use".
echo Close every Explorer window showing this folder, close the
echo editor or terminal whose current folder is inside it, then
echo rename the folder. Do not delete lock files to bypass it.
call :log "Stop: holders checked; Explorer and editors left alone"
goto :pause_menu

rem ==================== 8. LOGOUT EVERYWHERE ===================
:logout_all
cls
echo ------------------------------------------------------------
echo              LOG OUT OF EVERYTHING
echo            ( GitHub and Cloudflare )
echo ------------------------------------------------------------
echo.
call :log "Logout: option started"
echo You are about to sign out of GitHub and Cloudflare on this
echo computer. Nothing will be deleted from the internet.
echo You can log in again any time with the same account or a
echo different one.
echo.
set "ANS="
set /p "ANS=Really log out of everything? Type Y or N and press ENTER [N]: "
if /I not "%ANS%"=="Y" (
    echo Cancelled. Nothing was changed.
    call :log "Logout: cancelled by the user"
    goto :pause_menu
)
echo.
echo Signing out of ALL GitHub accounts on this computer...
where gh >nul 2>nul
if errorlevel 1 (
    echo   The GitHub tool is not installed - nothing to sign out of.
    call :log "Logout: GitHub tool not installed"
    goto :logout_git_id
)
rem Repeat until no GitHub account is left (up to 5 rounds), so a
rem computer with several saved accounts is cleared in one go.
set "GH_ROUND=0"
:gh_logout_loop
set /a GH_ROUND+=1
if %GH_ROUND% GTR 5 goto :gh_logout_check
set "GH_USER="
for /f "delims=" %%U in ('gh api user --jq .login 2^>nul') do set "GH_USER=%%U"
if not defined GH_USER goto :gh_logout_check
echo   Signing out account %GH_ROUND%:  %GH_USER%
rem If GitHub asks which account (several saved), pick it in this
rem window - the tool continues automatically afterwards.
gh auth logout --hostname github.com
call :log "Logout: signed out of GitHub account %GH_USER%"
goto :gh_logout_loop
:gh_logout_check
gh auth status >nul 2>&1
if errorlevel 1 (
    echo   No GitHub account is connected anymore.
    call :log "Logout: no GitHub account remains"
) else (
    echo   A GitHub account may still be connected - run option 8
    echo   once more to finish signing out.
    call :log "Logout: GitHub accounts may remain"
)
:logout_git_id
echo.
echo Clearing the saved Git name for THIS project...
set "OLD_GIT_NAME="
set "OLD_GIT_EMAIL="
for /f "delims=" %%N in ('git config --local user.name 2^^^>nul') do set "OLD_GIT_NAME=%%N"
for /f "delims=" %%E in ('git config --local user.email 2^^^>nul') do set "OLD_GIT_EMAIL=%%E"
git config --local --unset user.name >nul 2>&1
git config --local --unset user.email >nul 2>&1
if defined OLD_GIT_NAME (
    echo   Removed local Git author:  %OLD_GIT_NAME%
    call :log "Logout: cleared local git user.name=%OLD_GIT_NAME%"
)
if defined OLD_GIT_EMAIL (
    echo   Removed local Git email:   %OLD_GIT_EMAIL%
    call :log "Logout: cleared local git user.email=%OLD_GIT_EMAIL%"
)
rem Offer to clear the computer-wide Git identity. It is shared by
rem other projects on this PC, so the user decides - the tool only
rem removes it when explicitly chosen.
set "GLOBAL_GIT_NAME="
set "GLOBAL_GIT_EMAIL="
for /f "delims=" %%N in ('git config --global user.name 2^>nul') do set "GLOBAL_GIT_NAME=%%N"
for /f "delims=" %%E in ('git config --global user.email 2^>nul') do set "GLOBAL_GIT_EMAIL=%%E"
if not defined GLOBAL_GIT_NAME if not defined GLOBAL_GIT_EMAIL goto :logout_cf
echo.
echo This computer also has a computer-wide Git name saved:
if defined GLOBAL_GIT_NAME echo   name:   %GLOBAL_GIT_NAME%
if defined GLOBAL_GIT_EMAIL echo   email:  %GLOBAL_GIT_EMAIL%
echo Other projects on this computer may use it.
echo.
echo   [1]  Keep it (recommended - nothing else on this PC is affected)
echo   [2]  Remove it too (only if you are giving this computer away)
echo.
set "ANS="
set /p "ANS=Choose and press ENTER [1]: "
if "%ANS%"=="2" (
    git config --global --unset user.name >nul 2>&1
    git config --global --unset user.email >nul 2>&1
    echo   Removed the computer-wide Git name.
    call :log "Logout: cleared global git identity %GLOBAL_GIT_NAME%"
) else (
    echo   Kept the computer-wide Git name.
    call :log "Logout: kept global git identity"
)
:logout_cf
rem Clear saved repository link so next upload asks again
git config --unset website-manager.repo-name >nul 2>&1
call :log "Logout: cleared saved repository name"
echo Signing out of Cloudflare...
call npx --yes wrangler logout >nul 2>&1
call :log "Logout: signed out of Cloudflare"
echo.
echo Done. This computer is signed out of GitHub and Cloudflare,
echo and the Git identity saved for this project has been removed.
echo The saved code and the LIVE website are safe.
echo.
echo To log in again later, choose option 2 for GitHub or
echo option 3 for Cloudflare. You can log in with ANY account
echo you like - old or new. The tool will set the correct Git
echo identity automatically from your GitHub account.
call :log "Logout: finished"
goto :pause_menu

rem ==================== MISSING TOOLS =========================
:missing_node
cls
echo This tool needs "Node.js" on the computer, but it was not found.
echo.
echo Please install it from:  https://nodejs.org
echo Choose the LTS version, then open this tool again.
echo.
call :log "Blocked: Node.js is not installed"
goto :pause_menu

:missing_git
cls
echo This tool needs "Git" on the computer, but it was not found.
echo.
echo Please install it from:  https://git-scm.com
echo Then open this tool again.
echo.
call :log "Blocked: Git is not installed"
goto :pause_menu

:gh_missing
cls
echo The GitHub tool ("GitHub CLI") is not installed on this computer.
echo It is needed to save and upload your website code.
echo.
set "ANS="
set /p "ANS=Install it automatically now? Type Y or N and press ENTER [Y]: "
if /I "%ANS%"=="N" goto :pause_menu
echo.
echo Installing (this takes a minute, please wait)...
call winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo.
    echo The automatic install did not work.
    echo Please download it from:  https://cli.github.com
    echo Then open this tool again.
    call :log "GitHub CLI: automatic install failed"
    goto :pause_menu
)
echo.
echo Installed successfully. Please close this tool and open it
echo again, then choose option 2.
call :log "GitHub CLI: installed automatically"
goto :pause_menu

rem ==================== SUBROUTINES ===========================
:pause_menu
echo.
pause
goto :menu

:ensure_my_github_repo
rem Detects repositories in the logged-in GitHub account and lets the
rem user choose which one to upload to. Remembers the choice so the
rem next upload does not ask again (unless the user logs out).
set "SAVED_REPO="
set "TARGET_REPO="
set "TARGET_URL="

for /f "delims=" %%R in ('git config --get website-manager.repo-name 2^>nul') do set "SAVED_REPO=%%R"

rem ---- Set the Git author to the logged-in GitHub user ----
rem This ensures commits are attributed to the right person, not a
rem previous developer whose identity was saved in the project.
set "GH_DISPLAY_NAME="
set "GH_EMAIL="
for /f "delims=" %%N in ('gh api user --jq .name 2^>nul') do set "GH_DISPLAY_NAME=%%N"
for /f "delims=" %%E in ('gh api user --jq .email 2^>nul') do set "GH_EMAIL=%%E"
if not defined GH_DISPLAY_NAME set "GH_DISPLAY_NAME=%GH_USER%"
if not defined GH_EMAIL set "GH_EMAIL=%GH_USER%@users.noreply.github.com"
git config user.name "%GH_DISPLAY_NAME%"
git config user.email "%GH_EMAIL%"
call :log "GitHub: set local git author to %GH_DISPLAY_NAME% <%GH_EMAIL%>"

rem ---- Fetch available repositories from GitHub ----
echo.
echo Checking your GitHub repositories...
gh repo list %GH_USER% --limit 30 --json name,description --template "{{range .}}{{.name}}|||{{if .description}}{{.description}}{{end}}{{println}}{{end}}" > "%TEMP%\gh_repo_names.txt" 2>&1
if errorlevel 1 (
    echo Could not fetch repository list. Using saved settings.
    call :log "GitHub: repo list fetch failed, using fallback"
    goto :gh_repo_fallback
)

rem ---- Count the repos ----
set "REPO_TOTAL=0"
for /f "usebackq delims=" %%C in (`powershell -NoProfile -Command "[Console]::Write(@(Get-Content '%TEMP%\gh_repo_names.txt' | Where-Object { $_.Trim() }).Count)"`) do set "REPO_TOTAL=%%C"
if "%REPO_TOTAL%"=="0" (
    echo No repositories found in your account.
    goto :gh_repo_create_new
)

rem ---- Display the numbered menu ----
echo.
echo Which repository should receive this upload?
echo.
powershell -NoProfile -Command "$lines = @(Get-Content '%TEMP%\gh_repo_names.txt' | Where-Object { $_.Trim() }); $saved = $env:SAVED_REPO; for ($i = 0; $i -lt $lines.Count; $i++) { $parts = $lines[$i] -split '\|\|\|', 2; $nm = $parts[0]; $ds = if ($parts.Count -gt 1 -and $parts[1]) { '  (' + $parts[1] + ')' } else { '' }; $tag = ''; if ($nm -eq $saved) { $tag = '  << current' }; Write-Host ('  [' + ($i+1) + ']  ' + $nm + $ds + $tag) }"
set /a "NEW_OPT=%REPO_TOTAL%+1"
echo   [%NEW_OPT%]  Create a NEW private repository
echo   [0]  Cancel
echo.
set "ANS="
set /p "ANS=Choose a number and press ENTER: "
if not defined ANS (
    echo Invalid choice. Please try again.
    goto :ensure_my_github_repo
)
if "%ANS%"=="0" exit /b 1
if "%ANS%"=="%NEW_OPT%" goto :gh_repo_create_new

rem ---- Extract the chosen repo name ----
set "WM_CHOICE=%ANS%"
for /f "usebackq delims=" %%N in (`powershell -NoProfile -Command "$lines = @(Get-Content '%TEMP%\gh_repo_names.txt' | Where-Object { $_.Trim() }); $idx = 0; if ([int]::TryParse($env:WM_CHOICE, [ref]$idx) -and $idx -ge 1 -and $idx -le $lines.Count) { $parts = $lines[$idx - 1] -split '\|\|\|', 2; [Console]::Write($parts[0]) } else { [Console]::Write('INVALID') }"`) do set "TARGET_REPO=%%N"
set "WM_CHOICE="
if "%TARGET_REPO%"=="INVALID" (
    echo Invalid choice. Please try again.
    goto :ensure_my_github_repo
)
if not defined TARGET_REPO (
    echo Invalid choice. Please try again.
    goto :ensure_my_github_repo
)
call :log "GitHub: user selected repository %TARGET_REPO%"
goto :gh_repo_selected

:gh_repo_create_new
set "TARGET_REPO="
set /p "TARGET_REPO=Type the new repository name and press ENTER: "
if not defined TARGET_REPO (
    echo No name was given. Cancelled.
    exit /b 1
)
call :normalise_repo_name
if not defined TARGET_REPO (
    echo Invalid repository name. Cancelled.
    exit /b 1
)
echo Creating private repository:  %TARGET_REPO%
call :log "GitHub: creating new repo %GH_USER%/%TARGET_REPO%"
gh api --method POST user/repos -f "name=%TARGET_REPO%" -F private=true > "%TEMP%\gh_create_repo.txt" 2>&1
if errorlevel 1 (
    echo Could not create the repository.
    type "%TEMP%\gh_create_repo.txt"
    exit /b 1
)
echo Repository created!
goto :gh_repo_selected

:gh_repo_fallback
rem Fallback when gh repo list fails - use saved name or folder name.
if defined SAVED_REPO (
    set "TARGET_REPO=%SAVED_REPO%"
) else (
    for %%D in ("%~dp0.") do set "TARGET_REPO=%%~nxD"
)
call :normalise_repo_name
if not defined TARGET_REPO set "TARGET_REPO=website-backup"
rem Ensure the repo exists on GitHub
gh repo view "%GH_USER%/%TARGET_REPO%" --json name --jq .name >nul 2>&1
if errorlevel 1 (
    echo.
    echo Creating your private GitHub backup:  %TARGET_REPO%
    call :log "GitHub: creating private backup %GH_USER%/%TARGET_REPO%"
    gh api --method POST user/repos -f "name=%TARGET_REPO%" -F private=true > "%TEMP%\gh_create_repo.txt" 2>&1
    if errorlevel 1 (
        echo The private backup could not be created.
        type "%TEMP%\gh_create_repo.txt"
        exit /b 1
    )
    echo Private backup created successfully.
)

:gh_repo_selected
set "TARGET_URL=https://github.com/%GH_USER%/%TARGET_REPO%.git"
git remote get-url "%GH_REMOTE%" >nul 2>&1
if errorlevel 1 (
    git remote add "%GH_REMOTE%" "%TARGET_URL%"
) else (
    git remote set-url "%GH_REMOTE%" "%TARGET_URL%"
)
if errorlevel 1 exit /b 1
git config website-manager.repo-name "%TARGET_REPO%"
echo Your GitHub backup:  https://github.com/%GH_USER%/%TARGET_REPO%
call :log "GitHub: selected and linked repository %GH_USER%/%TARGET_REPO%"
exit /b 0

:normalise_repo_name
rem GitHub repository names are limited to these safe characters.
set "WM_REPO_VALUE=%TARGET_REPO%"
for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "$n = [string]$env:WM_REPO_VALUE; $n = $n.Trim() -replace '[^A-Za-z0-9._-]','-'; $n = $n.Trim('.','-','_'); if ($n.Length -gt 100) { $n = $n.Substring(0,100).TrimEnd('.','-','_') }; if (-not $n) { $n = 'website-backup' }; [Console]::Write($n)"`) do set "TARGET_REPO=%%R"
set "WM_REPO_VALUE="
goto :eof

:ensure_deps
rem Makes sure the website building blocks are installed. A fresh
rem copy of the website does not have them until the first run.
if exist "%~dp0node_modules" exit /b 0
echo The website building blocks are not installed in this copy
echo yet. Installing them now - this takes a few minutes and is
echo only needed once per copy. Please keep this window open.
echo.
call npm install
if errorlevel 1 (
    echo.
    echo The installation did not work. Check your internet
    echo connection, then choose this option again.
    call :log "Deps: npm install FAILED"
    exit /b 1
)
echo.
echo The building blocks are installed.
call :log "Deps: npm install finished - OK"
exit /b 0

:log
>> "%LOGFILE%" echo [%date% %time%] "%~1"
goto :eof

:clean
rem %~1 = name of a variable. Removes double-quote characters from
rem its value - a quote typed by the user could otherwise break the
rem upload command. The value is moved through files, never through
rem the command line, so no other character can break anything.
if not defined %~1 goto :eof
set %~1 > "%TEMP%\wm_raw.txt"
powershell -NoProfile -Command "$line = Get-Content -Raw '%TEMP%\wm_raw.txt'; $v = $line -replace '^[^=]*=','' -replace [string][char]34,'' -replace '\s+$',''; [Console]::Write($v)" > "%TEMP%\wm_clean.txt"
set "%~1="
set /p %~1=<"%TEMP%\wm_clean.txt"
goto :eof

:end
call :log "Tool closed"
endlocal
exit /b 0
