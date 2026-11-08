import { execFileSync, spawn } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { InstallationRecord } from './installation'
import { macRuntimeExecutable } from './macRuntime'
import type { RunPaths } from './paths'
import { isPathInside } from './paths'
import {
  assertOwnedProcess,
  CDP_PORT,
  findCdpPid,
  findListeningPid,
  findProcessGroupId,
  hasLiveMacProcessGroupMembers,
  isAlive,
  isDescendant,
  MAIN_INSPECTOR_PORT,
  terminateExactProcess,
  terminateOwnedMacProcessGroup,
  waitForExit,
  waitForMacProcessGroupExit,
  waitForPortRelease
} from './process'
import { createRedactor } from './redaction'
import type { Platform, RunMode, TestProfile } from './types'

export class AppExitedBeforeReadyError extends Error {
  constructor(
    readonly exitCode: number,
    cause: unknown
  ) {
    super(`Application exited with code ${exitCode} before CDP became ready: ${String(cause)}`, { cause })
    this.name = 'AppExitedBeforeReadyError'
  }
}

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
  port: number,
  logPath: string,
  timeout = 180_000
): Promise<{ electronPid: number; targetUrl: string }> {
  const deadline = Date.now() + timeout
  let lastError = 'CDP did not respond'
  while (Date.now() < deadline) {
    if (!isAlive(runnerPid)) {
      const snapshot = `CDP port ${port} listener pid: ${findListeningPid(platform, port) ?? 'none'}; inspector port ${MAIN_INSPECTOR_PORT} listener pid: ${findListeningPid(platform, MAIN_INSPECTOR_PORT) ?? 'none'}${platform === 'macos' ? `; process group ${runnerPid} has live members: ${hasLiveMacProcessGroupMembers(runnerPid)}` : ''}`
      appendFileSync(logPath, `[launch-failure] ${snapshot}\n`)
      throw new Error(`Application runner ${runnerPid} exited before CDP became ready; ${snapshot}`)
    }
    try {
      const targets = await readCdpTargets()
      const mainTarget = targets.find(
        (target) => target.type === 'page' && URL.parse(target.url)?.pathname.endsWith('/windows/main/index.html')
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

/**
 * Shell known folders used by native file dialogs and notification registration must exist
 * under the isolated Windows profile before Electron starts.
 */
export function windowsShellDirectories(homeDirectory: string): string[] {
  return [
    ...['Desktop', 'Documents', 'Downloads'].map((name) => join(homeDirectory, name)),
    join(homeDirectory, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ]
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
  const cliDirectories = ['.claude', '.codex', '.config', '.hermes', join('AppData', 'Local')].map((name) =>
    join(homeDirectory, name)
  )
  const npmCache = join(paths.private, 'npm-cache')
  for (const directory of [...Object.values(windowsDirectories), ...cliDirectories, npmCache])
    mkdirSync(directory, { recursive: true })
  if (process.platform === 'win32') {
    for (const directory of windowsShellDirectories(homeDirectory)) mkdirSync(directory, { recursive: true })
  }
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
    CODEX_HOME: join(homeDirectory, '.codex'),
    XDG_CONFIG_HOME: join(homeDirectory, '.config'),
    HERMES_HOME: join(homeDirectory, '.hermes'),
    NPM_CONFIG_CACHE: npmCache,
    npm_config_cache: npmCache,
    LOCALAPPDATA: join(homeDirectory, 'AppData', 'Local')
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
    Reflect.deleteProperty(environment, 'ELECTRON_RENDERER_URL')
    const preparedRuntime = macRuntimeExecutable(paths)
    const executablePath = process.platform === 'darwin' && existsSync(preparedRuntime) ? preparedRuntime : undefined
    const args = [
      join(targetRoot, 'node_modules', 'dotenv-cli', 'cli.js'),
      '--',
      process.execPath,
      join(targetRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
      'preview',
      '--skipBuild',
      '--',
      // Honours CHERRY_INSPECTOR_PORT so parallel checkouts do not share a port.
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
        ...(executablePath ? { ELECTRON_EXEC_PATH: executablePath } : {}),
        CS_DEV_PROFILE_ROOT: join(paths.profiles, profile),
        CS_DEV_USER_DATA_SUFFIX: `Regression-${runKey}-${profile}`
      },
      logPath,
      ...(executablePath ? { executablePath } : {})
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

export function assertNoLaunchFailure(paths: RunPaths): void {
  if (existsSync(paths.appLaunchFailure)) {
    const failure = readJson<{ reason: string }>(paths.appLaunchFailure)
    throw new Error(`Previous application relaunch failed: ${failure.reason}`)
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
  assertNoLaunchFailure(paths)
  if (findCdpPid(options.platform)) throw new Error(`CDP port ${CDP_PORT} is already owned by another process`)
  // A foreign listener here would only surface later as a failing inspector check.
  const inspectorOwner = findListeningPid(options.platform, MAIN_INSPECTOR_PORT)
  if (inspectorOwner)
    throw new Error(
      `Inspector port ${MAIN_INSPECTOR_PORT} is already owned by process ${inspectorOwner}; ` +
        'stop it or set CHERRY_INSPECTOR_PORT to a free port'
    )
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
    logLifecycleStage(launchRecord, 'waiting-for-cdp')
    const record: AppRecord = {
      ...launchRecord,
      ...(await waitForCdp(child.pid, options.platform, launchRecord.cdpPort, spec.logPath, options.readyTimeoutMs))
    }
    writeJson(paths.appRecord, record)
    logLifecycleStage(record, 'ready')
    rmSync(paths.appLaunchFailure, { force: true })
    return record
  } catch (error) {
    logLifecycleStage(launchRecord, 'launch-failed')
    if (child.exitCode === null && !isAlive(child.pid)) {
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer)
          child.off('exit', finish)
          resolve()
        }
        const timer = setTimeout(finish, 1_000)
        child.once('exit', finish)
      })
    }
    const exitCode = child.exitCode
    try {
      await stopOwnedRecord(launchRecord)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${String(error)}; owned-process cleanup failed: ${String(cleanupError)}`
      )
    }
    if (typeof exitCode === 'number') throw new AppExitedBeforeReadyError(exitCode, error)
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
  const record = readOwnedRecord(paths)
  try {
    await stopOwnedRecord(record)
  } catch (error) {
    const diagnostic = createRedactor([])({
      code: (error as NodeJS.ErrnoException)?.code ?? null,
      message: error instanceof Error ? error.message : String(error)
    })
    try {
      appendFileSync(
        record.logPath,
        `[${new Date().toISOString()}] lifecycle=stop-failed runner=${record.runnerPid} error=${JSON.stringify(diagnostic)}\n`
      )
    } catch {
      // Diagnostic I/O must not replace the original stop failure.
    }
    throw error
  }
}

function logLifecycleStage(record: LaunchRecord, stage: string): void {
  appendFileSync(
    record.logPath,
    `[${new Date().toISOString()}] lifecycle=${stage} runner=${record.runnerPid} electron=${record.electronPid ?? 'pending'}\n`
  )
}

function processExited(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return true
    throw new Error(`Cannot establish process ${pid} liveness: ${code ?? 'unknown error'}`)
  }
}

function windowsIdentityDiagnostic(pid: number): string {
  try {
    return (
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$item = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; @{ present = $null -ne $item; hasCommand = [bool]$item.CommandLine; startedAt = if ($item) { $item.CreationDate.ToUniversalTime().Ticks.ToString() } else { $null } } | ConvertTo-Json -Compress`
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 10_000 }
      ).trim() || 'unavailable'
    )
  } catch {
    return 'unavailable'
  }
}

async function terminateMacProcessGroupWithDrain(
  record: LaunchRecord,
  signal: 'SIGTERM' | 'SIGKILL',
  previouslyVerified: ReturnType<typeof terminateOwnedMacProcessGroup> = []
): Promise<ReturnType<typeof terminateOwnedMacProcessGroup>> {
  try {
    return terminateOwnedMacProcessGroup(record, signal, previouslyVerified)
  } catch (error) {
    // Observing a still-visible runner grants no authority to signal its unverified group.
    try {
      processExited(record.runnerPid)
    } catch {
      throw error
    }
    logLifecycleStage(record, 'unverified-group-drain-start')
    if (!(await waitForMacProcessGroupExit(record.runnerPid))) {
      if (signal === 'SIGKILL') {
        try {
          const members = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,lstart='], {
            encoding: 'utf8',
            timeout: 2_000,
            stdio: ['ignore', 'pipe', 'ignore']
          })
            .split(/\r?\n/)
            .flatMap((line) => {
              const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
              if (!match || Number(match[3]) !== record.runnerPid) return []
              const pid = Number(match[1])
              const startedAt = match[4]
              return [
                {
                  pid,
                  ppid: Number(match[2]),
                  pgid: Number(match[3]),
                  startedAt,
                  previouslyVerifiedStartMatches: previouslyVerified.some(
                    (previous) => previous.pid === pid && previous.startedAt === startedAt
                  )
                }
              ]
            })
          appendFileSync(
            record.logPath,
            `[${new Date().toISOString()}] lifecycle=unverified-group-survivors ${JSON.stringify({
              runnerPid: record.runnerPid,
              members: members.slice(0, 32),
              truncated: members.length > 32
            })}\n`
          )
        } catch {
          // A diagnostic failure must not replace the original ownership refusal.
        }
      }
      throw error
    }
    logLifecycleStage(record, 'unverified-group-drain-finished')
    try {
      processExited(record.runnerPid)
    } catch {
      throw error
    }
    return terminateOwnedMacProcessGroup(record, signal, previouslyVerified)
  }
}

