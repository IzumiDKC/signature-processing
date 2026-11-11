@echo off
setlocal
cd /d "%~dp0web"
if not exist "dist\index.html" (
    call npm.cmd ci --ignore-scripts --no-audit --no-fund
    if errorlevel 1 goto fail
    call npm.cmd run build
    if errorlevel 1 goto fail
)
echo Mo http://127.0.0.1:4173 trong trinh duyet. Nhan Ctrl+C de dung.
node scripts\serve.mjs --open
if errorlevel 1 goto fail
exit /b 0
:fail
echo Khong khoi dong duoc. Kiem tra Node.js va cong 4173.
pause
