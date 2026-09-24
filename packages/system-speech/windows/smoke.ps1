$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot 'cherry-system-speech.exe'

& (Join-Path $PSScriptRoot 'build.cmd')
if ($LASTEXITCODE -ne 0) { throw 'Windows helper build failed' }

function Invoke-Helper([string] $request) {
  $response = $request | & $helper | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Windows helper exited unsuccessfully' }
  return $response
}

$capabilities = Invoke-Helper '{"operation":"capabilities","locale":"en-US"}'
if (!$capabilities.ok -or $capabilities.value.operation -ne 'capabilities') {
  throw 'Invalid capabilities response'
}

$locales = Invoke-Helper '{"operation":"list_asr_locales"}'
if (!$locales.ok -or $locales.value.operation -ne 'list_asr_locales') {
  throw 'Invalid locale response'
}

$invalid = Invoke-Helper '{}'
if ($invalid.ok -or $invalid.error.code -ne 'invalid_request') {
  throw 'Invalid request was accepted'
}

Write-Output 'Windows helper protocol smoke passed'
