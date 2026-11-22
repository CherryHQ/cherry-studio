# Cherry Studio managed PowerShell integration.
$global:__CherryToken = $env:CHERRY_TERMINAL_TOKEN
Remove-Item Env:CHERRY_TERMINAL_TOKEN
$global:__CherrySequence = 0
$global:__CherryCommandResult = $null
$global:__CherryPendingPrompt = 0
$global:__CherryOriginalPrompt = $function:prompt
function global:prompt {
    $lastSuccess = $?
    $result = if ($null -ne $global:__CherryCommandResult) { $global:__CherryCommandResult } elseif ($lastSuccess) { 0 } elseif ($global:LASTEXITCODE) { $global:LASTEXITCODE } else { 1 }
    $global:__CherryCommandResult = $null
    $global:__CherrySequence++
    $global:__CherryPendingPrompt = $global:__CherrySequence
    $cwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PWD.ProviderPath))
    [Console]::Write("$([char]27)]633;Cherry;$global:__CherryToken;$global:__CherrySequence;P;$result;$cwd$([char]7)")
    if ($global:__CherryOriginalPrompt) { & $global:__CherryOriginalPrompt } else { "PS $PWD> " }
}
Import-Module PSReadLine -ErrorAction SilentlyContinue
$global:__CherryOriginalReadLine = $function:PSConsoleHostReadLine
if ($global:__CherryOriginalReadLine) {
    function global:PSConsoleHostReadLine {
        $line = & $global:__CherryOriginalReadLine
        if ($line) {
            $global:__CherryPendingPrompt = 0
            $global:__CherrySequence++
            $bytes = [Text.Encoding]::UTF8.GetBytes($line)
            $encoded = if ($bytes.Length -le 8192) { [Convert]::ToBase64String($bytes) } else { '' }
            [Console]::Write("$([char]27)]633;Cherry;$global:__CherryToken;$global:__CherrySequence;B;$encoded$([char]7)")
        }
        return $line
    }
    $null = Register-EngineEvent -SourceIdentifier PowerShell.OnIdle -Action {
        if ($global:__CherryPendingPrompt -gt 0) {
            $line = $null
            $cursor = 0
            [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
            if ([string]::IsNullOrEmpty($line)) {
                $global:__CherrySequence++
                [Console]::Write("$([char]27)]633;Cherry;$global:__CherryToken;$global:__CherrySequence;R;$global:__CherryPendingPrompt$([char]7)")
                $global:__CherryPendingPrompt = 0
            }
        }
    }
}
