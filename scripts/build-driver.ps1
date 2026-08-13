<#
.SYNOPSIS
    Builds the VeraCrypt kernel driver from source, from a checkout with nothing
    prepared, and verifies the artifact it produced.

.DESCRIPTION
    This exists so drive-letter mounting can be offered without shipping anyone
    else's binary. The driver is open source; what cannot be reproduced is its
    publisher signature, so the driver this produces is unsigned and Windows
    will refuse to load it until the machine's owner turns driver signature
    enforcement off themselves. That is a deliberate, user-made decision and
    this script neither performs it nor asks for it.

    Code signing is permanently out of scope: nothing here signs, test-signs, or
    requests a certificate, and SignMode is passed as Off explicitly.

    Everything it needs that is missing gets built or fetched into build/.cache,
    which is git-ignored. It never modifies the shared Visual Studio install —
    the WDK's kernel-mode toolset is assembled into a project-local MSBuild tree
    and passed via VCTargetsPath instead.

.PARAMETER Silent
    No prompts, non-zero exit on the first real failure. For CI and automation.
#>
[CmdletBinding()]
param(
    [switch]$Silent,
    [string]$VeraCryptTag = 'VeraCrypt_1.26.29'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $repo 'build\.cache'
$tools = Join-Path $cache 'tools'
$vctargets = Join-Path $cache 'vctargets'
$srcRoot = Join-Path $cache 'veracrypt-src'
$started = Get-Date

function Step($message) { Write-Host "==> $message" }
function Fail($message) { throw $message }

New-Item -ItemType Directory -Force $cache, $tools | Out-Null

# --- Visual Studio, MSVC and the WDK -------------------------------------
Step 'Locating the build toolchain'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { Fail 'vswhere.exe not found. Install Visual Studio Build Tools 2022 with the C++ workload.' }
$vs = & $vswhere -latest -products * -property installationPath
if (-not $vs) { Fail 'No Visual Studio installation was found.' }
$msbuild = Join-Path $vs 'MSBuild\Current\Bin\MSBuild.exe'
if (-not (Test-Path $msbuild)) { Fail "MSBuild was not found under $vs." }

$kitsRoot = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows Kits\Installed Roots' -ErrorAction SilentlyContinue).KitsRoot10
if (-not $kitsRoot) { Fail 'The Windows Driver Kit is not installed (no KitsRoot10 registry value).' }
$wdkBuildFolder = Get-ChildItem (Join-Path $kitsRoot 'build') -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object Name -Descending | Select-Object -First 1
if (-not $wdkBuildFolder) { Fail "No WDK build folder found under $kitsRoot\build." }
Write-Host "    Visual Studio : $vs"
Write-Host "    WDK           : $kitsRoot ($($wdkBuildFolder.Name))"

# --- The kernel-mode platform toolset ------------------------------------
# It ships as a Visual Studio extension. VSIXInstaller refuses a Build Tools
# target, and writing into the shared install would mutate a toolchain other
# projects rely on, so the toolset is assembled here instead.
if (-not (Test-Path (Join-Path $vctargets 'v170\Platforms\x64\PlatformToolsets\WindowsKernelModeDriver10.0'))) {
    Step 'Assembling the kernel-mode platform toolset'
    $vsix = Get-ChildItem (Join-Path $kitsRoot 'Vsix') -Filter 'WDK.vsix' -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'VS2022' } | Select-Object -First 1
    if (-not $vsix) { Fail "WDK.vsix for VS2022 was not found under $kitsRoot\Vsix." }
    $unpack = Join-Path $cache 'wdk-vsix'
    Remove-Item $unpack -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $unpack | Out-Null
    Copy-Item $vsix.FullName (Join-Path $unpack 'WDK.zip')
    Expand-Archive (Join-Path $unpack 'WDK.zip') -DestinationPath (Join-Path $unpack 'x') -Force
    Remove-Item $vctargets -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $vctargets | Out-Null
    Copy-Item (Join-Path $vs 'MSBuild\Microsoft\VC\*') $vctargets -Recurse -Force
    Copy-Item (Join-Path $unpack 'x\$MSBuild\Microsoft\VC\*') $vctargets -Recurse -Force
    if (-not (Test-Path (Join-Path $vctargets 'v170\Platforms\x64\PlatformToolsets\WindowsKernelModeDriver10.0'))) {
        Fail 'The kernel-mode toolset did not appear after unpacking WDK.vsix.'
    }
}

