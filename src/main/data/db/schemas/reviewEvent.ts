import type { ReviewRating, SerializedReviewState } from '@shared/data/types/englishLearning'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { reviewCardTable } from './reviewCard'

export const reviewEventTable = sqliteTable(
  'review_event',
  {
    id: uuidPrimaryKeyOrdered(),
    cardId: text().references(() => reviewCardTable.id, { onDelete: 'set null' }),
    rating: text().$type<ReviewRating>().notNull(),
    reviewedAt: integer().notNull(),
    durationMs: integer().notNull(),
    previousState: text({ mode: 'json' }).$type<SerializedReviewState>().notNull(),
    nextState: text({ mode: 'json' }).$type<SerializedReviewState>().notNull(),
    clientMutationId: text().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('review_event_client_mutation_id_uq').on(t.clientMutationId),
    index('review_event_card_reviewed_at_idx').on(t.cardId, t.reviewedAt)
  ]
)

export type ReviewEventRow = typeof reviewEventTable.$inferSelect
export type InsertReviewEventRow = typeof reviewEventTable.$inferInsert
