import type { TemporaryChatProvenance } from '@shared/data/api/schemas/temporaryChats'
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { messageTable } from './message'
import { topicTable } from './topic'

/**
 * Durable provenance for one batch promoted from a temporary chat.
 *
 * Aggregate topics contain many independent selection runs, so provenance
 * belongs to the message batch rather than the topic itself. The first-message
 * uniqueness constraint makes retry/replay idempotent.
 */
export const topicProvenanceTable = sqliteTable(
  'topic_provenance',
  {
    id: uuidPrimaryKeyOrdered(),
    topicId: text()
      .notNull()
      .references(() => topicTable.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    data: text({ mode: 'json' }).$type<TemporaryChatProvenance>().notNull(),
    firstMessageId: text()
      .notNull()
      .references(() => messageTable.id, { onDelete: 'cascade' }),
    lastMessageId: text()
      .notNull()
      .references(() => messageTable.id, { onDelete: 'cascade' }),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('topic_provenance_first_message_id_uq').on(t.firstMessageId),
    index('topic_provenance_topic_kind_idx').on(t.topicId, t.kind)
  ]
)

export type TopicProvenanceRow = typeof topicProvenanceTable.$inferSelect
export type InsertTopicProvenanceRow = typeof topicProvenanceTable.$inferInsert
