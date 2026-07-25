import type { Model } from '@shared/data/types/model'
import type { LanguageModelUsage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentLoopHooks } from '../../runtime/aiSdk'

const mockRecordRequest = vi.fn()

vi.mock('@main/data/services/UsageLedgerService', () => ({
  usageLedgerService: {
    // Always resolve so the fire-and-forget `.catch(...)` in the billing hook works.
    recordRequest: (...args: unknown[]) => {
      mockRecordRequest(...args)
      return Promise.resolve()
    }
  }
}))

const { createBillingHook } = await import('../billingHook')

const model = { id: 'test-provider::test-model' } as unknown as Model

// The hook only reads `step.usage`; build a minimal fake step (a full
// StepResult has 20+ fields we don't need here).
const fakeStep = (usage: Partial<LanguageModelUsage>) =>
  ({ usage }) as unknown as Parameters<NonNullable<AgentLoopHooks['onStepFinish']>>[0]

// What the ledger row must contain, and when it is written. A run ends through
// exactly one terminal hook, but only `onFinish` means "clean end" — usage
// accrued before an abort or a throwing step must still reach the ledger, and
// exactly once. Wiring details (id threading, zero-guard) live in AiService.test.
describe('createBillingHook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records the usage accrued across steps when the run is aborted', () => {
    const hook = createBillingHook(model, 'assistant-abort')

    void hook.onStepFinish?.(fakeStep({ inputTokens: 6, outputTokens: 3, totalTokens: 9 }))
    void hook.onStepFinish?.(fakeStep({ inputTokens: 4, outputTokens: 2, totalTokens: 6 }))
    void hook.onAbort?.()

    expect(mockRecordRequest).toHaveBeenCalledTimes(1)
    expect(mockRecordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-abort',
        stats: expect.objectContaining({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
      })
    )
  })

  it('records the usage accrued across steps when a later step errors', () => {
    const hook = createBillingHook(model, 'assistant-error')

    void hook.onStepFinish?.(fakeStep({ inputTokens: 6, outputTokens: 3, totalTokens: 9 }))
    void hook.onStepFinish?.(fakeStep({ inputTokens: 4, outputTokens: 2, totalTokens: 6 }))
    const outcome = hook.onError?.({ error: new Error('step blew up') })

    // Terminating semantics are unchanged: the hook still stops the run.
    expect(outcome).toBe('abort')
    expect(mockRecordRequest).toHaveBeenCalledTimes(1)
    expect(mockRecordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-error',
        stats: expect.objectContaining({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
      })
    )
  })

  // An OpenRouter-style `usage.cost` prices a single generation, and every
  // step is one — the ledger must carry the sum, not the last step's cost.
  it('records the provider-reported cost summed over every step', () => {
    const hook = createBillingHook(model, 'assistant-cost')

    void hook.onStepFinish?.(fakeStep({ inputTokens: 6, outputTokens: 3, totalTokens: 9, raw: { cost: 0.25 } }))
    void hook.onStepFinish?.(fakeStep({ inputTokens: 4, outputTokens: 2, totalTokens: 6, raw: { cost: 0.5 } }))
    void hook.onFinish?.()

    expect(mockRecordRequest).toHaveBeenCalledWith(expect.objectContaining({ providerCostUsd: 0.75 }))
  })

  it('records once when a finished run also reports abort or error', () => {
    const hook = createBillingHook(model, 'assistant-finish')

    void hook.onStepFinish?.(fakeStep({ inputTokens: 6, outputTokens: 3, totalTokens: 9 }))
    void hook.onFinish?.()
    void hook.onAbort?.()
    void hook.onError?.({ error: new Error('late error') })

    expect(mockRecordRequest).toHaveBeenCalledTimes(1)
    expect(mockRecordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: expect.objectContaining({ inputTokens: 6, outputTokens: 3, totalTokens: 9 })
      })
    )
  })
})
