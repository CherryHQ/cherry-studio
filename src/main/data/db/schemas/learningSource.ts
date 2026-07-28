import type { LearningSourceKind, LearningSourceStatus } from '@shared/data/types/englishLearning'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'

export const learningSourceTable = sqliteTable(
  'learning_source',
  {
    id: uuidPrimaryKeyOrdered(),
    kind: text().$type<LearningSourceKind>().notNull(),
    sourceRecordId: text().notNull(),
    sourceRevision: text().notNull(),
    status: text().$type<LearningSourceStatus>().notNull(),
    sourceLanguage: text(),
    targetLanguage: text(),
    sourceText: text().notNull(),
    targetText: text().notNull(),
    error: text(),
    processedAt: integer(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('learning_source_kind_record_revision_uq').on(t.kind, t.sourceRecordId, t.sourceRevision),
    index('learning_source_status_updated_at_idx').on(t.status, t.updatedAt)
  ]
)

export type LearningSourceRow = typeof learningSourceTable.$inferSelect
export type InsertLearningSourceRow = typeof learningSourceTable.$inferInsert
