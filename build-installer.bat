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

for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "ME_VERSION=%%V"
if not defined ME_VERSION (echo ERROR: package.json version could not be resolved.& exit /b 61)
set "ME_SETUP=%~dp0dist\squirrel-windows\MaterialEncryption-Setup-%ME_VERSION%-x64.exe"
set "ME_FULL_PACKAGE=%~dp0dist\squirrel-windows\material-encryption-%ME_VERSION%-full.nupkg"
set "ME_DELTA_PACKAGE=%~dp0dist\squirrel-windows\material-encryption-%ME_VERSION%-delta.nupkg"
if not exist "%ME_SETUP%" (echo ERROR: Exact Setup artifact was not produced: %ME_SETUP%.& exit /b 61)
if not exist "%~dp0dist\squirrel-windows\RELEASES" (echo ERROR: Squirrel.Windows RELEASES was not produced.& exit /b 62)
if not exist "%ME_FULL_PACKAGE%" (echo ERROR: Exact full Squirrel.Windows package was not produced: %ME_FULL_PACKAGE%.& exit /b 63)

set "ME_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%ME_POWERSHELL%" (echo ERROR: Windows PowerShell signature checker is unavailable at %ME_POWERSHELL%.& exit /b 64)
"%ME_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\verify-unsigned-installer.ps1" -Executable "%ME_SETUP%"
if errorlevel 1 (echo ERROR: The unsigned installer verification helper failed.& exit /b 64)
"%ME_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\verify-squirrel-release.ps1" -ArtifactDirectory "%~dp0dist\squirrel-windows" -PackageVersion "%ME_VERSION%"
if errorlevel 1 (echo ERROR: The Squirrel.Windows release linkage verification helper failed.& exit /b 65)
exit /b 0
