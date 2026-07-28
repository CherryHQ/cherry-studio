import { practiceAttemptTable } from '@data/db/schemas/practiceAttempt'
import { practiceSessionTable } from '@data/db/schemas/practiceSession'
import { learningSourceService } from '@data/services/LearningSourceService'
import { learningUnitService } from '@data/services/LearningUnitService'
import { PracticeService } from '@data/services/PracticeService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

describe('PracticeService', () => {
  const dbh = setupTestDatabase()

  function createUnit() {
    const source = learningSourceService.register({
      kind: 'translation',
      sourceRecordId: 'practice-source',
      sourceRevision: '1',
      sourceText: '我想要一杯茶',
      targetText: 'I would like a cup of tea'
    })
    return learningUnitService.upsertCandidate({
      sourceId: source.id,
      kind: 'sentence',
      english: 'I would like a cup of tea',
      meaning: '我想要一杯茶'
    })
  }

  it('records an attempt and completes an active session', () => {
    const service = new PracticeService()
    const unit = createUnit()
    const session = service.create({
      mode: 'spoken_recall',
      modelId: 'whisper-1',
      providerId: 'openai'
    })
    const attempt = service.addAttempt(session.id, {
      learningUnitId: unit.id,
      prompt: unit.meaning,
      transcript: 'I would like a cup of tea',
      feedback: { feedback: ['Natural and accurate.'], textSimilarity: 1 },
      textSimilarity: 1,
      durationMs: 2_000
    })
    const completed = service.finish(session.id, { status: 'completed' })

    expect(attempt).toMatchObject({
      practiceSessionId: session.id,
      learningUnitId: unit.id,
      textSimilarity: 1
    })
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).not.toBeNull()
    expect(dbh.db.select().from(practiceSessionTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(practiceAttemptTable).all()).toHaveLength(1)
  })

  it('rejects attempts after a session is finished', () => {
    const service = new PracticeService()
    const session = service.create({ mode: 'shadowing' })
    service.finish(session.id, { status: 'interrupted' })

    expect(() =>
      service.addAttempt(session.id, {
        prompt: 'Repeat this.',
        feedback: {},
        durationMs: 0
      })
    ).toThrow('no longer active')
  })

  it('makes finishing with the same status idempotent', () => {
    const service = new PracticeService()
    const session = service.create({ mode: 'scenario', scenario: 'At a hotel' })
    const first = service.finish(session.id, { status: 'failed', error: 'Provider unavailable' })
    const repeated = service.finish(session.id, { status: 'failed' })

    expect(repeated).toEqual(first)
  })
})
