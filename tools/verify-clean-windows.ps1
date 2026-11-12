$ErrorActionPreference = "Stop"

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ("vpr-clean-" + [guid]::NewGuid().ToString("N"))))
$expectedPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $temporaryRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing unsafe temporary path: $temporaryRoot"
}

New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
  Push-Location $sourceRoot
  try {
    $files = & git -c core.quotepath=false ls-files --cached --others --exclude-standard
    if ($LASTEXITCODE -ne 0) { throw "git ls-files failed" }
  } finally {
    Pop-Location
  }

  foreach ($relative in $files) {
    $source = Join-Path $sourceRoot $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    $target = Join-Path $temporaryRoot $relative
    $parent = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
  }

  Push-Location $temporaryRoot
  try {
    & git init --quiet
    if ($LASTEXITCODE -ne 0) { throw "temporary git init failed" }
    & git add .
    if ($LASTEXITCODE -ne 0) { throw "temporary git add failed" }
    & git -c user.name=VPR-Fixture -c user.email=fixture@example.invalid commit --quiet -m "Clean verification snapshot"
    if ($LASTEXITCODE -ne 0) { throw "temporary git commit failed" }
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "clean pnpm install failed" }
    & pnpm check
    if ($LASTEXITCODE -ne 0) { throw "clean pnpm check failed" }
    & pnpm vpr
    if ($LASTEXITCODE -ne 2) { throw "CLI smoke expected usage exit code 2" }
  } finally {
    Pop-Location
  }

  Write-Output "clean-install=passed platform=$([Environment]::OSVersion.Platform) path=$temporaryRoot"
} finally {
  if (
    (Test-Path -LiteralPath $temporaryRoot) -and
    $temporaryRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)
  ) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
