import { execFileSync, spawn } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve, win32 } from 'node:path'

import { evaluateCdpExpression } from './cdp-client'
import type { RunPaths } from './paths'
import { isPathInside } from './paths'
import type { Platform, RunMode, TestProfile } from './types'

const CDP_PORT = 9222
const MAIN_INSPECTOR_PORT = 9229

export interface InstallationRecord {
  artifactName: string
  artifactPath: string
  artifactSha256: string
  executablePath: string
  installedPath: string
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
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

function isAlive(pid: number): boolean {
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

function windowsProcessExecutablePath(pid: number): string {
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

function assertOwnedProcess(record: AppRecord, pid: number, kind: 'electron' | 'runner'): void {
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

async function waitForExit(pid: number, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  return !isAlive(pid)
}

function terminateExactProcess(pid: number, platform: Platform): void {
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

function isDescendant(pid: number, ancestorPid: number, platform: Platform): boolean {
  let current: number | undefined = pid
  for (let depth = 0; current && depth < 32; depth += 1) {
    if (current === ancestorPid) return true
    current = getParentPid(current, platform)
  }
  return false
}

function findListeningPid(platform: Platform, port: number): number | undefined {
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

function findCdpPid(platform: Platform): number | undefined {
  return findListeningPid(platform, CDP_PORT)
}

async function readCdpTargets(): Promise<Array<{ title: string; type: string; url: string }>> {
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

function findFile(root: string, predicate: (filePath: string) => boolean): string | undefined {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const filePath = join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = findFile(filePath, predicate)
      if (nested) return nested
    } else if (predicate(filePath)) {
      return filePath
    }
  }
  return undefined
}

export function installReleaseArtifact(
  paths: RunPaths,
  platform: Platform,
  artifactPath: string,
  artifactSha256: string
): InstallationRecord {
  if (!isPathInside(paths.artifacts, artifactPath)) throw new Error('Release artifact is outside the run directory')

  let executablePath: string
  let installedPath: string
  if (platform === 'macos') {
    const mountPath = join(paths.root, 'dmg-mount')
    mkdirSync(mountPath, { recursive: true })
    try {
      execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPath, artifactPath], {
        stdio: 'ignore',
        timeout: 60_000
      })
      const sourceApp = readdirSync(mountPath)
        .map((name) => join(mountPath, name))
        .find((candidate) => candidate.toLowerCase().endsWith('.app') && statSync(candidate).isDirectory())
      if (!sourceApp) throw new Error('The DMG does not contain an application bundle')
      installedPath = join(paths.installed, basename(sourceApp))
      execFileSync('ditto', [sourceApp, installedPath], { stdio: 'ignore', timeout: 120_000 })
    } finally {
      try {
        execFileSync('hdiutil', ['detach', mountPath], { stdio: 'ignore', timeout: 30_000 })
      } catch {
        // The attach failure path has nothing to detach.
      }
    }
    executablePath =
      findFile(join(installedPath, 'Contents', 'MacOS'), (candidate) => statSync(candidate).isFile()) ?? ''
  } else {
    installedPath = paths.installed
    execFileSync(artifactPath, ['/S', `/D=${installedPath}`], { stdio: 'ignore', timeout: 180_000 })
    executablePath =
      findFile(installedPath, (candidate) => basename(candidate).toLowerCase() === 'cherry studio.exe') ?? ''
  }

  if (!executablePath || !existsSync(executablePath))
    throw new Error('Installed Cherry Studio executable was not found')
  const record = {
    artifactName: basename(artifactPath),
    artifactPath,
    artifactSha256,
    executablePath,
    installedPath
  }
  writeJson(paths.installation, record)
  return record
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
    return {
      command: platform === 'windows' ? 'cmd.exe' : 'pnpm',
      args: platform === 'windows' ? ['/d', '/s', '/c', 'pnpm debug'] : ['debug'],
      cwd: targetRoot,
      environment: { ...process.env, CS_DEV_USER_DATA_SUFFIX: `Regression-${runKey}-${profile}` },
      logPath
    }
  }

  const installation = readJson<InstallationRecord>(paths.installation)
  return {
    command: installation.executablePath,
    args: [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(paths.profiles, profile)}`],
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

  try {
    const { electronPid, targetUrl } = await waitForCdp(child.pid, options.platform)
    const record: AppRecord = {
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
      electronPid,
      cdpPort: CDP_PORT,
      targetUrl,
      logPath: spec.logPath,
      startedAt: new Date().toISOString(),
      restartCount: options.restartCount ?? 0
    }
    writeJson(paths.appRecord, record)
    return record
  } catch (error) {
    try {
      const electronPid = findCdpPid(options.platform)
      if (electronPid && isDescendant(electronPid, child.pid, options.platform)) {
        terminateExactProcess(electronPid, options.platform)
        await waitForExit(electronPid)
      }
      terminateExactProcess(child.pid, options.platform)
      await waitForExit(child.pid)
    } catch {
      // Preserve the launch error; cleanup will inspect any remaining owned process.
    }
    throw error
  }
}

export function readAppRecord(paths: RunPaths): AppRecord {
  const record = readJson<AppRecord>(paths.appRecord)
  if (record.schemaVersion !== 1 || record.ownership !== 'regression-driver' || record.policy !== 'ephemeral') {
    throw new Error('Refusing to control an unowned application record')
  }
  if (!isPathInside(paths.root, record.logPath)) throw new Error('Application record points outside the run directory')
  return record
}

interface InspectorTarget {
  type: string
  webSocketDebuggerUrl?: string
}

const MAIN_WINDOW_PATH = '/windows/main/index.html'

async function ownedMainInspectorUrl(record: AppRecord): Promise<string> {
  if (findListeningPid(record.platform, MAIN_INSPECTOR_PORT) !== record.electronPid) {
    throw new Error('Owned Cherry Studio instance does not own the main-process inspector')
  }

  const response = await fetch(`http://127.0.0.1:${MAIN_INSPECTOR_PORT}/json/list`, {
    signal: AbortSignal.timeout(5_000)
  })
  if (!response.ok) throw new Error(`Main-process inspector discovery failed with HTTP ${response.status}`)
  const targets = (await response.json()) as InspectorTarget[]
  const target = targets.find((candidate) => candidate.type === 'node' && candidate.webSocketDebuggerUrl)
  if (!target?.webSocketDebuggerUrl) throw new Error('Main-process inspector target is unavailable')

  const debuggerUrl = new URL(target.webSocketDebuggerUrl)
  if (
    debuggerUrl.protocol !== 'ws:' ||
    !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(debuggerUrl.hostname) ||
    debuggerUrl.port !== String(MAIN_INSPECTOR_PORT)
  ) {
    throw new Error('Main-process inspector target is not loopback-owned')
  }
  return debuggerUrl.toString()
}

export async function prepareWindowsCdpConnection(record: AppRecord): Promise<void> {
  if (record.platform !== 'windows') return
  if (!isAlive(record.electronPid)) throw new Error('Owned Cherry Studio instance is not running')
  assertOwnedProcess(record, record.electronPid, 'electron')
  const debuggerUrl = await ownedMainInspectorUrl(record)
  const destroyed = await evaluateCdpExpression<number>(
    debuggerUrl,
    `(() => {
      const electron = process.mainModule?.require?.('electron')
      if (!electron?.BrowserWindow) throw new Error('Electron BrowserWindow is unavailable')
      const mainWindowPath = ${JSON.stringify(MAIN_WINDOW_PATH)}
      let destroyed = 0
      for (const window of electron.BrowserWindow.getAllWindows()) {
        let pathname = ''
        try {
          pathname = new URL(window.webContents.getURL()).pathname.toLowerCase()
        } catch {}
        if (pathname !== mainWindowPath) {
          window.destroy()
          destroyed += 1
        }
      }
      return destroyed
    })()`
  )
  if (!Number.isInteger(destroyed) || destroyed < 0) {
    throw new Error('Windows CDP preparation returned an invalid result')
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const targets = await readCdpTargets()
    const hasNonMainTarget = targets.some((target) => {
      try {
        return target.type === 'page' && new URL(target.url).pathname.toLowerCase() !== MAIN_WINDOW_PATH
      } catch {
        return target.type === 'page'
      }
    })
    if (!hasNonMainTarget) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('Non-main Windows CDP targets did not close')
}

export async function sendProtocolUrlToOwnedApp(record: AppRecord, url: string): Promise<void> {
  if (!isAlive(record.electronPid)) throw new Error('Owned Cherry Studio instance is not running')
  assertOwnedProcess(record, record.electronPid, 'electron')
  if (record.mode === 'branch') {
    const debuggerUrl = await ownedMainInspectorUrl(record)
    const delivered = await evaluateCdpExpression<boolean>(
      debuggerUrl,
      `(() => {
        const electron = process.mainModule?.require?.('electron')
        if (!electron?.app) throw new Error('Electron app is unavailable in the main-process inspector')
        return electron.app.emit('open-url', { preventDefault() {} }, ${JSON.stringify(url)})
      })()`
    )
    if (!delivered) throw new Error('Owned Cherry Studio instance has no protocol URL listener')
    return
  }

  if (record.platform === 'macos') {
    const executablePath = record.executablePath
    const isVerifiedExecutable = Boolean(
      record.executablePath && resolve(executablePath ?? '') === resolve(record.executablePath)
    )
    if (!executablePath || !isVerifiedExecutable) {
      throw new Error('Owned macOS Electron executable could not be verified')
    }
    const appBundlePath = dirname(dirname(dirname(executablePath)))
    if (!basename(appBundlePath).endsWith('.app')) {
      throw new Error('Owned macOS application bundle could not be verified')
    }
    try {
      execFileSync('open', ['-a', appBundlePath, url], {
        cwd: record.cwd,
        stdio: 'ignore',
        timeout: 15_000
      })
      return
    } catch {
      throw new Error('Failed to deliver the protocol callback to the owned Cherry Studio instance')
    }
  }

  const executablePath = windowsProcessExecutablePath(record.electronPid)
  const isVerifiedExecutable = Boolean(
    record.executablePath &&
      win32.resolve(executablePath).toLowerCase() === win32.resolve(record.executablePath).toLowerCase()
  )
  if (!executablePath || !isVerifiedExecutable) {
    throw new Error('Owned Windows Electron executable could not be verified')
  }
  const userDataArgument = record.args.find((arg) => arg.startsWith('--user-data-dir='))
  if (!userDataArgument) throw new Error('Owned Windows application profile is missing')
  try {
    execFileSync(executablePath, [userDataArgument, url], {
      cwd: record.cwd,
      env: { ...process.env },
      stdio: 'ignore',
      timeout: 15_000,
      windowsHide: true
    })
  } catch {
    throw new Error('Failed to deliver the protocol callback to the owned Cherry Studio instance')
  }
}

export async function stopOwnedApp(paths: RunPaths): Promise<void> {
  if (!existsSync(paths.appRecord)) return
  const record = readAppRecord(paths)
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
  const terminationPids = record.platform === 'windows' ? [record.runnerPid, ...ownedPids] : ownedPids
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
