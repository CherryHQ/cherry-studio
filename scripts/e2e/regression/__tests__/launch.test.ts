import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { vi } from 'vitest'

const { execFileSync, spawn } = vi.hoisted(() => ({ execFileSync: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync, spawn }))

import { ensureProfile, launchApp, readAppRecord, stopOwnedApp } from '../lifecycle'
import { ensureRunDirectories, getRunPaths } from '../paths'

beforeEach(() => vi.clearAllMocks())

it.each(['macos', 'windows'] as const)(
  'isolates the %s profile and launches Node directly to retain process-group ownership',
  async (platform) => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-prepared-launch-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    vi.stubEnv('CS_DEV_PROFILE_ROOT', '/unrelated/developer-profile')
    for (const key of ['HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'APPDATA', 'LOCALAPPDATA']) {
      vi.stubEnv(key, `/unrelated/developer-${key}`)
    }
    let launched = false
    execFileSync.mockImplementation(() => (launched ? '42001' : ''))
    spawn.mockImplementation(() => {
      launched = true
      return { pid: 42001, unref() {} }
    })
    vi.spyOn(process, 'kill').mockReturnValue(true)
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => [{ type: 'page', title: 'Cherry Studio', url: 'http://localhost:5173/windows/main/index.html' }]
    }))
    try {
      const record = await launchApp(paths, {
        mode: 'branch',
        platform,
        profile: 'authenticated',
        targetRoot: directory,
        runKey: 'prepared',
        restartCount: 1
      })
      const [command, args, options] = spawn.mock.calls[0]
      expect(command).toBe(process.execPath)
      expect(args).toEqual([
        join(directory, 'node_modules', 'dotenv-cli', 'cli.js'),
        '--',
        process.execPath,
        join(directory, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
        '--',
        '--inspect=9229',
        '--sourcemap',
        '--remote-debugging-port=9222',
        '--disable-backgrounding-occluded-windows'
      ])
      expect(options.detached).toBe(true)
      expect(options.env.CS_DEV_PROFILE_ROOT).toBe(join(paths.profiles, 'authenticated'))
      const isolatedHome = join(paths.profiles, 'authenticated', 'home')
      expect(options.env.HOME).toBe(isolatedHome)
      expect(options.env.USERPROFILE).toBe(isolatedHome)
      expect(options.env.TEMP).toBe(join(isolatedHome, 'temp'))
      expect(options.env.TMP).toBe(join(isolatedHome, 'temp'))
      expect(options.env.TMPDIR).toBe(join(isolatedHome, 'temp'))
      expect(existsSync(options.env.TEMP)).toBe(true)
      expect(options.env.CLAUDE_CONFIG_DIR).toBe(join(isolatedHome, '.claude'))
      expect(options.env.CODEX_HOME).toBe(join(isolatedHome, '.codex'))
      expect(existsSync(isolatedHome)).toBe(true)
      if (process.platform === 'win32') {
        expect(options.env.APPDATA).toBe(join(isolatedHome, 'AppData', 'Roaming'))
        expect(options.env.LOCALAPPDATA).toBe(join(isolatedHome, 'AppData', 'Local'))
        expect(existsSync(options.env.APPDATA)).toBe(true)
        expect(existsSync(options.env.LOCALAPPDATA)).toBe(true)
      }
      expect(options.cwd).toBe(directory)
      expect(process.env.CODEX_HOME).toBe('/unrelated/developer-CODEX_HOME')
      expect(process.env.USERPROFILE).toBe('/unrelated/developer-USERPROFILE')
      expect(options.env.CS_DEV_USER_DATA_SUFFIX).toBe('Regression-prepared-authenticated')
      expect(record).toMatchObject({ electronPid: 42001, restartCount: 1, profile: 'authenticated' })
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      rmSync(directory, { recursive: true, force: true })
    }
  }
)

