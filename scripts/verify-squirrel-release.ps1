param(
  [Parameter(Mandatory = $true)]
  [string]$ArtifactDirectory,
  [Parameter(Mandatory = $true)]
  [string]$PackageVersion
)

$resolvedDirectory = (Resolve-Path -LiteralPath $ArtifactDirectory -ErrorAction Stop).Path
$setupName = "MaterialEncryption-Setup-$PackageVersion-x64.exe"
$fullPackageName = "material-encryption-$PackageVersion-full.nupkg"
$requiredNames = @($setupName, 'RELEASES', $fullPackageName)
foreach ($name in $requiredNames) {
  $path = Join-Path $resolvedDirectory $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required Squirrel.Windows artifact is missing: $name" }
}

$unexpectedSetups = @(Get-ChildItem -LiteralPath $resolvedDirectory -File -Filter '*Setup*.exe' | Where-Object Name -ne $setupName)
$unexpectedFullPackages = @(Get-ChildItem -LiteralPath $resolvedDirectory -File -Filter '*-full.nupkg' | Where-Object Name -ne $fullPackageName)
if ($unexpectedSetups.Count -ne 0 -or $unexpectedFullPackages.Count -ne 0) {
  throw 'Unexpected setup or full package names are present beside the required artifacts.'
}

$entries = @(Get-Content -LiteralPath (Join-Path $resolvedDirectory 'RELEASES') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($entries.Count -ne 1) { throw "RELEASES must contain exactly one full-package entry; found $($entries.Count)." }
$escapedName = [regex]::Escape($fullPackageName)
if ($entries[0] -notmatch "^[A-Fa-f0-9]{40}\s+$escapedName\s+\d+$") { throw "RELEASES does not link the exact full package: $fullPackageName" }

Write-Output "[Material Encryption] Verified exact Squirrel.Windows artifact names and RELEASES linkage for $PackageVersion."
