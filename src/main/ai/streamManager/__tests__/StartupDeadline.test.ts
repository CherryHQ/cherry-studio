import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StartupDeadline } from '../StartupDeadline'

describe('StartupDeadline', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(preparationBudgetMs = 120 * 60_000) {
    const onExpire = vi.fn()
    const deadline = new StartupDeadline({ startupMs: 90_000, preparationBudgetMs, onExpire })
    return { deadline, onExpire }
  }

  it('expires exactly once at 90 seconds', () => {
    const { deadline, onExpire } = setup()
    vi.advanceTimersByTime(89_999)
    expect(deadline.expired).toBe(false)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(deadline.expired).toBe(true)
    expect(onExpire).toHaveBeenCalledTimes(1)
    deadline.beginPreparation('preparation')
    deadline.endPreparation('preparation')
    vi.advanceTimersByTime(1_000_000)
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('permanently disarms on output at 89 seconds', () => {
    const { deadline, onExpire } = setup()
    vi.advanceTimersByTime(89_000)
    deadline.notifyOutput()
    deadline.notifyOutput()
    deadline.beginPreparation('preparation')
    deadline.endPreparation('preparation')
    vi.advanceTimersByTime(10_000_000)
    expect(onExpire).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('nested preparation pauses and resumes the remaining budget', () => {
    const { deadline, onExpire } = setup()
    vi.advanceTimersByTime(40_000)
    deadline.beginPreparation('preparation')
    deadline.beginPreparation('preparation')
    vi.advanceTimersByTime(100_000)
    deadline.endPreparation('preparation')
    vi.advanceTimersByTime(100_000)
    expect(onExpire).not.toHaveBeenCalled()
    deadline.endPreparation('preparation')
    vi.advanceTimersByTime(49_999)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('repeated preparation never replenishes startup time', () => {
    const { deadline, onExpire } = setup()
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(30_000)
      deadline.beginPreparation('preparation')
      vi.advanceTimersByTime(100_000)
      deadline.endPreparation('preparation')
    }
    vi.advanceTimersByTime(29_999)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('resumes while preparation is active once the aggregate cap is exhausted', () => {
    const { deadline, onExpire } = setup(100_000)
    vi.advanceTimersByTime(20_000)
    deadline.beginPreparation('preparation')
    vi.advanceTimersByTime(60_000)
    deadline.endPreparation('preparation')
    vi.advanceTimersByTime(20_000)
    deadline.beginPreparation('preparation')
    vi.advanceTimersByTime(89_999)
    expect(onExpire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('dispose clears timers and prevents later preparation from rearming', () => {
    const { deadline, onExpire } = setup()
    deadline.beginPreparation('preparation')
    deadline.dispose()
    deadline.endPreparation('preparation')
    deadline.beginPreparation('preparation')
    vi.advanceTimersByTime(10_000_000)
    expect(onExpire).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
