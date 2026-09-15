import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { vi } from 'vitest'

const { execFileSync, spawn } = vi.hoisted(() => ({ execFileSync: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync, spawn }))

import { launchApp, readAppRecord, stopOwnedApp } from '../lifecycle'
import { ensureRunDirectories, getRunPaths } from '../paths'

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
    expect(spawn.mock.calls[0][1]).toEqual([
      '--inspect=9229',
      '--remote-debugging-port=9222',
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
  spawn.mockReturnValue({ pid: 42000, unref() {} })
  execFileSync.mockImplementation((file: string) =>
    file === 'ps' && childAlive ? `42001 42000 electron ${directory}` : ''
  )
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
      'Application runner 42000 exited before CDP became ready',
      'Termination denied'
    ])
    expect(JSON.parse(readFileSync(paths.appRecord, 'utf8'))).toMatchObject({
      runnerPid: 42000,
      runKey: 'failed-launch'
    })
    expect(() => readAppRecord(paths)).toThrow('has not finished launching')
    expect(childAlive).toBe(true)
    denyTermination = false
    await stopOwnedApp(paths)
    expect(childAlive).toBe(false)
  } finally {
    vi.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('reports a process group that ignores termination instead of accepting incomplete cleanup', async () => {
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
  execFileSync.mockReturnValue(`42001 42000 electron ${directory}`)
  vi.spyOn(process, 'kill').mockImplementation((pid) => {
    if (pid === 42000) throw new Error('Process not found')
    return true
  })
  vi.useFakeTimers()
  try {
    const result = expect(stopOwnedApp(paths)).rejects.toThrow('did not exit after SIGTERM')
    await vi.runAllTimersAsync()
    await result
    expect(JSON.parse(readFileSync(paths.appRecord, 'utf8')).runnerPid).toBe(42000)
  } finally {
    vi.useRealTimers()
    vi.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
  }
})
