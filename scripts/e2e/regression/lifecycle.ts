import { spawn } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { InstallationRecord } from './installation'
import type { RunPaths } from './paths'
import { isPathInside } from './paths'
import {
  assertOwnedProcess,
  CDP_PORT,
  findCdpPid,
  findProcessGroupId,
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
  locale?: string
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

async function waitForCdp(
  runnerPid: number,
  platform: Platform,
  timeout = 180_000
): Promise<{ electronPid: number; targetUrl: string }> {
  const deadline = Date.now() + timeout
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

export function createProfileEnvironment(paths: RunPaths, profile: TestProfile): NodeJS.ProcessEnv {
  const homeDirectory = join(paths.profiles, profile, 'home')
  const tempDirectory = join(homeDirectory, 'temp')
  mkdirSync(tempDirectory, { recursive: true })
  const windowsDirectories =
    process.platform === 'win32'
      ? {
          APPDATA: join(homeDirectory, 'AppData', 'Roaming'),
          LOCALAPPDATA: join(homeDirectory, 'AppData', 'Local')
        }
      : {}
  for (const directory of Object.values(windowsDirectories)) mkdirSync(directory, { recursive: true })
  return {
    ...process.env,
    ...windowsDirectories,
    HOME: homeDirectory,
    USERPROFILE: homeDirectory,
    TEMP: tempDirectory,
    TMP: tempDirectory,
    TMPDIR: tempDirectory,
    // Chromium on macOS resolves its temporary directory from NSTemporaryDirectory or this override, not TMPDIR.
    MAC_CHROMIUM_TMPDIR: tempDirectory,
    CLAUDE_CONFIG_DIR: join(homeDirectory, '.claude'),
    CODEX_HOME: join(homeDirectory, '.codex')
  }
}

function getLaunchSpec(
  paths: RunPaths,
  mode: RunMode,
  targetRoot: string,
  profile: TestProfile,
  runKey: string,
  locale?: string
): Pick<AppRecord, 'args' | 'command' | 'cwd' | 'executablePath' | 'logPath'> & { environment: NodeJS.ProcessEnv } {
  const logPath = join(paths.logs, `electron-${profile}.log`)
  const environment = createProfileEnvironment(paths, profile)
  if (mode === 'branch') {
    const args = [
      join(targetRoot, 'node_modules', 'dotenv-cli', 'cli.js'),
      '--',
      process.execPath,
      join(targetRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
      '--',
      `--inspect=${MAIN_INSPECTOR_PORT}`,
      '--sourcemap',
      `--remote-debugging-port=${CDP_PORT}`,
      '--disable-backgrounding-occluded-windows'
    ]
    if (locale) args.push(`--lang=${locale}`)
    return {
      command: process.execPath,
      args,
      cwd: targetRoot,
      environment: {
        ...environment,
        CS_DEV_PROFILE_ROOT: join(paths.profiles, profile),
        CS_DEV_USER_DATA_SUFFIX: `Regression-${runKey}-${profile}`
      },
      logPath
    }
  }

  const installation = readJson<InstallationRecord>(paths.installation)
  return {
    command: installation.executablePath,
    args: [
      `--inspect=${MAIN_INSPECTOR_PORT}`,
      `--remote-debugging-port=${CDP_PORT}`,
      '--disable-backgrounding-occluded-windows',
      `--user-data-dir=${join(paths.profiles, profile)}`,
      ...(locale ? [`--lang=${locale}`] : [])
    ],
    cwd: dirname(installation.executablePath),
    environment,
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
    readyTimeoutMs?: number
    locale?: string
  }
): Promise<AppRecord> {
  if (existsSync(paths.appRecord)) await stopOwnedApp(paths)
  if (findCdpPid(options.platform)) throw new Error(`CDP port ${CDP_PORT} is already owned by another process`)
  const targetRoot = resolve(options.targetRoot)
  const spec = getLaunchSpec(paths, options.mode, targetRoot, options.profile, options.runKey, options.locale)
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
    restartCount: options.restartCount ?? 0,
    ...(options.locale ? { locale: options.locale } : {})
  }
  try {
    writeJson(paths.appRecord, launchRecord)
    const record: AppRecord = {
      ...launchRecord,
      ...(await waitForCdp(child.pid, options.platform, options.readyTimeoutMs))
    }
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

export function readOwnedRecord(paths: RunPaths): LaunchRecord {
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
    if (record.mode === 'tag' && record.electronPid && isAlive(record.electronPid)) {
      assertOwnedProcess(record, record.electronPid, 'electron')
      // A relocation renderer exiting before its main process can schedule another relaunch.
      terminateExactProcess(record.electronPid, record.platform)
      await waitForExit(record.electronPid)
      await waitForMacProcessGroupExit(record.runnerPid)
    }
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

function isExpectedWindowUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url)
    return pathname.endsWith('/windows/main/index.html') || pathname.includes('/windows/userDataRelocation/')
  } catch {
    return false
  }
}

/**
 * Adopt the instance a packaged restore relaunched on its own. The replacement is not a
 * descendant of the recorded runner, so cleanup has to be pointed at it explicitly.
 * Electron exposes CDP before the renderer is ready, so a process is adopted only once an
 * expected window is up; a further relaunch during bootstrap therefore still counts as a
 * new replacement instead of being adopted prematurely.
 */
export async function adoptRelaunchedApp(paths: RunPaths, timeout = 120_000): Promise<AppRecord> {
  const record = readAppRecord(paths)
  if (record.mode !== 'tag') throw new Error('Only a packaged launch relaunches itself')
  const deadline = Date.now() + timeout
  let lastError = 'no replacement process took over the CDP port'
  while (Date.now() < deadline) {
    try {
      const targets = await readCdpTargets()
      const electronPid = findCdpPid(record.platform)
      if (electronPid && electronPid !== record.electronPid && isAlive(electronPid)) {
        const readyWindow = targets.some((target) => target.type === 'page' && isExpectedWindowUrl(target.url))
        if (readyWindow && findCdpPid(record.platform) === electronPid) {
          const runnerPid = findProcessGroupId(electronPid, record.platform) ?? electronPid
          const adopted: AppRecord = {
            ...record,
            runnerPid,
            electronPid,
            startedAt: new Date().toISOString(),
            restartCount: record.restartCount + 1
          }
          assertOwnedProcess(adopted, electronPid, 'electron')
          writeJson(paths.appRecord, adopted)
          return readAppRecord(paths)
        }
        lastError = readyWindow
          ? 'the replacement process changed before its window was ready'
          : 'the replacement process has no window yet'
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }
  throw new Error(`The relaunched application did not take over the CDP port (${lastError})`)
}

export async function restartApp(paths: RunPaths, profile?: TestProfile): Promise<AppRecord> {
  const current = readOwnedRecord(paths)
  if (current.platform === 'windows' && current.electronPid && isAlive(current.electronPid)) {
    const { requestOwnedAppQuit } = await import('./debugBridge')
    const app = readAppRecord(paths)
    await requestOwnedAppQuit(app)
    if (!(await waitForExit(app.electronPid, 30_000))) {
      throw new Error('Owned Cherry Studio did not exit after a normal shutdown request')
    }
  }
  await stopOwnedApp(paths)
  return launchApp(paths, {
    mode: current.mode,
    platform: current.platform,
    profile: profile ?? current.profile,
    targetRoot: current.targetRoot,
    runKey: current.runKey,
    restartCount: current.restartCount + 1,
    locale: current.locale
  })
}

export async function ensureProfile(paths: RunPaths, profile: TestProfile): Promise<AppRecord> {
  const current = readOwnedRecord(paths)
  if (current.profile === profile && current.electronPid && current.targetUrl && isAlive(current.electronPid)) {
    return { ...current, electronPid: current.electronPid, targetUrl: current.targetUrl }
  }
  return restartApp(paths, profile)
}
