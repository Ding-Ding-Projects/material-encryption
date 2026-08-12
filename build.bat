@echo off
setlocal EnableExtensions
set "ME_START=%TIME%"
set "ME_SILENT=0"
if /I "%~1"=="/s" set "ME_SILENT=1"
if /I "%~1"=="--silent" set "ME_SILENT=1"
if "%SILENT%"=="1" set "ME_SILENT=1"

echo [Material Encryption] Checking the Node.js toolchain...
where node >nul 2>nul
if errorlevel 1 goto :install_node
for /f "tokens=*" %%V in ('node --version') do echo [Material Encryption] Found Node.js %%V.
goto :install_deps

:install_node
echo [Material Encryption] Node.js 22 or newer is missing. Installing the current LTS release from the Windows package manager...
where winget >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js ^>=22 is required. The canonical winget route was unavailable and no safe user-scoped installer could be started.
  exit /b 10
)
winget install --id OpenJS.NodeJS.LTS --exact --scope user --silent --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo ERROR: Node.js ^>=22 could not be installed from OpenJS.NodeJS.LTS through winget.
  exit /b 11
)
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul || (echo ERROR: Node.js installed, but the executable is unavailable in this process.& exit /b 12)

:install_deps
echo [Material Encryption] Restoring locked project dependencies...
call npm ci --no-audit --no-fund
if errorlevel 1 (echo ERROR: npm ci failed while restoring package-lock.json.& exit /b 20)

echo [Material Encryption] Generating the offline renderer from the design export...
call npm run prepare:renderer
if errorlevel 1 (echo ERROR: The design renderer could not be generated.& exit /b 30)

echo [Material Encryption] Running local release checks...
call npm run test:all
if errorlevel 1 (echo ERROR: A local release check failed. No application was launched.& exit /b 40)

echo [Material Encryption] Building the unpacked Windows application...
call npm run package
if errorlevel 1 (echo ERROR: Electron packaging failed.& exit /b 50)

echo [Material Encryption] Build complete. Started at %ME_START%; finished at %TIME%.
if "%ME_SILENT%"=="1" exit /b 0
choice /M "Run Material Encryption now"
if errorlevel 2 exit /b 0
start "" "dist\win-unpacked\Material Encryption.exe"
exit /b 0
