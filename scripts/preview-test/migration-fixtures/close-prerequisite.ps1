param(
  [Parameter(Mandatory)][int]$ProcessId,
  [Parameter(Mandatory)][string]$Executable
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$process = Get-Process -Id $ProcessId -ErrorAction Stop
if ($process.Path -ine $Executable) { throw 'Unexpected legacy executable' }
$hwnd = $process.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero -or $process.MainWindowTitle -notmatch '^Cherry Studio') { return }

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PrerequisiteClose {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr ChildWindowFromPointEx(IntPtr window, Point point, uint flags);
    [DllImport("user32.dll")] static extern int MapWindowPoints(IntPtr from, IntPtr to, ref Point point, uint count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr buttons, IntPtr point);
    public static Point Click(IntPtr window, uint expectedProcess) {
        Rect bounds;
        if (!GetClientRect(window, out bounds)) throw new InvalidOperationException("No client bounds");
        double scale = GetDpiForWindow(window) / 96.0;
        Point position = new Point { X = bounds.Right - (int)(23 * scale), Y = (int)(18 * scale) };
        Point childPosition = position;
        IntPtr target = ChildWindowFromPointEx(window, position, 7);
        if (target == IntPtr.Zero) target = window;
        uint process;
        GetWindowThreadProcessId(target, out process);
        if (process != expectedProcess) throw new InvalidOperationException("Unexpected pointer target");
        if (target != window) MapWindowPoints(window, target, ref childPosition, 1);
        var point = new IntPtr((childPosition.Y << 16) | (childPosition.X & 0xffff));
        if (!PostMessage(target, 0x0200, IntPtr.Zero, point) ||
            !PostMessage(target, 0x0201, new IntPtr(1), point) ||
            !PostMessage(target, 0x0202, IntPtr.Zero, point)) {
            throw new InvalidOperationException("Could not click the top-right window control");
        }
        return position;
    }
}
"@
$bounds = New-Object PrerequisiteClose+Rect
if (![PrerequisiteClose]::GetClientRect($hwnd, [ref]$bounds)) { throw 'Missing legacy window bounds' }
$bitmap = New-Object Drawing.Bitmap $bounds.Right, $bounds.Bottom
$graphics = [Drawing.Graphics]::FromImage($bitmap)
try {
  $dc = $graphics.GetHdc()
  try { $captured = [PrerequisiteClose]::PrintWindow($hwnd, $dc, 3) } finally { $graphics.ReleaseHdc($dc) }
  if ($captured) {
    $bitmap.Save((Join-Path $PSScriptRoot 'prerequisite-window-before-close.png'), [Drawing.Imaging.ImageFormat]::Png)
  }
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
$point = [PrerequisiteClose]::Click($hwnd, $ProcessId)
@{ pid = $ProcessId; title = $process.MainWindowTitle; position = 'top-right'; x = $point.X; y = $point.Y } |
  ConvertTo-Json -Compress
