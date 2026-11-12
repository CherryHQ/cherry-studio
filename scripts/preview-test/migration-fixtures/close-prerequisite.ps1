param(
  [Parameter(Mandatory)][int]$ProcessId,
  [Parameter(Mandatory)][string]$Executable
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$process = Get-Process -Id $ProcessId -ErrorAction Stop
if ($process.Path -ine $Executable) { throw 'Unexpected legacy executable' }
if ($process.MainWindowHandle -eq [IntPtr]::Zero) { return }
$window = [Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
if ($window.Current.ProcessId -ne $ProcessId) { throw 'Unexpected legacy window' }
$bounds = $window.Current.BoundingRectangle
$condition = [Windows.Automation.PropertyCondition]::new(
  [Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
$buttons = @($window.FindAll([Windows.Automation.TreeScope]::Descendants, $condition) | Where-Object {
  $box = $_.Current.BoundingRectangle
  $_.Current.Name -in 'Close','关闭' -and $_.Current.IsEnabled -and ! $_.Current.IsOffscreen -and
    $box.Top -le ($bounds.Top + 52) -and $box.Right -ge ($bounds.Right - 50)
})
if ($buttons.Count -ne 1) { return }
$name = $buttons[0].Current.Name
$buttons[0].GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
@{ pid = $ProcessId; name = $name; position = 'top-right' } | ConvertTo-Json -Compress
