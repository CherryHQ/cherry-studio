import type { MCPConfigSample } from '@types'
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * MCP Server table - stores user-configured MCP server definitions
 *
 * Migrated from Redux state.mcp.servers.
 * Runtime flags (isUvInstalled, isBunInstalled) are NOT migrated - they are
 * re-detected at runtime and stored via usePersistCache.
 */
export const mcpServerTable = sqliteTable(
  'mcp_server',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    type: text(),
    description: text(),
    baseUrl: text(),
    command: text(),
    registryUrl: text(),
    args: text({ mode: 'json' }).$type<string[]>(),
    env: text({ mode: 'json' }).$type<Record<string, string>>(),
    headers: text({ mode: 'json' }).$type<Record<string, string>>(),
    provider: text(),
    providerUrl: text(),
    logoUrl: text(),
    tags: text({ mode: 'json' }).$type<string[]>(),
    longRunning: integer({ mode: 'boolean' }),
    timeout: integer(),
    dxtVersion: text(),
    dxtPath: text(),
    reference: text(),
    searchKey: text(),
    configSample: text({ mode: 'json' }).$type<MCPConfigSample>(),
    disabledTools: text({ mode: 'json' }).$type<string[]>(),
    disabledAutoApproveTools: text({ mode: 'json' }).$type<string[]>(),
    shouldConfig: integer({ mode: 'boolean' }),
    isActive: integer({ mode: 'boolean' }).notNull().default(false),
    installSource: text(),
    isTrusted: integer({ mode: 'boolean' }),
    trustedAt: integer(),
    installedAt: integer(),

    ...createUpdateTimestamps
  },
  (t) => [
    index('mcp_server_name_idx').on(t.name),
    index('mcp_server_is_active_idx').on(t.isActive),
    check(
      'mcp_server_type_check',
      sql`${t.type} IS NULL OR ${t.type} IN ('stdio', 'sse', 'streamableHttp', 'inMemory')`
    ),
    check(
      'mcp_server_install_source_check',
      sql`${t.installSource} IS NULL OR ${t.installSource} IN ('builtin', 'manual', 'protocol', 'unknown')`
    )
  ]
)

export type McpServerInsert = typeof mcpServerTable.$inferInsert
export type McpServerSelect = typeof mcpServerTable.$inferSelect
