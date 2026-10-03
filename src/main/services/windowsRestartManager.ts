import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { app } from 'electron'
import * as z from 'zod'

import { application } from '@application'

const execFileAsync = promisify(execFile)
const processSchema = z.object({
  pid: z.number().int().positive(),
  started: z.string().regex(/^\d+$/),
  name: z.string(),
  executable: z.string()
})
export type DatabaseProcess = z.infer<typeof processSchema>

// Restart Manager binds process identity to PID and creation time, including during shutdown.
const nativeSource = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class DatabaseRestartManager {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct UniqueProcess { public uint Pid; public long Started; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct ProcessInfo {
    public UniqueProcess Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string Service;
    public uint Type, Status, Session;
    [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
  }
  public class Owner {
    public uint pid;
    public string started, name, executable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmStartSession(out uint session, uint flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmRegisterResources(uint session, uint count, string[] files,
    uint processCount, UniqueProcess[] processes, uint serviceCount, string[] services);
  [DllImport("rstrtmgr.dll")]
  static extern int RmGetList(uint session, out uint needed, ref uint count,
    [In, Out] ProcessInfo[] info, ref uint reasons);
  [DllImport("rstrtmgr.dll")]
  static extern int RmShutdown(uint session, uint flags, IntPtr callback);
  [DllImport("rstrtmgr.dll")]
  static extern int RmEndSession(uint session);
  static void Check(int code) {
    if (code != 0) throw new System.ComponentModel.Win32Exception(code);
  }
  static ProcessInfo[] Read(uint session) {
    uint count = 0, needed = 0, reasons = 0;
    for (int attempt = 0; attempt < 4; attempt++) {
      var rows = new ProcessInfo[count];
      int code = RmGetList(session, out needed, ref count, rows, ref reasons);
      if (code == 234) { count = needed; continue; }
      Check(code);
      Array.Resize(ref rows, (int)count);
      return rows;
    }
    throw new InvalidOperationException("Process list kept changing");
  }
  public static Owner[] List(string database, int self) {
    uint session;
    Check(RmStartSession(out session, 0, new StringBuilder(33)));
    try {
      var files = new List<string>();
      foreach (string suffix in new [] { "", "-wal", "-shm" }) {
        if (File.Exists(database + suffix)) files.Add(database + suffix);
      }
      if (files.Count == 0) return new Owner[0];
      Check(RmRegisterResources(session, (uint)files.Count, files.ToArray(), 0, null, 0, null));
      var owners = new List<Owner>();
      foreach (var row in Read(session)) {
        if (row.Process.Pid == self) continue;
        string executable = "";
        try {
          using (var process = Process.GetProcessById((int)row.Process.Pid)) {
            if (process.StartTime.ToUniversalTime().ToFileTimeUtc() != row.Process.Started) continue;
            executable = process.MainModule.FileName;
          }
        } catch { }
        owners.Add(new Owner { pid = row.Process.Pid, started = row.Process.Started.ToString(),
          name = row.Name, executable = executable });
      }
      return owners.ToArray();
    } finally { RmEndSession(session); }
  }
  public static int Stop(string database, int self, uint pid, string started, string executable, bool force) {
    Owner match = Array.Find(List(database, self), p => p.pid == pid && p.started == started &&
      String.Equals(p.executable, executable, StringComparison.OrdinalIgnoreCase));
    if (match == null || pid == self || String.IsNullOrEmpty(executable))
      throw new InvalidOperationException("Database process identity changed");
    uint session;
    Check(RmStartSession(out session, 0, new StringBuilder(33)));
    try {
      var target = new UniqueProcess { Pid = pid, Started = Int64.Parse(started) };
      Check(RmRegisterResources(session, 0, null, 1, new [] { target }, 0, null));
      foreach (var row in Read(session)) {
        if (row.Process.Pid != pid || row.Process.Started != target.Started)
          throw new InvalidOperationException("Unexpected shutdown target");
      }
      return RmShutdown(session, force ? 1u : 0u, IntPtr.Zero);
    } finally { RmEndSession(session); }
  }
}`

async function invoke(input: object, action: string, signal?: AbortSignal): Promise<unknown> {
  if (process.platform !== 'win32') throw new Error('Restart Manager requires Windows')
  const payload = Buffer.from(JSON.stringify(input)).toString('base64')
  const script = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
${nativeSource}
'@
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
${action}`
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { signal, windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 }
  )
  return JSON.parse(stdout.trim())
}

export async function listDatabaseProcesses(database: string, signal?: AbortSignal): Promise<DatabaseProcess[]> {
  const result = await invoke(
    { database, self: process.pid },
    'ConvertTo-Json -InputObject @([DatabaseRestartManager]::List($request.database, $request.self)) -Compress -Depth 4',
    signal
  )
  return z.array(processSchema).parse(result)
}

export async function stopDatabaseProcess(
  database: string,
  target: DatabaseProcess,
  force: boolean,
  signal?: AbortSignal
): Promise<void> {
  if (!canStopDatabaseProcess(target)) throw new Error('Not a verified Cherry Studio process')
  const executable = application.getPath('app.exe_file')
  const result = await invoke(
    { database, self: process.pid, ...target, executable, force },
    '[DatabaseRestartManager]::Stop($request.database, $request.self, $request.pid, $request.started, $request.executable, $request.force) | ConvertTo-Json -Compress',
    signal
  )
  // ERROR_FAIL_SHUTDOWN means the application refused; the UI can offer explicit force confirmation.
  if (result !== 0 && (force || result !== 351)) throw new Error(`Restart Manager shutdown failed: ${result}`)
}

export function canStopDatabaseProcess(target: DatabaseProcess): boolean {
  return (
    process.platform === 'win32' &&
    app.isPackaged &&
    target.pid !== process.pid &&
    target.executable.length > 0 &&
    target.executable.toLowerCase() === application.getPath('app.exe_file').toLowerCase()
  )
}
