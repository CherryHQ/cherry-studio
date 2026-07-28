import { application } from '@application'
import { learningSourceTable } from '@data/db/schemas/learningSource'
import { learningUnitTable } from '@data/db/schemas/learningUnit'
import { practiceSessionTable } from '@data/db/schemas/practiceSession'
import { reviewStateTable } from '@data/db/schemas/reviewCard'
import { reviewEventTable } from '@data/db/schemas/reviewEvent'
import type { EnglishLearningDashboard } from '@shared/data/api/schemas/englishLearning'
import type { LearningSourceStatus } from '@shared/data/types/englishLearning'
import { and, eq, gte, lte, sql } from 'drizzle-orm'

const SOURCE_STATUSES: LearningSourceStatus[] = ['pending', 'processing', 'ready', 'failed', 'excluded']

export class EnglishLearningDashboardService {
  get(): EnglishLearningDashboard {
    const db = application.get('DbService').getDb()
    const now = Date.now()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const startOfToday = today.getTime()

    const sourceRows = db
      .select({ status: learningSourceTable.status, count: sql<number>`count(*)` })
      .from(learningSourceTable)
      .groupBy(learningSourceTable.status)
      .all()
    const sources = Object.fromEntries(SOURCE_STATUSES.map((status) => [status, 0])) as Record<
      LearningSourceStatus,
      number
    >
    for (const row of sourceRows) sources[row.status] = row.count

    const unitCounts = db
      .select({
        total: sql<number>`count(*)`,
        suspended: sql<number>`sum(case when ${learningUnitTable.suspended} = 1 then 1 else 0 end)`
      })
      .from(learningUnitTable)
      .get()
    const dueNow = db
      .select({ count: sql<number>`count(*)` })
      .from(reviewStateTable)
      .where(and(lte(reviewStateTable.dueAt, now), eq(reviewStateTable.suspended, false)))
      .get()
    const reviewedToday = db
      .select({ count: sql<number>`count(*)` })
      .from(reviewEventTable)
      .where(gte(reviewEventTable.reviewedAt, startOfToday))
      .get()
    const practiceToday = db
      .select({ durationMs: sql<number>`coalesce(sum(${practiceSessionTable.durationMs}), 0)` })
      .from(practiceSessionTable)
      .where(gte(practiceSessionTable.startedAt, startOfToday))
      .get()

    return {
      sources,
      unitTotal: unitCounts?.total ?? 0,
      suspendedUnitTotal: unitCounts?.suspended ?? 0,
      dueNowTotal: dueNow?.count ?? 0,
      reviewedTodayTotal: reviewedToday?.count ?? 0,
      practiceMinutesToday: Math.round((practiceToday?.durationMs ?? 0) / 60_000)
    }
  }
}

export const englishLearningDashboardService = new EnglishLearningDashboardService()
