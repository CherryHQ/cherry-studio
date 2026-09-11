import { execFileSync } from 'node:child_process'

import type { AppRecord } from './lifecycle'

interface ProcessInfo {
  command: string
  parentPid: number
  pid: number
}

function listProcesses(record: AppRecord): ProcessInfo[] {
  if (record.platform === 'windows') {
    const script =
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 15_000
    }).trim()
    if (!output) return []
    const raw = JSON.parse(output) as
      | { CommandLine?: string; ParentProcessId: number; ProcessId: number }
      | Array<{ CommandLine?: string; ParentProcessId: number; ProcessId: number }>
    return (Array.isArray(raw) ? raw : [raw]).map((processInfo) => ({
      command: processInfo.CommandLine ?? '',
      parentPid: processInfo.ParentProcessId,
      pid: processInfo.ProcessId
    }))
  }

  return execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 15_000 })
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ pid: Number(match[1]), parentPid: Number(match[2]), command: match[3] }))
}

function belongsToApp(processInfo: ProcessInfo, byPid: Map<number, ProcessInfo>, electronPid: number): boolean {
  let current: ProcessInfo | undefined = processInfo
  for (let depth = 0; current && depth < 64; depth += 1) {
    if (current.pid === electronPid) return true
    current = byPid.get(current.parentPid)
  }
  return false
}

export interface ProcessObservation {
  matched: Array<{ command: string; pid: number }>
  passed: boolean
}

export function listOwnedProcessIds(record: AppRecord): number[] {
  const processes = listProcesses(record)
  const byPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]))
  return processes
    .filter(
      (processInfo) => processInfo.pid !== record.electronPid && belongsToApp(processInfo, byPid, record.electronPid)
    )
    .map(({ pid }) => pid)
}

export function observeOwnedProcess(
  record: AppRecord,
  commandFragment: string,
  expectedRunning: boolean,
  baselinePids: ReadonlySet<number> = new Set()
): ProcessObservation {
  const fragment = commandFragment.trim().toLowerCase()
  if (fragment.length < 2) throw new Error('Process evidence requires a command fragment with at least two characters')
  const processes = listProcesses(record)
  const byPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]))
  const allMatches = processes
    .filter(
      (processInfo) =>
        processInfo.pid !== record.electronPid &&
        belongsToApp(processInfo, byPid, record.electronPid) &&
        processInfo.command.toLowerCase().includes(fragment)
    )
    .map(({ command, pid }) => ({ command, pid }))
  const matched = expectedRunning ? allMatches.filter(({ pid }) => !baselinePids.has(pid)) : allMatches
  return { matched, passed: expectedRunning ? matched.length > 0 : matched.length === 0 }
}
