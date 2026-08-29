$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = $nodeCommand.Source

if (-not $nodePath) {
  $bundledNodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $bundledNodePath) {
    $nodePath = $bundledNodePath
  }
}

if (-not $nodePath) {
  throw 'Node.js was not found. Install Node.js 18+ or run this project in Codex Desktop.'
}

& $nodePath (Join-Path $PSScriptRoot 'local-server.js')
