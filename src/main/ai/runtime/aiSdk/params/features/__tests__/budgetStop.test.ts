import { describe, expect, it, vi } from 'vitest'

const setBudgetTripped = vi.fn()
vi.mock('@main/core/application', () => ({
  application: { get: vi.fn(() => ({ setBudgetTripped })) }
}))
vi.mock('@main/ai/agentSession/topic', () => ({
  isAgentSessionTopic: (id: string) => id.startsWith('agent-session:')
}))
vi.mock('@main/data/services/TemporaryChatService', () => ({
  temporaryChatService: { hasTopic: (id: string) => id.startsWith('temp:') }
}))

import { budgetStopFeature } from '../budgetStop'

const scope = (chatId?: string, contextWindow?: number, modelId = 'prov::model', assistant?: any) =>
  ({ request: { chatId }, model: { id: modelId, contextWindow }, assistant }) as any

describe('budgetStopFeature', () => {
  // --- applies ---

  it('applies when chatId is present and contextWindow is positive (persistent chat)', () => {
    expect(budgetStopFeature.applies?.(scope('topic-1', 100_000))).toBe(true)
  })

  it('does not apply when chatId is missing', () => {
    expect(budgetStopFeature.applies?.(scope(undefined, 100_000))).toBe(false)
  })

  it('does not apply when contextWindow is 0', () => {
    expect(budgetStopFeature.applies?.(scope('topic-1', 0))).toBe(false)
  })

  it('does not apply when contextWindow is undefined', () => {
    expect(budgetStopFeature.applies?.(scope('topic-1', undefined))).toBe(false)
  })

  // Fix B — agent-session and temporary-chat exclusions
  it('does not apply for agent-session topics', () => {
    expect(budgetStopFeature.applies?.(scope('agent-session:s1', 100_000))).toBe(false)
  })

  it('does not apply for temporary-chat topics', () => {
    expect(budgetStopFeature.applies?.(scope('temp:t1', 100_000))).toBe(false)
  })

  // --- contributeStopConditions ---

  it('contributes a single stop condition', () => {
    const conditions = budgetStopFeature.contributeStopConditions!(scope('topic-1', 100_000))
    expect(conditions).toHaveLength(1)
  })

  it('returns false and does not call setBudgetTripped when inputTokens is below threshold', () => {
    setBudgetTripped.mockClear()
    const [condition] = budgetStopFeature.contributeStopConditions!(scope('topic-1', 100_000))
    // threshold = 0.8 * 100_000 = 80_000; 79_999 < threshold
    expect(condition({ steps: [{ usage: { inputTokens: 79_999 } }] } as any)).toBe(false)
    expect(setBudgetTripped).not.toHaveBeenCalled()
  })

  it('returns true and calls setBudgetTripped when inputTokens meets threshold (below cap)', () => {
    setBudgetTripped.mockClear()
    const [condition] = budgetStopFeature.contributeStopConditions!(scope('topic-1', 100_000, 'prov::model'))
    // threshold = 80_000; step 1 of 20 cap — budget is binding
    expect(condition({ steps: [{ usage: { inputTokens: 80_000 } }] } as any)).toBe(true)
    expect(setBudgetTripped).toHaveBeenCalledOnce()
    expect(setBudgetTripped).toHaveBeenCalledWith('topic-1', 'prov::model')
  })

  it('returns true and calls setBudgetTripped when inputTokens exceeds threshold (below cap)', () => {
    setBudgetTripped.mockClear()
    const [condition] = budgetStopFeature.contributeStopConditions!(scope('topic-1', 100_000, 'prov::model'))
    expect(condition({ steps: [{ usage: { inputTokens: 95_000 } }] } as any)).toBe(true)
    expect(setBudgetTripped).toHaveBeenCalledWith('topic-1', 'prov::model')
  })

  it('defaults inputTokens to 0 (no trip) when steps is empty', () => {
    setBudgetTripped.mockClear()
    const [condition] = budgetStopFeature.contributeStopConditions!(scope('topic-1', 100_000))
    expect(condition({ steps: [] } as any)).toBe(false)
    expect(setBudgetTripped).not.toHaveBeenCalled()
  })

  it('contributes nothing for a topicless request', () => {
    expect(budgetStopFeature.contributeStopConditions!(scope(undefined, 100_000))).toEqual([])
  })

  it('contributes nothing when contextWindow is missing', () => {
    expect(budgetStopFeature.contributeStopConditions!(scope('topic-1', undefined))).toEqual([])
  })

  // Fix D — do NOT trip when the step cap is the binding constraint

  it('does not trip when steps.length equals the default cap (20), even if over threshold', () => {
    setBudgetTripped.mockClear()
    // No assistant → default cap is 20
    const [condition] = budgetStopFeature.contributeStopConditions!(scope('topic-1', 100_000))
    const atCap = Array.from({ length: 20 }, () => ({ usage: { inputTokens: 95_000 } }))
    expect(condition({ steps: atCap } as any)).toBe(false)
    expect(setBudgetTripped).not.toHaveBeenCalled()
  })

  it('does not trip when steps.length equals a custom assistant cap, even if over threshold', () => {
    setBudgetTripped.mockClear()
    const assistant = { settings: { enableMaxToolCalls: true, maxToolCalls: 5 } }
    const [condition] = budgetStopFeature.contributeStopConditions!(scope('topic-1', 100_000, 'prov::model', assistant))
    const atCap = Array.from({ length: 5 }, () => ({ usage: { inputTokens: 95_000 } }))
    expect(condition({ steps: atCap } as any)).toBe(false)
    expect(setBudgetTripped).not.toHaveBeenCalled()
  })

  it('trips when steps.length is one below the custom assistant cap and over threshold', () => {
    setBudgetTripped.mockClear()
    const assistant = { settings: { enableMaxToolCalls: true, maxToolCalls: 5 } }
    const [condition] = budgetStopFeature.contributeStopConditions!(scope('topic-1', 100_000, 'prov::model', assistant))
    const belowCap = Array.from({ length: 4 }, () => ({ usage: { inputTokens: 95_000 } }))
    expect(condition({ steps: belowCap } as any)).toBe(true)
    expect(setBudgetTripped).toHaveBeenCalledOnce()
  })

  it('uses default cap (20) when enableMaxToolCalls is false', () => {
    setBudgetTripped.mockClear()
    const assistant = { settings: { enableMaxToolCalls: false, maxToolCalls: 5 } }
    const [condition] = budgetStopFeature.contributeStopConditions!(scope('topic-1', 100_000, 'prov::model', assistant))
    // At cap=20, should not trip
    const atDefaultCap = Array.from({ length: 20 }, () => ({ usage: { inputTokens: 95_000 } }))
    expect(condition({ steps: atDefaultCap } as any)).toBe(false)
    expect(setBudgetTripped).not.toHaveBeenCalled()
    // Below cap=20, should trip
    setBudgetTripped.mockClear()
    const belowDefaultCap = Array.from({ length: 19 }, () => ({ usage: { inputTokens: 95_000 } }))
    expect(condition({ steps: belowDefaultCap } as any)).toBe(true)
    expect(setBudgetTripped).toHaveBeenCalledOnce()
  })
})
