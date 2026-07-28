import type { ReviewCardDirection, ReviewStatePhase } from '@shared/data/types/englishLearning'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { learningUnitTable } from './learningUnit'

export const reviewCardTable = sqliteTable(
  'review_card',
  {
    id: uuidPrimaryKeyOrdered(),
    learningUnitId: text()
      .notNull()
      .references(() => learningUnitTable.id, { onDelete: 'cascade' }),
    direction: text().$type<ReviewCardDirection>().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('review_card_unit_direction_uq').on(t.learningUnitId, t.direction),
    index('review_card_unit_id_idx').on(t.learningUnitId)
  ]
)

export const reviewStateTable = sqliteTable(
  'review_state',
  {
    cardId: text()
      .primaryKey()
      .references(() => reviewCardTable.id, { onDelete: 'cascade' }),
    dueAt: integer().notNull(),
    stability: real().notNull(),
    difficulty: real().notNull(),
    elapsedDays: integer().notNull(),
    scheduledDays: integer().notNull(),
    reps: integer().notNull(),
    lapses: integer().notNull(),
    learningSteps: integer().notNull(),
    phase: text().$type<ReviewStatePhase>().notNull(),
    lastReviewAt: integer(),
    suspended: integer({ mode: 'boolean' }).notNull().default(false),
    ...createUpdateTimestamps
  },
  (t) => [index('review_state_due_at_suspended_idx').on(t.dueAt, t.suspended)]
)

export type ReviewCardRow = typeof reviewCardTable.$inferSelect
export type InsertReviewCardRow = typeof reviewCardTable.$inferInsert
export type ReviewStateRow = typeof reviewStateTable.$inferSelect
export type InsertReviewStateRow = typeof reviewStateTable.$inferInsert