# --- yasm ------------------------------------------------------------------
# The published yasm-1.3.0-win64.exe imports MSVCR100.dll, the VC++ 2010
# runtime, which a modern machine does not have; it dies with a missing-DLL
# status that reads like a corrupt download. Building it here avoids installing
# a system-wide redistributable for one assembler.
#
# yasm's own CMake build then registers the win64 object format but never the
# x64 alias that VeraCrypt's build invokes, even though yasm_x64_LTX_objfmt
# exists in its C source — so that one line is added before building.
$yasm = Join-Path $tools 'yasm.exe'
if (-not (Test-Path $yasm)) {
    Step 'Building yasm from source'
    $yasmSrc = Join-Path $cache 'yasm-src'
    if (-not (Test-Path (Join-Path $yasmSrc 'CMakeLists.txt'))) {
        & git clone --depth 1 --branch v1.3.0 https://github.com/yasm/yasm.git $yasmSrc 2>&1 | Out-Null
        if (-not (Test-Path (Join-Path $yasmSrc 'CMakeLists.txt'))) { Fail 'Cloning yasm failed.' }
    }
    $coff = Join-Path $yasmSrc 'modules\objfmts\coff\CMakeLists.txt'
    if ((Get-Content $coff -Raw) -notmatch 'objfmt_x64') {
        Add-Content $coff "`nlist(APPEND YASM_MODULES objfmt_x64)"
    }
    $cmake = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
    if (-not (Test-Path $cmake)) { $cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source }
    if (-not $cmake) { Fail 'CMake was not found; it is needed to build yasm.' }
    $yasmBuild = Join-Path $cache 'yasm-build'
    Remove-Item $yasmBuild -Recurse -Force -ErrorAction SilentlyContinue
    & $cmake -S $yasmSrc -B $yasmBuild -G 'Visual Studio 17 2022' -A x64 -DBUILD_SHARED_LIBS=OFF | Out-Null
    & $cmake --build $yasmBuild --config Release --target yasm | Out-Null
    $built = Get-ChildItem $yasmBuild -Filter 'yasm.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $built) { Fail 'yasm did not build.' }
    Copy-Item $built.FullName $yasm -Force
}
& $yasm --version > $null 2>&1
if ($LASTEXITCODE -ne 0) { Fail 'The yasm build does not run.' }

# --- nasm ------------------------------------------------------------------
$nasm = Join-Path $tools 'nasm.exe'
if (-not (Test-Path $nasm)) {
    Step 'Fetching nasm'
    $zip = Join-Path $cache 'nasm.zip'
    Invoke-WebRequest -Uri 'https://www.nasm.us/pub/nasm/releasebuilds/2.16.03/win64/nasm-2.16.03-win64.zip' -OutFile $zip
    $unpack = Join-Path $cache 'nasm'
    Remove-Item $unpack -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive $zip -DestinationPath $unpack -Force
    $found = Get-ChildItem $unpack -Filter 'nasm.exe' -Recurse | Select-Object -First 1
    if (-not $found) { Fail 'nasm.exe was not found in the downloaded archive.' }
    Copy-Item $found.FullName $nasm -Force
}

# --- VeraCrypt source ------------------------------------------------------
if (-not (Test-Path (Join-Path $srcRoot 'src\Driver\Driver.vcxproj'))) {
    Step "Cloning the VeraCrypt source at $VeraCryptTag"
    Remove-Item $srcRoot -Recurse -Force -ErrorAction SilentlyContinue
    & git clone --depth 1 --branch $VeraCryptTag https://github.com/veracrypt/VeraCrypt.git $srcRoot 2>&1 | Out-Null
    if (-not (Test-Path (Join-Path $srcRoot 'src\Driver\Driver.vcxproj'))) { Fail 'Cloning the VeraCrypt source failed.' }
}
$src = Join-Path $srcRoot 'src'

