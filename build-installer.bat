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
for /r "%~dp0dist\squirrel-windows" %%F in (*Setup*.exe) do set "ME_SETUP=%%~fF"
if not defined ME_SETUP (echo ERROR: Setup.exe was not produced.& exit /b 61)
if not exist "%~dp0dist\squirrel-windows\RELEASES" (echo ERROR: Squirrel.Windows RELEASES was not produced.& exit /b 62)
dir /b "%~dp0dist\squirrel-windows\*.nupkg" >nul 2>nul || (echo ERROR: No full Squirrel.Windows .nupkg was produced.& exit /b 63)

set "ME_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%ME_POWERSHELL%" (echo ERROR: Windows PowerShell signature checker is unavailable at %ME_POWERSHELL%.& exit /b 64)
"%ME_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\verify-unsigned-installer.ps1" -Executable "%ME_SETUP%"
if errorlevel 1 (echo ERROR: The unsigned installer verification helper failed.& exit /b 64)
exit /b 0
