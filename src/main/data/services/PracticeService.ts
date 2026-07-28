import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { learningUnitTable } from '@data/db/schemas/learningUnit'
import { practiceAttemptTable } from '@data/db/schemas/practiceAttempt'
import { practiceSessionTable } from '@data/db/schemas/practiceSession'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type {
  AddPracticeAttemptDto,
  CreatePracticeSessionDto,
  FinishPracticeSessionDto
} from '@shared/data/api/schemas/englishLearning'
import type { PracticeAttempt, PracticeSession } from '@shared/data/types/englishLearning'
import { eq } from 'drizzle-orm'

import { timestampToISO } from './utils/rowMappers'

function rowToSession(row: typeof practiceSessionTable.$inferSelect): PracticeSession {
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    scenario: row.scenario,
    modelId: row.modelId,
    providerId: row.providerId,
    startedAt: timestampToISO(row.startedAt),
    completedAt: row.completedAt === null ? null : timestampToISO(row.completedAt),
    durationMs: row.durationMs,
    error: row.error
  }
}

function rowToAttempt(row: typeof practiceAttemptTable.$inferSelect): PracticeAttempt {
  return {
    id: row.id,
    practiceSessionId: row.practiceSessionId,
    learningUnitId: row.learningUnitId,
    prompt: row.prompt,
    transcript: row.transcript,
    responseText: row.responseText,
    feedback: row.feedback,
    recognitionConfidence: row.recognitionConfidence,
    textSimilarity: row.textSimilarity,
    durationMs: row.durationMs,
    attemptedAt: timestampToISO(row.attemptedAt)
  }
}

export class PracticeService {
  create(input: CreatePracticeSessionDto): PracticeSession {
    const row = application
      .get('DbService')
      .getDb()
      .insert(practiceSessionTable)
      .values({
        mode: input.mode,
        status: 'active',
        scenario: input.scenario,
        modelId: input.modelId,
        providerId: input.providerId,
        startedAt: Date.now()
      })
      .returning()
      .get()
    this.notify(row.id)
    return rowToSession(row)
  }

  getById(id: string): PracticeSession {
    const row = application
      .get('DbService')
      .getDb()
      .select()
      .from(practiceSessionTable)
      .where(eq(practiceSessionTable.id, id))
      .limit(1)
      .get()
    if (!row) throw DataApiErrorFactory.notFound('PracticeSession', id)
    return rowToSession(row)
  }

  addAttempt(practiceSessionId: string, input: AddPracticeAttemptDto): PracticeAttempt {
    const row = application.get('DbService').withWriteTx((tx) => {
      const session = tx
        .select()
        .from(practiceSessionTable)
        .where(eq(practiceSessionTable.id, practiceSessionId))
        .limit(1)
        .get()
      if (!session) throw DataApiErrorFactory.notFound('PracticeSession', practiceSessionId)
      if (session.status !== 'active') throw DataApiErrorFactory.conflict('PracticeSession is no longer active')

      if (input.learningUnitId) {
        const unit = tx
          .select({ id: learningUnitTable.id })
          .from(learningUnitTable)
          .where(eq(learningUnitTable.id, input.learningUnitId))
          .limit(1)
          .get()
        if (!unit) throw DataApiErrorFactory.notFound('LearningUnit', input.learningUnitId)
      }

      return tx
        .insert(practiceAttemptTable)
        .values({
          practiceSessionId,
          learningUnitId: input.learningUnitId,
          prompt: input.prompt,
          transcript: input.transcript,
          responseText: input.responseText,
          feedback: input.feedback,
          recognitionConfidence: input.recognitionConfidence,
          textSimilarity: input.textSimilarity,
          durationMs: input.durationMs,
          attemptedAt: Date.now()
        })
        .returning()
        .get()
    })
    this.notify(practiceSessionId)
    return rowToAttempt(row)
  }

  finish(id: string, input: FinishPracticeSessionDto): PracticeSession {
    const now = Date.now()
    const row = application.get('DbService').withWriteTx((tx) => {
      const session = tx.select().from(practiceSessionTable).where(eq(practiceSessionTable.id, id)).limit(1).get()
      if (!session) throw DataApiErrorFactory.notFound('PracticeSession', id)
      if (session.status !== 'active') {
        if (session.status === input.status) return session
        throw DataApiErrorFactory.conflict('PracticeSession is already finished')
      }
      return tx
        .update(practiceSessionTable)
        .set({
          status: input.status,
          completedAt: now,
          durationMs: Math.max(0, now - session.startedAt),
          error: input.error
        })
        .where(eq(practiceSessionTable.id, id))
        .returning()
        .get()
    })
    this.notify(id)
    return rowToSession(row)
  }

  private notify(id: string): void {
    notifyDataApiDataChange([
      { endpoint: '/english-learning/dashboard' },
      { endpoint: '/english-learning/practice/sessions/:id', entityIds: [id] }
    ])
  }
}

export const practiceService = new PracticeService()
