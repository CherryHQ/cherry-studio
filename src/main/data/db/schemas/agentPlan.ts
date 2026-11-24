import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import type { AgentPlanState } from '@shared/data/api/schemas/agentPlans'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentSessionTable } from './agentSession'

export const agentPlanTable = sqliteTable('agent_plan', {
  id: uuidPrimaryKey(),
  sessionId: text()
    .notNull()
    .unique()
    .references(() => agentSessionTable.id, { onDelete: 'cascade' }),
  revision: integer().notNull(),
  state: text({ mode: 'json' }).$type<AgentPlanState>().notNull(),
  ...createUpdateTimestamps
})
export type AgentPlanRow = typeof agentPlanTable.$inferSelect

export const agentPlanHistoryTable = sqliteTable(
  'agent_plan_history',
  {
    id: uuidPrimaryKey(),
    planId: text()
      .notNull()
      .references(() => agentPlanTable.id, { onDelete: 'cascade' }),
    revision: integer().notNull(),
    state: text({ mode: 'json' }).$type<AgentPlanState>().notNull(),
    origin: text({ enum: ['user-edit'] }).notNull(),
    createdAt: createUpdateTimestamps.createdAt
  },
  (t) => [uniqueIndex('agent_plan_history_revision_uq').on(t.planId, t.revision)]
)

// Retain removed identities without reading every historical plan on each edit.
export const agentPlanStepIdentityTable = sqliteTable(
  'agent_plan_step_identity',
  {
    planId: text()
      .notNull()
      .references(() => agentPlanTable.id, { onDelete: 'cascade' }),
    stepId: text().notNull()
  },
  (t) => [primaryKey({ columns: [t.planId, t.stepId] })]
)