async function stopOwnedRecord(record: LaunchRecord): Promise<void> {
  logLifecycleStage(record, 'stop-start')
  if (record.platform === 'macos') {
    if (record.mode === 'branch' && record.electronPid && !isAlive(record.electronPid)) {
      // Normal app exit can precede its runner's children. Wait without claiming unknown survivors.
      logLifecycleStage(record, 'natural-group-drain-start')
      await waitForMacProcessGroupExit(record.runnerPid)
      logLifecycleStage(record, 'natural-group-drain-finished')
    }
    if (record.mode === 'tag' && record.electronPid && isAlive(record.electronPid)) {
      assertOwnedProcess(record, record.electronPid, 'electron')
      // A relocation renderer exiting before its main process can schedule another relaunch.
      terminateExactProcess(record.electronPid, record.platform)
      await waitForExit(record.electronPid)
      await waitForMacProcessGroupExit(record.runnerPid)
    }
    logLifecycleStage(record, 'group-termination-start')
    const verifiedMembers = await terminateMacProcessGroupWithDrain(record, 'SIGTERM')
    if (!(await waitForMacProcessGroupExit(record.runnerPid))) {
      await terminateMacProcessGroupWithDrain(record, 'SIGKILL', verifiedMembers)
      if (!(await waitForMacProcessGroupExit(record.runnerPid))) {
        throw new Error(`Owned application process group ${record.runnerPid} did not exit after SIGKILL`)
      }
    }
    if (!(await waitForPortRelease(record.platform, record.cdpPort))) {
      throw new Error(`CDP port ${record.cdpPort} was not released after stopping the owned application`)
    }
    if (!(await waitForPortRelease(record.platform, MAIN_INSPECTOR_PORT))) {
      throw new Error(
        `Main-process inspector port ${MAIN_INSPECTOR_PORT} was not released after stopping the owned application`
      )
    }
    logLifecycleStage(record, 'stopped')
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
  const verifiedPids = new Set<number>()
  for (const pid of ownedPids) {
    if (processExited(pid)) continue
    try {
      if (pid === currentCdpPid) {
        assertOwnedProcess(record, pid, 'electron')
      } else if (pid === record.runnerPid) {
        assertOwnedProcess(record, pid, 'runner')
      } else if (!isAlive(record.runnerPid) || !isDescendant(pid, record.runnerPid, record.platform)) {
        throw new Error('Refusing cleanup because the recorded Electron process is no longer owned by its runner')
      }
    } catch (error) {
      const metadata = windowsIdentityDiagnostic(pid)
      const exited = processExited(pid)
      appendFileSync(
        record.logPath,
        `[cleanup] Identity check failed for PID ${pid}; exited=${exited}; metadata=${metadata}\n`
      )
      if (exited) continue
      throw error
    }
    verifiedPids.add(pid)
  }
  const terminationPids = [record.runnerPid, ...verifiedPids].filter((pid) => verifiedPids.has(pid))
  for (const pid of new Set(terminationPids)) {
    if (processExited(pid)) {
      verifiedPids.delete(pid)
      continue
    }
    try {
      terminateExactProcess(pid, record.platform)
    } catch (error) {
      appendFileSync(record.logPath, `[cleanup] ${error instanceof Error ? error.message : String(error)}\n`)
    }
    await waitForExit(pid)
  }
  const remaining = [...verifiedPids].filter((pid) => !processExited(pid))
  if (remaining.length > 0) {
    throw new Error(`Owned Cherry Studio processes did not exit after SIGTERM: ${remaining.join(', ')}`)
  }
  if (!(await waitForPortRelease(record.platform, record.cdpPort))) {
    throw new Error(`CDP port ${record.cdpPort} was not released after stopping the owned application`)
  }
  if (!(await waitForPortRelease(record.platform, MAIN_INSPECTOR_PORT))) {
    throw new Error(
      `Main-process inspector port ${MAIN_INSPECTOR_PORT} was not released after stopping the owned application`
    )
  }
  logLifecycleStage(record, 'stopped')
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
  logLifecycleStage(current, 'restart-start')
  if (current.platform === 'windows' && current.electronPid && isAlive(current.electronPid)) {
    const { requestOwnedAppQuit } = await import('./debugBridge')
    const app = readAppRecord(paths)
    await requestOwnedAppQuit(app)
    if (!(await waitForExit(app.electronPid, 30_000))) {
      throw new Error('Owned Cherry Studio did not exit after a normal shutdown request')
    }
  }
  await stopOwnedApp(paths)
  logLifecycleStage(current, 'restart-stopped')
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
