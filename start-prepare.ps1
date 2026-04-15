param(
  [string]$PlanId = "init",
  [switch]$SkipBuild,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$args = @("prepare", $PlanId, "--web")

if ($NoOpen) {
  $args += "--no-open"
}

if ($SkipBuild) {
  & "$repoRoot\start.ps1" -SkipBuild @args
} else {
  & "$repoRoot\start.ps1" @args
}

exit $LASTEXITCODE
