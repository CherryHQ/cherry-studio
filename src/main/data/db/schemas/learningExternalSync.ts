import type { LearningSyncState, LearningSyncTarget } from '@shared/data/types/englishLearning'
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { learningUnitTable } from './learningUnit'

export const learningExternalSyncTable = sqliteTable(
  'learning_external_sync',
  {
    id: uuidPrimaryKeyOrdered(),
    learningUnitId: text()
      .notNull()
      .references(() => learningUnitTable.id, { onDelete: 'cascade' }),
    target: text().$type<LearningSyncTarget>().notNull(),
    state: text().$type<LearningSyncState>().notNull(),
    externalPath: text(),
    sourceRevision: text().notNull(),
    syncedRevision: text(),
    error: text(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('learning_external_sync_unit_target_uq').on(t.learningUnitId, t.target),
    index('learning_external_sync_target_state_updated_at_idx').on(t.target, t.state, t.updatedAt)
  ]
)

export type LearningExternalSyncRow = typeof learningExternalSyncTable.$inferSelect
export type InsertLearningExternalSyncRow = typeof learningExternalSyncTable.$inferInsert
