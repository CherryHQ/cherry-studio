import type * as NodeChildProcess from 'node:child_process'
import { EventEmitter } from 'node:events'

import { BaseService } from '@main/core/lifecycle'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appGet: vi.fn(),
  isWin: false,
  spawn: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: mocks.appGet } }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))
vi.mock('@main/core/platform', () => ({
  get isWin() {
    return mocks.isWin
  }
}))
vi.mock('@main/utils/processRunner', () => ({ crossPlatformSpawn: mocks.spawn }))
vi.mock('@main/utils/shellEnv', () => ({
  getRawShellEnv: vi.fn(async () => ({ PATH: '/system/bin' })),
  refreshShellEnv: vi.fn(async () => ({ PATH: '/managed/bin' }))
}))

const { HermesDashboardService } = await import('../HermesDashboardService')

class FakeChild extends EventEmitter {
  pid = 43001
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  close(signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    this.signalCode = signal
    this.emit('close', null, signal)
  }
}

describe('HermesDashboardService', () => {
  let child: FakeChild

  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.isWin = false
    child = new FakeChild()
    mocks.appGet.mockReturnValue({
      getToolSnapshots: vi.fn(async () => ({
        hermes: { availability: { source: 'system', path: '/usr/local/bin/hermes' } }
      }))
    })
    mocks.spawn.mockReturnValue(child as unknown as NodeChildProcess.ChildProcess)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, body: { cancel: vi.fn() } }))
    )
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals) => {
      if (pid === -child.pid) queueMicrotask(() => child.close(signal ?? 'SIGTERM'))
      return true
    }) as typeof process.kill)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts a localhost dashboard only after its status endpoint is healthy', async () => {
    const result = await new HermesDashboardService().start()

    expect(result).toMatchObject({ success: true, url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/) })
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/usr/local/bin/hermes',
      ['dashboard', '--host', '127.0.0.1', '--port', expect.any(String), '--no-open'],
      expect.objectContaining({ detached: true, env: { PATH: '/system/bin' }, stdio: ['ignore', 'pipe', 'pipe'] })
    )
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/status$/), expect.anything())
  })

  it('reuses its healthy child instead of starting another dashboard', async () => {
    const service = new HermesDashboardService()

    const first = await service.start()
    const second = await service.start()

    expect(second).toEqual(first)
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })

  it('reports a missing Hermes binary without spawning a process', async () => {
    mocks.appGet.mockReturnValue({
      getToolSnapshots: vi.fn(async () => ({ hermes: { availability: { source: 'none' } } }))
    })

    await expect(new HermesDashboardService().start()).resolves.toEqual({
      success: false,
      message: 'Hermes is not installed'
    })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('cancels a startup awaiting binary discovery without spawning the Dashboard', async () => {
    let resolveSnapshots: (value: { hermes: { availability: { source: 'system'; path: string } } }) => void
    const getToolSnapshots = vi.fn(
      () =>
        new Promise<{ hermes: { availability: { source: 'system'; path: string } } }>((resolve) => {
          resolveSnapshots = resolve
        })
    )
    mocks.appGet.mockReturnValue({ getToolSnapshots })
    const service = new HermesDashboardService()

    const starting = service.start()
    await vi.waitFor(() => expect(getToolSnapshots).toHaveBeenCalledOnce())
    const stopping = service.stop()
    resolveSnapshots!({ hermes: { availability: { source: 'system', path: '/usr/local/bin/hermes' } } })

    await expect(starting).resolves.toEqual({ success: false, message: 'Hermes Dashboard startup was cancelled' })
    await expect(stopping).resolves.toBeUndefined()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('rejects new dashboards once lifecycle shutdown begins', async () => {
    const service = new HermesDashboardService()

    await (service as any).onStop()

    await expect(service.start()).resolves.toEqual({
      success: false,
      message: 'Hermes Dashboard is unavailable during application shutdown'
    })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('terminates only the child process it started', async () => {
    const service = new HermesDashboardService()
    await service.start()

    await service.stop()

    expect(process.kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM')
    expect(service.getStatus()).toEqual({ status: 'stopped' })
  })
})
