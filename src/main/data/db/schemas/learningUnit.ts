import type { LearningDedupDecision, LearningUnitKind } from '@shared/data/types/englishLearning'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { learningSourceTable } from './learningSource'

export const learningUnitTable = sqliteTable(
  'learning_unit',
  {
    id: uuidPrimaryKeyOrdered(),
    kind: text().$type<LearningUnitKind>().notNull(),
    english: text().notNull(),
    normalizedEnglish: text().notNull(),
    meaning: text().notNull(),
    usageNote: text(),
    example: text(),
    tags: text({ mode: 'json' }).$type<string[]>().notNull().default([]),
    cefr: text(),
    exactHash: text().notNull(),
    extractionConfidence: real(),
    isUserEdited: integer({ mode: 'boolean' }).notNull().default(false),
    suspended: integer({ mode: 'boolean' }).notNull().default(false),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('learning_unit_exact_hash_uq').on(t.exactHash),
    index('learning_unit_kind_updated_at_idx').on(t.kind, t.updatedAt)
  ]
)

export const learningUnitSourceTable = sqliteTable(
  'learning_unit_source',
  {
    learningUnitId: text()
      .notNull()
      .references(() => learningUnitTable.id, { onDelete: 'cascade' }),
    learningSourceId: text()
      .notNull()
      .references(() => learningSourceTable.id, { onDelete: 'cascade' }),
    createdAt: integer().notNull().$defaultFn(Date.now)
  },
  (t) => [
    primaryKey({ columns: [t.learningUnitId, t.learningSourceId] }),
    index('learning_unit_source_source_id_idx').on(t.learningSourceId)
  ]
)

export const learningUnitDedupDecisionTable = sqliteTable(
  'learning_unit_dedup_decision',
  {
    id: uuidPrimaryKeyOrdered(),
    learningSourceId: text().references(() => learningSourceTable.id, { onDelete: 'set null' }),
    matchedUnitId: text().references(() => learningUnitTable.id, { onDelete: 'set null' }),
    resultingUnitId: text().references(() => learningUnitTable.id, { onDelete: 'set null' }),
    candidateEnglish: text().notNull(),
    candidateMeaning: text().notNull(),
    candidateHash: text().notNull(),
    decision: text().$type<LearningDedupDecision>().notNull(),
    confidence: real().notNull(),
    modelId: text().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('learning_unit_dedup_source_candidate_uq').on(t.learningSourceId, t.candidateHash),
    index('learning_unit_dedup_source_id_idx').on(t.learningSourceId),
    index('learning_unit_dedup_resulting_unit_id_idx').on(t.resultingUnitId)
  ]
)

export type LearningUnitRow = typeof learningUnitTable.$inferSelect
export type InsertLearningUnitRow = typeof learningUnitTable.$inferInsert
export type LearningUnitSourceRow = typeof learningUnitSourceTable.$inferSelect
export type LearningUnitDedupDecisionRow = typeof learningUnitDedupDecisionTable.$inferSelect
