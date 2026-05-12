import type { ContextSettingsOverride } from '@shared/data/types/contextSettings'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, orderKeyColumns, scopedOrderKeyIndex, uuidPrimaryKey } from './_columnHelpers'
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
    /**
     * Absolute filesystem path the topic is bound to.
     */
    workspaceRoot: text(),

    // FK to group table for organization
    // SET NULL: preserve topic when group is deleted
    groupId: text().references(() => groupTable.id, { onDelete: 'set null' }),

    // Fractional-indexing order key, partitioned by groupId.
    ...orderKeyColumns,

    /**
     * Per-topic override for context settings (chef).
     * NULL/missing = inherit fully from assistant (then global).
     * Stored as partial JSON so individual fields can be overridden
     * while others inherit.
     */
    contextSettings: text({ mode: 'json' }).$type<ContextSettingsOverride>(),

    ...createUpdateDeleteTimestamps
  },
  (t) => [
    index('topic_group_updated_idx').on(t.groupId, t.updatedAt),
    index('topic_updated_at_idx').on(t.updatedAt),
    scopedOrderKeyIndex('topic', 'groupId')(t),
    index('topic_assistant_id_idx').on(t.assistantId)
  ]
)
