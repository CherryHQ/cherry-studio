import { describe, expect, it } from 'vitest'

import { getPromptCacheUsage } from '../promptCacheUsage'

describe('getPromptCacheUsage', () => {
  it.each([
    [100, null, 40, null, 0.4],
    [null, 50, 30, 20, 0.3],
    [100, 60, 40, null, 0.4],
    [100, null, null, null, null],
    [null, 60, 40, null, null],
    [0, 0, 0, 0, null],
    [10, null, 11, null, null],
    [null, null, null, null, null],
    [100, null, 0, null, 0]
  ])(
    'calculates rates from %s, %s, %s, %s',
    (inputTokens, noCacheTokens, cacheReadTokens, cacheWriteTokens, expected) => {
      expect(
        getPromptCacheUsage({ inputTokens, noCacheTokens, cacheReadTokens, cacheWriteTokens })?.hitRate ?? null
      ).toBe(expected)
    }
  )
})
