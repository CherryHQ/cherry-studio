import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { LocalAgentAccount, LocalAgentConfiguration, LocalAgentModelSelection } from '@shared/ai/localAgent'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'

export const agentProviderTable = sqliteTable(
  'agent_provider',
  {
    id: uuidPrimaryKey(),
    presetId: text().$type<LocalAgentConfiguration['presetId']>(),
    executable: text(),
    args: text({ mode: 'json' }).$type<LocalAgentConfiguration['args']>(),
    env: text({ mode: 'json' }).$type<LocalAgentConfiguration['env']>(),
    encryptedEnv: text(),
    account: text({ mode: 'json' }).$type<LocalAgentAccount>(),
    ...createUpdateTimestamps
  },
  (table) => [
    check('agent_provider_launch_target_check', sql`${table.presetId} IS NOT NULL OR ${table.executable} IS NOT NULL`)
  ]
)

export const agentProviderBindingTable = sqliteTable(
  'agent_provider_binding',
  {
    agentId: text()
      .primaryKey()
      .references(() => agentTable.id, { onDelete: 'cascade' }),
    providerId: text()
      .notNull()
      .references(() => agentProviderTable.id, { onDelete: 'restrict' }),
    enabled: integer({ mode: 'boolean' }).notNull(),
    browserControl: text().$type<LocalAgentConfiguration['browserControl']>(),
    model: text({ mode: 'json' }).$type<LocalAgentModelSelection>().notNull()
  },
  (table) => [index('agent_provider_binding_provider_idx').on(table.providerId)]
)
