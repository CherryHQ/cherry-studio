import { sql } from 'drizzle-orm'
import { check, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

export type AgentRuntimeLocator = { version: 1; kind: 'pi' } | { version: 1; kind: 'pi-durable'; fileName: string }

export const agentRuntimeBackendTable = sqliteTable(
  'agent_runtime_backend',
  {
    id: uuidPrimaryKey(),
    locator: text({ mode: 'json' }).$type<AgentRuntimeLocator>().notNull(),
    state: text({ enum: ['creating', 'bound'] }).notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('agent_runtime_backend_locator_uniq').on(t.locator),
    check('agent_runtime_backend_state_check', sql`${t.state} IN ('creating', 'bound')`)
  ]
)

export type AgentRuntimeBackendRow = typeof agentRuntimeBackendTable.$inferSelect
