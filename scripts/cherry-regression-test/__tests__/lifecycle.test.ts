import type * as ChildProcess from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, vi } from 'vitest'

const { evaluateCdpExpressionMock, execFileSyncMock } = vi.hoisted(() => ({
  evaluateCdpExpressionMock: vi.fn(),
  execFileSyncMock: vi.fn()
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFileSync: execFileSyncMock
}))
vi.mock('../cdp-client', () => ({ evaluateCdpExpression: evaluateCdpExpressionMock }))

import {
  type AppRecord,
  ensureProfile,
  prepareWindowsCdpConnection,
  sendProtocolUrlToOwnedApp,
  stopOwnedApp
} from '../lifecycle'
import { ensureRunDirectories, getRunPaths } from '../paths'

afterEach(() => {
  evaluateCdpExpressionMock.mockReset()
  execFileSyncMock.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mockMainInspector(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => [{ type: 'node', webSocketDebuggerUrl: 'ws://127.0.0.1:9229/main-process' }],
      ok: true,
      status: 200
    })
  )
  evaluateCdpExpressionMock.mockResolvedValue(true)
}

describe('owned application lifecycle', () => {
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

  it('force terminates the verified Windows process tree', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-regression-lifecycle-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    const runnerPid = 42_000
    const electronPid = 42_001
    const alive = new Set([runnerPid, electronPid])
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
      if (!alive.has(Number(pid))) throw new Error('Process not found')
      return true
    })
    execFileSyncMock.mockImplementation((file: string, args: string[]) => {
      const script = String(args.at(-1))
      if (file === 'taskkill.exe') {
        if (Number(args[1]) === runnerPid) alive.clear()
        else alive.delete(Number(args[1]))
        return ''
      }
      if (script.includes('Get-NetTCPConnection')) return String(electronPid)
      if (script.includes('CommandLine')) return script.includes(String(electronPid)) ? targetRoot : 'pnpm debug'
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
      if (!alive.has(Number(pid))) throw new Error('Process not found')
      return true
    })
    execFileSyncMock.mockImplementation((file: string, args: string[]) => {
      const script = String(args.at(-1))
      if (file === 'taskkill.exe') {
        if (Number(args[1]) === runnerPid) alive.clear()
        else alive.delete(Number(args[1]))
        return ''
      }
      if (script.includes('Get-NetTCPConnection')) return String(currentElectronPid)
      if (script.includes('CommandLine')) return script.includes(String(currentElectronPid)) ? targetRoot : 'pnpm debug'
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

  it('delivers a protocol URL through the owned Windows main-process inspector', async () => {
    const electronPid = 42_001
    const targetRoot = 'D:\\target-app'
    const executablePath = `${targetRoot}\\node_modules\\electron\\dist\\electron.exe`
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
      runnerPid: 42_000,
      electronPid,
      cdpPort: 9222,
      targetUrl: 'http://127.0.0.1:9222',
      logPath: 'D:\\run\\electron.log',
      startedAt: '2026-08-22T00:00:00.000Z',
      restartCount: 0
    }
    const callback = 'cherrystudio://oauth/callback?code=test-code&state=test-state'
    vi.spyOn(process, 'kill').mockReturnValue(true)
    mockMainInspector()
    execFileSyncMock.mockImplementation((file: string, args: string[]) => {
      const script = String(args.at(-1))
      if (script.includes('Get-NetTCPConnection')) return String(electronPid)
      if (script.includes('CommandLine')) return `${executablePath} ${targetRoot}`
      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    })

    await sendProtocolUrlToOwnedApp(record, callback)

    expect(evaluateCdpExpressionMock).toHaveBeenCalledWith(
      'ws://127.0.0.1:9229/main-process',
      expect.stringContaining("electron.app.emit('open-url'")
    )
    expect(evaluateCdpExpressionMock.mock.calls[0][1]).toContain(callback)
  })

  it('disposes non-main windows before a Windows CDP connection', async () => {
    const electronPid = 42_001
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
      runnerPid: 42_000,
      electronPid,
      cdpPort: 9222,
      targetUrl: 'http://127.0.0.1:9222',
      logPath: 'D:\\run\\electron.log',
      startedAt: '2026-08-22T00:00:00.000Z',
      restartCount: 0
    }
    vi.spyOn(process, 'kill').mockReturnValue(true)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => ({
        json: async () =>
          url.includes(':9229')
            ? [{ type: 'node', webSocketDebuggerUrl: 'ws://127.0.0.1:9229/main-process' }]
            : [{ title: 'Cherry Studio', type: 'page', url: 'http://localhost/windows/main/index.html' }],
        ok: true,
        status: 200
      }))
    )
    evaluateCdpExpressionMock.mockResolvedValue(2)
    execFileSyncMock.mockImplementation((file: string, args: string[]) => {
      const script = String(args.at(-1))
      if (script.includes('Get-NetTCPConnection')) return String(electronPid)
      if (script.includes('CommandLine')) return `${targetRoot}\\node_modules\\electron\\electron.exe ${targetRoot}`
      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    })

    await prepareWindowsCdpConnection(record)

    expect(evaluateCdpExpressionMock).toHaveBeenCalledWith(
      'ws://127.0.0.1:9229/main-process',
      expect.stringContaining('/windows/main/index.html')
    )
    expect(evaluateCdpExpressionMock.mock.calls[0][1]).toContain('pathname !== mainWindowPath')
    expect(evaluateCdpExpressionMock.mock.calls[0][1]).toContain('window.destroy()')
  })

  it('delivers a protocol URL through the owned macOS main-process inspector', async () => {
    const electronPid = 42_001
    const targetRoot = '/tmp/target-app'
    const executablePath = `${targetRoot}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`
    const record: AppRecord = {
      schemaVersion: 1,
      ownership: 'regression-driver',
      policy: 'ephemeral',
      mode: 'branch',
      platform: 'macos',
      profile: 'authenticated',
      runKey: 'test-run',
      targetRoot,
      command: 'pnpm',
      args: ['debug'],
      cwd: targetRoot,
      runnerPid: 42_000,
      electronPid,
      cdpPort: 9222,
      targetUrl: 'http://127.0.0.1:9222',
      logPath: '/tmp/run/electron.log',
      startedAt: '2026-08-22T00:00:00.000Z',
      restartCount: 0
    }
    const callback = 'cherrystudio://oauth/callback?code=test-code&state=test-state'
    vi.spyOn(process, 'kill').mockReturnValue(true)
    mockMainInspector()
    execFileSyncMock.mockImplementation((file: string, args: string[]) => {
      if (file === 'lsof' && args.includes('-iTCP:9222')) return String(electronPid)
      if (file === 'lsof' && args.includes('-iTCP:9229')) return String(electronPid)
      if (file === 'ps' && args.includes('command=')) return `${executablePath} ${targetRoot}`
      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    })

    await sendProtocolUrlToOwnedApp(record, callback)

    expect(evaluateCdpExpressionMock).toHaveBeenCalledWith(
      'ws://127.0.0.1:9229/main-process',
      expect.stringContaining("electron.app.emit('open-url'")
    )
    expect(evaluateCdpExpressionMock.mock.calls[0][1]).toContain(callback)
  })

  it('rejects a main-process inspector owned by another process', async () => {
    const electronPid = 42_001
    const targetRoot = '/tmp/target-app'
    const record: AppRecord = {
      schemaVersion: 1,
      ownership: 'regression-driver',
      policy: 'ephemeral',
      mode: 'branch',
      platform: 'macos',
      profile: 'authenticated',
      runKey: 'test-run',
      targetRoot,
      command: 'pnpm',
      args: ['debug'],
      cwd: targetRoot,
      runnerPid: 42_000,
      electronPid,
      cdpPort: 9222,
      targetUrl: 'http://127.0.0.1:9222',
      logPath: '/tmp/run/electron.log',
      startedAt: '2026-08-22T00:00:00.000Z',
      restartCount: 0
    }
    vi.spyOn(process, 'kill').mockReturnValue(true)
    execFileSyncMock.mockImplementation((file: string, args: string[]) => {
      if (file === 'lsof' && args.includes('-iTCP:9222')) return String(electronPid)
      if (file === 'lsof' && args.includes('-iTCP:9229')) return '99999'
      if (file === 'ps' && args.includes('command='))
        return `${targetRoot}/node_modules/electron/Electron ${targetRoot}`
      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    })

    await expect(
      sendProtocolUrlToOwnedApp(record, 'cherrystudio://oauth/callback?code=test-code&state=test-state')
    ).rejects.toThrow('does not own the main-process inspector')
    expect(evaluateCdpExpressionMock).not.toHaveBeenCalled()
  })
})
