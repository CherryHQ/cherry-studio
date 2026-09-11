import type * as ChildProcess from 'node:child_process'

import { afterEach, vi } from 'vitest'

import { sendProtocolUrlToOwnedApp } from '../debugBridge'
import type { AppRecord } from '../lifecycle'

const { evaluateCdpExpressionMock, execFileSyncMock } = vi.hoisted(() => ({
  evaluateCdpExpressionMock: vi.fn(),
  execFileSyncMock: vi.fn()
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFileSync: execFileSyncMock
}))
vi.mock('../cdpClient', () => ({ evaluateCdpExpression: evaluateCdpExpressionMock }))

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

describe('owned application debug bridge', () => {
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
