import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { loggerService } from '@logger'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'

const logger = loggerService.withContext('remapAgentPrefixIds')

/** Remap old prefix IDs and hardcoded builtin IDs to UUID v4, updating all FK references.
 *  Uses manual BEGIN/COMMIT (not db.transaction()) so PRAGMA foreign_keys = OFF and all
 *  DML share the same connection — db.transaction() may open a fresh connection in libsql.
 *  Idempotent. */
export async function remapAgentPrefixIds(db: MigrationContext['db']): Promise<void> {
  // PRAGMA foreign_keys cannot be changed inside a transaction; must be set before BEGIN.
  await db.run(sql.raw('PRAGMA foreign_keys = OFF'))
  let committed = false
  let pendingError: unknown = null
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

    // Final FK integrity check inside the FK=OFF window: if any FK update missed
    // rows we'd otherwise commit a corrupted state and re-enable FKs as if all
    // were well. PRAGMA foreign_key_check returns one row per violation; an empty
    // result means every (table, rowid, parent, fkid) tuple satisfies its FK.
    const fkViolations = await db.all<{
      table: string
      rowid: number | null
      parent: string
      fkid: number
    }>(sql.raw('PRAGMA foreign_key_check'))
    if (fkViolations.length > 0) {
      throw new Error(
        `remapAgentPrefixIds left ${fkViolations.length} foreign-key violation(s): ` +
          fkViolations
            .slice(0, 5)
            .map((v) => `${v.table}->${v.parent} (rowid=${v.rowid})`)
            .join(', ')
      )
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
    pendingError = error
  }

  try {
    await db.run(sql.raw('PRAGMA foreign_keys = ON'))
  } catch (pragmaError) {
    logger.error(
      'Failed to re-enable foreign_keys after remapAgentPrefixIds — aborting migration',
      pragmaError as Error
    )
    if (!pendingError) pendingError = pragmaError
  }

  if (pendingError) throw pendingError
}
