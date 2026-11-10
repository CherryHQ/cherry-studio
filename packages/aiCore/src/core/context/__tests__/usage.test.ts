import { describe, expect, it } from 'vitest'

import { getContextInputTokens, getContextTokens } from '../usage'

describe('continuation context usage', () => {
  it.each(['google', 'vertex'])('counts the %s prompt once while preserving billed usage', (provider) => {
    const usage = Object.freeze({ inputTokens: 203, totalTokens: 211 })
    const metadata = { [provider]: { initialPromptTokenCount: 100 } }
    expect(getContextInputTokens(usage.inputTokens, metadata)).toBe(100)
    expect(getContextTokens(usage, metadata)).toBe(108)
    expect(usage).toEqual({ inputTokens: 203, totalTokens: 211 })
  })

  it.each([undefined, null, '100', -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'retains ordinary usage when the continuation count is %s',
    (initialPromptTokenCount) => {
      const metadata = initialPromptTokenCount === undefined ? undefined : { google: { initialPromptTokenCount } }
      expect(getContextTokens({ inputTokens: 100, totalTokens: 108 }, metadata)).toBe(108)
    }
  )

  it('does not use output-only totals as a context anchor', () => {
    expect(getContextTokens({ inputTokens: undefined, totalTokens: 8 })).toBeUndefined()
  })
})
