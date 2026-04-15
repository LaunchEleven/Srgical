param(
  [switch]$SkipBuild,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArgs
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required to run srgical."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required to run srgical."
}

$resolvedArgs = if ($CliArgs -and $CliArgs.Count -gt 0) {
  $CliArgs
} else {
  @("studio")
}

if (-not $SkipBuild) {
  Write-Host "Building srgical..."
  & npm run build

  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

Write-Host ("Starting srgical " + ($resolvedArgs -join " ") + "...")
& node apps/cli/dist/index.js $resolvedArgs
exit $LASTEXITCODE
