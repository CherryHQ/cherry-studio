import type { PracticeMode, PracticeSessionStatus } from '@shared/data/types/englishLearning'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'

export const practiceSessionTable = sqliteTable(
  'practice_session',
  {
    id: uuidPrimaryKeyOrdered(),
    mode: text().$type<PracticeMode>().notNull(),
    status: text().$type<PracticeSessionStatus>().notNull(),
    scenario: text(),
    modelId: text(),
    providerId: text(),
    startedAt: integer().notNull(),
    completedAt: integer(),
    durationMs: integer().notNull().default(0),
    error: text(),
    ...createUpdateTimestamps
  },
  (t) => [index('practice_session_started_at_idx').on(t.startedAt)]
)

export type PracticeSessionRow = typeof practiceSessionTable.$inferSelect
export type InsertPracticeSessionRow = typeof practiceSessionTable.$inferInsert
