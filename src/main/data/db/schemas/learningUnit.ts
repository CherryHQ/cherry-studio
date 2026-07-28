import type { LearningUnitKind } from '@shared/data/types/englishLearning'
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

export type LearningUnitRow = typeof learningUnitTable.$inferSelect
export type InsertLearningUnitRow = typeof learningUnitTable.$inferInsert
export type LearningUnitSourceRow = typeof learningUnitSourceTable.$inferSelect
