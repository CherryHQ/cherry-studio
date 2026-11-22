import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

import type { KnowledgeChunkGovernanceState } from '@shared/data/types/knowledgeChunkGovernance'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { knowledgeItemTable } from './knowledge'

export const knowledgeChunkGovernanceTable = sqliteTable(
  'knowledge_chunk_governance',
  {
    id: uuidPrimaryKey(),
    baseId: text().notNull(),
    itemId: text().notNull(),
    unitId: text().notNull(),
    retired: integer({ mode: 'boolean' }).notNull().default(false),
    sourceContentHash: text().notNull(),
    charStart: integer().notNull(),
    charEnd: integer().notNull(),
    originalText: text().notNull(),
    originalTextHash: text().notNull(),
    state: text({ mode: 'json' }).$type<KnowledgeChunkGovernanceState>().notNull(),
    revision: integer().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    foreignKey({
      columns: [t.baseId, t.itemId],
      foreignColumns: [knowledgeItemTable.baseId, knowledgeItemTable.id]
    }).onDelete('cascade'),
    unique('knowledge_chunk_governance_unit_unique').on(t.baseId, t.itemId, t.unitId),
    index('knowledge_chunk_governance_item_idx').on(t.baseId, t.itemId),
    check('knowledge_chunk_governance_offsets_check', sql`${t.charStart} >= 0 AND ${t.charEnd} > ${t.charStart}`),
    check('knowledge_chunk_governance_revision_check', sql`${t.revision} >= 1`),
    check('knowledge_chunk_governance_state_check', sql`json_valid(${t.state})`)
  ]
)

export const knowledgeChunkGovernanceHistoryTable = sqliteTable(
  'knowledge_chunk_governance_history',
  {
    id: uuidPrimaryKey(),
    operation: text({ enum: ['edit', 'discard', 'rebind-away', 'rebind-from', 'restore-discard'] })
      .notNull()
      .default('edit'),
    relatedGovernanceId: text(),
    governanceId: text()
      .notNull()
      .references(() => knowledgeChunkGovernanceTable.id, { onDelete: 'cascade' }),
    revision: integer().notNull(),
    state: text({ mode: 'json' }).$type<KnowledgeChunkGovernanceState>().notNull(),
    createdAt: integer()
      .notNull()
      .$defaultFn(() => Date.now())
  },
  (t) => [
    unique('knowledge_chunk_governance_history_revision_unique').on(t.governanceId, t.revision),
    check('knowledge_chunk_governance_history_revision_check', sql`${t.revision} >= 1`),
    check('knowledge_chunk_governance_history_state_check', sql`json_valid(${t.state})`)
  ]
)
