param(
  [Parameter(Mandatory = $true)]
  [string]$ArtifactDirectory,
  [Parameter(Mandatory = $true)]
  [string]$PackageVersion
)

$resolvedDirectory = (Resolve-Path -LiteralPath $ArtifactDirectory -ErrorAction Stop).Path
$setupName = "MaterialEncryption-Setup-$PackageVersion-x64.exe"
$fullPackageName = "material-encryption-$PackageVersion-full.nupkg"
$deltaPackageName = "material-encryption-$PackageVersion-delta.nupkg"
$requiredNames = @($setupName, 'RELEASES', $fullPackageName)
foreach ($name in $requiredNames) {
  $path = Join-Path $resolvedDirectory $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required Squirrel.Windows artifact is missing: $name" }
}

$entries = @(Get-Content -LiteralPath (Join-Path $resolvedDirectory 'RELEASES') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$olderFullPackages = @(Get-ChildItem -LiteralPath $resolvedDirectory -File -Filter '*-full.nupkg' | Where-Object {
  $_.Name -match '^material-encryption-(?<version>\d+\.\d+\.\d+)-full\.nupkg$' -and [version]$Matches.version -lt [version]$PackageVersion
})
if ($olderFullPackages.Count -gt 0 -and -not (Test-Path -LiteralPath (Join-Path $resolvedDirectory $deltaPackageName) -PathType Leaf)) {
  throw "An older full package is present but the current delta package is missing: $deltaPackageName"
}
$currentPackages = @($fullPackageName)
if (Test-Path -LiteralPath (Join-Path $resolvedDirectory $deltaPackageName) -PathType Leaf) { $currentPackages += $deltaPackageName }
foreach ($packageName in $currentPackages) {
  $escapedName = [regex]::Escape($packageName)
  $matchingEntry = @($entries | Where-Object { $_ -match "^(?<sha>[A-Fa-f0-9]{40})\s+$escapedName\s+(?<size>\d+)$" })
  if ($matchingEntry.Count -ne 1) { throw "RELEASES does not link the exact current package: $packageName" }
  $null = $matchingEntry[0] -match "^(?<sha>[A-Fa-f0-9]{40})\s+$escapedName\s+(?<size>\d+)$"
  $packagePath = Join-Path $resolvedDirectory $packageName
  $actualSha = (Get-FileHash -Algorithm SHA1 -LiteralPath $packagePath).Hash
  $actualSize = (Get-Item -LiteralPath $packagePath).Length
  if ($actualSha -ne $Matches.sha -or $actualSize -ne [long]$Matches.size) { throw "RELEASES integrity metadata does not match the package bytes: $packageName" }
}

Write-Output "[Material Encryption] Verified exact Squirrel.Windows artifact names and RELEASES linkage for $PackageVersion."
