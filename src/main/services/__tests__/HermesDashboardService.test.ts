import type * as NodeChildProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import type * as NodeFsPromises from 'node:fs/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import type * as ProcessRunner from '@main/utils/processRunner'

const mocks = vi.hoisted(() => ({
  appGet: vi.fn(),
  getHermesHome: vi.fn(),
  getRawShellEnv: vi.fn(),
  isWin: false,
  realpath: vi.fn(),
  refreshShellEnv: vi.fn(),
  spawn: vi.fn()
}))

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFsPromises>()),
  realpath: mocks.realpath
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
vi.mock('@main/services/codeCli', () => ({ getHermesHome: mocks.getHermesHome }))
vi.mock('@main/utils/processRunner', async (importOriginal) => ({
  ...(await importOriginal<typeof ProcessRunner>()),
  crossPlatformSpawn: mocks.spawn
}))
vi.mock('@main/utils/shellEnv', () => ({
  getRawShellEnv: mocks.getRawShellEnv,
  refreshShellEnv: mocks.refreshShellEnv
}))

const { HermesDashboardService } = await import('../HermesDashboardService')

class FakeChild extends EventEmitter {
  pid = 43001
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  stdout = Object.assign(new EventEmitter(), { resume: vi.fn() })
  stderr = Object.assign(new EventEmitter(), { resume: vi.fn() })

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
    mocks.getHermesHome.mockResolvedValue('/home/test/.hermes')
    mocks.getRawShellEnv.mockResolvedValue({ PATH: '/system/bin' })
    mocks.realpath.mockRejectedValue(new Error('ENOENT'))
    mocks.refreshShellEnv.mockResolvedValue({ PATH: '/managed/bin' })
    mocks.spawn.mockReturnValue(child as unknown as NodeChildProcess.ChildProcess)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        body: { cancel: vi.fn() },
        json: async () => ({ hermes_home: '/home/test/.hermes', gateway_running: false })
      }))
    )
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals) => {
      if (pid === -child.pid) queueMicrotask(() => child.close(signal ?? 'SIGTERM'))
      return true
    }) as typeof process.kill)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts a localhost dashboard only after its status endpoint is healthy', async () => {
    const result = await new HermesDashboardService().start()

    expect(result).toMatchObject({ success: true, url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/) })
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/usr/local/bin/hermes',
      ['dashboard', '--host', '127.0.0.1', '--port', expect.any(String), '--no-open'],
      expect.objectContaining({
        detached: true,
        env: { PATH: '/system/bin', HERMES_HOME: '/home/test/.hermes' },
        stdio: ['ignore', 'pipe', 'pipe']
      })
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

  it('rejects Hermes config writes while the Dashboard is running', async () => {
    const service = new HermesDashboardService()
    await service.start()
    const write = vi.fn(async () => undefined)

    await expect(service.writeConfigFiles(write)).rejects.toThrow('Hermes Agent web UI is running')
    expect(write).not.toHaveBeenCalled()
  })

  it('does not start the Dashboard until an earlier Hermes config write completes', async () => {
    let resolveWrite: (() => void) | undefined
    const service = new HermesDashboardService()
    const writing = service.writeConfigFiles(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        })
    )
    await vi.waitFor(() => expect(resolveWrite).toBeDefined())

    const starting = service.start()
    await Promise.resolve()
    expect(mocks.spawn).not.toHaveBeenCalled()

    resolveWrite?.()
    await writing
    await expect(starting).resolves.toMatchObject({ success: true })
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })

  it('pins the spawned Dashboard to the session Hermes home, replacing inherited variants', async () => {
    mocks.appGet.mockReturnValue({
      getToolSnapshots: vi.fn(async () => ({
        hermes: { availability: { source: 'mise', path: '/managed/bin/hermes' } }
      }))
    })
    mocks.refreshShellEnv.mockResolvedValue({ PATH: '/managed/bin', hermes_home: '/changed/hermes' })
    mocks.getHermesHome.mockResolvedValue('/custom/hermes')
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: { cancel: vi.fn() },
      json: async () => ({ hermes_home: '/custom/hermes', gateway_running: false })
    } as unknown as Response)

    await expect(new HermesDashboardService().start()).resolves.toMatchObject({ success: true })

    expect(mocks.spawn).toHaveBeenCalledWith(
      '/managed/bin/hermes',
      expect.any(Array),
      expect.objectContaining({ env: { PATH: '/managed/bin', HERMES_HOME: '/custom/hermes' } })
    )
  })

  it('rejects a Dashboard that reports a different configuration home', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: { cancel: vi.fn() },
      json: async () => ({ hermes_home: '/wrong/hermes', gateway_running: false })
    } as unknown as Response)
    const service = new HermesDashboardService()

    await expect(service.start()).resolves.toMatchObject({
      success: false,
      reason: 'startup_failed',
      message: expect.stringContaining('different configuration home')
    })
    expect(service.getStatus()).toEqual({ status: 'error' })
    expect(mocks.realpath).toHaveBeenCalledOnce()
    expect(mocks.realpath).toHaveBeenCalledWith('/home/test/.hermes')
  })

  it('never touches the filesystem when the reported home matches lexically', async () => {
    await expect(new HermesDashboardService().start()).resolves.toMatchObject({ success: true })

    expect(mocks.realpath).not.toHaveBeenCalled()
  })

  it('accepts an equivalent Windows Hermes home across casing and separator styles', async () => {
    mocks.isWin = true
    mocks.getHermesHome.mockResolvedValue('C:\\Users\\Test\\Hermes')
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: { cancel: vi.fn() },
      json: async () => ({ hermes_home: 'c:/users/test/hermes', gateway_running: false })
    } as unknown as Response)

    await expect(new HermesDashboardService().start()).resolves.toMatchObject({ success: true })
  })

  it('reports a missing Hermes binary without spawning a process', async () => {
    mocks.appGet.mockReturnValue({
      getToolSnapshots: vi.fn(async () => ({ hermes: { availability: { source: 'none' } } }))
    })

    await expect(new HermesDashboardService().start()).resolves.toEqual({
      success: false,
      reason: 'not_installed',
      message: 'Hermes is not installed'
    })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('classifies missing Dashboard dependencies from the child diagnostic', async () => {
    const service = new HermesDashboardService()
    vi.mocked(fetch).mockRejectedValue(new Error('Dashboard is not ready'))
    const starting = service.start()

    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    child.stderr.emit('data', Buffer.from('Web UI requires fastapi and uvicorn.'))
    child.close()

    await expect(starting).resolves.toMatchObject({
      success: false,
      reason: 'dashboard_dependencies_missing',
      message: expect.stringContaining('Web UI requires fastapi and uvicorn')
    })
  })

  it('does not classify unrelated Uvicorn diagnostics as missing dependencies', async () => {
    const service = new HermesDashboardService()
    vi.mocked(fetch).mockRejectedValue(new Error('Dashboard is not ready'))
    const starting = service.start()

    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    child.stderr.emit('data', Buffer.from('Uvicorn failed to bind port 49152.'))
    child.close()

    await expect(starting).resolves.toMatchObject({ success: false, reason: 'startup_failed' })
  })

  it('classifies a dependency signature even after a long diagnostic prefix', async () => {
    const service = new HermesDashboardService()
    vi.mocked(fetch).mockRejectedValue(new Error('Dashboard is not ready'))
    const starting = service.start()

    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
    child.stderr.emit('data', Buffer.from(`${'diagnostic '.repeat(3000)}Web UI requires fastapi and uvicorn.`))
    child.close()

    await expect(starting).resolves.toMatchObject({ success: false, reason: 'dashboard_dependencies_missing' })
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

    await expect(starting).resolves.toEqual({
      success: false,
      reason: 'cancelled',
      message: 'Hermes Dashboard startup was cancelled'
    })
    await expect(stopping).resolves.toBeUndefined()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('rejects new dashboards once lifecycle shutdown begins', async () => {
    const service = new HermesDashboardService()

    await (service as any).onStop()

    await expect(service.start()).resolves.toEqual({
      success: false,
      reason: 'cancelled',
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

  it('signals nothing once its child has already exited on its own', async () => {
    const service = new HermesDashboardService()
    await service.start()
    child.close()
    await vi.waitFor(() => expect(service.getStatus()).toEqual({ status: 'error' }))
    vi.mocked(process.kill).mockClear()

    await service.stop()

    expect(process.kill).not.toHaveBeenCalled()
    expect(service.getStatus()).toEqual({ status: 'stopped' })
  })

  // A pid-less child would make the process-group signal `process.kill(-0)`, which
  // targets Cherry's own group instead of the Dashboard's.
  it('signals nothing when its child carries no pid', async () => {
    const service = new HermesDashboardService()
    await service.start()
    child.pid = 0
    vi.mocked(process.kill).mockClear()

    await service.stop()

    expect(process.kill).not.toHaveBeenCalled()
    expect(service.getStatus()).toEqual({ status: 'stopped' })
  })

  it('times out a startup whose health probe never passes and terminates the child it spawned', async () => {
    vi.useFakeTimers()
    const service = new HermesDashboardService()
    vi.mocked(fetch).mockRejectedValue(new Error('Dashboard is not ready'))

    const starting = service.start()
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(starting).resolves.toMatchObject({ success: false, reason: 'startup_failed' })
    expect(process.kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM')
    expect(service.getStatus()).toEqual({ status: 'error' })
  })

  it('rejects a foreign 200 on the port whose body is not a Hermes status document', async () => {
    vi.useFakeTimers()
    const service = new HermesDashboardService()
    // A different server grabbed the freshly-picked port: HTTP 200, but /api/status
    // carries none of Hermes's identifying fields, so it must never pass as ready.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: { cancel: vi.fn() },
      json: async () => ({ service: 'not-hermes' })
    } as unknown as Response)

    const starting = service.start()
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(starting).resolves.toMatchObject({ success: false, reason: 'startup_failed' })
    expect(service.getStatus()).toEqual({ status: 'error' })
  })

  it('escalates to a forced kill and reports an error when its child ignores termination', async () => {
    const service = new HermesDashboardService()
    await service.start()
    vi.mocked(process.kill).mockImplementation((() => true) as typeof process.kill)
    vi.useFakeTimers()

    const stopping = service.stop()
    const rejection = expect(stopping).rejects.toThrow('did not exit after forced termination')
    await vi.advanceTimersByTimeAsync(10_000)
    await rejection

    expect(process.kill).toHaveBeenNthCalledWith(1, -child.pid, 'SIGTERM')
    expect(process.kill).toHaveBeenNthCalledWith(2, -child.pid, 'SIGKILL')
    expect(service.getStatus()).toEqual({ status: 'error' })
  })
})
