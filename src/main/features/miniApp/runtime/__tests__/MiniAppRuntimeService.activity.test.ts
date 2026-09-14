import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'

const flush = vi.fn(async () => {})
const forget = vi.fn(async () => {})
vi.mock('../../activityLog', () => ({ ACTIVITY_COUNT_FLUSH_MS: 60_000, miniAppActivityLog: { flush, forget } }))
vi.mock('../events', () => ({ emitToApp: vi.fn(), emitToGuest: vi.fn() }))

const destroy = vi.fn()
vi.mock('electron', () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: () => ({ destroy }) }
}))

import { mockMiniAppApplication } from '../../__tests__/applicationMock'

const broadcast = vi.fn()
vi.mock('@application', () => mockMiniAppApplication({ IpcApiService: { broadcast } }))

const { MiniAppRuntimeService } = await import('../MiniAppRuntimeService')

const A = 'com.example.a'

beforeEach(() => {
  BaseService.resetInstances()
  flush.mockClear()
  forget.mockClear()
  broadcast.mockReset()
})

describe('the runtime as the activity log’s clock', () => {
  it('flushes an app’s counts when its last guest goes, not while another one runs', () => {
    // The log has no timer of its own; a closed app must not wait a minute for its
    // counts to land.
    const svc = new MiniAppRuntimeService()
    svc.registerGuest(A, 1)
    svc.registerGuest(A, 2)

    svc.unregisterGuest(1)
    expect(flush).not.toHaveBeenCalled()

    svc.unregisterGuest(2)
    expect(flush).toHaveBeenCalledWith(A)
  })

  it('runs the minute flush only while some app runs', () => {
    // An idle host must not tick for a log nobody is writing.
    vi.useFakeTimers()
    try {
      const svc = new MiniAppRuntimeService()
      const periodic = () => flush.mock.calls.filter((c) => c.length === 0).length

      vi.advanceTimersByTime(60_000)
      expect(periodic()).toBe(0)

      svc.registerGuest(A, 1)
      svc.registerGuest('com.example.b', 2)
      vi.advanceTimersByTime(60_000)
      expect(periodic()).toBe(1)

      svc.unregisterGuest(1)
      vi.advanceTimersByTime(60_000)
      expect(periodic()).toBe(2)

      svc.unregisterGuest(2)
      vi.advanceTimersByTime(120_000)
      expect(periodic()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes before the mutation that takes an app offline', async () => {
    // Counts must land BEFORE whatever grant line the mutation writes, or the log reads
    // "updated, then 40 storage writes" for writes that happened before the update.
    const order: string[] = []
    flush.mockImplementation(async () => void order.push('flush'))
    const svc = new MiniAppRuntimeService()
    svc.registerGuest(A, 1)
    broadcast.mockImplementation(() => svc.unregisterGuest(1))

    await svc.withAppQuiesced(A, async () => void order.push('mutate'))

    expect(order.lastIndexOf('flush')).toBeLessThan(order.indexOf('mutate'))
    expect(flush).toHaveBeenCalledWith(A)
  })

  it('does not resolve until the log removal has finished', async () => {
    // What this replaces asserted `toHaveBeenCalledWith(A)` — which `void forget(...)`
    // satisfies just as well, so uninstall resolved (and the process could exit) with the
    // log still on disk. The contract is that this AWAITS the removal.
    const svc = new MiniAppRuntimeService()
    let release = () => {}
    forget.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
    let settled = false

    const pending = svc.forgetApp(A).then(() => {
      settled = true
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(forget).toHaveBeenCalledWith(A)
    expect(settled).toBe(false)

    release()
    await pending
    expect(settled).toBe(true)
  })
})