it('starts Windows installers with both owned inspector and renderer CDP ports', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-launch-'))
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  writeFileSync(paths.installation, JSON.stringify({ executablePath: 'C:\\Cherry\\Cherry Studio.exe' }))
  let launched = false
  execFileSync.mockImplementation(() => (launched ? '42001' : ''))
  spawn.mockImplementation(() => {
    launched = true
    return { pid: 42001, unref() {} }
  })
  vi.spyOn(process, 'kill').mockReturnValue(true)
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    json: async () => [
      {
        type: 'page',
        title: 'Cherry Studio',
        url: 'file:///C:/Cherry/resources/app.asar/out/renderer/windows/main/index.html'
      }
    ]
  }))
  try {
    const record = await launchApp(paths, {
      mode: 'tag',
      platform: 'windows',
      profile: 'authenticated',
      targetRoot: directory,
      runKey: 'test'
    })
    expect(record.electronPid).toBe(42001)
    const isolatedHome = join(paths.profiles, 'authenticated', 'home')
    expect(spawn.mock.calls[0][2].env).toMatchObject({
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      TEMP: join(isolatedHome, 'temp'),
      TMP: join(isolatedHome, 'temp'),
      TMPDIR: join(isolatedHome, 'temp'),
      CLAUDE_CONFIG_DIR: join(isolatedHome, '.claude'),
      CODEX_HOME: join(isolatedHome, '.codex')
    })
    expect(spawn.mock.calls[0][1]).toEqual([
      '--inspect=9229',
      '--remote-debugging-port=9222',
      '--disable-backgrounding-occluded-windows',
      `--user-data-dir=${join(paths.profiles, 'authenticated')}`
    ])
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('retains launch ownership and both errors so cleanup can retry after the runner exits', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-launch-failure-'))
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  let childAlive = true
  let denyTermination = true
  let launched = false
  spawn.mockImplementation(() => {
    launched = true
    return { pid: 42000, unref() {} }
  })
  execFileSync.mockImplementation((file: string, args: string[]) => {
    if (file === 'lsof' && launched && childAlive) return args.some((arg) => arg.includes('9229')) ? '42003' : '42002'
    if (file === 'ps' && childAlive)
      return args.includes('pgid=,stat=') ? '42000 S' : `42001 42000 electron ${directory}`
    return ''
  })
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid === -42000 && signal === 'SIGTERM') {
      if (denyTermination) throw new Error('Termination denied')
      childAlive = false
      return true
    }
    if (pid === -42000 && childAlive) return true
    throw new Error('Process not found')
  })
  try {
    const error = await launchApp(paths, {
      mode: 'branch',
      platform: 'macos',
      profile: 'clean',
      targetRoot: directory,
      runKey: 'failed-launch'
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors.map((cause: Error) => cause.message)).toEqual([
      'Application runner 42000 exited before CDP became ready; CDP port 9222 listener pid: 42002; inspector port 9229 listener pid: 42003; process group 42000 has live members: true',
      'Termination denied'
    ])
    expect(JSON.parse(readFileSync(paths.appRecord, 'utf8'))).toMatchObject({
      runnerPid: 42000,
      runKey: 'failed-launch'
    })
    expect(() => readAppRecord(paths)).toThrow('has not finished launching')
    expect(readFileSync(join(paths.logs, 'electron-clean.log'), 'utf8')).toContain(
      '[launch-failure] CDP port 9222 listener pid: 42002; inspector port 9229 listener pid: 42003; process group 42000 has live members: true\n'
    )
    expect(childAlive).toBe(true)
    denyTermination = false
    await stopOwnedApp(paths)
    expect(childAlive).toBe(false)
  } finally {
    vi.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
  }
})

it.each([true, false])(
  'escalates an unresponsive owned group and reports failure if needed (kill succeeds: %s)',
  async (killSucceeds) => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-launch-timeout-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    writeFileSync(
      paths.appRecord,
      JSON.stringify({
        schemaVersion: 1,
        ownership: 'regression-driver',
        policy: 'ephemeral',
        mode: 'branch',
        platform: 'macos',
        runnerPid: 42000,
        targetRoot: directory,
        cdpPort: 9222,
        logPath: join(paths.logs, 'electron.log')
      })
    )
    let childAlive = true
    execFileSync.mockImplementation((file: string, args: string[]) => {
      if (file !== 'ps' || !childAlive) return ''
      return args.includes('pgid=,stat=') ? '42000 S' : `42001 42000 electron ${directory}`
    })
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -42000 && signal === 'SIGKILL' && killSucceeds) childAlive = false
      if (pid === 42000) throw new Error('Process not found')
      return true
    })
    vi.useFakeTimers()
    try {
      const stopping = stopOwnedApp(paths)
      const result = killSucceeds
        ? expect(stopping).resolves.toBeUndefined()
        : expect(stopping).rejects.toThrow('did not exit after SIGKILL')
      await vi.runAllTimersAsync()
      await result
      expect(kill).toHaveBeenCalledWith(-42000, 'SIGTERM')
      expect(kill).toHaveBeenCalledWith(-42000, 'SIGKILL')
      expect(JSON.parse(readFileSync(paths.appRecord, 'utf8')).runnerPid).toBe(42000)
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
      rmSync(directory, { recursive: true, force: true })
    }
  }
)

