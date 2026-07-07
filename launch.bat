@echo off
setlocal
cd /d "%~dp0"

echo.
echo  Ledger - Local Dev Server (Vite)
echo  =================================
echo  Press Ctrl+C to stop.
echo.

if not exist node_modules (
    echo  First run: installing dependencies...
    call npm install || goto :fail
)

call npm run dev -- --open
goto :eof

:fail
echo.
echo  npm install failed. Is Node.js installed? https://nodejs.org
pause
endlocal
