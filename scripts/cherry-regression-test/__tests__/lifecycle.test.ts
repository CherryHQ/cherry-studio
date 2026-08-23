import type * as ChildProcess from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, vi } from 'vitest'

const execFileSyncMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFileSync: execFileSyncMock
}))

import { type AppRecord, ensureProfile, sendProtocolUrlToOwnedApp, stopOwnedApp } from '../lifecycle'
import { ensureRunDirectories, getRunPaths } from '../paths'

afterEach(() => {
  execFileSyncMock.mockReset()
  vi.restoreAllMocks()
})

describe('owned application lifecycle', () => {
  it('reuses a live application when the requested profile already matches', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'cherry-regression-lifecycle-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    const record: AppRecord = {
      schemaVersion: 1,
      ownership: 'agent',
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
      ownership: 'agent',
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
        alive.delete(Number(args[1]))
        return ''
      }
      if (script.includes('Get-NetTCPConnection')) return String(electronPid)
      if (script.includes('CommandLine')) return script.includes(String(electronPid)) ? targetRoot : 'pnpm debug'
      if (script.includes('ParentProcessId')) return script.includes(String(electronPid)) ? String(runnerPid) : '1'
      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    })

    try {
      await stopOwnedApp(paths)
      expect(execFileSyncMock).toHaveBeenCalledWith(
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

  it('delivers a protocol URL to the owned Windows development instance', () => {
    const electronPid = 42_001
    const targetRoot = 'D:\\target-app'
    const executablePath = `${targetRoot}\\node_modules\\electron\\dist\\electron.exe`
    const record: AppRecord = {
      schemaVersion: 1,
      ownership: 'agent',
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
    execFileSyncMock.mockImplementation((file: string, args: string[]) => {
      const script = String(args.at(-1))
      if (file === executablePath) return ''
      if (script.includes('Get-NetTCPConnection')) return String(electronPid)
      if (script.includes('CommandLine')) return `${executablePath} ${targetRoot}`
      if (script.includes('ExecutablePath')) return executablePath
      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    })

    sendProtocolUrlToOwnedApp(record, callback)

    expect(execFileSyncMock).toHaveBeenCalledWith(
      executablePath,
      [targetRoot, callback],
      expect.objectContaining({
        cwd: targetRoot,
        env: expect.objectContaining({ CS_DEV_USER_DATA_SUFFIX: 'Regression-test-run-authenticated' }),
        stdio: 'ignore',
        windowsHide: true
      })
    )
  })

  it('delivers a protocol URL directly to the owned macOS development instance', () => {
    const electronPid = 42_001
    const targetRoot = '/tmp/target-app'
    const executablePath = `${targetRoot}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`
    const record: AppRecord = {
      schemaVersion: 1,
      ownership: 'agent',
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
    execFileSyncMock.mockImplementation((file: string, args: string[]) => {
      if (file === executablePath) return ''
      if (file === 'lsof') return String(electronPid)
      if (file === 'ps' && args.includes('command=')) return `${executablePath} ${targetRoot}`
      if (file === 'ps' && args.includes('comm=')) return executablePath
      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    })

    sendProtocolUrlToOwnedApp(record, callback)

    expect(execFileSyncMock).toHaveBeenCalledWith(
      executablePath,
      [targetRoot, callback],
      expect.objectContaining({
        cwd: targetRoot,
        env: expect.objectContaining({ CS_DEV_USER_DATA_SUFFIX: 'Regression-test-run-authenticated' }),
        stdio: 'ignore'
      })
    )
  })
})
