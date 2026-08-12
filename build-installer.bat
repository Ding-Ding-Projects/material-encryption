@echo off
setlocal EnableExtensions
set "ME_SILENT=0"
if /I "%~1"=="/s" set "ME_SILENT=1"
if /I "%~1"=="--silent" set "ME_SILENT=1"
if "%SILENT%"=="1" set "ME_SILENT=1"

echo [Material Encryption] Building the application before the installer...
call "%~dp0build.bat" /s
if errorlevel 1 exit /b %errorlevel%

echo [Material Encryption] Building unsigned Squirrel.Windows artifacts...
call npm run dist
if errorlevel 1 (echo ERROR: Squirrel.Windows packaging failed.& exit /b 60)

set "ME_SETUP="
for /r "%~dp0dist" %%F in (*Setup.exe) do set "ME_SETUP=%%~fF"
if not defined ME_SETUP (echo ERROR: Setup.exe was not produced.& exit /b 61)
if not exist "%~dp0dist\squirrel-windows\RELEASES" (echo ERROR: Squirrel.Windows RELEASES was not produced.& exit /b 62)
dir /b "%~dp0dist\squirrel-windows\*.nupkg" >nul 2>nul || (echo ERROR: No full Squirrel.Windows .nupkg was produced.& exit /b 63)

for /f "usebackq tokens=*" %%S in (`powershell -NoProfile -Command "(Get-AuthenticodeSignature -LiteralPath $env:ME_SETUP).Status"`) do set "ME_SIGNATURE=%%S"
if /I not "%ME_SIGNATURE%"=="NotSigned" (echo ERROR: The installer signature state is %ME_SIGNATURE%; policy requires NotSigned.& exit /b 64)
for /f "usebackq tokens=*" %%H in (`powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath $env:ME_SETUP).Hash"`) do set "ME_SHA=%%H"

echo [Material Encryption] Unsigned installer verified.
echo Artifact: %ME_SETUP%
echo SHA-256: %ME_SHA%
echo Warning: this installer is unsigned and may trigger an unknown-publisher or SmartScreen warning.
exit /b 0
