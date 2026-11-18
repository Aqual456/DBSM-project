# Delete only ReliefFlow's generated output, using native Windows filesystem handling.
$ErrorActionPreference = 'Stop'
$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildPath = [System.IO.Path]::GetFullPath((Join-Path $workspacePath '.next-build'))
if ($buildPath -ne (Join-Path $workspacePath '.next-build')) { throw 'Unexpected output directory' }
if (Test-Path -LiteralPath $buildPath) { Remove-Item -LiteralPath $buildPath -Recurse -Force }
