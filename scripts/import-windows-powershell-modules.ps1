$moduleRoot = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules'
foreach ($module in @('Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Security')) {
  $manifest = Join-Path $moduleRoot "$module\$module.psd1"
  if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
    throw "Required Windows PowerShell module manifest is missing: $manifest"
  }
  Import-Module -Name $manifest -Force -ErrorAction Stop
}
