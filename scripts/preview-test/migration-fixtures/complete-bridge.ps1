param(
  [string]$Relaunch = (Join-Path $PSScriptRoot 'final-relaunch.json'),
  [ValidatePattern('^[a-z-]+$')][string]$EvidencePrefix = 'signed-fix'
)

$ErrorActionPreference = 'Stop'
$record = Get-Content -LiteralPath $Relaunch -Raw | ConvertFrom-Json
if (!$record.replacedWithExactGitCodeExecutable -or $record.relaunch.version -notmatch '^2\.1\.0\b') {
  throw 'Expected verified replacement and 2.1.0 relaunch evidence'
}
$exe = $record.relaunch.executablePath
$bridgePid = $record.relaunch.electronPid
$root = $record.fixture
$windowTool = Join-Path $PSScriptRoot 'bridge-window.ps1'
$logs = Join-Path $root 'home/AppData/Roaming/CherryStudio/logs'

$deadline = [DateTime]::UtcNow.AddSeconds(30)
$start = $null
do {
  try {
    $state = & $windowTool -ProcessId $bridgePid -Executable $exe -Action inspect | ConvertFrom-Json
    if (@($state.buttons | Where-Object { $_ -in @('Start Migration','开始迁移') }).Count -eq 1) {
      $startScreenshot = Join-Path $PSScriptRoot "$EvidencePrefix-migration-start.png"
      $start = & $windowTool -ProcessId $bridgePid -Executable $exe -Action start -Screenshot $startScreenshot | ConvertFrom-Json
    }
  } catch {
    $lastWindowError = $_
  }
  if (!$start) { Start-Sleep -Milliseconds 400 }
} while (!$start -and [DateTime]::UtcNow -lt $deadline)
if (!$start) { throw "Cannot invoke the tracked migration wizard: $lastWindowError" }
if (!(Test-Path -LiteralPath $logs)) { throw 'Expected isolated 2.1.0 logs' }
$start | ConvertTo-Json -Compress

$verifiedPath = Join-Path $PSScriptRoot "$EvidencePrefix-sqlite-evidence.json"
$deadline = [DateTime]::UtcNow.AddSeconds(150)
do {
  $output = node (Join-Path $PSScriptRoot 'verify-migrated-data.cjs') $root $verifiedPath 2>&1
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 1
} while ([DateTime]::UtcNow -lt $deadline)
if ($LASTEXITCODE -ne 0) { throw ($output | Out-String) }
$output

$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  $completed = & $windowTool -ProcessId $bridgePid -Executable $exe -Action inspect | ConvertFrom-Json
  if ('Restart App' -in $completed.buttons -or '重启应用' -in $completed.buttons) { break }
  Start-Sleep -Milliseconds 400
} while ([DateTime]::UtcNow -lt $deadline)
if ('Restart App' -notin $completed.buttons -and '重启应用' -notin $completed.buttons) {
  throw 'SQLite completion verified, but the completion button was not present'
}
$completedScreenshot = Join-Path $PSScriptRoot "$EvidencePrefix-migration-completed.png"
& $windowTool -ProcessId $bridgePid -Executable $exe -Action inspect -Screenshot $completedScreenshot

& $windowTool -ProcessId $bridgePid -Executable $exe -Action close
$deadline = [DateTime]::UtcNow.AddSeconds(20)
do {
  $remaining = @(Get-Process -Id $record.relaunch.wrapperPid,$bridgePid -ErrorAction SilentlyContinue)
  if (!$remaining.Count) { break }
  Start-Sleep -Milliseconds 300
} while ([DateTime]::UtcNow -lt $deadline)
if ($remaining.Count) { throw 'The isolated migration instance has not finished closing' }
if (@(Get-ChildItem -LiteralPath $root -File -Filter '*.update-*' | Where-Object { $_.Extension -ne '.previous' }).Count) {
  throw 'An unexpected staging or backup file remains after successful replacement'
}

[ordered]@{
  started = $start.invoked
  completedButtons = $completed.buttons
  database = $verifiedPath
  wrapperExited = $true
  electronExited = $true
  noStagedUpdate = $true
} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot "$EvidencePrefix-completion.json")
