param(
  [Parameter(Mandatory)][int]$ProcessId,
  [Parameter(Mandatory)][string]$Executable,
  [ValidateSet('inspect','start','finish','click','close')][string]$Action = 'inspect',
  [string]$Screenshot,
  [ValidateRange(0,1)][double]$X,
  [ValidateRange(0,1)][double]$Y
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$process = Get-Process -Id $ProcessId -ErrorAction Stop
if ($process.Path -ine $Executable) { throw 'Executable identity changed' }
if ($process.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Migration window is not visible' }

if ($Action -eq 'close') {
  if (!$process.CloseMainWindow()) { throw 'Could not request window close' }
  return
}

$window = [Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
if ($window.Current.ProcessId -ne $ProcessId) { throw 'Window identity changed' }
$scope = [Windows.Automation.TreeScope]::Descendants
$buttonCondition = [Windows.Automation.PropertyCondition]::new(
  [Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
$buttons = @($window.FindAll($scope, $buttonCondition) | Where-Object { $_.Current.Name })
$result = [ordered]@{
  pid = $ProcessId
  title = $window.Current.Name
  buttons = @($buttons | ForEach-Object { $_.Current.Name })
}

if ($Screenshot) {
  Add-Type -AssemblyName System.Drawing
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MigrationCapture {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
}
'@
  $bounds = $window.Current.BoundingRectangle
  $bitmap = New-Object Drawing.Bitmap ([int]$bounds.Width), ([int]$bounds.Height)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $hdc = $graphics.GetHdc()
    try {
      if (![MigrationCapture]::PrintWindow($process.MainWindowHandle, $hdc, 2)) { throw 'Window screenshot failed' }
    } finally { $graphics.ReleaseHdc($hdc) }
    $bitmap.Save($Screenshot, [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

if ($Action -eq 'click') {
  if ($result.title -notmatch 'Data Migration|数据迁移') { throw 'Expected the migration wizard window' }
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MigrationInput {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] static extern IntPtr ChildWindowFromPointEx(IntPtr hwnd, Point point, uint flags);
  [DllImport("user32.dll")] static extern int MapWindowPoints(IntPtr from, IntPtr to, ref Point point, uint count);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  public static void Click(IntPtr window, uint pid, double x, double y) {
    Rect rect;
    if (!GetClientRect(window, out rect)) throw new InvalidOperationException("Missing client rectangle");
    var point = new Point { X = (int)((rect.R - rect.L) * x), Y = (int)((rect.B - rect.T) * y) };
    var target = ChildWindowFromPointEx(window, point, 7);
    if (target == IntPtr.Zero) target = window;
    uint actualPid;
    GetWindowThreadProcessId(target, out actualPid);
    if (actualPid != pid) throw new InvalidOperationException("Unexpected input window process");
    if (target != window) MapWindowPoints(window, target, ref point, 1);
    var packed = new IntPtr((point.Y << 16) | (point.X & 0xffff));
    if (!PostMessage(target, 0x0200, IntPtr.Zero, packed) ||
        !PostMessage(target, 0x0201, new IntPtr(1), packed) ||
        !PostMessage(target, 0x0202, IntPtr.Zero, packed)) {
      throw new InvalidOperationException("Could not dispatch window-scoped click");
    }
  }
}
'@
  [MigrationInput]::Click($process.MainWindowHandle, $ProcessId, $X, $Y)
  $result['click'] = @($X, $Y)
}

if ($Action -in 'start','finish') {
  # English and Simplified Chinese resources from the official bridge.
  $names = if ($Action -eq 'start') { @('Start Migration', '开始迁移') } else { @('Start Using', '开始使用', 'Get Started', 'Continue', '继续') }
  $matches = @($buttons | Where-Object { $_.Current.IsEnabled -and $_.Current.Name.Trim() -in $names })
  if ($matches.Count -ne 1) { throw "Expected one enabled $Action button. $($result | ConvertTo-Json -Compress)" }
  $button = $matches[0]
  $result['invoked'] = $button.Current.Name
  $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
}
$result | ConvertTo-Json -Compress
