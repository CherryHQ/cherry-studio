import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentProviderTable } from './agentProvider'

export type AgentRuntimeLocator =
  | { version: 1; kind: 'local' }
  | { version: 1; kind: 'pi' }
  | { version: 1; kind: 'pi-durable'; fileName: string }
  | { version: 1; kind: 'claude-code'; configDir: string }

export const agentRuntimeBackendTable = sqliteTable(
  'agent_runtime_backend',
  {
    id: uuidPrimaryKey(),
    locator: text({ mode: 'json' }).$type<AgentRuntimeLocator>().notNull(),
    localProviderId: text().references(() => agentProviderTable.id, { onDelete: 'restrict' }),
    state: text({ enum: ['creating', 'bound'] }).notNull(),
    needsRecoveryCheck: integer({ mode: 'boolean' }).notNull().default(false),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_runtime_backend_recovery_idx')
      .on(t.id)
      .where(sql`${t.needsRecoveryCheck} = 1`),
    uniqueIndex('agent_runtime_backend_locator_uniq')
      .on(t.locator)
      .where(sql`json_extract(${t.locator}, '$.kind') <> 'local'`),
    uniqueIndex('agent_runtime_backend_provider_uniq').on(t.localProviderId),
    check('agent_runtime_backend_state_check', sql`${t.state} IN ('creating', 'bound')`)
  ]
)

export type AgentRuntimeBackendRow = typeof agentRuntimeBackendTable.$inferSelect
