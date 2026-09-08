import { sql } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { v5 as uuidv5 } from 'uuid'

import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable, agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { loggerService } from '@logger'

import type { MigrationContext } from '../core/MigrationContext'

const logger = loggerService.withContext('remapAgentPrefixIds')

function migrationUuid(kind: 'agent' | 'session', legacyId: string): string {
  return uuidv5(`cherry-studio:v2:${kind}:${legacyId}`, uuidv5.URL)
}

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

export interface AgentPrefixIdRemap {
  agentIds: Map<string, string>
  sessionIds: Map<string, string>
}

/**
 * Remap old prefix IDs and hardcoded builtin IDs to deterministic UUIDs,
 * updating all FK references. Stable IDs make filesystem migration retryable:
 * a rerun after the database is cleared resolves to the same managed paths.
 *
 * Runs inside AgentsMigrator's ATTACH window, so it uses manual BEGIN/COMMIT to keep every
 * statement on the same connection that holds `agents_legacy` attached, bracketed by the
 * surrounding ATTACH/DETACH. Foreign keys are already OFF for the entire
 * migration (MigrationDbService sets `foreign_keys = OFF` once on its single connection), so this does
 * not toggle FK itself; AgentsMigrator asserts agent-domain FK integrity via
 * `assertOwnedForeignKeys(AGENT_TABLES)` after this returns. Idempotent.
 */
export function remapAgentPrefixIds(db: MigrationContext['db']): AgentPrefixIdRemap {
  const startedAt = performance.now()
  const agentIds = new Map<string, string>()
  const sessionIds = new Map<string, string>()
  let committed = false
  try {
    db.run(sql.raw('BEGIN'))
    db.run(
      sql.raw('CREATE TEMP TABLE IF NOT EXISTS agent_id_remap (old_id TEXT PRIMARY KEY, new_id TEXT NOT NULL UNIQUE)')
    )
    db.run(
      sql.raw(
        'CREATE TEMP TABLE IF NOT EXISTS agent_session_id_remap (old_id TEXT PRIMARY KEY, new_id TEXT NOT NULL UNIQUE)'
      )
    )
    db.run(sql.raw('DELETE FROM agent_id_remap'))
    db.run(sql.raw('DELETE FROM agent_session_id_remap'))

    const oldAgents = db
      .select({ id: agentTable.id })
      .from(agentTable)
      .where(
        sql`${agentTable.id} GLOB 'agent_*' OR ${agentTable.id} = 'cherry-claw-default' OR ${agentTable.id} = 'cherry-assistant-default'`
      )
      .all()

    for (const { id: oldId } of oldAgents) {
      const newId = migrationUuid('agent', oldId)
      agentIds.set(oldId, newId)
      db.run(sql`INSERT INTO agent_id_remap (old_id, new_id) VALUES (${oldId}, ${newId})`)
    }

    db.run(
      sql.raw(`UPDATE agent
        SET id = (SELECT new_id FROM agent_id_remap WHERE old_id = agent.id)
        WHERE EXISTS (SELECT 1 FROM agent_id_remap WHERE old_id = agent.id)`)
    )
    for (const table of ['agent_session', 'agent_skill', 'agent_channel', 'agent_mcp_server']) {
      db.run(
        sql.raw(`UPDATE ${table}
          SET agent_id = (SELECT new_id FROM agent_id_remap WHERE old_id = ${table}.agent_id)
          WHERE EXISTS (SELECT 1 FROM agent_id_remap WHERE old_id = ${table}.agent_id)`)
      )
    }
    db.run(
      sql.raw(`UPDATE agent_session_message
        SET message_snapshot = json_set(
          message_snapshot,
          '$.id',
          (SELECT new_id FROM agent_id_remap WHERE old_id = json_extract(message_snapshot, '$.id'))
        )
        WHERE EXISTS (
          SELECT 1 FROM agent_id_remap WHERE old_id = json_extract(message_snapshot, '$.id')
        )`)
    )
    // job_schedule.jobInputTemplate is a JSON column carrying the same agent_id
    // for migrated agent.task schedules. The mapping join rewrites every task
    // row in one scan so post-remap reads stay consistent with agent.id.
    db.run(
      sql.raw(`UPDATE job_schedule
        SET job_input_template = json_set(
          job_input_template,
          '$.agentId',
          (SELECT new_id FROM agent_id_remap WHERE old_id = json_extract(job_input_template, '$.agentId'))
        )
        WHERE type = 'agent.task'
          AND EXISTS (
            SELECT 1 FROM agent_id_remap WHERE old_id = json_extract(job_input_template, '$.agentId')
          )`)
    )
    // agent_task is dropped in v2 — its rows are migrated into jobScheduleTable
    // by AgentsMigrator's TS-loop, which writes fresh UUIDs straight away. No
    // prefix-id remap needed for the schedule rows or the agent_channel_task
    // link rows (the TS-loop populates them with the new schedule ids).

    const oldSessions = db
      .select({ id: agentSessionTable.id })
      .from(agentSessionTable)
      .where(sql`${agentSessionTable.id} GLOB 'session_*'`)
      .all()

    for (const { id: oldId } of oldSessions) {
      const newId = migrationUuid('session', oldId)
      sessionIds.set(oldId, newId)
      db.run(sql`INSERT INTO agent_session_id_remap (old_id, new_id) VALUES (${oldId}, ${newId})`)
    }

    db.run(
      sql.raw(`UPDATE agent_session
        SET id = (SELECT new_id FROM agent_session_id_remap WHERE old_id = agent_session.id)
        WHERE EXISTS (SELECT 1 FROM agent_session_id_remap WHERE old_id = agent_session.id)`)
    )
    for (const table of ['agent_session_message', 'agent_channel']) {
      db.run(
        sql.raw(`UPDATE ${table}
          SET session_id = (SELECT new_id FROM agent_session_id_remap WHERE old_id = ${table}.session_id)
          WHERE EXISTS (SELECT 1 FROM agent_session_id_remap WHERE old_id = ${table}.session_id)`)
      )
    }

    db.run(sql.raw('DROP TABLE agent_session_id_remap'))
    db.run(sql.raw('DROP TABLE agent_id_remap'))
    db.run(sql.raw('COMMIT'))
    committed = true
  } catch (error) {
    if (!committed) {
      try {
        db.run(sql.raw('ROLLBACK'))
      } catch (rollbackError) {
        logger.error(
          'ROLLBACK failed in remapAgentPrefixIds — DB may be in an inconsistent state',
          rollbackError as Error
        )
      }
    }
    throw error
  }
  logger.info('Remapped legacy Agent and Session ids with temporary mapping tables', {
    agents: agentIds.size,
    sessions: sessionIds.size,
    durationMs: Math.round(performance.now() - startedAt)
  })
  return { agentIds, sessionIds }
}
