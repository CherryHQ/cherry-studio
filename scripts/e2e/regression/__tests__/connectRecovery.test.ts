import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from '@playwright/test'
import { afterEach, expect, it, vi } from 'vitest'

import { RegressionApp } from '../../../../tests/e2e/regression/RegressionApp'
import type * as DebugBridge from '../debugBridge'
import type * as Lifecycle from '../lifecycle'
import { ensureRunDirectories, getRunPaths } from '../paths'

const { assertIsolationMock, connectOverCdpMock, restartAppMock } = vi.hoisted(() => ({
  assertIsolationMock: vi.fn(),
  connectOverCdpMock: vi.fn(),
  restartAppMock: vi.fn()
}))

vi.mock('../debugBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof DebugBridge>()),
  assertOwnedAppIsolation: assertIsolationMock
}))
vi.mock('../lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof Lifecycle>()),
  restartApp: restartAppMock
}))

const directories: string[] = []
afterEach(() => {
  assertIsolationMock.mockReset()
  connectOverCdpMock.mockReset()
  restartAppMock.mockReset()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const OWNERSHIP_ERROR = 'does not own the main-process inspector'

function staleRegressionApp(): { app: RegressionApp; record: Lifecycle.AppRecord; relaunched: Lifecycle.AppRecord } {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-connect-recovery-'))
  directories.push(directory)
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  writeFileSync(join(paths.workspace, 'TASK.md'), 'case task')
  const record: Lifecycle.AppRecord = {
    schemaVersion: 1,
    ownership: 'regression-driver',
    policy: 'ephemeral',
    mode: 'branch',
    platform: 'macos',
    profile: 'authenticated',
    runKey: 'connect-recovery',
    targetRoot: directory,
    command: process.execPath,
    args: [],
    cwd: directory,
    runnerPid: 42_000,
    electronPid: 42_001,
    cdpPort: 9_222,
    targetUrl: 'http://127.0.0.1:9222/windows/main/index.html',
    logPath: join(paths.logs, 'electron-authenticated.log'),
    startedAt: new Date().toISOString(),
    restartCount: 0
  }
  writeFileSync(paths.appRecord, JSON.stringify(record))
  const relaunched = { ...record, electronPid: 42_101, cdpPort: 9_333, restartCount: 1 }
  const page = { url: () => `http://127.0.0.1:${relaunched.cdpPort}/windows/main/index.html` }
  // A crashed instance leaves its CDP connection reporting disconnected, so every
  // connect() re-runs the ownership gate instead of early-returning.
  connectOverCdpMock.mockResolvedValue({
    isConnected: () => false,
    close: async () => {},
    contexts: () => [{ pages: () => [page] }]
  })
  vi.spyOn(chromium, 'connectOverCDP').mockImplementation(connectOverCdpMock)
  return { app: new RegressionApp(directory, 'MCP-01'), record, relaunched }
}

it('relaunches the owned app and reconnects when the ownership gate fails', async () => {
  const { app, record, relaunched } = staleRegressionApp()
  assertIsolationMock
    .mockRejectedValueOnce(new Error(`Owned Cherry Studio instance ${OWNERSHIP_ERROR}`))
    .mockResolvedValue(undefined)
  restartAppMock.mockResolvedValue(relaunched)

  const page = await app.window('/windows/main/index.html')

  expect(page.url()).toContain('/windows/main/index.html')
  expect(assertIsolationMock).toHaveBeenNthCalledWith(1, record, join(app.paths.profiles, record.profile, 'home'))
  expect(restartAppMock).toHaveBeenCalledWith(app.paths)
  expect(assertIsolationMock).toHaveBeenNthCalledWith(
    2,
    relaunched,
    join(app.paths.profiles, relaunched.profile, 'home')
  )
  expect(connectOverCdpMock).toHaveBeenCalledWith(`http://127.0.0.1:${relaunched.cdpPort}`, {
    isLocal: true,
    noDefaults: true,
    timeout: 30_000
  })
})

it('throws the original ownership error when the relaunch itself fails', async () => {
  const { app } = staleRegressionApp()
  assertIsolationMock.mockRejectedValue(new Error(`Owned Cherry Studio instance ${OWNERSHIP_ERROR}`))
  restartAppMock.mockRejectedValue(new Error('CDP port 9222 is already owned by another process'))

  const failure = app.window('/windows/main/index.html').then(
    () => undefined,
    (error: Error) => error
  )
  expect((await failure)?.message).toContain(OWNERSHIP_ERROR)
  expect((await failure)?.cause).toEqual(new Error('CDP port 9222 is already owned by another process'))
  expect(restartAppMock).toHaveBeenCalledTimes(1)
  expect(connectOverCdpMock).not.toHaveBeenCalled()
  expect(JSON.parse(readFileSync(app.paths.appLaunchFailure, 'utf8'))).toMatchObject({
    reason: 'CDP port 9222 is already owned by another process',
    runnerPid: 42000,
    recordedAt: expect.any(String)
  })
  const nextCase = new RegressionApp(app.paths.root, 'MCP-02')
  await expect(nextCase.window('/windows/main/index.html')).rejects.toThrow(
    'Previous application relaunch failed: CDP port 9222 is already owned by another process'
  )
  expect(restartAppMock).toHaveBeenCalledTimes(1)
})

it('refuses to connect when the relaunched instance still fails the ownership gate', async () => {
  const { app, relaunched } = staleRegressionApp()
  assertIsolationMock.mockRejectedValue(new Error(`Owned Cherry Studio instance ${OWNERSHIP_ERROR}`))
  restartAppMock.mockResolvedValue(relaunched)

  await expect(app.window('/windows/main/index.html')).rejects.toThrow(OWNERSHIP_ERROR)
  expect(restartAppMock).toHaveBeenCalledTimes(1)
  expect(connectOverCdpMock).not.toHaveBeenCalled()
})

it('recovers at most once per app instance', async () => {
  const { app, relaunched } = staleRegressionApp()
  assertIsolationMock
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error(`Owned Cherry Studio instance ${OWNERSHIP_ERROR}`))
    .mockResolvedValueOnce(undefined)
    .mockRejectedValue(new Error(`Owned Cherry Studio instance ${OWNERSHIP_ERROR}`))
  restartAppMock.mockResolvedValue(relaunched)

  await expect(app.window('/windows/main/index.html')).resolves.toBeDefined()
  await expect(app.window('/windows/main/index.html')).resolves.toBeDefined()
  await expect(app.window('/windows/main/index.html')).rejects.toThrow(OWNERSHIP_ERROR)

  expect(restartAppMock).toHaveBeenCalledTimes(1)
  expect(connectOverCdpMock).toHaveBeenCalledTimes(2)
})
