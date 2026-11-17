import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { RunPaths } from './paths'

export interface WindowsTerminal {
  pid: number
  startedAt: string
}

function terminalCandidates(paths: RunPaths): string {
  return [
    `$root = '${paths.root.replaceAll("'", "''")}'`,
    `$candidates = @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine.Contains('launch_claude-code_') })`,
    '$rows = @($candidates | ForEach-Object { @{ pid = [int]$_.ProcessId; startedAt = $_.CreationDate.ToUniversalTime().Ticks.ToString() } })'
  ].join('; ')
}

export function listWindowsCodeTerminals(paths: RunPaths): WindowsTerminal[] {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$output = [Console]::OpenStandardOutput()',
    `Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(CONSOLE_DRIVER).toString('base64')}')))`,
    terminalCandidates(paths),
    '$terminals = @()',
    '$seen = @{}',
    'foreach ($row in $rows) {',
    '  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($row.pid)"',
    '  if (-not $current -or $current.CreationDate.ToUniversalTime().Ticks.ToString() -ne $row.startedAt) { continue }',
    '  $window = [OwnedConsole]::Window($row.pid).ToString()',
    '  $row.consoleWindow = $window',
    '  if ($window -ne "0" -and -not $seen.ContainsKey($window)) {',
    '    $seen[$window] = $true',
    '    $terminals += @{ pid = $row.pid; startedAt = $row.startedAt }',
    '  }',
    '}',
    '$json = ConvertTo-Json -InputObject @{ terminals = @($terminals); candidates = @($rows) } -Compress',
    '$bytes = [Text.Encoding]::UTF8.GetBytes($json)',
    '$output.Write($bytes, 0, $bytes.Length)',
    '$output.Flush()'
  ].join('\n')
  const result = JSON.parse(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true
    })
  ) as { terminals: WindowsTerminal[]; candidates: (WindowsTerminal & { consoleWindow?: string })[] }
  writeFileSync(join(paths.logs, 'windows-terminal-candidates.json'), JSON.stringify(result.candidates))
  return result.terminals
}

const CONSOLE_DRIVER = String.raw`
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class OwnedConsole {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public short X; public short Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public short Left; public short Top; public short Right; public short Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct BufferInfo { public Point Size; public Point Cursor; public ushort Attributes; public Rect Window; public Point Maximum; }
  [StructLayout(LayoutKind.Explicit, Size = 20, CharSet = CharSet.Unicode)] public struct Input {
    [FieldOffset(0)] public ushort Type;
    [FieldOffset(4)] public int Down;
    [FieldOffset(8)] public ushort Repeat;
    [FieldOffset(10)] public ushort Key;
    [FieldOffset(12)] public ushort Scan;
    [FieldOffset(14)] public char Character;
    [FieldOffset(16)] public uint State;
  }
  [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] private static extern bool FreeConsole();
  [DllImport("kernel32.dll")] private static extern IntPtr GetConsoleWindow();
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetConsoleScreenBufferInfo(IntPtr handle, out BufferInfo info);
  [DllImport("kernel32.dll", EntryPoint = "ReadConsoleOutputCharacterW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Read(IntPtr handle, StringBuilder text, uint count, Point position, out uint read);
  [DllImport("kernel32.dll", EntryPoint = "WriteConsoleInputW", SetLastError = true)] private static extern bool Write(IntPtr handle, Input[] events, uint count, out uint written);
  private static IntPtr Open(uint pid, bool writeInput, bool probe = false) {
    FreeConsole();
    if (!AttachConsole(pid)) {
      int error = Marshal.GetLastWin32Error();
      if (probe && error == 87) return new IntPtr(-1);
      throw new Win32Exception(error);
    }
    if (GetConsoleWindow() == IntPtr.Zero) throw new Win32Exception(6);
    IntPtr handle = CreateFile(writeInput ? "CONIN$" : "CONOUT$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    return handle;
  }
  public static long Window(uint pid) {
    IntPtr handle = new IntPtr(-1);
    try {
      handle = Open(pid, false, true);
      if (handle == new IntPtr(-1)) return 0;
      BufferInfo info;
      if (!GetConsoleScreenBufferInfo(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
      return GetConsoleWindow().ToInt64();
    } catch (Win32Exception error) {
      if (error.NativeErrorCode == 6) return 0;
      throw;
    } finally { if (handle != new IntPtr(-1)) CloseHandle(handle); FreeConsole(); }
  }
  public static string Run(uint pid, bool writeInput, string text, ushort? key) {
    IntPtr handle = new IntPtr(-1);
    try {
      handle = Open(pid, writeInput);
      if (writeInput) {
        int count = text.Length + (key.HasValue ? 1 : 0);
        Input[] events = new Input[count * 2];
        for (int i = 0; i < count; i++) {
          char character = i < text.Length ? text[i] : key == 13 ? '\r' : key == 27 ? '\u001b' : '\0';
          events[i * 2] = new Input { Type = 1, Down = 1, Repeat = 1, Key = i < text.Length ? (ushort)0 : key.GetValueOrDefault(), Character = character };
          events[i * 2 + 1] = events[i * 2]; events[i * 2 + 1].Down = 0;
        }
        uint written;
        if (!Write(handle, events, (uint)events.Length, out written) || written != events.Length) throw new Win32Exception(Marshal.GetLastWin32Error());
        return "";
      }
      BufferInfo info;
      if (!GetConsoleScreenBufferInfo(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
      int rows = Math.Min(info.Size.Y, Math.Max(info.Cursor.Y, info.Window.Bottom) + 1);
      int length = info.Size.X * rows;
      StringBuilder buffer = new StringBuilder(length);
      uint read;
      if (!Read(handle, buffer, (uint)length, new Point(), out read)) throw new Win32Exception(Marshal.GetLastWin32Error());
      string value = buffer.ToString();
      StringBuilder lines = new StringBuilder();
      for (int offset = 0; offset < value.Length; offset += info.Size.X) lines.AppendLine(value.Substring(offset, Math.Min(info.Size.X, value.Length - offset)).TrimEnd());
      return lines.ToString();
    } catch (Win32Exception error) {
      if (!writeInput && error.NativeErrorCode == 6) return "";
      throw;
    } finally { if (handle != new IntPtr(-1)) CloseHandle(handle); FreeConsole(); }
  }
}
`

export function windowsTerminalText(
  paths: RunPaths,
  terminal: WindowsTerminal,
  input?: string,
  key: number | null = 13
): string {
  if (!Number.isSafeInteger(terminal.pid) || terminal.pid <= 0 || !/^\d+$/.test(terminal.startedAt))
    throw new Error('Invalid owned CLI terminal identity')
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$output = [Console]::OpenStandardOutput()',
    `Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(CONSOLE_DRIVER).toString('base64')}')))`,
    input === undefined
      ? '$text = $null'
      : `$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(input).toString('base64')}'))`,
    terminalCandidates(paths),
    `if (-not ($rows | Where-Object { $_.pid -eq ${terminal.pid} -and $_.startedAt -eq '${terminal.startedAt}' })) { throw 'The owned CLI terminal is no longer running' }`,
    `$result = [OwnedConsole]::Run(${terminal.pid}, $${input !== undefined}, $text, ${key === null ? '$null' : key})`,
    '$bytes = [Text.Encoding]::UTF8.GetBytes($result)',
    '$output.Write($bytes, 0, $bytes.Length)',
    '$output.Flush()'
  ].join('; ')
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  })
}
