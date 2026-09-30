import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { beforeEach, describe, expect, it } from 'vitest'

import { cacheService } from '@data/CacheService'
import type { CacheAskUserQuestionDraft } from '@shared/data/cache/cacheValueTypes'

import {
  clearAskUserQuestionDraftCache,
  getAskUserQuestionDraftCacheKey,
  readAskUserQuestionDraftCache,
  writeAskUserQuestionDraftCache
} from '../askUserQuestionDraftCache'

describe('askUserQuestionDraftCache', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
  })

  it('round-trips selected answers, custom answers and the current question', () => {
    writeAskUserQuestionDraftCache('approval-1', {
      selectedAnswers: { 0: ['Winston'], 2: ['Pino', 'Bunyan'] },
      customAnswers: { 1: 'Use JSON logs' },
      currentIndex: 2
    })

    const restored = readAskUserQuestionDraftCache('approval-1')

    expect(restored.currentIndex).toBe(2)
    expect(restored.selectedAnswers).toEqual({ 0: ['Winston'], 2: ['Pino', 'Bunyan'] })
    expect(restored.customAnswers).toEqual({ 1: 'Use JSON logs' })
  })

  it('keys drafts by approval id so sibling questions stay independent', () => {
    writeAskUserQuestionDraftCache('approval-1', {
      selectedAnswers: { 0: ['Winston'] },
      customAnswers: {},
      currentIndex: 0
    })

    expect(readAskUserQuestionDraftCache('approval-2').selectedAnswers).toEqual({})
  })

  it('falls back to an empty draft when the cached value is malformed', () => {
    // The cache is untyped at runtime, so narrowing has to survive garbage values.
    const malformed = {
      selectedAnswers: { 0: 'Winston', '-1': ['Pino'], 1: ['Bunyan', 42] },
      customAnswers: { 0: 7, 1: 'kept' },
      currentIndex: -3
    } as unknown as CacheAskUserQuestionDraft
    cacheService.set(getAskUserQuestionDraftCacheKey('approval-1'), malformed)

    expect(readAskUserQuestionDraftCache('approval-1')).toEqual({
      selectedAnswers: { 1: ['Bunyan'] },
      customAnswers: { 1: 'kept' },
      currentIndex: 0
    })
  })

  it('clears the draft once it is no longer needed', () => {
    writeAskUserQuestionDraftCache('approval-1', {
      selectedAnswers: { 0: ['Winston'] },
      customAnswers: {},
      currentIndex: 1
    })

    clearAskUserQuestionDraftCache('approval-1')

    expect(readAskUserQuestionDraftCache('approval-1')).toEqual({
      selectedAnswers: {},
      customAnswers: {},
      currentIndex: 0
    })
  })
})
