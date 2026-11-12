param(
  [ValidateSet('dashboard', 'plugin')]
  [string]$Mode = 'dashboard'
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $projectRoot
try {
  if ($Mode -eq 'plugin') {
    & claude --plugin-dir $projectRoot
    exit $LASTEXITCODE
  }
  & pnpm build
  if ($LASTEXITCODE -ne 0) { throw 'VPR build failed' }
  $profile = Get-Content -LiteralPath (Join-Path $projectRoot '.vpr/profile.json') -Raw | ConvertFrom-Json
  & node packages/cli/dist/bin.js dashboard --project $projectRoot --db (Join-Path $projectRoot '.vpr/local.sqlite') --project-id $profile.projectId
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