it.each([
  ['macos', false],
  ['windows', false],
  ['macos', true],
  ['windows', true]
] as const)(
  'recovers the requested %s profile after its owned launch exits (main was ready: %s)',
  async (platform, wasReady) => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-pending-restart-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    writeFileSync(
      paths.appRecord,
      JSON.stringify({
        schemaVersion: 1,
        ownership: 'regression-driver',
        policy: 'ephemeral',
        mode: 'branch',
        platform,
        profile: 'authenticated',
        runKey: 'promotion',
        targetRoot: directory,
        runnerPid: 42000,
        cdpPort: 9222,
        logPath: join(paths.logs, 'electron.log'),
        restartCount: 1,
        ...(wasReady ? { electronPid: 42002, targetUrl: 'http://localhost:5173/windows/main/index.html' } : {})
      })
    )
    let launched = false
    execFileSync.mockImplementation(() => (launched ? '42001' : ''))
    spawn.mockImplementation(() => {
      launched = true
      return { pid: 42001, unref() {} }
    })
    vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === 42001) return true
      throw new Error('Process not found')
    })
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => [{ type: 'page', title: 'Cherry Studio', url: 'http://localhost:5173/windows/main/index.html' }]
    }))
    try {
      if (!wasReady) expect(() => readAppRecord(paths)).toThrow('has not finished launching')
      const ready = await ensureProfile(paths, 'authenticated')
      expect(ready).toMatchObject({
        electronPid: 42001,
        profile: 'authenticated',
        runKey: 'promotion',
        restartCount: 2
      })
      expect(spawn.mock.calls[0][2].env.CS_DEV_PROFILE_ROOT).toBe(join(paths.profiles, 'authenticated'))
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      rmSync(directory, { recursive: true, force: true })
    }
  }
)

it('rejects an occupied main-process inspector before spawning', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-inspector-guard-'))
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  execFileSync.mockImplementation((_file: string, args: string[]) =>
    args.some((arg) => arg.includes('9229')) ? '43000' : ''
  )
  try {
    await expect(
      launchApp(paths, { mode: 'branch', platform: 'macos', profile: 'clean', targetRoot: directory, runKey: 'test' })
    ).rejects.toThrow('Main-process inspector port 9229 is still held by pid 43000; the previous instance did not exit')
    expect(spawn).not.toHaveBeenCalled()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('blocks a recorded recovery failure and clears a failure recorded during a successful launch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-launch-marker-'))
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const options = {
    mode: 'branch',
    platform: 'macos',
    profile: 'clean',
    targetRoot: directory,
    runKey: 'test'
  } as const
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(directory, 'state'))
  writeFileSync(paths.appLaunchFailure, JSON.stringify({ reason: 'runner exited', recordedAt: 'now', runnerPid: 42 }))
  try {
    await expect(launchApp(paths, options)).rejects.toThrow('Previous application relaunch failed: runner exited')
    expect(spawn).not.toHaveBeenCalled()
    rmSync(paths.appLaunchFailure)
    let launched = false
    execFileSync.mockImplementation(() => (launched ? '42001' : ''))
    spawn.mockImplementation(() => {
      launched = true
      writeFileSync(paths.appLaunchFailure, JSON.stringify({ reason: 'old failure' }))
      return { pid: 42001, unref() {} }
    })
    vi.spyOn(process, 'kill').mockReturnValue(true)
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => [{ type: 'page', url: 'http://localhost/windows/main/index.html' }]
    }))
    await launchApp(paths, options)
    expect(existsSync(paths.appLaunchFailure)).toBe(false)
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    rmSync(directory, { recursive: true, force: true })
  }
})
