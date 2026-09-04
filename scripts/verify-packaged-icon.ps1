param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,
  [string]$Output = 'dist\packaged-executable-icon.png'
)

. (Join-Path $PSScriptRoot 'import-windows-powershell-modules.ps1')

$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Output))
$outputDirectory = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }

Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($resolvedExecutable)
if ($null -eq $icon) { throw "No application icon could be extracted from $resolvedExecutable" }
try {
  $bitmap = $icon.ToBitmap()
  try {
    if ($bitmap.Width -lt 16 -or $bitmap.Height -lt 16) { throw "The extracted icon is smaller than 16 pixels." }
    $bitmap.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bitmap.Dispose()
  }
} finally {
  $icon.Dispose()
}

$signature = (Get-AuthenticodeSignature -LiteralPath $resolvedExecutable).Status
if ($signature -ne 'NotSigned') { throw "Packaged executable signature is $signature; expected NotSigned." }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedExecutable).Hash
Write-Output "PASS: extracted $resolvedOutput from the unsigned packaged executable."
Write-Output "Executable SHA-256: $hash"
