import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useHasCurrentPaidPlan } from '../useHasCurrentPaidPlan'

const plans = vi.hoisted(() => ({
  isPlansReady: true,
  activePaid: undefined as { id: string; expires_at?: string } | undefined
}))

vi.mock('@renderer/hooks/useCherryCloudPlans', () => ({
  useCherryCloudPlans: () => plans
}))

describe('useHasCurrentPaidPlan', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T00:00:00.000Z'))
    plans.isPlansReady = true
    plans.activePaid = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is true for a fresh active paid entitlement without an expiry', () => {
    plans.activePaid = { id: 'pro' }

    expect(renderHook(() => useHasCurrentPaidPlan()).result.current).toBe(true)
  })

  it.each([
    { case: 'there is no paid entitlement', ready: true, paid: undefined },
    { case: 'the plans are not fresh', ready: false, paid: { id: 'pro' } },
    {
      case: 'the entitlement already expired',
      ready: true,
      paid: { id: 'pro', expires_at: '2026-11-19T23:00:00.000Z' }
    }
  ])('is false when $case', ({ ready, paid }) => {
    plans.isPlansReady = ready
    plans.activePaid = paid

    expect(renderHook(() => useHasCurrentPaidPlan()).result.current).toBe(false)
  })

  it('is false when disabled, as for image captures', () => {
    plans.activePaid = { id: 'pro' }

    expect(renderHook(() => useHasCurrentPaidPlan(false)).result.current).toBe(false)
  })

  it('turns false at the recorded expiry while mounted, without a new receipt', async () => {
    plans.activePaid = { id: 'pro', expires_at: '2026-11-20T00:10:00.000Z' }
    const { result } = renderHook(() => useHasCurrentPaidPlan())
    expect(result.current).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(9 * 60_000)
    })
    expect(result.current).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current).toBe(false)
  })

  it('turns false when the deadline passes between render and its effect', () => {
    plans.activePaid = { id: 'pro', expires_at: '2026-11-20T00:00:00.010Z' }
    const now = Date.parse('2026-11-20T00:00:00.000Z')
    // Render reads the clock first (still valid); the effect then sees the deadline already gone.
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValue(now + 20)

    const { result } = renderHook(() => useHasCurrentPaidPlan())

    expect(result.current).toBe(false)
  })
})
