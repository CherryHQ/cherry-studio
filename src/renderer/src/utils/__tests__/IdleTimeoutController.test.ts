import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IdleTimeoutController } from '../IdleTimeoutController'

describe('IdleTimeoutController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should abort after the idle timeout expires', () => {
    const controller = new IdleTimeoutController(5000)
    expect(controller.signal.aborted).toBe(false)

    vi.advanceTimersByTime(5000)
    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toBeInstanceOf(DOMException)
    expect(controller.signal.reason.name).toBe('TimeoutError')
  })

  it('should not abort before the timeout', () => {
    const controller = new IdleTimeoutController(5000)
    vi.advanceTimersByTime(4999)
    expect(controller.signal.aborted).toBe(false)
  })

  it('should reset the timer on reset()', () => {
    const controller = new IdleTimeoutController(5000)

    // Advance 4 seconds, then reset
    vi.advanceTimersByTime(4000)
    expect(controller.signal.aborted).toBe(false)

    controller.reset()

    // Advance another 4 seconds — should NOT abort (timer was reset)
    vi.advanceTimersByTime(4000)
    expect(controller.signal.aborted).toBe(false)

    // Advance 1 more second (5 total since reset) — should abort
    vi.advanceTimersByTime(1000)
    expect(controller.signal.aborted).toBe(true)
  })

  it('should support multiple resets', () => {
    const controller = new IdleTimeoutController(1000)

    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(900)
      controller.reset()
    }

    // 10 * 900ms = 9 seconds total, but never timed out
    expect(controller.signal.aborted).toBe(false)

    // Now let it expire
    vi.advanceTimersByTime(1000)
    expect(controller.signal.aborted).toBe(true)
  })

  it('should not restart timer after already aborted', () => {
    const controller = new IdleTimeoutController(1000)

    vi.advanceTimersByTime(1000)
    expect(controller.signal.aborted).toBe(true)

    // reset() after abort should be a no-op
    controller.reset()
    expect(controller.signal.aborted).toBe(true)
  })

  it('cleanup() should prevent the timeout from firing', () => {
    const controller = new IdleTimeoutController(1000)

    controller.cleanup()

    vi.advanceTimersByTime(5000)
    expect(controller.signal.aborted).toBe(false)
  })
})
