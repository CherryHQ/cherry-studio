import {
  applyReviewRating,
  createInitialReviewState,
  REVIEW_SCHEDULER_VERSION
} from '@data/services/EnglishLearningFsrsAdapter'
import { describe, expect, it } from 'vitest'

describe('fsrsAdapter', () => {
  const now = new Date('2026-07-28T04:00:00.000Z')

  it('creates a stable serialized new-card state', () => {
    expect(createInitialReviewState(now)).toEqual({
      dueAt: now.toISOString(),
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      learningSteps: 0,
      phase: 'new',
      lastReviewAt: null,
      schedulerVersion: REVIEW_SCHEDULER_VERSION,
      suspended: false
    })
  })

  it.each(['again', 'hard', 'good', 'easy'] as const)('applies the %s rating through FSRS', (rating) => {
    const next = applyReviewRating(createInitialReviewState(now), rating, now)

    expect(next.reps).toBe(1)
    expect(next.lastReviewAt).toBe(now.toISOString())
    expect(Date.parse(next.dueAt)).toBeGreaterThan(now.getTime())
    expect(next.schedulerVersion).toBe(REVIEW_SCHEDULER_VERSION)
  })
})
