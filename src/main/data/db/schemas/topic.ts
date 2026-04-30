import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { assistantTable } from './assistant'
import { groupTable } from './group'

/**
 * Topic table - stores conversation topics/threads
 *
 * Topics are containers for messages and reference assistants via FK.
 * They can be organized into groups.
 */
export const topicTable = sqliteTable(
  'topic',
  {
    id: uuidPrimaryKey(),
    name: text().notNull().default(''),
    // Whether the name was manually edited by user
    isNameManuallyEdited: integer({ mode: 'boolean' }).notNull().default(false),
    // FK to assistant table - "last used assistant"
    // SET NULL: preserve topic when assistant is deleted
    assistantId: text().references(() => assistantTable.id, { onDelete: 'set null' }),
    // Active node ID in the message tree
    activeNodeId: text(),

    // FK to group table for organization
    // SET NULL: preserve topic when group is deleted
    groupId: text().references(() => groupTable.id, { onDelete: 'set null' }),
    // Sort order within group
    sortOrder: integer().notNull().default(0),
    // Pinning state and order
    isPinned: integer({ mode: 'boolean' }).notNull().default(false),
    pinnedOrder: integer().notNull().default(0),

    ...createUpdateDeleteTimestamps
  },
  (t) => [
    index('topic_group_updated_idx').on(t.groupId, t.updatedAt),
    index('topic_group_sort_idx').on(t.groupId, t.sortOrder),
    index('topic_updated_at_idx').on(t.updatedAt),
    index('topic_is_pinned_idx').on(t.isPinned, t.pinnedOrder),
    index('topic_assistant_id_idx').on(t.assistantId)
  ]
)
