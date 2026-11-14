import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { agentSessionTable } from './agentSession'
import { assistantTable } from './assistant'
import { topicTable } from './topic'

/**
 * Outputs of an Agent (files reported through `report_artifacts`, owned by a session) or of an
 * Assistant (images from `generate_image`, owned by a topic).
 */
export const artifactTable = sqliteTable(
  'artifact',
  {
    id: uuidPrimaryKey(),
    agentId: text().references(() => agentTable.id, { onDelete: 'cascade' }),
    sessionId: text().references(() => agentSessionTable.id, { onDelete: 'cascade' }),
    assistantId: text().references(() => assistantTable.id, { onDelete: 'cascade' }),
    topicId: text().references(() => topicTable.id, { onDelete: 'cascade' }),
    /** Absolute path of a file on disk; Agent outputs. */
    path: text(),
    /** Managed file; Assistant outputs. No FK: an output must not keep its file from cleanup, and a
     * removed file shows as unavailable (see persistentFileRefTablesBySourceType). */
    fileEntryId: text(),
    title: text().notNull(),
    kind: text({ enum: ['page', 'media', 'file'] }).notNull(),
    // Null when the size was unknown at report time.
    size: integer(),
    // Moves forward when a session reports the same path again.
    reportedAt: integer().notNull().$defaultFn(Date.now)
  },
  (t) => [
    uniqueIndex('artifact_session_path_uq').on(t.sessionId, t.path),
    index('artifact_agent_reported_idx').on(t.agentId, t.reportedAt),
    index('artifact_assistant_reported_idx').on(t.assistantId, t.reportedAt),
    index('artifact_topic_idx').on(t.topicId),
    index('artifact_file_entry_idx').on(t.fileEntryId),
    check('artifact_kind_check', sql`${t.kind} IN ('page', 'media', 'file')`),
    check(
      'artifact_owner_check',
      sql`(${t.agentId} IS NOT NULL AND ${t.sessionId} IS NOT NULL AND ${t.assistantId} IS NULL AND ${t.topicId} IS NULL AND ${t.path} IS NOT NULL AND ${t.fileEntryId} IS NULL) OR (${t.agentId} IS NULL AND ${t.sessionId} IS NULL AND ${t.assistantId} IS NOT NULL AND ${t.topicId} IS NOT NULL AND ${t.path} IS NULL AND ${t.fileEntryId} IS NOT NULL)`
    )
  ]
)

export type ArtifactRow = typeof artifactTable.$inferSelect
