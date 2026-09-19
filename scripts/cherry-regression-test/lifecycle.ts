import { spawn } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { InstallationRecord } from './installation'
import type { RunPaths } from './paths'
import { isPathInside } from './paths'
import {
  assertOwnedProcess,
  CDP_PORT,
  findCdpPid,
  isAlive,
  isDescendant,
  MAIN_INSPECTOR_PORT,
  terminateExactProcess,
  terminateOwnedMacProcessGroup,
  waitForExit,
  waitForMacProcessGroupExit,
  waitForPortRelease
} from './process'
import type { Platform, RunMode, TestProfile } from './types'

export interface AppRecord {
  schemaVersion: 1
  ownership: 'regression-driver'
  policy: 'ephemeral'
  mode: RunMode
  platform: Platform
  profile: TestProfile
  runKey: string
  targetRoot: string
  executablePath?: string
  command: string
  args: string[]
  cwd: string
  runnerPid: number
  electronPid: number
  cdpPort: number
  targetUrl: string
  logPath: string
  startedAt: string
  restartCount: number
}

type LaunchRecord = Omit<AppRecord, 'electronPid' | 'targetUrl'> & Partial<Pick<AppRecord, 'electronPid' | 'targetUrl'>>

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

export async function readCdpTargets(): Promise<Array<{ title: string; type: string; url: string }>> {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(2_000) })
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`)
  return (await response.json()) as Array<{ title: string; type: string; url: string }>
}

async function waitForCdp(runnerPid: number, platform: Platform): Promise<{ electronPid: number; targetUrl: string }> {
  const deadline = Date.now() + 180_000
  let lastError = 'CDP did not respond'
  while (Date.now() < deadline) {
    if (!isAlive(runnerPid)) throw new Error(`Application runner ${runnerPid} exited before CDP became ready`)
    try {
      const targets = await readCdpTargets()
      const mainTarget = targets.find(
        (target) => target.type === 'page' && new URL(target.url).pathname.endsWith('/windows/main/index.html')
      )
      const electronPid = findCdpPid(platform)
      if (mainTarget && electronPid && isDescendant(electronPid, runnerPid, platform)) {
        return { electronPid, targetUrl: mainTarget.url }
      }
      lastError = mainTarget
        ? 'CDP listener is not owned by the launched process tree'
        : 'Main window target is not ready'
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))
  }
  throw new Error(`Timed out waiting for Cherry Studio CDP: ${lastError}`)
}

function getLaunchSpec(
  paths: RunPaths,
  mode: RunMode,
  platform: Platform,
  targetRoot: string,
  profile: TestProfile,
  runKey: string
): Pick<AppRecord, 'args' | 'command' | 'cwd' | 'executablePath' | 'logPath'> & { environment: NodeJS.ProcessEnv } {
  const logPath = join(paths.logs, `electron-${profile}.log`)
  if (mode === 'branch') {
    const args = [
      'exec',
      'dotenv',
      '--',
      'electron-vite',
      '--',
      '--inspect',
      '--sourcemap',
      '--remote-debugging-port=9222'
    ]
    return {
      command: platform === 'windows' ? 'cmd.exe' : 'pnpm',
      args: platform === 'windows' ? ['/d', '/s', '/c', `pnpm ${args.join(' ')}`] : args,
      cwd: targetRoot,
      environment: { ...process.env, CS_DEV_USER_DATA_SUFFIX: `Regression-${runKey}-${profile}` },
      logPath
    }
  }

  const installation = readJson<InstallationRecord>(paths.installation)
  return {
    command: installation.executablePath,
    args: [
      `--inspect=${MAIN_INSPECTOR_PORT}`,
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${join(paths.profiles, profile)}`
    ],
    cwd: dirname(installation.executablePath),
    environment: { ...process.env },
    executablePath: installation.executablePath,
    logPath
  }
}

