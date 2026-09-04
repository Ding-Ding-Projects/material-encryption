param(
  [Parameter(Mandatory = $true)]
  [string]$Executable
)

$resolved = (Resolve-Path -LiteralPath $Executable -ErrorAction Stop).Path
. (Join-Path $PSScriptRoot 'import-windows-powershell-modules.ps1')
$signature = (Get-AuthenticodeSignature -LiteralPath $resolved).Status
if ($signature -ne 'NotSigned') {
  throw "The installer signature state is $signature; policy requires NotSigned."
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolved).Hash
Write-Output '[Material Encryption] Unsigned installer verified.'
Write-Output "Artifact: $resolved"
Write-Output "SHA-256: $hash"
Write-Output 'Warning: this installer is unsigned and may trigger an unknown-publisher or SmartScreen warning.'
