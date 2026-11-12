param([string]$Preview)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ($Preview) {
  $previewSignature = Get-AuthenticodeSignature -LiteralPath $Preview
$publisher = 'A4976B6F9EE099393484F05C794F3F19A69EA2B9'
if ($previewSignature.Status -ne 'Valid' -or $previewSignature.SignerCertificate.Thumbprint -ne $publisher) {
    throw "Unexpected preview signature: $($previewSignature.Status)"
  }
}

function Get-VerifiedAsset([string]$Uri, [string]$File, [string]$Sha256) {
  curl.exe --fail --location --retry 3 --output $File $Uri
  if ($LASTEXITCODE -or (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Sha256) {
    throw "Failed to verify $File"
  }
}

$electronZip = Join-Path $env:RUNNER_TEMP 'electron-v41.2.1-win32-x64.zip'
$electron = Join-Path $env:RUNNER_TEMP 'electron41'
Get-VerifiedAsset 'https://github.com/electron/electron/releases/download/v41.2.1/electron-v41.2.1-win32-x64.zip' $electronZip 'b44d951f36dfc785cd04bf7bbb342672df365a62ef3c966073eb46e5838c13dd'
Expand-Archive -LiteralPath $electronZip -DestinationPath $electron -Force
$fixtureScript = Join-Path $PSScriptRoot 'migration-fixtures/fixture-app'
$generator = Start-Process -FilePath "$electron/electron.exe" -ArgumentList ('"' + $fixtureScript + '"') -Wait -PassThru -WindowStyle Hidden
if ($generator.ExitCode -ne 0) { Get-Content ./migration-fixtures/fixture-error.log; throw 'Fixture generation failed' }
$seedPath = Join-Path $PSScriptRoot 'migration-fixtures/seed-evidence.json'
$seed = Get-Content -LiteralPath $seedPath -Raw | ConvertFrom-Json
$shortFixture = Join-Path $env:RUNNER_TEMP 'cs23998-e2e'
Move-Item -LiteralPath $seed.fixture -Destination $shortFixture
$seed.fixture = $shortFixture
$seed | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $seedPath
$portable = Join-Path $shortFixture 'Cherry Studio Portable.exe'
$data = Join-Path $shortFixture 'data'
$history = Join-Path $data 'version.log'
@{ tray = $true; trayOnClose = $true; autoUpdate = $false; enableDataCollection = $false; portableMigrationFixture = 'preserve' } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $data 'config.json')
$first = Join-Path $env:RUNNER_TEMP 'Cherry-Studio-1.9.11-x64-portable.exe'
Get-VerifiedAsset 'https://github.com/CherryHQ/cherry-studio/releases/download/v1.9.11/Cherry-Studio-1.9.11-x64-portable.exe' $first '114c4f6ffde670eb4793976643d7039aec6e13755fc009df61b535b2b90ed348'

