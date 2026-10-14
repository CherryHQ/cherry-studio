param([switch] $Tts)
$ErrorActionPreference = 'Stop'
$smoke = Join-Path $PSScriptRoot '..\scripts\smoke-windows.cjs'
if ($Tts) { & node $smoke --tts } else { & node $smoke }
exit $LASTEXITCODE
