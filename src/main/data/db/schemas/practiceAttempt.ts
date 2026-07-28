import type { PracticeFeedback } from '@shared/data/types/englishLearning'
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { learningUnitTable } from './learningUnit'
import { practiceSessionTable } from './practiceSession'

export const practiceAttemptTable = sqliteTable(
  'practice_attempt',
  {
    id: uuidPrimaryKeyOrdered(),
    practiceSessionId: text()
      .notNull()
      .references(() => practiceSessionTable.id, { onDelete: 'cascade' }),
    learningUnitId: text().references(() => learningUnitTable.id, { onDelete: 'set null' }),
    prompt: text().notNull(),
    transcript: text(),
    responseText: text(),
    feedback: text({ mode: 'json' }).$type<PracticeFeedback>().notNull().default({}),
    recognitionConfidence: real(),
    textSimilarity: real(),
    durationMs: integer().notNull().default(0),
    attemptedAt: integer().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('practice_attempt_session_attempted_at_idx').on(t.practiceSessionId, t.attemptedAt),
    index('practice_attempt_unit_id_idx').on(t.learningUnitId)
  ]
)

export type PracticeAttemptRow = typeof practiceAttemptTable.$inferSelect
export type InsertPracticeAttemptRow = typeof practiceAttemptTable.$inferInsert
