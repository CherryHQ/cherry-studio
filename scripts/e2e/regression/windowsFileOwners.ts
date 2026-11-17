import { execFileSync } from 'node:child_process'

import { resolveAllowedPath, type RunPaths } from './paths'

// Restart Manager enumerates existing file users without requiring a handle.exe download.
// Only registration/query/end APIs are exposed; this probe cannot stop or restart applications.
const FILE_OWNERS = String.raw`
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class FileOwners {
  [StructLayout(LayoutKind.Sequential)]
  public struct UniqueProcess { public int Pid; public System.Runtime.InteropServices.ComTypes.FILETIME Started; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct ProcessInfo {
    public UniqueProcess Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Application;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string Service;
    public int Type; public uint Status; public uint Session;
    [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  private static extern int RmStartSession(out uint handle, uint flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  private static extern int RmRegisterResources(uint handle, uint fileCount, string[] files, uint processCount, UniqueProcess[] processes, uint serviceCount, string[] services);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  private static extern int RmGetList(uint handle, out uint needed, ref uint count, [In, Out] ProcessInfo[] processes, ref uint reasons);
  [DllImport("rstrtmgr.dll")]
  private static extern int RmEndSession(uint handle);
  public static int[] Read(string file) {
    uint handle;
    int result = RmStartSession(out handle, 0, new StringBuilder(33));
    if (result != 0) throw new Win32Exception(result);
    try {
      result = RmRegisterResources(handle, 1, new string[] { file }, 0, null, 0, null);
      if (result != 0) throw new Win32Exception(result);
      uint needed = 0, count = 0, reasons = 0;
      ProcessInfo[] processes = null;
      for (int attempt = 0; attempt < 3; attempt++) {
        result = RmGetList(handle, out needed, ref count, processes, ref reasons);
        if (result == 0) {
          int[] owners = new int[count];
          for (int index = 0; index < count; index++) owners[index] = processes[index].Process.Pid;
          return owners;
        }
        if (result != 234) throw new Win32Exception(result);
        count = needed;
        processes = new ProcessInfo[count];
      }
      throw new Win32Exception(result);
    } finally { RmEndSession(handle); }
  }
}
`

export function readWindowsFileOwners(paths: RunPaths, candidate: string): number[] {
  const file = resolveAllowedPath(candidate, [paths.profiles])
  const script = [
    '$ErrorActionPreference = "Stop"',
    `Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(FILE_OWNERS).toString('base64')}')))`,
    `$file = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(file).toString('base64')}'))`,
    'ConvertTo-Json -InputObject @([FileOwners]::Read($file)) -Compress'
  ].join('; ')
  const owners = JSON.parse(
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 15_000
    })
  ) as number[]
  return [...new Set(owners)].sort((a, b) => a - b)
}
