@echo off
setlocal
title Working Fund - Review Page

rem ===========================================================================
rem  Working Fund - Review Page launcher
rem
rem  WHAT THIS DOES: opens the office Review Page in your web browser.
rem  HOW TO USE IT:  just double-click this file. That is all.
rem
rem  The first time you run it on a computer, it spends a minute getting ready.
rem  After that it starts quickly. You can close this window any time to stop.
rem ===========================================================================

rem Move into the "local" folder, which sits right next to this file.
cd /d "%~dp0local"

rem --- Step 1 of 3: find Python --------------------------------------------
set "PY="
py -3 --version >nul 2>nul
if %errorlevel%==0 set "PY=py -3"
if not "%PY%"=="" goto have_python
python --version >nul 2>nul
if %errorlevel%==0 set "PY=python"
if not "%PY%"=="" goto have_python

echo.
echo   Python is not installed on this computer yet.
echo.
echo   How to fix it, this takes about 3 minutes:
echo     1. Open this web page:  https://www.python.org/downloads/
echo     2. Click the yellow "Download Python" button and run the file.
echo     3. IMPORTANT: on the first install screen, tick the box that says
echo        "Add Python to PATH", and then click "Install Now".
echo     4. When it has finished, double-click this file again.
echo.
pause
exit /b

:have_python

rem --- Step 2 of 3: get the needed pieces, only if they are missing --------
%PY% -c "import flask, pymongo" >nul 2>nul
if %errorlevel%==0 goto run

echo.
echo   First-time setup: downloading the pieces this app needs.
echo   Please wait, this can take a minute or two. You only do this once.
echo.
%PY% -m pip install --user -r requirements.txt
if errorlevel 1 goto setup_failed
%PY% -c "import flask, pymongo" >nul 2>nul
if errorlevel 1 goto setup_failed

:run
rem --- Step 3 of 3: start the Review Page ----------------------------------
echo.
echo   Starting the Review Page...
echo   A browser tab will open by itself in a few seconds.
echo.
echo   PLEASE KEEP THIS WINDOW OPEN while you work.
echo   To stop the Review Page, simply close this window.
echo.
%PY% app.py

echo.
echo   The Review Page has stopped. You can close this window now.
pause
exit /b

:setup_failed
echo.
echo   Setup could not finish.
echo   The most common reason is that the computer is not online.
echo   Please connect to the internet and try again.
echo   If it still does not work, send a photo of this window to Brian.
echo.
pause
exit /b
