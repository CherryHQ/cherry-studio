import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable, agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { loggerService } from '@logger'
import { eq, sql } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { v4 as uuidv4 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'

const logger = loggerService.withContext('remapAgentPrefixIds')

/**
 * Every agent-domain table this remap touches. AgentsMigrator passes these to
 * `assertOwnedForeignKeys()` to verify agent-domain referential integrity once the
 * remap completes — keeping the FK self-check scoped to exactly the tables this
 * function rewrites.
 */
export const AGENT_TABLES: SQLiteTable[] = [
  agentTable,
  agentSessionTable,
  agentSkillTable,
  agentChannelTable,
  agentSessionMessageTable,
  agentChannelTaskTable,
  agentMcpServerTable
]

/**
 * Remap old prefix IDs and hardcoded builtin IDs to UUID v4, updating all FK references.
 *
 * Runs inside AgentsMigrator's ATTACH window, so it uses manual BEGIN/COMMIT — never
 * `db.transaction()`, which would swap to a fresh libsql connection, making `agents_legacy`
 * invisible and breaking the subsequent DETACH. Foreign keys are already OFF for the entire
 * migration (MigrationDbService registers `foreign_keys = OFF` via setPragma), so this does
 * not toggle FK itself; AgentsMigrator asserts agent-domain FK integrity via
 * `assertOwnedForeignKeys(AGENT_TABLES)` after this returns. Idempotent.
 */
export async function remapAgentPrefixIds(db: MigrationContext['db']): Promise<void> {
  let committed = false
  try {
    await db.run(sql.raw('BEGIN'))

    const oldAgents = await db
      .select({ id: agentTable.id })
      .from(agentTable)
      .where(
        sql`${agentTable.id} GLOB 'agent_*' OR ${agentTable.id} = 'cherry-claw-default' OR ${agentTable.id} = 'cherry-assistant-default'`
      )

    for (const { id: oldId } of oldAgents) {
      const newId = uuidv4()
      await db.update(agentTable).set({ id: newId }).where(eq(agentTable.id, oldId))
      await db.update(agentSessionTable).set({ agentId: newId }).where(eq(agentSessionTable.agentId, oldId))
      await db.update(agentSkillTable).set({ agentId: newId }).where(eq(agentSkillTable.agentId, oldId))
      await db.update(agentChannelTable).set({ agentId: newId }).where(eq(agentChannelTable.agentId, oldId))
      await db.update(agentMcpServerTable).set({ agentId: newId }).where(eq(agentMcpServerTable.agentId, oldId))
      // job_schedule.jobInputTemplate is a JSON column carrying the same agent_id
      // for migrated agent.task schedules. json_set rewrites it atomically so
      // post-remap reads see the new id consistently with agent.id above.
      await db.run(sql`
        UPDATE job_schedule
        SET job_input_template = json_set(job_input_template, '$.agentId', ${newId})
        WHERE type = 'agent.task'
          AND json_extract(job_input_template, '$.agentId') = ${oldId}
      `)
    }
    // agent_task is dropped in v2 — its rows are migrated into jobScheduleTable
    // by AgentsMigrator's TS-loop, which writes fresh UUIDs straight away. No
    // prefix-id remap needed for the schedule rows or the agent_channel_task
    // link rows (the TS-loop populates them with the new schedule ids).

    const oldSessions = await db
      .select({ id: agentSessionTable.id })
      .from(agentSessionTable)
      .where(sql`${agentSessionTable.id} GLOB 'session_*'`)

    for (const { id: oldId } of oldSessions) {
      const newId = uuidv4()
      await db.update(agentSessionTable).set({ id: newId }).where(eq(agentSessionTable.id, oldId))
      await db
        .update(agentSessionMessageTable)
        .set({ sessionId: newId })
        .where(eq(agentSessionMessageTable.sessionId, oldId))
      await db.update(agentChannelTable).set({ sessionId: newId }).where(eq(agentChannelTable.sessionId, oldId))
    }

    await db.run(sql.raw('COMMIT'))
    committed = true
  } catch (error) {
    if (!committed) {
      try {
        await db.run(sql.raw('ROLLBACK'))
      } catch (rollbackError) {
        logger.error(
          'ROLLBACK failed in remapAgentPrefixIds — DB may be in an inconsistent state',
          rollbackError as Error
        )
      }
    }
    throw error
  }
}
