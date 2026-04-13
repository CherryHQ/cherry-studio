import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { assistantTable } from './assistant'
import { knowledgeBaseTable } from './knowledge'
import { mcpServerTable } from './mcpServer'

// NOTE: assistant-model relationship is 1:1 (default model) stored as assistant.modelId.
// Multi-model (@mention) list is ephemeral UI state stored in persist-cache.

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
    ...createUpdateTimestamps
  },
  (t) => [primaryKey({ columns: [t.assistantId, t.mcpServerId] })]
)

/**
 * Assistant-KnowledgeBase junction table
 *
 * Associates assistants with knowledge bases.
 * Both sides CASCADE: deleting either removes the association.
 */
export const assistantKnowledgeBaseTable = sqliteTable(
  'assistant_knowledge_base',
  {
    assistantId: text()
      .notNull()
      .references(() => assistantTable.id, { onDelete: 'cascade' }),
    knowledgeBaseId: text()
      .notNull()
      .references(() => knowledgeBaseTable.id, { onDelete: 'cascade' }),
    ...createUpdateTimestamps
  },
  (t) => [primaryKey({ columns: [t.assistantId, t.knowledgeBaseId] })]
)
