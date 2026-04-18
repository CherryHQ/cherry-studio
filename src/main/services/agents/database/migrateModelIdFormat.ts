/**
 * Migration: Convert model IDs from "providerId:modelId" to UniqueModelId "providerId::modelId".
 *
 * Affects: agents.model, agents.plan_model, agents.small_model,
 *          sessions.model, sessions.plan_model, sessions.small_model
 *
 * Skips values that already contain "::" (already migrated).
 * Replaces the first ":" with "::" using SQLite string functions.
 */

import { loggerService } from '@logger'
import { sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import type * as schema from './schema'

const logger = loggerService.withContext('MigrateModelIdFormat')

export interface ModelIdMigrationResult {
  agentsUpdated: number
  sessionsUpdated: number
}

/**
 * SQL expression: replace first ":" with "::" in a column.
 * Only updates rows where column contains ":" but not "::" (not yet migrated).
 */
function buildMigrateSql(table: string, col: string) {
  return sql.raw(
    `UPDATE ${table}
     SET ${col} = SUBSTR(${col}, 1, INSTR(${col}, ':') - 1) || '::' || SUBSTR(${col}, INSTR(${col}, ':') + 1),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE ${col} IS NOT NULL
       AND ${col} != ''
       AND ${col} LIKE '%:%'
       AND ${col} NOT LIKE '%::%'`
  )
}

export async function runModelIdFormatMigration(
  database: LibSQLDatabase<typeof schema>
): Promise<ModelIdMigrationResult> {
  const result: ModelIdMigrationResult = { agentsUpdated: 0, sessionsUpdated: 0 }

  for (const col of ['model', 'plan_model', 'small_model']) {
    const agentRes = await database.run(buildMigrateSql('agents', col))
    const agentCount = agentRes.rowsAffected
    if (agentCount > 0) {
      logger.info(`Migrated ${agentCount} agents.${col} values`)
      result.agentsUpdated += agentCount
    }

    const sessionRes = await database.run(buildMigrateSql('sessions', col))
    const sessionCount = sessionRes.rowsAffected
    if (sessionCount > 0) {
      logger.info(`Migrated ${sessionCount} sessions.${col} values`)
      result.sessionsUpdated += sessionCount
    }
  }

  logger.info('Model ID format migration complete', result)
  return result
}
