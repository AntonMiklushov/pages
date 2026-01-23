$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe -and (Test-Path "C:\Program Files\nodejs\node.exe")) {
  $nodeExe = "C:\Program Files\nodejs\node.exe"
}
if (-not $nodeExe) {
  throw "Node.js not found in PATH or default location."
}

& $nodeExe "tools/admin-panel/server.mjs"
