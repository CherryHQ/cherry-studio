import { describe, expect, it } from 'vitest'

import { getAiUsageRecordTotalTokens } from '@shared/data/types/aiUsageRecord'

describe('getAiUsageRecordTotalTokens', () => {
  it('prefers the provider total and derives a missing total from partial usage', () => {
    expect(getAiUsageRecordTotalTokens({ totalTokens: 90, inputTokens: 70, outputTokens: 20 })).toBe(90)
    expect(getAiUsageRecordTotalTokens({ totalTokens: null, inputTokens: 100, outputTokens: 20 })).toBe(120)
    expect(getAiUsageRecordTotalTokens({ totalTokens: null, inputTokens: 100, outputTokens: null })).toBe(100)
  })

  it('preserves unknown usage instead of displaying it as zero', () => {
    expect(getAiUsageRecordTotalTokens({ totalTokens: null, inputTokens: null, outputTokens: null })).toBeNull()
  })
})
