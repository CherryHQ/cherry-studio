import { execFileSync } from 'node:child_process'

import type { RunPaths } from './paths'

export interface WindowsTerminal {
  pid: number
  startedAt: string
}

export function listWindowsCodeTerminals(paths: RunPaths): WindowsTerminal[] {
  const script = [
    `$root = '${paths.root.replaceAll("'", "''")}'`,
    `$candidates = @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine.Contains('launch_claude-code_') })`,
    '$candidateIds = @($candidates | ForEach-Object { $_.ProcessId })',
    '$rows = @($candidates | Where-Object { $_.ParentProcessId -notin $candidateIds } | ForEach-Object { @{ pid = [int]$_.ProcessId; startedAt = $_.CreationDate.ToUniversalTime().Ticks.ToString() } })',
    'ConvertTo-Json -InputObject $rows -Compress'
  ].join('; ')
  return JSON.parse(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 10_000
    })
  )
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
  public static string Run(uint pid, bool writeInput, string text, ushort key) {
    FreeConsole();
    if (!AttachConsole(pid)) throw new Win32Exception(Marshal.GetLastWin32Error());
    IntPtr handle = new IntPtr(-1);
    try {
      if (GetConsoleWindow() == IntPtr.Zero) throw new Exception("Owned terminal has no native console window");
      handle = CreateFile(writeInput ? "CONIN$" : "CONOUT$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
      if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      if (writeInput) {
        Input[] events = new Input[(text.Length + 1) * 2];
        for (int i = 0; i <= text.Length; i++) {
          char character = i < text.Length ? text[i] : key == 13 ? '\r' : key == 27 ? '\u001b' : '\0';
          events[i * 2] = new Input { Type = 1, Down = 1, Repeat = 1, Key = i < text.Length ? (ushort)0 : key, Character = character };
          events[i * 2 + 1] = events[i * 2]; events[i * 2 + 1].Down = 0;
        }
        uint written;
        if (!Write(handle, events, (uint)events.Length, out written) || written != events.Length) throw new Win32Exception(Marshal.GetLastWin32Error());
        return "";
      }
      BufferInfo info;
      if (!GetConsoleScreenBufferInfo(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
      int length = info.Size.X * (info.Cursor.Y + 1);
      StringBuilder buffer = new StringBuilder(length);
      uint read;
      if (!Read(handle, buffer, (uint)length, new Point(), out read)) throw new Win32Exception(Marshal.GetLastWin32Error());
      string value = buffer.ToString();
      StringBuilder lines = new StringBuilder();
      for (int offset = 0; offset < value.Length; offset += info.Size.X) lines.AppendLine(value.Substring(offset, Math.Min(info.Size.X, value.Length - offset)).TrimEnd());
      return lines.ToString();
    } finally { if (handle != new IntPtr(-1)) CloseHandle(handle); FreeConsole(); }
  }
}
`

export function windowsTerminalText(paths: RunPaths, terminal: WindowsTerminal, input?: string, key = 13): string {
  const current = listWindowsCodeTerminals(paths).find(
    ({ pid, startedAt }) => pid === terminal.pid && startedAt === terminal.startedAt
  )
  if (!current) throw new Error('The owned CLI terminal is no longer running')
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$output = [Console]::OpenStandardOutput()',
    `Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(CONSOLE_DRIVER).toString('base64')}')))`,
    input === undefined
      ? '$text = $null'
      : `$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(input).toString('base64')}'))`,
    `$result = [OwnedConsole]::Run(${terminal.pid}, $${input !== undefined}, $text, ${key})`,
    '$bytes = [Text.Encoding]::UTF8.GetBytes($result)',
    '$output.Write($bytes, 0, $bytes.Length)',
    '$output.Flush()'
  ].join('; ')
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024
  })
}
