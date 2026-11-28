import { execFileSync } from 'node:child_process'
import { posix, win32 } from 'node:path'

import type { AppRecord } from './lifecycle'
import type { Platform } from './types'

function portFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback
}

// Overridable so a second regression run can share the host (CI and a local session used to fight over 9222).
export const CDP_PORT = portFromEnv('CHERRY_CDP_PORT', 9222)
export const MAIN_INSPECTOR_PORT = portFromEnv('CHERRY_INSPECTOR_PORT', 9229)

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function processCommand(pid: number, platform: Platform): string {
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
          { encoding: 'utf8', timeout: 10_000, windowsHide: true }
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
      { encoding: 'utf8', timeout: 10_000, windowsHide: true }
    ).trim()
  } catch {
    return ''
  }
}

type ProcessOwner = Pick<AppRecord, 'mode' | 'platform' | 'executablePath' | 'targetRoot' | 'cdpPort' | 'runnerPid'>

export function assertOwnedProcess(record: ProcessOwner, pid: number, kind: 'electron' | 'runner' | 'inspector'): void {
  const command = processCommand(pid, record.platform)
  const expected =
    record.mode === 'tag'
      ? record.executablePath
      : kind !== 'runner'
        ? (record.executablePath ?? record.targetRoot)
        : (record.platform === 'windows' ? win32 : posix).join(
            record.targetRoot,
            'node_modules',
            'dotenv-cli',
            'cli.js'
          )
  if (!expected || !command.toLowerCase().includes(expected.toLowerCase())) {
    throw new Error(`Refusing to terminate stale ${kind} PID ${pid}; its command no longer matches the owned run`)
  }
  if (kind === 'electron' && findCdpPid(record.platform) !== pid) {
    throw new Error(`Refusing to terminate PID ${pid}; it no longer owns CDP port ${record.cdpPort}`)
  }
  if (kind === 'inspector' && findListeningPid(record.platform, MAIN_INSPECTOR_PORT) !== pid) {
    throw new Error(`Refusing native dialog control of PID ${pid}; it no longer owns the main inspector`)
  }
}

interface MacProcessIdentity {
  pid: number
  command: string
  startedAt: string
}

function macProcessStartedAt(pid: string): string {
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', pid], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return ''
  }
}

export function terminateOwnedMacProcessGroup(
  record: ProcessOwner,
  signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM',
  previouslyVerified: readonly MacProcessIdentity[] = []
): MacProcessIdentity[] {
  const group = execFileSync('ps', ['-axo', 'pid=,pgid=,stat=,command='], { encoding: 'utf8', timeout: 10_000 })
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match && Number(match[2]) === record.runnerPid))
  const members = group.filter((member) => !member[3].startsWith('Z'))
  if (members.length === 0) {
    if (group.length === 0 && isAlive(record.runnerPid)) {
      throw new Error('Refusing cleanup: runner no longer owns its process group')
    }
    return []
  }
  const identities = members.map((member) => ({
    pid: Number(member[1]),
    command: member[4],
    startedAt: macProcessStartedAt(member[1])
  }))
  const knownSurvivors = identities.every(
    (member) =>
      member.startedAt &&
      previouslyVerified.some(
        (previous) =>
          previous.pid === member.pid && previous.command === member.command && previous.startedAt === member.startedAt
      )
  )
  const runnerExited = group.some((member) => Number(member[1]) === record.runnerPid && member[3].startsWith('Z'))
  if (!runnerExited && isAlive(record.runnerPid)) {
    assertOwnedProcess(record, record.runnerPid, 'runner')
    if (!members.some((member) => Number(member[1]) === record.runnerPid)) {
      throw new Error('Refusing cleanup: runner no longer owns its process group')
    }
  } else if (!knownSurvivors) {
    const expected = record.executablePath ?? (record.mode === 'branch' ? record.targetRoot : undefined)
    const appContents = record.executablePath?.match(/^(.*\.app\/Contents)\/MacOS\/[^/]+$/)?.[1]
    if (
      !expected ||
      !members.some(
        (member) => member[4].includes(expected) || (appContents && member[4].startsWith(`${appContents}/Frameworks/`))
      )
    ) {
      throw new Error('Refusing cleanup: orphaned process group does not match the owned application')
    }
  }
  // detached macOS launches own a process group, including children without CDP listeners.
  process.kill(-record.runnerPid, signal)
  return identities
}

export function hasLiveMacProcessGroupMembers(groupId: number): boolean {
  return execFileSync('ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8', timeout: 10_000 })
    .split(/\r?\n/)
    .some((line) => {
      const [group, state] = line.trim().split(/\s+/)
      return Number(group) === groupId && Boolean(state) && !state.startsWith('Z')
    })
}

export async function waitForMacProcessGroupExit(groupId: number, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (hasLiveMacProcessGroupMembers(groupId)) {
    if (Date.now() >= deadline) return false
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  return true
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
            { encoding: 'utf8', timeout: 10_000, windowsHide: true }
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
              `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`
            ],
            { encoding: 'utf8', timeout: 10_000, windowsHide: true }
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

/** Process group of a live process; the group is what macOS cleanup signals. */
export function findProcessGroupId(pid: number, platform: Platform): number | undefined {
  if (platform === 'windows') return undefined
  try {
    const groupId = Number(
      execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8', timeout: 10_000 }).trim()
    )
    return Number.isSafeInteger(groupId) && groupId > 0 ? groupId : undefined
  } catch {
    return undefined
  }
}
