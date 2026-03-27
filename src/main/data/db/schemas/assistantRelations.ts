import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { assistantTable } from './assistant'
import { mcpServerTable } from './mcpServer'

/**
 * Assistant-Model junction table
 *
 * Associates assistants with models for multi-model parallel answering.
 * No FK on modelId yet - model table not merged.
 */
export const assistantModelTable = sqliteTable(
  'assistant_model',
  {
    assistantId: text()
      .notNull()
      .references(() => assistantTable.id, { onDelete: 'cascade' }),
    // TODO: Add FK to model table once merged — .references(() => modelTable.id, { onDelete: 'cascade' })
    modelId: text().notNull(),
    sortOrder: integer().default(0),
    ...createUpdateTimestamps
  },
  (t) => [primaryKey({ columns: [t.assistantId, t.modelId] })]
)

/**
 * Assistant-McpServer junction table
 *
 * Associates assistants with MCP servers.
 * Both sides CASCADE: deleting either removes the association.
 */
export const assistantMcpServerTable = sqliteTable(
  'assistant_mcp_server',
  {
    assistantId: text()
      .notNull()
      .references(() => assistantTable.id, { onDelete: 'cascade' }),
    mcpServerId: text()
      .notNull()
      .references(() => mcpServerTable.id, { onDelete: 'cascade' }),
    sortOrder: integer().default(0),
    ...createUpdateTimestamps
  },
  (t) => [primaryKey({ columns: [t.assistantId, t.mcpServerId] })]
)

/**
 * Assistant-KnowledgeBase junction table
 *
 * Associates assistants with knowledge bases.
 * No FK on knowledgeBaseId yet - knowledge_base table not created.
 */
export const assistantKnowledgeBaseTable = sqliteTable(
  'assistant_knowledge_base',
  {
    assistantId: text()
      .notNull()
      .references(() => assistantTable.id, { onDelete: 'cascade' }),
    // TODO: Add FK to knowledge_base table once created — .references(() => knowledgeBaseTable.id, { onDelete: 'cascade' })
    knowledgeBaseId: text().notNull(),
    sortOrder: integer().default(0),
    ...createUpdateTimestamps
  },
  (t) => [primaryKey({ columns: [t.assistantId, t.knowledgeBaseId] })]
)
