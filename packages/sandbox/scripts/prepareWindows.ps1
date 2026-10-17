$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an administrator PowerShell. It prepares the system-drive metadata ACL and the Null device for MXC.'
}
$architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$helper = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../node_modules/@microsoft/mxc-sdk/bin/$architecture/wxc-host-prep.exe"))
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw "MXC host-prep is missing: $helper. Run pnpm install first." }
foreach ($operation in @('prepare-system-drive', 'prepare-null-device')) {
    & $helper $operation
    if ($LASTEXITCODE -ne 0) { throw "MXC $operation failed with exit code $LASTEXITCODE" }
}
Write-Output 'MXC Windows host preparation completed. Null-device preparation must be repeated after Windows restarts.'
