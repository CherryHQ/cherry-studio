export const WINDOWS_EXTERNAL_APP_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ExternalWindow { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'
$handles = @{}
$target = $request.target
function Inspect-External {
  $processes = @()
  $windows = @()
  $native = @(Get-CimInstance Win32_Process)
  if ($target.kind -eq 'folder') {
    $shell = New-Object -ComObject Shell.Application
    foreach ($window in @($shell.Windows())) {
      if ($window.FullName -notmatch '(?i)\\explorer\.exe$') { continue }
      [uint32]$owner = 0
      [ExternalWindow]::GetWindowThreadProcessId([IntPtr]$window.HWND, [ref]$owner) | Out-Null
      $process = Get-Process -Id $owner -ErrorAction Stop
      $startedAt = $process.StartTime.ToUniversalTime().Ticks.ToString()
      $processes += @{ pid = [int]$owner; startedAt = $startedAt; application = 'explorer.exe'; shared = $true }
      $id = "$owner" + ':' + $startedAt + ':explorer:' + $window.HWND
      $directory = $window.Document.Folder.Self.Path
      $windows += @{ id = $id; pid = [int]$owner; matches = $directory -eq [IO.Path]::GetDirectoryName($target.path) }
      $handles[$id] = @{ explorer = $window }
    }
    return @{ processes = $processes; windows = $windows }
  }
  foreach ($entry in $native) {
    $browser = $entry.Name -match '^(chrome|msedge|firefox|brave)\.exe$'
    $terminal = $entry.Name -match '^(cmd|powershell|pwsh|WindowsTerminal)\.exe$'
    $document = $target.kind -eq 'document' -and $target.application -eq 'Notepad' -and $entry.Name -eq 'notepad.exe'
    if (($target.kind -eq 'browser' -and -not $browser) -or ($target.kind -eq 'terminal' -and -not $terminal) -or ($target.kind -eq 'document' -and -not $document)) { continue }
    if ($target.kind -notin @('browser', 'terminal', 'document')) { throw 'Unsupported Windows external resource' }
    $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    if ($browser -and $entry.CommandLine -match '--type=') { continue }
    $ownedCommand = $entry.CommandLine -and $entry.CommandLine.IndexOf($request.root, [StringComparison]::OrdinalIgnoreCase) -ge 0
    if ($document) { $ownedCommand = $entry.CommandLine -and $entry.CommandLine.IndexOf($target.path, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
    if ($terminal -and $process.MainWindowHandle -eq 0 -and -not $ownedCommand) { continue }
    $startedAt = $process.StartTime.ToUniversalTime().Ticks.ToString()
    $pidValue = [int]$process.Id
    $processes += @{ pid = $pidValue; startedAt = $startedAt; application = $entry.Name; shared = $false }
    $prefix = "$pidValue" + ':' + $startedAt + ':'
    $processCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty, $pidValue)
    $roots = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $processCondition)
    if ($browser) {
      foreach ($root in $roots) {
      $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::TabItem)
      $tabs = $root.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
      if ($tabs.Count -eq 0) { throw "Browser tabs are not exposed for cleanup: $pidValue" }
      foreach ($tab in $tabs) {
        $id = $prefix + ($tab.GetRuntimeId() -join '.')
        $windows += @{ id = $id; pid = $pidValue; matches = $tab.Current.Name.Contains($target.title) }
        $handles[$id] = @{ tab = $tab; root = $root }
      }
      }
    } else {
      if ($process.MainWindowHandle -eq 0) { continue }
      $id = $prefix + $process.MainWindowHandle
      $windows += @{ id = $id; pid = $pidValue; matches = [bool]$ownedCommand }
      $handles[$id] = @{ process = $process }
    }
  }
  return @{ processes = $processes; windows = $windows }
}
$snapshot = Inspect-External
if ($request.action -eq 'inspect') { $snapshot | ConvertTo-Json -Depth 8 -Compress; exit }
if ($request.window -and $handles.ContainsKey($request.window.id) -and $target.kind -eq 'folder') {
  $handles[$request.window.id].explorer.Quit()
} else {
  $expected = $request.process
  $current = @($snapshot.processes | Where-Object { $_.pid -eq $expected.pid -and $_.startedAt -eq $expected.startedAt })
  if ($current.Count -eq 0) { $snapshot | ConvertTo-Json -Depth 8 -Compress; exit }
  if ($current[0].shared) { throw 'Refusing to terminate the shared file manager' }
  $process = Get-Process -Id $expected.pid -ErrorAction SilentlyContinue
  if (-not $process -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $expected.startedAt) {
    Inspect-External | ConvertTo-Json -Depth 8 -Compress
    exit
  }
  if ($request.action -eq 'close') {
    $handle = $handles[$request.window.id]
    if ($handle.tab) {
      $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
      $close = $handle.tab.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
      if ($close) {
        $close.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
      } else {
        $selection = $handle.tab.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
        $selection.Select()
        $hwnd = [IntPtr]$handle.root.Current.NativeWindowHandle
        [ExternalWindow]::SetForegroundWindow($hwnd) | Out-Null
        if ([ExternalWindow]::GetForegroundWindow() -ne $hwnd) { throw 'Could not activate the owned browser window' }
        (New-Object -ComObject WScript.Shell).SendKeys('^w')
      }
    } elseif ($handle.process) { $process.CloseMainWindow() | Out-Null }
  } else {
    if (@($snapshot.windows | Where-Object { $_.pid -eq $expected.pid -and $_.id -notin $request.owned }).Count) { throw 'External application contains unrelated windows' }
    if ($request.action -eq 'force') {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
      if ($LASTEXITCODE -ne 0 -and -not $process.HasExited) { throw 'Could not terminate the owned application tree' }
    } else { $process.CloseMainWindow() | Out-Null }
  }
}
$deadline = [DateTime]::UtcNow.AddSeconds(3)
do {
  Start-Sleep -Milliseconds 100
  $snapshot = Inspect-External
  if ($request.action -eq 'close') {
    $remaining = @($snapshot.windows | Where-Object { $_.id -eq $request.window.id })
  } else {
    $remaining = @($snapshot.processes | Where-Object { $_.pid -eq $request.process.pid -and $_.startedAt -eq $request.process.startedAt })
  }
} while ($remaining.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
$snapshot | ConvertTo-Json -Depth 8 -Compress
`
