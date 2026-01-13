$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$envFile = Join-Path $root ".env.local"
if (-not (Test-Path $envFile)) {
  throw "Missing .env.local. Create it locally with LIB_PASSWORD and LIB_BASE_URL."
}

Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) {
    return
  }
  if ($line -match '^\s*([^=]+?)\s*=\s*(.*)$') {
    $name = $matches[1].Trim()
    $value = $matches[2].Trim()
    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path "env:$name" -Value $value
  }
}

if (-not $env:LIB_PASSWORD) {
  throw "LIB_PASSWORD is required."
}

if (-not $env:LIB_BASE_URL) {
  throw "LIB_BASE_URL is required."
}

if (-not $env:LIB_BASE_URL.EndsWith("/")) {
  throw "LIB_BASE_URL must end with '/'."
}

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe -and (Test-Path "C:\\Program Files\\nodejs\\node.exe")) {
  $nodeExe = "C:\\Program Files\\nodejs\\node.exe"
}
if (-not $nodeExe) {
  throw "Node.js not found in PATH or default location."
}

$awsExe = (Get-Command aws -ErrorAction SilentlyContinue).Source
if (-not $awsExe -and (Test-Path "C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe")) {
  $awsExe = "C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe"
}
if (-not $awsExe) {
  throw "AWS CLI not found in PATH or default location."
}

& $nodeExe "tools/build-library.mjs"

$uri = [Uri]$env:LIB_BASE_URL
$path = $uri.AbsolutePath.Trim("/")
if (-not $path) {
  throw "LIB_BASE_URL must include a bucket path."
}

$bucket = $path
$prefix = ""
if ($path.Contains("/")) {
  $parts = $path.Split("/", 2)
  $bucket = $parts[0]
  $prefix = $parts[1]
}

$dest = if ($prefix) { "s3://$bucket/$prefix/" } else { "s3://$bucket/" }

& $awsExe "--endpoint-url=https://storage.yandexcloud.net" "s3" "sync" "out/objects" $dest
