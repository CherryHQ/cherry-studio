import type * as ChildProcess from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { createContext as createVmContext, runInContext } from 'node:vm'

import { afterEach, expect, it, vi } from 'vitest'

import { requestOwnedAppQuit } from '../debugBridge'
import { type AppRecord, restartApp } from '../lifecycle'
import { ensureRunDirectories, getRunPaths } from '../paths'

const { execute, command } = vi.hoisted(() => ({ execute: vi.fn(), command: vi.fn() }))
vi.mock('../cdpClient', () => ({ evaluateCdpExpression: execute }))
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcess>()),
  execFileSync: command
}))

const directories: string[] = []
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  execute.mockReset()
  command.mockReset()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function runtime(preventQuit = false) {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-graceful-restart-'))
  directories.push(directory)
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const pendingFile = join(directory, 'pending-state.txt')
  writeFileSync(pendingFile, 'previous state')
  const record: AppRecord = {
    schemaVersion: 1,
    ownership: 'regression-driver',
    policy: 'ephemeral',
    mode: 'branch',
    platform: 'windows',
    profile: 'authenticated',
    runKey: 'graceful-restart',
    targetRoot: directory,
    cwd: directory,
    command: 'node',
    args: [],
    runnerPid: 42000,
    electronPid: 42001,
    cdpPort: 9222,
    targetUrl: 'http://localhost:5173/windows/main/index.html',
    logPath: join(paths.logs, 'electron.log'),
    startedAt: new Date().toISOString(),
    restartCount: 0
  }
  writeFileSync(paths.appRecord, JSON.stringify(record))
  const alive = new Set([record.runnerPid, record.electronPid])
  const state = { inspectorPid: record.electronPid }
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (signal !== 0) throw new Error('Unexpected process signal')
    if (!alive.has(Number(pid))) throw new Error('Process not found')
    return true
  })
  command.mockImplementation((file: string, args: string[]) => {
    const script = args.at(-1) ?? ''
    if (file === 'taskkill.exe') {
      writeFileSync(pendingFile, 'state lost by forced termination')
      throw new Error('Forced termination is not a normal restart')
    }
    if (script.includes('Get-NetTCPConnection'))
      return String(script.includes('9222') ? record.electronPid : state.inspectorPid)
    if (script.includes('CommandLine'))
      return script.includes(String(record.runnerPid))
        ? win32.join(directory, 'node_modules', 'dotenv-cli', 'cli.js')
        : `${directory}/node_modules/electron/electron.exe ${directory}`
    if (script.includes('ParentProcessId')) return String(record.runnerPid)
    throw new Error(`Unexpected command: ${file}`)
  })
  vi.stubGlobal('fetch', async () =>
    Response.json([{ type: 'node', webSocketDebuggerUrl: 'ws://127.0.0.1:9229/owned-main' }])
  )
  const context = createVmContext({
    setImmediate,
    process: {
      mainModule: {
        require: () => ({
          app: {
            quit() {
              if (preventQuit) return
              writeFileSync(pendingFile, 'state saved by normal shutdown')
              alive.delete(record.electronPid)
            }
          }
        })
      }
    }
  })
  execute.mockImplementation(async (_url: string, expression: string) => runInContext(expression, context))
  return { record, paths, pendingFile, alive, state }
}

it('allows normal shutdown to save state and refuses an inspector belonging to another process', async () => {
  const app = runtime()
  app.state.inspectorPid = 99999
  await expect(requestOwnedAppQuit(app.record)).rejects.toThrow('does not own the main-process inspector')
  expect(readFileSync(app.pendingFile, 'utf8')).toBe('previous state')
  app.state.inspectorPid = app.record.electronPid
  await requestOwnedAppQuit(app.record)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(readFileSync(app.pendingFile, 'utf8')).toBe('state saved by normal shutdown')
  expect(app.alive.has(app.record.electronPid)).toBe(false)
})

it('fails a blocked normal restart without forcing termination or destroying pending state', async () => {
  vi.useFakeTimers()
  const app = runtime(true)
  const result = restartApp(app.paths).then(
    () => undefined,
    (error: Error) => error
  )
  await vi.runAllTimersAsync()
  expect((await result)?.message).toContain('did not exit after a normal shutdown request')
  expect(readFileSync(app.pendingFile, 'utf8')).toBe('previous state')
  expect(app.alive.has(app.record.electronPid)).toBe(true)
})
