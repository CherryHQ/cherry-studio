import type * as ChildProcess from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'

import { afterEach, vi } from 'vitest'

const { execFileSyncMock, spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execFileSyncMock: vi.fn()
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFileSync: execFileSyncMock,
  spawn: spawnMock
}))

import { type AppRecord, createProfileEnvironment, ensureProfile, launchApp, stopOwnedApp } from '../lifecycle'
import { ensureRunDirectories, getRunPaths } from '../paths'
import * as processUtils from '../process'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  spawnMock.mockReset()
  execFileSyncMock.mockReset()
  vi.restoreAllMocks()
})

describe('isolated profile environment', () => {
  it('makes native shell directories available inside the isolated Windows profile', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-regression-windows-profile-'))
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    try {
      const environment = createProfileEnvironment(getRunPaths(directory), 'authenticated')
      for (const path of [
        join(environment.USERPROFILE!, 'Desktop'),
        join(environment.USERPROFILE!, 'Documents'),
        join(environment.USERPROFILE!, 'Downloads'),
        join(environment.APPDATA!, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      ]) {
        expect(statSync(path).isDirectory(), path).toBe(true)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('owned application lifecycle', () => {
  it.each(['drained', 'stuck', 'alive', 'EPERM', 'UNKNOWN'])(
    'only waits for an unverified macOS group after the runner has exited: %s',
    async (outcome) => {
      vi.useFakeTimers()
      const directory = mkdtempSync(join(tmpdir(), 'cherry-draining-runner-'))
      const paths = getRunPaths(directory)
      ensureRunDirectories(paths)
      const runnerPid = 42_000
      writeFileSync(
        paths.appRecord,
        JSON.stringify({
          schemaVersion: 1,
          ownership: 'regression-driver',
          policy: 'ephemeral',
          mode: 'branch',
          platform: 'macos',
          targetRoot: '/owned/app',
          runnerPid,
          cdpPort: 9222,
          logPath: join(paths.logs, 'electron.log')
        })
      )
      let workerAlive = true
      let probes = 0
      const signals: number[] = []
      const releasedPorts = new Set<string>()
      vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        if (signal !== 0) {
          signals.push(pid)
          return true
        }
        const code = probes++ === 0 || outcome === 'drained' || outcome === 'stuck' ? 'ESRCH' : outcome
        if (code === 'alive') return true
        throw Object.assign(new Error('Runner liveness'), { code })
      })
      execFileSyncMock.mockImplementation((file: string, args: string[]) => {
        if (file === 'lsof') {
          releasedPorts.add(args[1])
          return ''
        }
        if (file === 'ps' && args.includes('lstart=')) return 'Sun Nov 8 23:29:04 2026'
        if (file === 'ps' && args.includes('pid=,pgid=,stat=,command='))
          return workerAlive ? `42001 ${runnerPid} S /usr/bin/transient-worker` : ''
        if (file === 'ps' && args.includes('pgid=,stat=')) return workerAlive ? `${runnerPid} S` : ''
        throw new Error('Unexpected process query')
      })
      if (outcome === 'drained') setTimeout(() => (workerAlive = false), 250)
      try {
        const stopped = stopOwnedApp(paths)
        const assertion =
          outcome === 'drained'
            ? expect(stopped).resolves.toBeUndefined()
            : expect(stopped).rejects.toThrow('orphaned process group does not match the owned application')
        await Promise.all([assertion, vi.runAllTimersAsync()])
        expect(signals).toEqual([])
        if (outcome === 'drained') {
          expect(workerAlive).toBe(false)
          expect(releasedPorts).toEqual(new Set(['-iTCP:9222', `-iTCP:${processUtils.MAIN_INSPECTOR_PORT}`]))
        } else expect(workerAlive).toBe(true)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )

  it.each(['ESRCH', 'EPERM', 'UNKNOWN', 'alive'])(
    'handles a Windows identity lookup race without terminating an unverified PID: %s',
    async (liveness) => {
      const directory = mkdtempSync(join(tmpdir(), 'cherry-exiting-runner-'))
      const paths = getRunPaths(directory)
      ensureRunDirectories(paths)
      const pid = 42_000
      writeFileSync(
        paths.appRecord,
        JSON.stringify({
          schemaVersion: 1,
          ownership: 'regression-driver',
          policy: 'ephemeral',
          mode: 'branch',
          platform: 'windows',
          targetRoot: 'D:\\target-app',
          runnerPid: pid,
          cdpPort: 9222,
          logPath: join(paths.logs, 'electron.log')
        })
      )
      let queried = false
      let disappearanceObserved = false
      let terminated = false
      vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
        if (signal !== 0) {
          terminated = true
          return true
        }
        if (queried && !disappearanceObserved && liveness !== 'alive') {
          disappearanceObserved = true
          throw Object.assign(new Error('Liveness unavailable'), { code: liveness })
        }
        // A reused PID becomes live immediately after the confirmed exit.
        return true
      })
      execFileSyncMock.mockImplementation((file: string, args: string[]) => {
        if (file === 'taskkill.exe') {
          terminated = true
          return ''
        }
        const script = String(args.at(-1))
        if (script.includes('Get-NetTCPConnection')) return ''
        if (script.includes('CreationDate'))
          return JSON.stringify({ present: false, hasCommand: false, startedAt: null })
        if (script.includes('CommandLine')) {
          queried = true
          return ''
        }
        throw new Error('Unexpected query')
      })
      try {
        if (liveness === 'ESRCH') {
          await expect(stopOwnedApp(paths)).resolves.toBeUndefined()
          expect(readFileSync(join(paths.logs, 'electron.log'), 'utf8')).toContain(`PID ${pid}; exited=true`)
          expect(readFileSync(join(paths.logs, 'electron.log'), 'utf8')).toContain('"hasCommand":false')
        } else {
          await expect(stopOwnedApp(paths)).rejects.toThrow(
            liveness === 'alive' ? 'command no longer matches' : `liveness: ${liveness}`
          )
        }
        expect(queried).toBe(true)
        expect(terminated).toBe(false)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )

  it('stops a packaged macOS relocation without triggering a renderer-driven relaunch', async () => {
    vi.useFakeTimers()
    const directory = mkdtempSync(join(tmpdir(), 'cherry-regression-lifecycle-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    const mainPid = 42_000
    const rendererPid = 42_001
    const executablePath = posix.join(directory, 'Cherry Studio.app/Contents/MacOS/Cherry Studio')
    const alive = new Set([mainPid, rendererPid])
    let relaunched = false
    let command = executablePath
    let helperCommand = posix.join(
      directory,
      'Cherry Studio.app/Contents/Frameworks/Cherry Studio Helper.app/Contents/MacOS/Cherry Studio Helper'
    )
    const record: AppRecord = {
      schemaVersion: 1,
      ownership: 'regression-driver',
      policy: 'ephemeral',
      mode: 'tag',
      platform: 'macos',
      profile: 'authenticated',
      runKey: 'relocation',
      targetRoot: directory,
      executablePath,
      command: executablePath,
      args: [],
      cwd: directory,
      runnerPid: mainPid,
      electronPid: mainPid,
      cdpPort: 9222,
      targetUrl: 'file:///windows/userDataRelocation/index.html',
      logPath: join(paths.logs, 'electron.log'),
      startedAt: '2026-10-26T00:00:00.000Z',
      restartCount: 1
    }
    writeFileSync(paths.appRecord, JSON.stringify(record))
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0) {
        if (!alive.has(Number(pid))) throw new Error('Process not found')
        return true
      }
      if (pid === mainPid) {
        alive.delete(mainPid)
        return true
      }
      if (pid === -mainPid && alive.has(mainPid)) relaunched = true
      alive.clear()
      return true
    })
    execFileSyncMock.mockImplementation((file: string, args: string[]) => {
      if (file === 'lsof') return relaunched ? '43000' : alive.has(mainPid) ? String(mainPid) : ''
      if (file === 'ps' && args.includes('command=')) return command
      if (file === 'ps' && args.includes('pid=,pgid=,stat=,command='))
        return [...alive].map((pid) => `${pid} ${mainPid} S ${pid === mainPid ? command : helperCommand}`).join('\n')
      if (file === 'ps' && args.includes('pgid=,stat=')) return [...alive].map(() => `${mainPid} S`).join('\n')
      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    })
    try {
      const stopped = expect(stopOwnedApp(paths)).resolves.toBeUndefined()
      await vi.runAllTimersAsync()
      await stopped
      expect(alive.size).toBe(0)
      expect(relaunched).toBe(false)

      alive.add(mainPid)
      command = '/Applications/Unrelated.app/Contents/MacOS/Unrelated'
      await expect(stopOwnedApp(paths)).rejects.toThrow('its command no longer matches the owned run')
      expect(alive.has(mainPid)).toBe(true)

      alive.delete(mainPid)
      alive.add(rendererPid)
      helperCommand = '/Applications/Unrelated.app/Contents/MacOS/Unrelated'
      await expect(stopOwnedApp(paths)).rejects.toThrow('orphaned process group does not match the owned application')
      expect(alive.has(rendererPid)).toBe(true)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('reuses a live application when the requested profile already matches', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-regression-lifecycle-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    const record: AppRecord = {
      schemaVersion: 1,
      ownership: 'regression-driver',
      policy: 'ephemeral',
      mode: 'branch',
      platform: 'macos',
      profile: 'clean',
      runKey: 'test-run',
      targetRoot: '/tmp/target-app',
      command: 'pnpm',
      args: ['debug'],
      cwd: '/tmp/target-app',
      runnerPid: 42_000,
      electronPid: 42_001,
      cdpPort: 9222,
      targetUrl: 'http://127.0.0.1:9222',
      logPath: join(paths.logs, 'electron.log'),
      startedAt: '2026-08-22T00:00:00.000Z',
      restartCount: 0
    }
    writeFileSync(paths.appRecord, JSON.stringify(record))
    vi.spyOn(process, 'kill').mockReturnValue(true)

    try {
      await expect(ensureProfile(paths, 'clean')).resolves.toEqual(record)
      expect(execFileSyncMock).not.toHaveBeenCalled()
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('force terminates the verified Windows process tree and waits for its CDP listener', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-regression-lifecycle-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    const runnerPid = 42_000
    const electronPid = 42_001
    const alive = new Set([runnerPid, electronPid])
    let cdpChecks = 0
    const targetRoot = 'D:\\target-app'
    const record: AppRecord = {
      schemaVersion: 1,
      ownership: 'regression-driver',
      policy: 'ephemeral',
      mode: 'branch',
      platform: 'windows',
      profile: 'authenticated',
      runKey: 'test-run',
      targetRoot,
      command: 'pnpm.cmd',
      args: ['debug'],
      cwd: targetRoot,
      runnerPid,
      electronPid,
      cdpPort: 9222,
      targetUrl: 'http://127.0.0.1:9222',
      logPath: join(paths.logs, 'electron.log'),
      startedAt: '2026-08-22T00:00:00.000Z',
      restartCount: 0
    }
    writeFileSync(paths.appRecord, JSON.stringify(record))

    vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (!alive.has(Number(pid))) throw Object.assign(new Error('Process not found'), { code: 'ESRCH' })
      return true
    })
    execFileSyncMock.mockImplementation((file: string, args: string[]) => {
      const script = String(args.at(-1))
      if (file === 'taskkill.exe') {
        if (Number(args[1]) === runnerPid) alive.clear()
        else alive.delete(Number(args[1]))
        return ''
      }
      if (script.includes('Get-NetTCPConnection')) {
        cdpChecks += 1
        return alive.has(electronPid) || cdpChecks === 2 ? String(electronPid) : ''
      }
      if (script.includes('CommandLine')) {
        return script.includes(String(electronPid))
          ? targetRoot
          : `node ${win32.join(targetRoot, 'node_modules', 'dotenv-cli', 'cli.js')}`
      }
      if (script.includes('ParentProcessId')) return script.includes(String(electronPid)) ? String(runnerPid) : '1'
      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    })

    try {
      await stopOwnedApp(paths)
      expect(execFileSyncMock).not.toHaveBeenCalledWith(
        'taskkill.exe',
        ['/PID', String(electronPid), '/T', '/F'],
        expect.anything()
      )
      expect(execFileSyncMock).toHaveBeenCalledWith(
        'taskkill.exe',
        ['/PID', String(runnerPid), '/T', '/F'],
        expect.anything()
      )
      expect([...alive]).toEqual([])
      expect(cdpChecks).toBeGreaterThan(2)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('only terminates a replacement Windows Electron process owned by the recorded runner', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-regression-lifecycle-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    const runnerPid = 42_000
    const staleElectronPid = 42_001
    const currentElectronPid = 42_002
    const alive = new Set([runnerPid, currentElectronPid])
    let currentParentPid = 1
    const targetRoot = 'D:\\target-app'
    const record: AppRecord = {
      schemaVersion: 1,
      ownership: 'regression-driver',
      policy: 'ephemeral',
      mode: 'branch',
      platform: 'windows',
      profile: 'authenticated',
      runKey: 'test-run',
      targetRoot,
      command: 'pnpm.cmd',
      args: ['debug'],
      cwd: targetRoot,
      runnerPid,
      electronPid: staleElectronPid,
      cdpPort: 9222,
      targetUrl: 'http://127.0.0.1:9222',
      logPath: join(paths.logs, 'electron.log'),
      startedAt: '2026-08-22T00:00:00.000Z',
      restartCount: 0
    }
    writeFileSync(paths.appRecord, JSON.stringify(record))

    vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (!alive.has(Number(pid))) throw Object.assign(new Error('Process not found'), { code: 'ESRCH' })
      return true
    })
    execFileSyncMock.mockImplementation((file: string, args: string[]) => {
      const script = String(args.at(-1))
      if (file === 'taskkill.exe') {
        if (Number(args[1]) === runnerPid) alive.clear()
        else alive.delete(Number(args[1]))
        return ''
      }
      if (script.includes('Get-NetTCPConnection'))
        return alive.has(currentElectronPid) ? String(currentElectronPid) : ''
      if (script.includes('CommandLine')) {
        return script.includes(String(currentElectronPid))
          ? targetRoot
          : `node ${win32.join(targetRoot, 'node_modules', 'dotenv-cli', 'cli.js')}`
      }
      if (script.includes('ParentProcessId'))
        return script.includes(String(currentElectronPid)) ? String(currentParentPid) : '1'
      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    })

    try {
      await expect(stopOwnedApp(paths)).rejects.toThrow(
        'Refusing cleanup because the current CDP process is not owned by the recorded runner'
      )
      expect(execFileSyncMock.mock.calls.some(([file]) => file === 'taskkill.exe')).toBe(false)

      currentParentPid = runnerPid
      await stopOwnedApp(paths)
      expect(execFileSyncMock).toHaveBeenCalledWith(
        'taskkill.exe',
        ['/PID', String(runnerPid), '/T', '/F'],
        expect.anything()
      )
      expect(execFileSyncMock).not.toHaveBeenCalledWith(
        'taskkill.exe',
        ['/PID', String(currentElectronPid), '/T', '/F'],
        expect.anything()
      )
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})

it.each(['macos', 'windows'] as const)(
  'reports an inspector port that remains held after %s cleanup',
  async (platform) => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-inspector-release-'))
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
        runnerPid: 42000,
        targetRoot: directory,
        cdpPort: 9222,
        logPath: join(paths.logs, 'electron.log')
      })
    )
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Process not found'), { code: 'ESRCH' })
    })
    execFileSyncMock.mockImplementation((_file: string, args: string[]) =>
      args.some((arg) => arg.includes('9229')) ? '43000' : ''
    )
    vi.useFakeTimers()
    try {
      const result = expect(stopOwnedApp(paths)).rejects.toThrow(
        'Main-process inspector port 9229 was not released after stopping the owned application'
      )
      await vi.runAllTimersAsync()
      await result
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
)

it('launches a prebuilt branch without rebuilding or inheriting another renderer server', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-prebuilt-launch-'))
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://unrelated.invalid')
  vi.spyOn(processUtils, 'findCdpPid').mockReturnValueOnce(undefined).mockReturnValue(42_001)
  vi.spyOn(processUtils, 'findListeningPid').mockReturnValue(undefined)
  vi.spyOn(processUtils, 'isAlive').mockReturnValue(true)
  vi.spyOn(processUtils, 'isDescendant').mockReturnValue(true)
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify([{ type: 'page', url: 'file:///test/out/renderer/windows/main/index.html' }]))
      )
  )
  spawnMock.mockReturnValue({ pid: 42_000, unref: vi.fn(), exitCode: null })
  try {
    await launchApp(paths, {
      mode: 'branch',
      platform: 'macos',
      profile: 'authenticated',
      targetRoot: directory,
      runKey: 'prebuilt',
      readyTimeoutMs: 100
    })
    const [, args, options] = spawnMock.mock.calls[0]
    const viteArguments = args.slice(args.findIndex((value: string) => value.endsWith('electron-vite.js')) + 1)
    expect(viteArguments.slice(0, 3)).toEqual(['preview', '--skipBuild', '--'])
    expect(options.env.ELECTRON_RENDERER_URL).toBeUndefined()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
