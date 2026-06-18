import { describe, expect, it, vi } from 'vitest'

const setBudgetTripped = vi.fn()
vi.mock('@main/core/application', () => ({
  application: { get: vi.fn(() => ({ setBudgetTripped })) }
}))

import { budgetStopFeature } from '../budgetStop'

const scope = (chatId?: string, contextWindow?: number, modelId = 'prov::model') =>
  ({ request: { chatId }, model: { id: modelId, contextWindow } }) as any

describe('budgetStopFeature', () => {
  it('applies when chatId is present and contextWindow is positive', () => {
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

  it('returns true and calls setBudgetTripped when inputTokens meets threshold', () => {
    setBudgetTripped.mockClear()
    const [condition] = budgetStopFeature.contributeStopConditions!(scope('topic-1', 100_000, 'prov::model'))
    // threshold = 80_000; 80_000 >= threshold
    expect(condition({ steps: [{ usage: { inputTokens: 80_000 } }] } as any)).toBe(true)
    expect(setBudgetTripped).toHaveBeenCalledOnce()
    expect(setBudgetTripped).toHaveBeenCalledWith('topic-1', 'prov::model')
  })

  it('returns true and calls setBudgetTripped when inputTokens exceeds threshold', () => {
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
})