function Wait-Version([string]$Version) {
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  do {
    if (Test-Path -LiteralPath $history) {
      $lines = @(Get-Content -LiteralPath $history)
      if ($lines[-1].StartsWith("$Version|win|prod|packaged|portable|")) { return $lines }
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "$Version did not record its startup"
}

function Stop-Portable([int]$WrapperId) {
  $wrapper = Get-CimInstance Win32_Process -Filter "ProcessId = $WrapperId"
  if ($wrapper -and $wrapper.ExecutablePath -ine $portable) { throw 'Unexpected fixture process' }
  if ($wrapper) {
    $app = Get-CimInstance Win32_Process -Filter "ParentProcessId = $WrapperId" | Select-Object -First 1
    if ($app) {
      $main = Get-Process -Id $app.ProcessId -ErrorAction SilentlyContinue
      if ($main) { $null = $main.CloseMainWindow() }
      Start-Sleep -Seconds 3
    }
    if (Get-Process -Id $WrapperId -ErrorAction SilentlyContinue) {
      taskkill.exe /PID $WrapperId /T /F
    }
  }
  $remaining = Get-Process -Id $WrapperId -ErrorAction SilentlyContinue
  if ($remaining) { $remaining.WaitForExit(15000) | Out-Null }
}

Copy-Item -LiteralPath $first -Destination $portable
Remove-Item -LiteralPath $history
$oldHome = $env:USERPROFILE
$oldRoaming = $env:APPDATA
$oldLocal = $env:LOCALAPPDATA
$oldTemp = $env:TEMP
$oldTmp = $env:TMP
try {
  $env:USERPROFILE = Join-Path $shortFixture 'home'
  $env:APPDATA = Join-Path $env:USERPROFILE 'AppData/Roaming'
  $env:LOCALAPPDATA = Join-Path $env:USERPROFILE 'AppData/Local'
  $env:TEMP = Join-Path $shortFixture 'temp'
  $env:TMP = $env:TEMP
  $null = New-Item -ItemType Directory -Force $env:APPDATA,$env:LOCALAPPDATA,$env:TEMP
  $firstInstance = Start-Process -FilePath $portable -WorkingDirectory $shortFixture -PassThru -WindowStyle Hidden
  Wait-Version '1.9.11' | Set-Content ./1.9.11-history.txt
  Start-Sleep -Seconds 4
} finally {
  if ($firstInstance) { Stop-Portable $firstInstance.Id }
  $env:USERPROFILE = $oldHome
  $env:APPDATA = $oldRoaming
  $env:LOCALAPPDATA = $oldLocal
  $env:TEMP = $oldTemp
  $env:TMP = $oldTmp
}

if (!$Preview) {
  $asset = Join-Path $env:RUNNER_TEMP 'Cherry-Studio-1.9.12-x64-portable.exe'
  Get-VerifiedAsset 'https://gitcode.com/CherryHQ/cherry-studio/releases/download/v1.9.12/Cherry-Studio-1.9.12-x64-portable.exe' $asset 'AF72B381030A7C1EBCE5479523219029E54FE19E1F09847254F7CE584A208ED4'
  $stage = $portable + '.update-' + [Guid]::NewGuid().ToString() + '.exe'
  Copy-Item -LiteralPath $asset -Destination $stage
  $configPath = Join-Path $data 'config.json'
  $settings = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $settings.trayOnClose = $false
  $settings | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $configPath
  try {
    $env:USERPROFILE = Join-Path $shortFixture 'home'
    $env:APPDATA = Join-Path $env:USERPROFILE 'AppData/Roaming'
    $env:LOCALAPPDATA = Join-Path $env:USERPROFILE 'AppData/Local'
    $env:TEMP = Join-Path $shortFixture 'temp'
    $env:TMP = $env:TEMP
    $wrapper = Start-Process -FilePath $stage -WorkingDirectory $shortFixture -PassThru -WindowStyle Hidden -ArgumentList '--remote-debugging-port=49239','--remote-debugging-address=127.0.0.1'
    Wait-Version '1.9.12' | Set-Content ./1.9.12-history.txt
    $closeButton = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    do {
      $main = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($wrapper.Id)" |
        Where-Object { $_.ExecutablePath -like "$env:TEMP*" -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1
      if ($main) {
        $closeButton = powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./migration-fixtures/close-prerequisite.ps1 -ProcessId $main.ProcessId -Executable $main.ExecutablePath
        if ($closeButton -and $LASTEXITCODE -eq 0) { break }
      }
      Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    if (!$closeButton -or !$wrapper.WaitForExit(45000) -or $wrapper.ExitCode -ne 0) {
      node ./legacy-window-debug.cjs
      throw 'The 1.9.12 Close control was not invoked successfully'
    }
    $closeButton | Set-Content ./prerequisite-exit.json
  } finally {
    $env:USERPROFILE = $oldHome
    $env:APPDATA = $oldRoaming
    $env:LOCALAPPDATA = $oldLocal
    $env:TEMP = $oldTemp
    $env:TMP = $oldTmp
  }
  return
}

node ./verify.cjs $Preview $seedPath '895800c82db92069706d13471125e1be16e267ec'
if ($LASTEXITCODE) { exit $LASTEXITCODE }
(Get-Content ./migration-fixtures/relaunch-2.1.0.json -Raw | ConvertFrom-Json).recordedHistory |
  Set-Content ./1.9.12-history.txt

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./migration-fixtures/complete-bridge.ps1 -Relaunch (Join-Path $PSScriptRoot 'migration-fixtures/relaunch-2.1.0.json') -EvidencePrefix 'prerequisite'

if ($LASTEXITCODE) { exit $LASTEXITCODE }
