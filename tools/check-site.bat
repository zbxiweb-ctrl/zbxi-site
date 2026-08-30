@echo off
REM Double-click this to check whether {{SITE_DOMAIN}} is actually OK.
REM Takes about 10 seconds. The window stays open so you can read it.
cd /d "%~dp0.."
echo.
echo Checking {{SITE_DOMAIN}} ...
echo.
node tools\healthcheck.mjs
echo.
if %ERRORLEVEL%==0 echo RESULT: Everything is fine. Nothing to do.
if %ERRORLEVEL%==1 echo RESULT: Site is up, but something needs a look soon (see WARN above).
if %ERRORLEVEL%==2 echo RESULT: SOMETHING IS BROKEN for visitors. Send the lines marked FAIL to Claude.
echo.
pause
