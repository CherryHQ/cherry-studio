import { execFileSync } from 'node:child_process'

import type { AppRecord } from './lifecycle'
import type { Platform } from './types'

export const CDP_PORT = 9222
export const MAIN_INSPECTOR_PORT = 9229

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function processCommand(pid: number, platform: Platform): string {
  try {
    return platform === 'windows'
      ? execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`
          ],
          { encoding: 'utf8', timeout: 10_000 }
        ).trim()
      : execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 10_000 }).trim()
  } catch {
    return ''
  }
}

export function windowsProcessExecutablePath(pid: number): string {
  try {
    return execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").ExecutablePath`
      ],
      { encoding: 'utf8', timeout: 10_000 }
    ).trim()
  } catch {
    return ''
  }
}

export function assertOwnedProcess(record: AppRecord, pid: number, kind: 'electron' | 'runner'): void {
  const command = processCommand(pid, record.platform)
  const expected =
    record.mode === 'tag'
      ? record.executablePath
      : kind === 'electron'
        ? record.targetRoot
        : record.platform === 'windows'
          ? 'pnpm debug'
          : 'pnpm'
  if (!expected || !command.toLowerCase().includes(expected.toLowerCase())) {
    throw new Error(`Refusing to terminate stale ${kind} PID ${pid}; its command no longer matches the owned run`)
  }
  if (kind === 'electron' && findCdpPid(record.platform) !== pid) {
    throw new Error(`Refusing to terminate PID ${pid}; it no longer owns CDP port ${record.cdpPort}`)
  }
}

export async function waitForExit(pid: number, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  return !isAlive(pid)
}

export async function waitForPortRelease(platform: Platform, port: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!findListeningPid(platform, port)) return true
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  return !findListeningPid(platform, port)
}

export function terminateExactProcess(pid: number, platform: Platform): void {
  if (!isAlive(pid)) return
  if (platform === 'windows') {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 10_000 })
    return
  }
  process.kill(pid, 'SIGTERM')
}

function getParentPid(pid: number, platform: Platform): number | undefined {
  try {
    const output =
      platform === 'windows'
        ? execFileSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").ParentProcessId`
            ],
            { encoding: 'utf8', timeout: 10_000 }
          )
        : execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', timeout: 10_000 })
    const parent = Number(output.trim())
    return Number.isInteger(parent) && parent > 0 ? parent : undefined
  } catch {
    return undefined
  }
}

export function isDescendant(pid: number, ancestorPid: number, platform: Platform): boolean {
  let current: number | undefined = pid
  for (let depth = 0; current && depth < 32; depth += 1) {
    if (current === ancestorPid) return true
    current = getParentPid(current, platform)
  }
  return false
}

export function findListeningPid(platform: Platform, port: number): number | undefined {
  try {
    const output =
      platform === 'windows'
        ? execFileSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `(Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -First 1 -ExpandProperty OwningProcess)`
            ],
            { encoding: 'utf8', timeout: 10_000 }
          )
        : execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
            encoding: 'utf8',
            timeout: 10_000
          })
    const pid = Number(output.trim().split(/\r?\n/)[0])
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

export function findCdpPid(platform: Platform): number | undefined {
  return findListeningPid(platform, CDP_PORT)
}
