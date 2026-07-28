import { learningExternalSyncTable } from '@data/db/schemas/learningExternalSync'
import { learningSourceTable } from '@data/db/schemas/learningSource'
import { learningUnitSourceTable, learningUnitTable } from '@data/db/schemas/learningUnit'
import { practiceAttemptTable } from '@data/db/schemas/practiceAttempt'
import { practiceSessionTable } from '@data/db/schemas/practiceSession'
import { reviewCardTable, reviewStateTable } from '@data/db/schemas/reviewCard'
import { reviewEventTable } from '@data/db/schemas/reviewEvent'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('English learning schemas', () => {
  const dbh = setupTestDatabase()

  function insertSource() {
    return dbh.db
      .insert(learningSourceTable)
      .values({
        kind: 'translation',
        sourceRecordId: crypto.randomUUID(),
        sourceRevision: 'sha256:source-v1',
        status: 'pending',
        sourceLanguage: 'zh-cn',
        targetLanguage: 'en-us',
        sourceText: '你好',
        targetText: 'Hello'
      })
      .returning()
      .get()
  }

  function insertUnit(exactHash = `sha256:${crypto.randomUUID()}`) {
    return dbh.db
      .insert(learningUnitTable)
      .values({
        kind: 'expression',
        english: 'call it a day',
        normalizedEnglish: 'call it a day',
        meaning: 'stop working',
        exactHash
      })
      .returning()
      .get()
  }

  it('deduplicates source revisions and canonical units at the database boundary', () => {
    const source = insertSource()
    const unit = insertUnit()

    expect(() =>
      dbh.db
        .insert(learningSourceTable)
        .values({
          kind: source.kind,
          sourceRecordId: source.sourceRecordId,
          sourceRevision: source.sourceRevision,
          status: 'pending',
          sourceText: source.sourceText,
          targetText: source.targetText
        })
        .run()
    ).toThrow()
    expect(() =>
      dbh.db
        .insert(learningUnitTable)
        .values({
          kind: 'expression',
          english: 'Call it a day',
          normalizedEnglish: 'call it a day',
          meaning: 'finish work',
          exactHash: unit.exactHash
        })
        .run()
    ).toThrow()
  })

  it('keeps a canonical unit when its source is removed but drops the provenance link', () => {
    const source = insertSource()
    const unit = insertUnit()
    dbh.db.insert(learningUnitSourceTable).values({ learningUnitId: unit.id, learningSourceId: source.id }).run()

    dbh.db.delete(learningSourceTable).where(eq(learningSourceTable.id, source.id)).run()

    expect(dbh.db.select().from(learningUnitTable).where(eq(learningUnitTable.id, unit.id)).get()).toBeDefined()
    expect(
      dbh.db.select().from(learningUnitSourceTable).where(eq(learningUnitSourceTable.learningUnitId, unit.id)).all()
    ).toEqual([])
  })

  it('keeps review events after a card is removed and nulls the card reference', () => {
    const unit = insertUnit()
    const card = dbh.db
      .insert(reviewCardTable)
      .values({ learningUnitId: unit.id, direction: 'production' })
      .returning()
      .get()
    const state = {
      dueAt: new Date().toISOString(),
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      learningSteps: 0,
      phase: 'new' as const,
      lastReviewAt: null,
      schedulerVersion: 'ts-fsrs@5.4.1',
      suspended: false
    }
    dbh.db
      .insert(reviewStateTable)
      .values({
        cardId: card.id,
        dueAt: Date.now(),
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        learningSteps: 0,
        phase: 'new'
      })
      .run()
    const event = dbh.db
      .insert(reviewEventTable)
      .values({
        cardId: card.id,
        rating: 'good',
        reviewedAt: Date.now(),
        durationMs: 1200,
        previousState: state,
        nextState: { ...state, phase: 'learning', reps: 1 },
        clientMutationId: crypto.randomUUID()
      })
      .returning()
      .get()

    dbh.db.delete(reviewCardTable).where(eq(reviewCardTable.id, card.id)).run()

    expect(dbh.db.select().from(reviewStateTable).where(eq(reviewStateTable.cardId, card.id)).all()).toEqual([])
    expect(dbh.db.select().from(reviewEventTable).where(eq(reviewEventTable.id, event.id)).get()?.cardId).toBeNull()
  })

  it('enforces one card direction and one external target per unit', () => {
    const unit = insertUnit()
    dbh.db.insert(reviewCardTable).values({ learningUnitId: unit.id, direction: 'recognition' }).run()
    dbh.db
      .insert(learningExternalSyncTable)
      .values({
        learningUnitId: unit.id,
        target: 'obsidian',
        state: 'pending',
        sourceRevision: 'unit-v1'
      })
      .run()

    expect(() =>
      dbh.db.insert(reviewCardTable).values({ learningUnitId: unit.id, direction: 'recognition' }).run()
    ).toThrow()
    expect(() =>
      dbh.db
        .insert(learningExternalSyncTable)
        .values({
          learningUnitId: unit.id,
          target: 'obsidian',
          state: 'pending',
          sourceRevision: 'unit-v2'
        })
        .run()
    ).toThrow()
  })

  it('cascades practice attempts with their owning session', () => {
    const session = dbh.db
      .insert(practiceSessionTable)
      .values({ mode: 'shadowing', status: 'active', startedAt: Date.now() })
      .returning()
      .get()
    const attempt = dbh.db
      .insert(practiceAttemptTable)
      .values({
        practiceSessionId: session.id,
        prompt: 'Call it a day.',
        attemptedAt: Date.now()
      })
      .returning()
      .get()

    dbh.db.delete(practiceSessionTable).where(eq(practiceSessionTable.id, session.id)).run()

    expect(dbh.db.select().from(practiceAttemptTable).where(eq(practiceAttemptTable.id, attempt.id)).all()).toEqual([])
  })
})
