# Cherry Studio managed PowerShell integration.
$global:__CherryToken = $env:CHERRY_TERMINAL_TOKEN
Remove-Item Env:CHERRY_TERMINAL_TOKEN
$global:__CherrySequence = 0
$global:__CherryOriginalPrompt = $function:prompt
function global:prompt {
    $result = if ($?) { 0 } elseif ($null -ne $global:LASTEXITCODE) { $global:LASTEXITCODE } else { 1 }
    $global:__CherrySequence++
    $cwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PWD.ProviderPath))
    [Console]::Write("$([char]27)]633;Cherry;$global:__CherryToken;$global:__CherrySequence;P;$result;$cwd$([char]7)")
    if ($global:__CherryOriginalPrompt) { & $global:__CherryOriginalPrompt } else { "PS $PWD> " }
}
Import-Module PSReadLine -ErrorAction SilentlyContinue
$command = Get-Command Set-PSReadLineOption -ErrorAction SilentlyContinue
if ($command -and $command.Parameters.ContainsKey('AddToHistoryHandler')) {
    $global:__CherryHistoryHandler = (Get-PSReadLineOption).AddToHistoryHandler
    Set-PSReadLineOption -AddToHistoryHandler {
        param($line)
        $global:__CherrySequence++
        [Console]::Write("$([char]27)]633;Cherry;$global:__CherryToken;$global:__CherrySequence;B$([char]7)")
        if ($global:__CherryHistoryHandler) { return (& $global:__CherryHistoryHandler $line) }
        return $true
    }
}
