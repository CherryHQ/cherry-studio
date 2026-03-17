import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'

/**
 * MCP Server table - stores user-configured MCP server definitions
 *
 * Migrated from Redux state.mcp.servers.
 * Runtime flags (isUvInstalled, isBunInstalled) are NOT migrated - they are
 * re-detected at startup and belong in CacheService.
 */
export const mcpServerTable = sqliteTable(
  'mcp_server',
  {
    id: text().primaryKey(),
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
    configSample: text({ mode: 'json' }),
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
  (t) => [index('mcp_server_name_idx').on(t.name), index('mcp_server_is_active_idx').on(t.isActive)]
)

export type McpServerInsert = typeof mcpServerTable.$inferInsert
export type McpServerSelect = typeof mcpServerTable.$inferSelect
