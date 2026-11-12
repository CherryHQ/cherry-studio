import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { vi } from 'vitest'

const { command } = vi.hoisted(() => ({ command: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync: command }))

import { type AppRecord, stopOwnedApp } from '../lifecycle'
import { ensureRunDirectories, getRunPaths } from '../paths'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  command.mockReset()
})

it.each([1_000, 20_000, null])(
  'waits for a quitting app without signaling an unidentified orphan (exit delay: %s)',
  async (exitDelay) => {
    vi.useFakeTimers()
    const directory = mkdtempSync(join(tmpdir(), 'cherry-mac-shutdown-'))
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    const record: AppRecord = {
      schemaVersion: 1,
      ownership: 'regression-driver',
      policy: 'ephemeral',
      mode: 'branch',
      platform: 'macos',
      profile: 'authenticated',
      runKey: 'shutdown',
      targetRoot: directory,
      command: 'node',
      args: [],
      cwd: directory,
      runnerPid: 42000,
      electronPid: 42001,
      cdpPort: 9222,
      targetUrl: 'http://localhost:5173/windows/main/index.html',
      logPath: join(paths.logs, 'electron.log'),
      startedAt: new Date().toISOString(),
      restartCount: 0
    }
    writeFileSync(paths.appRecord, JSON.stringify(record))
    const alive = new Set([42002, 99000])
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal !== 0) throw new Error('An unidentified process must never be signaled')
      if (!alive.has(Number(pid))) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      return true
    })
    command.mockImplementation((file: string, args: string[]) => {
      if (file === 'lsof') return ''
      if (args.includes('pgid=,stat=')) return alive.has(42002) ? '42000 S\n99000 S' : '99000 S'
      if (args.includes('pid=,pgid=,stat=,command='))
        return alive.has(42002)
          ? '42002 42000 S npx server-everything\n99000 99000 S TextEdit'
          : '99000 99000 S TextEdit'
      if (args.includes('lstart=')) return 'Sat Nov 7 10:50:30 2026'
      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    })
    if (exitDelay !== null) setTimeout(() => alive.delete(42002), exitDelay)
    try {
      const outcome =
        exitDelay !== null
          ? expect(stopOwnedApp(paths)).resolves.toBeUndefined()
          : expect(stopOwnedApp(paths)).rejects.toThrow('orphaned process group does not match the owned application')
      await Promise.all([vi.runAllTimersAsync(), outcome])
      expect([...alive]).toEqual(exitDelay !== null ? [99000] : [42002, 99000])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
)
