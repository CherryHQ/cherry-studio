import type { AssistantMeta } from '@shared/data/types/meta'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { groupTable } from './group'

/**
 * Topic table - stores conversation topics/threads
 *
 * Topics are containers for messages and belong to assistants.
 * They can be organized into groups and have tags for categorization.
 */
export const topicTable = sqliteTable(
  'topic',
  {
    id: uuidPrimaryKey(),
    name: text(),
    // Whether the name was manually edited by user
    isNameManuallyEdited: integer({ mode: 'boolean' }).default(false),
    // FK to assistant table
    assistantId: text(),
    // Preserved assistant info for display when assistant is deleted
    assistantMeta: text({ mode: 'json' }).$type<AssistantMeta>(),
    // Topic-specific prompt override
    prompt: text(),
    // Active node ID in the message tree
    activeNodeId: text(),

    // FK to group table for organization
    // SET NULL: preserve topic when group is deleted
    groupId: text().references(() => groupTable.id, { onDelete: 'set null' }),
    // Sort order within group
    sortOrder: integer().default(0),
    // Pinning state and order
    isPinned: integer({ mode: 'boolean' }).default(false),
    pinnedOrder: integer().default(0),

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