export async function launchApp(
  paths: RunPaths,
  options: {
    mode: RunMode
    platform: Platform
    profile: TestProfile
    targetRoot: string
    runKey: string
    restartCount?: number
  }
): Promise<AppRecord> {
  if (existsSync(paths.appRecord)) await stopOwnedApp(paths)
  if (findCdpPid(options.platform)) throw new Error(`CDP port ${CDP_PORT} is already owned by another process`)
  const targetRoot = resolve(options.targetRoot)
  const spec = getLaunchSpec(paths, options.mode, options.platform, targetRoot, options.profile, options.runKey)
  const logFd = openSync(spec.logPath, 'a', 0o600)
  appendFileSync(spec.logPath, `\n[${new Date().toISOString()}] Launching ${spec.command} ${spec.args.join(' ')}\n`)
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    detached: true,
    env: spec.environment,
    stdio: ['ignore', logFd, logFd],
    windowsHide: false
  })
  closeSync(logFd)
  if (!child.pid) throw new Error('Application launch did not return a process ID')
  child.unref()

  const launchRecord: LaunchRecord = {
    schemaVersion: 1,
    ownership: 'regression-driver',
    policy: 'ephemeral',
    mode: options.mode,
    platform: options.platform,
    profile: options.profile,
    runKey: options.runKey,
    targetRoot,
    executablePath: spec.executablePath,
    command: spec.command,
    args: spec.args,
    cwd: spec.cwd,
    runnerPid: child.pid,
    cdpPort: CDP_PORT,
    logPath: spec.logPath,
    startedAt: new Date().toISOString(),
    restartCount: options.restartCount ?? 0
  }
  try {
    writeJson(paths.appRecord, launchRecord)
    const record: AppRecord = { ...launchRecord, ...(await waitForCdp(child.pid, options.platform)) }
    writeJson(paths.appRecord, record)
    return record
  } catch (error) {
    try {
      await stopOwnedRecord(launchRecord)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${String(error)}; owned-process cleanup failed: ${String(cleanupError)}`
      )
    }
    throw error
  }
}

function readOwnedRecord(paths: RunPaths): LaunchRecord {
  const record = readJson<LaunchRecord>(paths.appRecord)
  if (record.schemaVersion !== 1 || record.ownership !== 'regression-driver' || record.policy !== 'ephemeral') {
    throw new Error('Refusing to control an unowned application record')
  }
  if (!isPathInside(paths.root, record.logPath)) throw new Error('Application record points outside the run directory')
  if (!Number.isSafeInteger(record.runnerPid) || record.runnerPid <= 0) throw new Error('Invalid owned runner PID')
  return record
}

export function readAppRecord(paths: RunPaths): AppRecord {
  const record = readOwnedRecord(paths)
  if (!record.electronPid || !record.targetUrl) throw new Error('Owned application has not finished launching')
  return { ...record, electronPid: record.electronPid, targetUrl: record.targetUrl }
}

export async function stopOwnedApp(paths: RunPaths): Promise<void> {
  if (!existsSync(paths.appRecord)) return
  await stopOwnedRecord(readOwnedRecord(paths))
}

async function stopOwnedRecord(record: LaunchRecord): Promise<void> {
  if (record.platform === 'macos') {
    terminateOwnedMacProcessGroup(record)
    if (!(await waitForMacProcessGroupExit(record.runnerPid))) {
      terminateOwnedMacProcessGroup(record, 'SIGKILL')
      if (!(await waitForMacProcessGroupExit(record.runnerPid))) {
        throw new Error(`Owned application process group ${record.runnerPid} did not exit after SIGKILL`)
      }
    }
    if (!(await waitForPortRelease(record.platform, record.cdpPort))) {
      throw new Error(`CDP port ${record.cdpPort} was not released after stopping the owned application`)
    }
    return
  }
  const currentCdpPid = findCdpPid(record.platform)
  if (
    currentCdpPid &&
    currentCdpPid !== record.electronPid &&
    (!isAlive(record.runnerPid) || !isDescendant(currentCdpPid, record.runnerPid, record.platform))
  ) {
    throw new Error('Refusing cleanup because the current CDP process is not owned by the recorded runner')
  }
  const ownedPids = [
    ...new Set([record.electronPid, currentCdpPid, record.runnerPid].filter((pid) => pid !== undefined))
  ]
  for (const pid of ownedPids) {
    if (!isAlive(pid)) continue
    if (pid === currentCdpPid) {
      assertOwnedProcess(record, pid, 'electron')
    } else if (pid === record.runnerPid) {
      assertOwnedProcess(record, pid, 'runner')
    } else if (!isAlive(record.runnerPid) || !isDescendant(pid, record.runnerPid, record.platform)) {
      throw new Error('Refusing cleanup because the recorded Electron process is no longer owned by its runner')
    }
  }
  const terminationPids = [record.runnerPid, ...ownedPids]
  for (const pid of new Set(terminationPids)) {
    if (!isAlive(pid)) continue
    try {
      terminateExactProcess(pid, record.platform)
    } catch (error) {
      appendFileSync(record.logPath, `[cleanup] ${error instanceof Error ? error.message : String(error)}\n`)
    }
    await waitForExit(pid)
  }
  const remaining = ownedPids.filter(isAlive)
  if (remaining.length > 0) {
    throw new Error(`Owned Cherry Studio processes did not exit after SIGTERM: ${remaining.join(', ')}`)
  }
  if (!(await waitForPortRelease(record.platform, record.cdpPort))) {
    throw new Error(`CDP port ${record.cdpPort} was not released after stopping the owned application`)
  }
}

export async function restartApp(paths: RunPaths, profile?: TestProfile): Promise<AppRecord> {
  const current = readAppRecord(paths)
  await stopOwnedApp(paths)
  return launchApp(paths, {
    mode: current.mode,
    platform: current.platform,
    profile: profile ?? current.profile,
    targetRoot: current.targetRoot,
    runKey: current.runKey,
    restartCount: current.restartCount + 1
  })
}

export async function ensureProfile(paths: RunPaths, profile: TestProfile): Promise<AppRecord> {
  const current = readAppRecord(paths)
  if (current.profile === profile && isAlive(current.electronPid)) return current
  return restartApp(paths, profile)
}
