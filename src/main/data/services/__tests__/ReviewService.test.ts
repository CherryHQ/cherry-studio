import { reviewCardTable, reviewStateTable } from '@data/db/schemas/reviewCard'
import { reviewEventTable } from '@data/db/schemas/reviewEvent'
import { learningSourceService } from '@data/services/LearningSourceService'
import { learningUnitService } from '@data/services/LearningUnitService'
import { ReviewService } from '@data/services/ReviewService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

describe('ReviewService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => MockMainPreferenceServiceUtils.resetMocks())

  function createUnit(index: number) {
    const source = learningSourceService.register({
      kind: 'translation',
      sourceRecordId: `source-${index}`,
      sourceRevision: 'revision-1',
      sourceText: `含义 ${index}`,
      targetText: `Expression ${index}`
    })
    return learningUnitService.upsertCandidate({
      sourceId: source.id,
      kind: 'expression',
      english: `Expression ${index}`,
      meaning: `含义 ${index}`
    })
  }

  it('idempotently materializes recognition and production cards', () => {
    const service = new ReviewService()
    const unit = createUnit(1)
    const now = new Date('2026-07-28T04:00:00.000Z')

    expect(service.ensureCardsForUnit(unit.id, now)).toHaveLength(2)
    expect(service.ensureCardsForUnit(unit.id, now)).toEqual([])
    expect(dbh.db.select().from(reviewCardTable).all()).toHaveLength(2)
    expect(dbh.db.select().from(reviewStateTable).all()).toHaveLength(2)
    expect(dbh.db.select().from(reviewStateTable).all()[0]).toMatchObject({
      dueAt: now.getTime(),
      phase: 'new',
      schedulerVersion: 'ts-fsrs@5.4.1'
    })
  })

  it('builds a bounded queue without adjacent cards from the same unit', () => {
    const service = new ReviewService()
    const now = new Date('2026-07-28T04:00:00.000Z')
    const first = createUnit(1)
    const second = createUnit(2)
    service.ensureCardsForUnit(first.id, now)
    service.ensureCardsForUnit(second.id, now)

    const queue = service.getDailyQueue({ now, limit: 4, newCardLimit: 4 })

    expect(queue.items).toHaveLength(4)
    expect(queue.items[0].unit.id).not.toBe(queue.items[1].unit.id)
    expect(queue.items[1].unit.id).not.toBe(queue.items[2].unit.id)
    expect(queue.newTotal).toBe(4)
  })

  it('submits a rating atomically and deduplicates a repeated client mutation', () => {
    const service = new ReviewService()
    const now = new Date('2026-07-28T04:00:00.000Z')
    const unit = createUnit(1)
    const [cardId] = service.ensureCardsForUnit(unit.id, now)
    const input = {
      cardId,
      rating: 'good' as const,
      durationMs: 2_500,
      clientMutationId: 'review-mutation-1',
      reviewedAt: now
    }

    const first = service.submit(input)
    const repeated = service.submit(input)

    expect(repeated).toEqual(first)
    expect(first.state).toMatchObject({ reps: 1, lastReviewAt: now.toISOString() })
    expect(dbh.db.select().from(reviewEventTable).all()).toHaveLength(1)
    expect(
      dbh.db
        .select()
        .from(reviewStateTable)
        .all()
        .find((state) => state.cardId === cardId)?.reps
    ).toBe(1)
  })

  it('subtracts new cards already introduced today from the daily cap', () => {
    const service = new ReviewService()
    const now = new Date()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.english_learning.new_card_limit', 1)
    const first = createUnit(1)
    const [firstCardId] = service.ensureCardsForUnit(first.id, now)
    service.submit({
      cardId: firstCardId,
      rating: 'good',
      durationMs: 1_000,
      clientMutationId: 'introduced-today',
      reviewedAt: now
    })
    const second = createUnit(2)
    service.ensureCardsForUnit(second.id, now)

    expect(service.getDailyQueue({ now }).items.every((item) => item.state.phase !== 'new')).toBe(true)
  })

  it('rejects a stale review submission after its learning unit is suspended', () => {
    const service = new ReviewService()
    const now = new Date()
    const unit = createUnit(1)
    const [cardId] = service.ensureCardsForUnit(unit.id, now)
    learningUnitService.update(unit.id, { suspended: true })

    expect(() =>
      service.submit({
        cardId,
        rating: 'good',
        durationMs: 1_000,
        clientMutationId: 'suspended-unit',
        reviewedAt: now
      })
    ).toThrow('Learning unit is suspended')
  })
})