# The project's post-build step copies into this directory without creating it.
New-Item -ItemType Directory -Force (Join-Path $src 'Driver\Release\Setup Files') | Out-Null

# --- Build -----------------------------------------------------------------
Step 'Building the driver'
$env:PATH = "$tools;$env:PATH"
$log = Join-Path $cache 'driver-build.log'
& $msbuild (Join-Path $src 'Driver\Driver.vcxproj') `
    /p:Configuration=Release /p:Platform=x64 `
    /p:VCTargetsPath="$vctargets\v170\" `
    /p:WDKContentRoot="$kitsRoot" /p:WDKBuildFolder=$($wdkBuildFolder.Name) `
    /p:VeraCryptSourceRoot="$src" `
    /p:ForceImportBeforeCppTargets="$PSScriptRoot\driver\SourceIncludes.props" `
    /p:SpectreMitigation=false /p:SignMode=Off `
    /t:Rebuild /v:minimal /nologo > $log 2>&1
$buildExit = $LASTEXITCODE
if ($buildExit -ne 0) {
    Get-Content $log -Tail 30
    Fail "The driver build failed with exit code $buildExit. Full log: $log"
}

# --- Verify ----------------------------------------------------------------
Step 'Verifying the artifact'
$sys = Join-Path $src 'Driver\x64\Release\veracrypt.sys'
if (-not (Test-Path $sys)) { Fail "The build reported success but $sys does not exist." }
$info = Get-Item $sys
if ($info.Length -lt 100KB) { Fail "veracrypt.sys is only $($info.Length) bytes; that is not a complete driver." }

$signature = (Get-AuthenticodeSignature $sys).Status
if ($signature -ne 'NotSigned') { Fail "The driver reports its signature as '$signature'. This project never signs; investigate before shipping it." }

$dumpbin = Get-ChildItem (Join-Path $vs 'VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe') -ErrorAction SilentlyContinue | Select-Object -First 1
if ($dumpbin) {
    $headers = & $dumpbin.FullName /headers $sys 2>&1
    if (-not ($headers | Select-String -Quiet 'machine \(x64\)')) { Fail 'The driver is not an x64 binary.' }
    if (-not ($headers | Select-String -Quiet 'subsystem \(Native\)')) { Fail 'The driver is not a native-subsystem binary.' }
    $imports = & $dumpbin.FullName /dependents $sys 2>&1
    if (-not ($imports | Select-String -Quiet 'ntoskrnl.exe')) { Fail 'The driver does not import ntoskrnl.exe, so it is not a kernel driver.' }
}

$hash = (Get-FileHash $sys -Algorithm SHA256).Hash.ToLower()
$elapsed = (Get-Date) - $started

$outDir = Join-Path $cache 'driver'
New-Item -ItemType Directory -Force $outDir | Out-Null
Copy-Item $sys (Join-Path $outDir 'veracrypt.sys') -Force
@{
    source      = "veracrypt/VeraCrypt @ $VeraCryptTag"
    builtAt     = (Get-Date).ToUniversalTime().ToString('o')
    sha256      = $hash
    bytes       = $info.Length
    signed      = $false
    toolchain   = @{ visualStudio = $vs; wdk = $wdkBuildFolder.Name }
} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $outDir 'veracrypt.sys.json') -Encoding utf8

Write-Host ''
Write-Host "Driver built from source."
Write-Host "  artifact : $(Join-Path $outDir 'veracrypt.sys')"
Write-Host "  bytes    : $($info.Length)"
Write-Host "  sha256   : $hash"
Write-Host "  signed   : no (by policy)"
Write-Host "  duration : $($elapsed.ToString('hh\:mm\:ss'))"
Write-Host ''
Write-Host "Windows will not load this driver until the machine's owner disables"
Write-Host "driver signature enforcement themselves. This script does not do that,"
Write-Host "and nothing in this project will."

if (-not $Silent) { Write-Host ''; Write-Host 'Done.' }
exit 0
