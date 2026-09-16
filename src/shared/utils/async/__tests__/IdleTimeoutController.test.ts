import { afterEach, describe, expect, it, vi } from 'vitest'

import { IdleTimeoutController } from '..'

afterEach(() => vi.useRealTimers())

describe('IdleTimeoutController reason', () => {
  it('retains TimeoutError by default and allows the native AbortError contract', async () => {
    vi.useFakeTimers()
    const standard = new IdleTimeoutController(100)
    const native = new IdleTimeoutController(100, () => undefined)
    await vi.advanceTimersByTimeAsync(100)
    expect(standard.signal.reason).toMatchObject({ name: 'TimeoutError', message: 'Idle timeout exceeded' })
    expect(native.signal.reason).toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
