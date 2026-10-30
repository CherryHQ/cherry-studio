import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from '@playwright/test'
import { afterEach, expect, it, vi } from 'vitest'

import { RegressionApp } from '../../../../tests/e2e/regression/RegressionApp'
import type * as DebugBridge from '../debugBridge'
import type * as Lifecycle from '../lifecycle'
import { ensureRunDirectories, getRunPaths } from '../paths'

const { assertIsolationMock, connectOverCdpMock, prepareCdpMock, restartAppMock } = vi.hoisted(() => ({
  assertIsolationMock: vi.fn(),
  connectOverCdpMock: vi.fn(),
  prepareCdpMock: vi.fn(),
  restartAppMock: vi.fn()
}))

vi.mock('../debugBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof DebugBridge>()),
  assertOwnedAppIsolation: assertIsolationMock,
  prepareWindowsCdpConnection: prepareCdpMock
}))
vi.mock('../lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof Lifecycle>()),
  restartApp: restartAppMock
}))

const directories: string[] = []
afterEach(() => {
  assertIsolationMock.mockReset()
  connectOverCdpMock.mockReset()
  prepareCdpMock.mockReset()
  restartAppMock.mockReset()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

interface SlowWindow {
  app: RegressionApp
  record: Lifecycle.AppRecord
  waits: number[]
  setRootVisible: (visible: boolean) => void
}

/** A Windows run whose renderer only shows #root when the test says so. */
function slowWindowRun(): SlowWindow {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-window-recovery-'))
  directories.push(directory)
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  writeFileSync(join(paths.workspace, 'TASK.md'), 'case task')
  const record: Lifecycle.AppRecord = {
    schemaVersion: 1,
    ownership: 'regression-driver',
    policy: 'ephemeral',
    mode: 'branch',
    platform: 'windows',
    profile: 'authenticated',
    runKey: 'window-recovery',
    targetRoot: directory,
    command: process.execPath,
    args: [],
    cwd: directory,
    runnerPid: 43_000,
    electronPid: 43_001,
    cdpPort: 9_222,
    targetUrl: 'http://127.0.0.1:9222/windows/main/index.html',
    logPath: join(paths.logs, 'electron-authenticated.log'),
    startedAt: new Date().toISOString(),
    restartCount: 0
  }
  writeFileSync(paths.appRecord, JSON.stringify(record))

  const waits: number[] = []
  let rootVisible = false
  const page = {
    url: () => 'http://127.0.0.1:9222/windows/main/index.html',
    locator: (selector: string) => ({
      waitFor: async ({ timeout }: { timeout: number }) => {
        waits.push(timeout)
        if (!rootVisible) throw new Error(`Timeout ${timeout}ms exceeded while waiting for ${selector}`)
      }
    })
  }
  connectOverCdpMock.mockResolvedValue({
    isConnected: () => false,
    close: async () => {},
    contexts: () => [{ pages: () => [page] }]
  })
  vi.spyOn(chromium, 'connectOverCDP').mockImplementation(connectOverCdpMock)

  return {
    app: new RegressionApp(directory, 'MP-151'),
    record,
    waits,
    setRootVisible: (visible: boolean) => {
      rootVisible = visible
    }
  }
}

it('restarts a renderer that stays hidden once, then waits instead of restarting again', async () => {
  const { app, record, waits } = slowWindowRun()
  assertIsolationMock.mockResolvedValue(undefined)
  restartAppMock.mockImplementation(async () => {
    if (restartAppMock.mock.calls.length > 1) throw new Error('renderer restarted more than once')
    return { ...record, electronPid: 43_101, cdpPort: 9_333, restartCount: 1 }
  })

  const error = await app.mainWindow().then(
    () => undefined,
    (failure: Error) => failure
  )

  expect(restartAppMock).toHaveBeenCalledTimes(1)
  expect(prepareCdpMock).toHaveBeenCalledTimes(1)
  expect(waits).toEqual([5_000, 5_000, 60_000])
  expect(error?.message).toContain('waiting for #root')
})

it('clears the recovery guard once the bounded wait finishes', async () => {
  const { app, record, setRootVisible } = slowWindowRun()
  assertIsolationMock.mockResolvedValue(undefined)
  restartAppMock.mockImplementation(async () => {
    setRootVisible(true)
    return { ...record, restartCount: restartAppMock.mock.calls.length }
  })

  await expect(app.mainWindow()).resolves.toBeDefined()
  expect(restartAppMock).toHaveBeenCalledTimes(1)

  setRootVisible(false)
  await expect(app.mainWindow()).resolves.toBeDefined()
  expect(restartAppMock).toHaveBeenCalledTimes(2)
})
