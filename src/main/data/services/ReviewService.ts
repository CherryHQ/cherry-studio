import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { learningUnitTable } from '@data/db/schemas/learningUnit'
import { reviewCardTable, reviewStateTable } from '@data/db/schemas/reviewCard'
import { reviewEventTable } from '@data/db/schemas/reviewEvent'
import { applyReviewRating, createInitialReviewState } from '@data/services/EnglishLearningFsrsAdapter'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type {
  DailyReviewCard,
  DailyReviewQueue,
  LearningUnit,
  ReviewCardDirection,
  ReviewRating,
  ReviewSubmissionResult,
  SerializedReviewState
} from '@shared/data/types/englishLearning'
import { and, asc, desc, eq, gte, lte, or, sql } from 'drizzle-orm'

import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:ReviewService')

export interface SubmitReviewInput {
  cardId: string
  rating: ReviewRating
  durationMs: number
  clientMutationId: string
  reviewedAt?: Date
}

function rowToUnit(row: typeof learningUnitTable.$inferSelect): LearningUnit {
  return {
    id: row.id,
    kind: row.kind,
    english: row.english,
    normalizedEnglish: row.normalizedEnglish,
    meaning: row.meaning,
    usageNote: row.usageNote,
    example: row.example,
    tags: row.tags,
    cefr: row.cefr,
    exactHash: row.exactHash,
    extractionConfidence: row.extractionConfidence,
    isUserEdited: row.isUserEdited,
    suspended: row.suspended,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function rowToSerializedState(row: typeof reviewStateTable.$inferSelect): SerializedReviewState {
  return {
    dueAt: timestampToISO(row.dueAt),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    reps: row.reps,
    lapses: row.lapses,
    learningSteps: row.learningSteps,
    phase: row.phase,
    lastReviewAt: row.lastReviewAt === null ? null : timestampToISO(row.lastReviewAt),
    schedulerVersion: row.schedulerVersion,
    suspended: row.suspended
  }
}

function serializedStateToRow(state: SerializedReviewState) {
  return {
    dueAt: Date.parse(state.dueAt),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsedDays: state.elapsedDays,
    scheduledDays: state.scheduledDays,
    reps: state.reps,
    lapses: state.lapses,
    learningSteps: state.learningSteps,
    phase: state.phase,
    lastReviewAt: state.lastReviewAt === null ? null : Date.parse(state.lastReviewAt),
    schedulerVersion: state.schedulerVersion,
    suspended: state.suspended
  }
}

function interleaveUnits(items: DailyReviewCard[]): DailyReviewCard[] {
  const remaining = [...items]
  const result: DailyReviewCard[] = []
  while (remaining.length > 0) {
    const previousUnitId = result.at(-1)?.unit.id
    const nextIndex = remaining.findIndex((item) => item.unit.id !== previousUnitId)
    result.push(remaining.splice(nextIndex >= 0 ? nextIndex : 0, 1)[0])
  }
  return result
}

export class ReviewService {
  private get db() {
    return application.get('DbService').getDb()
  }

  ensureCardsForUnit(learningUnitId: string, now = new Date()): string[] {
    const createdCardIds = application.get('DbService').withWriteTx((tx) => {
      const unit = tx.select().from(learningUnitTable).where(eq(learningUnitTable.id, learningUnitId)).limit(1).get()
      if (!unit) throw DataApiErrorFactory.notFound('LearningUnit', learningUnitId)

      const ids: string[] = []
      for (const direction of ['recognition', 'production'] satisfies ReviewCardDirection[]) {
        const card =
          tx
            .select()
            .from(reviewCardTable)
            .where(and(eq(reviewCardTable.learningUnitId, learningUnitId), eq(reviewCardTable.direction, direction)))
            .limit(1)
            .get() ?? tx.insert(reviewCardTable).values({ learningUnitId, direction }).returning().get()
        const state = tx.select().from(reviewStateTable).where(eq(reviewStateTable.cardId, card.id)).limit(1).get()
        if (!state) {
          tx.insert(reviewStateTable)
            .values({ cardId: card.id, ...serializedStateToRow(createInitialReviewState(now)) })
            .run()
          ids.push(card.id)
        }
      }
      return ids
    })

    if (createdCardIds.length > 0) this.notifyReviewChanged(createdCardIds)
    return createdCardIds
  }

  getDailyQueue(options: { now?: Date; limit?: number; newCardLimit?: number } = {}): DailyReviewQueue {
    const now = options.now ?? new Date()
    const preferenceService = application.get('PreferenceService')
    const budgetMinutes = Math.max(
      1,
      Math.min(180, preferenceService.get('feature.english_learning.daily_time_budget_minutes'))
    )
    const responseTimeMs = this.getMedianReviewDurationMs()
    const budgetCardLimit = Math.max(1, Math.floor((budgetMinutes * 60_000) / responseTimeMs))
    const limit = Math.min(options.limit ?? 50, budgetCardLimit)
    const configuredNewCardLimit = Math.max(
      0,
      Math.min(100, preferenceService.get('feature.english_learning.new_card_limit'))
    )
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)
    const introducedToday = this.getIntroducedTodayCount(startOfToday)
    const newCardLimit = options.newCardLimit ?? Math.max(0, configuredNewCardLimit - introducedToday)
    const endOfToday = new Date(now)
    endOfToday.setHours(23, 59, 59, 999)

    const rows = this.db
      .select({ card: reviewCardTable, state: reviewStateTable, unit: learningUnitTable })
      .from(reviewStateTable)
      .innerJoin(reviewCardTable, eq(reviewCardTable.id, reviewStateTable.cardId))
      .innerJoin(learningUnitTable, eq(learningUnitTable.id, reviewCardTable.learningUnitId))
      .where(
        and(
          eq(reviewStateTable.suspended, false),
          eq(learningUnitTable.suspended, false),
          or(
            lte(reviewStateTable.dueAt, endOfToday.getTime()),
            eq(reviewStateTable.phase, 'relearning'),
            eq(reviewStateTable.phase, 'new')
          )
        )
      )
      .orderBy(
        sql`case when ${reviewStateTable.dueAt} < ${now.getTime()} and ${reviewStateTable.phase} <> 'new' then 0
                 when ${reviewStateTable.dueAt} <= ${endOfToday.getTime()} and ${reviewStateTable.phase} <> 'new' then 1
                 when ${reviewStateTable.phase} = 'relearning' then 2
                 else 3 end`,
        asc(reviewStateTable.dueAt),
        asc(reviewCardTable.id)
      )
      .limit(limit * 3)
      .all()

    let newCount = 0
    const items = rows
      .filter(({ state }) => state.phase !== 'new' || newCount++ < newCardLimit)
      .slice(0, limit)
      .map(({ card, state, unit }) => ({
        cardId: card.id,
        direction: card.direction,
        unit: rowToUnit(unit),
        state: rowToSerializedState(state)
      }))

    const [{ dueTotal }] = this.db
      .select({ dueTotal: sql<number>`count(*)` })
      .from(reviewStateTable)
      .innerJoin(reviewCardTable, eq(reviewCardTable.id, reviewStateTable.cardId))
      .innerJoin(learningUnitTable, eq(learningUnitTable.id, reviewCardTable.learningUnitId))
      .where(
        and(
          eq(reviewStateTable.suspended, false),
          eq(learningUnitTable.suspended, false),
          lte(reviewStateTable.dueAt, endOfToday.getTime())
        )
      )
      .all()
    const [{ newTotal }] = this.db
      .select({ newTotal: sql<number>`count(*)` })
      .from(reviewStateTable)
      .innerJoin(reviewCardTable, eq(reviewCardTable.id, reviewStateTable.cardId))
      .innerJoin(learningUnitTable, eq(learningUnitTable.id, reviewCardTable.learningUnitId))
      .where(
        and(
          eq(reviewStateTable.suspended, false),
          eq(learningUnitTable.suspended, false),
          eq(reviewStateTable.phase, 'new')
        )
      )
      .all()

    return {
      items: interleaveUnits(items),
      dueTotal,
      newTotal,
      estimatedMinutes: Math.ceil((items.length * responseTimeMs) / 60_000)
    }
  }

  submit(input: SubmitReviewInput): ReviewSubmissionResult {
    const reviewedAt = input.reviewedAt ?? new Date()
    const result = application.get('DbService').withWriteTx((tx) => {
      const existing = tx
        .select()
        .from(reviewEventTable)
        .where(eq(reviewEventTable.clientMutationId, input.clientMutationId))
        .limit(1)
        .get()
      if (existing) return this.eventToSubmission(existing)

      const stateRow = tx
        .select()
        .from(reviewStateTable)
        .where(eq(reviewStateTable.cardId, input.cardId))
        .limit(1)
        .get()
      if (!stateRow) throw DataApiErrorFactory.notFound('ReviewCard', input.cardId)
      if (stateRow.suspended) {
        throw DataApiErrorFactory.invalidOperation('submit review', 'Review card is suspended')
      }
      const cardAndUnit = tx
        .select({ unitSuspended: learningUnitTable.suspended })
        .from(reviewCardTable)
        .innerJoin(learningUnitTable, eq(learningUnitTable.id, reviewCardTable.learningUnitId))
        .where(eq(reviewCardTable.id, input.cardId))
        .limit(1)
        .get()
      if (!cardAndUnit) throw DataApiErrorFactory.notFound('ReviewCard', input.cardId)
      if (cardAndUnit.unitSuspended) {
        throw DataApiErrorFactory.invalidOperation('submit review', 'Learning unit is suspended')
      }

      const previousState = rowToSerializedState(stateRow)
      const nextState = applyReviewRating(previousState, input.rating, reviewedAt)
      tx.update(reviewStateTable)
        .set(serializedStateToRow(nextState))
        .where(eq(reviewStateTable.cardId, input.cardId))
        .run()
      const event = tx
        .insert(reviewEventTable)
        .values({
          cardId: input.cardId,
          rating: input.rating,
          reviewedAt: reviewedAt.getTime(),
          durationMs: input.durationMs,
          previousState,
          nextState,
          clientMutationId: input.clientMutationId
        })
        .returning()
        .get()
      return this.eventToSubmission(event)
    })

    this.notifyReviewChanged([input.cardId])
    logger.info('Submitted English learning review', { cardId: input.cardId, rating: input.rating })
    return result
  }

  private eventToSubmission(row: typeof reviewEventTable.$inferSelect): ReviewSubmissionResult {
    if (!row.cardId) throw DataApiErrorFactory.invalidOperation('read review event', 'Review card was deleted')
    return {
      eventId: row.id,
      cardId: row.cardId,
      rating: row.rating,
      reviewedAt: timestampToISO(row.reviewedAt),
      state: row.nextState
    }
  }

  private getMedianReviewDurationMs(): number {
    const durations = this.db
      .select({ durationMs: reviewEventTable.durationMs })
      .from(reviewEventTable)
      .orderBy(desc(reviewEventTable.reviewedAt))
      .limit(50)
      .all()
      .map(({ durationMs }) => durationMs)
      .filter((durationMs) => durationMs > 0 && durationMs <= 10 * 60_000)
      .sort((a, b) => a - b)
    if (durations.length === 0) return 20_000
    const middle = Math.floor(durations.length / 2)
    return durations.length % 2 === 0 ? (durations[middle - 1] + durations[middle]) / 2 : durations[middle]
  }

  private getIntroducedTodayCount(startOfToday: Date): number {
    const [{ count }] = this.db
      .select({ count: sql<number>`count(distinct ${reviewEventTable.cardId})` })
      .from(reviewEventTable)
      .where(
        and(
          gte(reviewEventTable.reviewedAt, startOfToday.getTime()),
          sql`json_extract(${reviewEventTable.previousState}, '$.phase') = 'new'`
        )
      )
      .all()
    return count
  }

  private notifyReviewChanged(cardIds: string[]): void {
    notifyDataApiDataChange([
      { endpoint: '/english-learning/reviews/today', kind: 'projection', entityIds: cardIds },
      { endpoint: '/english-learning/dashboard' }
    ])
  }
}

export const reviewService = new ReviewService()
