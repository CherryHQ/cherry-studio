import type * as LifecycleModule from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

const { statfsMock, broadcastToTypeMock, getPathMock, appGetMock } = vi.hoisted(() => ({
  statfsMock: vi.fn(),
  broadcastToTypeMock: vi.fn(),
  getPathMock: vi.fn(() => '/mock/userdata'),
  appGetMock: vi.fn()
}))

vi.mock('fs/promises', () => ({ statfs: statfsMock }))

vi.mock('@application', () => ({
  application: { getPath: getPathMock, get: appGetMock }
}))

// Keep the real lifecycle decorators (so getPhase/getDependencies reflect the
// real @ServicePhase / @DependsOn), but swap BaseService for a stub that
// captures registerInterval callbacks so tests can drive ticks manually.
vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()
  class MockBaseService {
    protected readonly _intervals: Array<{
      callback: () => void | Promise<void>
      intervalMs: number
      disposable: { dispose: ReturnType<typeof vi.fn> }
    }> = []
    protected readonly _disposables: Array<{ dispose: () => void } | (() => void)> = []
    ipcHandle = vi.fn()

    protected registerInterval(callback: () => void | Promise<void>, intervalMs: number) {
      const disposable = { dispose: vi.fn() }
      this._intervals.push({ callback, intervalMs, disposable })
      return disposable
    }

    protected registerDisposable<T extends { dispose: () => void } | (() => void)>(d: T): T {
      this._disposables.push(d)
      return d
    }
  }
  return { ...actual, BaseService: MockBaseService }
})

import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'

const { StorageMonitorService, intervalForFree } = await import('../StorageMonitorService')

const MINUTE = 1000 * 60
const GB = 1024 ** 3

/** Queue one statfs result. bsize=1 so freeBytes === bavail for readable assertions. */
function queueDisk(freeBytes: number, totalBytes = 500 * GB) {
  statfsMock.mockResolvedValueOnce({ bsize: 1, bavail: freeBytes, blocks: totalBytes })
}

type ServiceInternals = {
  onInit: () => void
  onReady: () => void
  _intervals: Array<{
    callback: () => Promise<void>
    intervalMs: number
    disposable: { dispose: ReturnType<typeof vi.fn> }
  }>
  health: { level: string; freeBytes: number; totalBytes: number; checkedAt: number }
}

function createService() {
  const svc = new StorageMonitorService() as unknown as ServiceInternals
  svc.onInit()
  return svc
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** onReady fires the first check fire-and-forget; flush a macrotask to settle it. */
async function start(svc: ServiceInternals) {
  svc.onReady()
  await flush()
}

/** Run the most recently registered interval callback (one adaptive poll tick). */
async function tick(svc: ServiceInternals) {
  await svc._intervals.at(-1)!.callback()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'WindowManager') return { broadcastToType: broadcastToTypeMock }
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('intervalForFree', () => {
  it.each([
    [20 * GB, 60 * MINUTE],
    [25 * GB, 60 * MINUTE],
    [20 * GB - 1, 30 * MINUTE],
    [10 * GB, 30 * MINUTE],
    [10 * GB - 1, 15 * MINUTE],
    [5 * GB, 15 * MINUTE],
    [5 * GB - 1, 10 * MINUTE],
    [1 * GB, 10 * MINUTE],
    [1 * GB - 1, 5 * MINUTE],
    [0, 5 * MINUTE]
  ])('free=%i bytes -> %i ms', (free, expected) => {
    expect(intervalForFree(free)).toBe(expected)
  })

  it('is bounded to [5min, 60min]', () => {
    expect(intervalForFree(Number.MAX_SAFE_INTEGER)).toBe(60 * MINUTE)
    expect(intervalForFree(-1)).toBe(5 * MINUTE)
  })
})

describe('StorageMonitorService', () => {
  it('runs in the WhenReady phase and depends on WindowManager', () => {
    expect(getPhase(StorageMonitorService)).toBe(Phase.WhenReady)
    expect(getDependencies(StorageMonitorService)).toContain('WindowManager')
  })

  it('does not push when the level stays ok across checks', async () => {
    const svc = createService()
    queueDisk(20 * GB)
    await start(svc)
    queueDisk(15 * GB)
    await tick(svc)

    expect(svc.health.level).toBe('ok')
    expect(broadcastToTypeMock).not.toHaveBeenCalled()
  })

  it('pushes to the main window when crossing ok -> low', async () => {
    const svc = createService()
    queueDisk(20 * GB)
    await start(svc)
    expect(broadcastToTypeMock).not.toHaveBeenCalled()

    queueDisk(0.5 * GB)
    await tick(svc)

    expect(svc.health.level).toBe('low')
    expect(broadcastToTypeMock).toHaveBeenCalledTimes(1)
    expect(broadcastToTypeMock).toHaveBeenCalledWith(
      WindowType.Main,
      IpcChannel.StorageMonitor_HealthChanged,
      expect.objectContaining({ level: 'low', freeBytes: 0.5 * GB })
    )
  })

  it('pushes again on recovery low -> ok and lets the renderer auto-dismiss', async () => {
    const svc = createService()
    queueDisk(0.5 * GB)
    await start(svc) // starts low -> push
    queueDisk(5 * GB)
    await tick(svc) // recovers -> push

    expect(svc.health.level).toBe('ok')
    expect(broadcastToTypeMock).toHaveBeenCalledTimes(2)
    expect(broadcastToTypeMock).toHaveBeenLastCalledWith(
      WindowType.Main,
      IpcChannel.StorageMonitor_HealthChanged,
      expect.objectContaining({ level: 'ok' })
    )
  })

  it('re-registers the timer with a new interval only when the band changes', async () => {
    const svc = createService()
    queueDisk(20 * GB)
    await start(svc)
    expect(svc._intervals).toHaveLength(1)
    expect(svc._intervals.at(-1)!.intervalMs).toBe(60 * MINUTE)

    // Same band (still >= 20 GB): keep the existing timer, no churn.
    queueDisk(30 * GB)
    await tick(svc)
    expect(svc._intervals).toHaveLength(1)

    // New band (5-10 GB -> 15 min): dispose old, register new.
    queueDisk(8 * GB)
    await tick(svc)
    expect(svc._intervals).toHaveLength(2)
    expect(svc._intervals[0].disposable.dispose).toHaveBeenCalledTimes(1)
    expect(svc._intervals.at(-1)!.intervalMs).toBe(15 * MINUTE)
  })

  it('keeps polling after a statfs error without flipping the level', async () => {
    const svc = createService()
    queueDisk(20 * GB)
    await start(svc)

    statfsMock.mockRejectedValueOnce(new Error('statfs failed'))
    await tick(svc)

    expect(svc.health.level).toBe('ok') // unchanged
    expect(svc._intervals.length).toBeGreaterThanOrEqual(1) // timer still alive
  })

  it('exposes current health via the GetHealth IPC handler', async () => {
    const svc = createService()
    queueDisk(0.5 * GB)
    await start(svc)

    const ipcHandle = (svc as unknown as { ipcHandle: ReturnType<typeof vi.fn> }).ipcHandle
    const handler = ipcHandle.mock.calls.find((c) => c[0] === IpcChannel.StorageMonitor_GetHealth)?.[1]
    expect(handler).toBeDefined()
    expect(handler()).toEqual(expect.objectContaining({ level: 'low', freeBytes: 0.5 * GB }))
  })
})
