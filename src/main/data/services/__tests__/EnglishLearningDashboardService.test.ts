import { practiceSessionTable } from '@data/db/schemas/practiceSession'
import { reviewCardTable, reviewStateTable } from '@data/db/schemas/reviewCard'
import { reviewEventTable } from '@data/db/schemas/reviewEvent'
import { englishLearningDashboardService } from '@data/services/EnglishLearningDashboardService'
import { learningSourceService } from '@data/services/LearningSourceService'
import { learningUnitService } from '@data/services/LearningUnitService'
import type { SerializedReviewState } from '@shared/data/types/englishLearning'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

describe('EnglishLearningDashboardService', () => {
  const dbh = setupTestDatabase()

  it('summarizes source, review, and speaking activity for today', () => {
    const now = Date.now()
    const source = learningSourceService.register({
      kind: 'translation',
      sourceRecordId: 'history-1',
      sourceRevision: 'revision-1',
      sourceText: '你好',
      targetText: 'Hello'
    })
    const unit = learningUnitService.upsertCandidate({
      sourceId: source.id,
      kind: 'expression',
      english: 'Hello',
      meaning: '你好'
    })
    learningUnitService.update(unit.id, { suspended: true })
    const card = dbh.db
      .insert(reviewCardTable)
      .values({ learningUnitId: unit.id, direction: 'recognition' })
      .returning()
      .get()
    dbh.db
      .insert(reviewStateTable)
      .values({
        cardId: card.id,
        dueAt: now - 1,
        stability: 1,
        difficulty: 5,
        elapsedDays: 1,
        scheduledDays: 1,
        reps: 1,
        lapses: 0,
        learningSteps: 0,
        phase: 'review',
        suspended: false
      })
      .run()
    const state: SerializedReviewState = {
      dueAt: new Date(now).toISOString(),
      stability: 1,
      difficulty: 5,
      elapsedDays: 1,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      learningSteps: 0,
      phase: 'review',
      lastReviewAt: null,
      suspended: false
    }
    dbh.db
      .insert(reviewEventTable)
      .values({
        cardId: card.id,
        rating: 'good',
        reviewedAt: now,
        durationMs: 10_000,
        previousState: state,
        nextState: state,
        clientMutationId: 'review-1'
      })
      .run()
    dbh.db
      .insert(practiceSessionTable)
      .values({
        mode: 'scenario',
        status: 'completed',
        startedAt: now,
        completedAt: now,
        durationMs: 150_000
      })
      .run()

    expect(englishLearningDashboardService.get()).toEqual({
      sources: { pending: 1, processing: 0, ready: 0, failed: 0, excluded: 0 },
      unitTotal: 1,
      suspendedUnitTotal: 1,
      dueNowTotal: 1,
      reviewedTodayTotal: 1,
      practiceMinutesToday: 3
    })
  })
})
