import type { Client } from '@libsql/client'
import { loggerService } from '@logger'
import { BackupDomain, ConflictStrategy } from '@shared/backup'
import { sql } from 'drizzle-orm'

import type { CancellationToken } from '../CancellationToken'
import { filterPreferences } from '../filters/PreferenceFilter'
import type { BackupProgressTracker } from '../progress/BackupProgressTracker'
import { DOMAIN_TABLE_MAP } from './DomainRegistry'
import type { IdRemapper } from './IdRemapper'

type SqlRunResult = { rowsAffected: number }

type SqlRunner = {
  run(query: ReturnType<typeof sql>): Promise<SqlRunResult>
  all(query: ReturnType<typeof sql>): Promise<unknown[]>
}

const logger = loggerService.withContext('DomainImporter')
const BATCH_SIZE = 500

const FK_REMAP_RULES: Record<string, string[]> = {
  topic: ['id', 'group_id', 'active_node_id', 'assistant_id'],
  message: ['id', 'parent_id', 'topic_id'],
  entity_tag: ['tag_id', 'entity_id'],
  knowledge_item: ['id', 'base_id', 'group_id'],
  tag: ['id'],
  group: ['id'],
  pin: ['id', 'entity_id'],
  translate_history: ['id'],
  knowledge_base: ['id'],
  mcp_server: ['id'],
  assistant: ['id'],
  assistant_mcp_server: ['assistant_id', 'mcp_server_id'],
  assistant_knowledge_base: ['assistant_id', 'knowledge_base_id'],
  agent: ['id'],
  agent_global_skill: ['id'],
  agent_channel: ['id', 'agent_id', 'session_id'],
  agent_skill: ['agent_id', 'skill_id'],
  agent_session: ['id', 'agent_id'],
  agent_task: ['id', 'agent_id'],
  agent_channel_task: ['channel_id', 'task_id'],
  agent_session_message: ['session_id', 'agent_session_id'],
  agent_task_run_log: ['task_id', 'session_id']
}

// Stripping only applies to RENAME: SKIP uses ON CONFLICT DO NOTHING (safe),
// OVERWRITE intentionally matches on the original PK to replace the row.
const AUTOINCREMENT_PK_TABLES = new Set(['agent_session_message', 'agent_task_run_log'])

// Tables with a UNIQUE non-PK column AND downstream FK references in FK_REMAP_RULES
// must have an entry here, otherwise RENAME inserts fail on the UNIQUE constraint
// and child FK references become dangling.
const UNIQUE_MERGE_RULES: Record<string, { column: string }> = {
  agent_global_skill: { column: 'folder_name' },
  tag: { column: 'name' }
}

export class DomainImporter {
  constructor(
    private readonly backupClient: Client,
    private readonly liveDb: SqlRunner & { transaction: (fn: (tx: SqlRunner) => Promise<void>) => Promise<void> },
    private readonly remapper: IdRemapper,
    private readonly progressTracker: BackupProgressTracker,
    private readonly token: CancellationToken
  ) {}

  async importDomain(
    domain: BackupDomain,
    strategy: ConflictStrategy
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    const tables = DOMAIN_TABLE_MAP[domain]
    if (!tables || tables.length === 0) {
      return { imported: 0, skipped: 0, errors: 0 }
    }

    if (domain === BackupDomain.PREFERENCES) {
      await filterPreferences(this.backupClient, this.token)
    }

    let totalImported = 0
    let totalSkipped = 0
    let totalErrors = 0

    await this.liveDb.transaction(async (tx: SqlRunner) => {
      for (const table of tables) {
        this.token.throwIfCancelled()
        const result = await this.importTable(tx, table, strategy)
        totalImported += result.imported
        totalSkipped += result.skipped
        totalErrors += result.errors
      }
    })

    logger.info('Domain import complete', {
      domain,
      imported: totalImported,
      skipped: totalSkipped,
      errors: totalErrors
    })
    return { imported: totalImported, skipped: totalSkipped, errors: totalErrors }
  }

  private async importTable(
    tx: SqlRunner,
    tableName: string,
    strategy: ConflictStrategy
  ): Promise<{ imported: number; skipped: number; errors: number }> {
    let offset = 0
    let imported = 0
    let skipped = 0
    let errors = 0
    const stripAutoIncrementPk = AUTOINCREMENT_PK_TABLES.has(tableName) && strategy === ConflictStrategy.RENAME

    while (true) {
      this.token.throwIfCancelled()
      const batch = await this.backupClient.execute({
        sql: `SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`,
        args: [BATCH_SIZE, offset]
      })
      if (batch.rows.length === 0) break

      const allColumns = Object.keys(batch.rows[0])
      const columns = stripAutoIncrementPk ? allColumns.filter((c) => c !== 'id') : allColumns
      const colList = columns.map((c) => `"${c}"`).join(', ')

      let conflictClause = ''
      if (strategy === ConflictStrategy.SKIP || strategy === ConflictStrategy.RENAME) {
        conflictClause = ' ON CONFLICT DO NOTHING'
      } else if (strategy === ConflictStrategy.OVERWRITE) {
        const updates = columns.map((c) => `"${c}" = excluded."${c}"`).join(', ')
        conflictClause = ` ON CONFLICT DO UPDATE SET ${updates}`
      }

      for (const row of batch.rows) {
        if (strategy === ConflictStrategy.RENAME) {
          const merged = await this.tryUniqueMerge(tx, tableName, row as Record<string, unknown>)
          if (merged) {
            skipped++
            continue
          }
        }

        let remapped = this.remapRow(tableName, row as Record<string, unknown>)

        if (tableName === 'user_provider' && strategy === ConflictStrategy.OVERWRITE) {
          remapped = await this.preserveProviderCredentials(tx, remapped)
        }

        const values = columns.map((c) => remapped[c] ?? null)
        const paramChunks = values.map((v) => sql`${v}`)
        const query = sql`INSERT INTO ${sql.raw(`"${tableName}"`)} (${sql.raw(colList)}) VALUES (${sql.join(paramChunks, sql.raw(', '))})${sql.raw(conflictClause)}`

        try {
          const result = await tx.run(query)
          const affected = result.rowsAffected
          if (affected > 0) {
            imported++
          } else {
            skipped++
          }
        } catch (err) {
          if (strategy === ConflictStrategy.SKIP) {
            skipped++
          } else {
            errors++
            logger.warn('Row insert failed', { table: tableName, error: (err as Error).message })
          }
        }
      }

      offset += BATCH_SIZE
      this.progressTracker.incrementItemsProcessed(batch.rows.length)
    }

    return { imported, skipped, errors }
  }

  private remapRow(tableName: string, row: Record<string, unknown>): Record<string, unknown> {
    const cols = FK_REMAP_RULES[tableName]
    if (!cols) return { ...row }
    const result = { ...row }
    for (const col of cols) {
      if (result[col] && typeof result[col] === 'string') {
        result[col] = this.remapper.remap(result[col])
      }
    }
    return result
  }

  private async tryUniqueMerge(tx: SqlRunner, tableName: string, row: Record<string, unknown>): Promise<boolean> {
    const rule = UNIQUE_MERGE_RULES[tableName]
    if (!rule) return false

    const uniqueValue = row[rule.column]
    if (uniqueValue == null) return false

    const existing = await tx.all(
      sql`SELECT id FROM ${sql.raw(`"${tableName}"`)} WHERE ${sql.raw(`"${rule.column}"`)} = ${uniqueValue as string}`
    )
    if (existing.length === 0) return false

    const liveId = (existing[0] as { id: string }).id
    const backupId = row.id as string
    if (backupId && liveId !== backupId) {
      this.remapper.addMapping(backupId, liveId)
      logger.info('UNIQUE merge: mapped backup row to existing live record', {
        table: tableName,
        column: rule.column,
        backupId,
        liveId
      })
    }
    return true
  }

  private async preserveProviderCredentials(
    tx: SqlRunner,
    row: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const providerId = row.provider_id
    if (!providerId) return row

    try {
      const existing = await tx.all(
        sql`SELECT api_keys, auth_config FROM ${sql.raw('"user_provider"')} WHERE provider_id = ${providerId as string}`
      )
      if (existing.length > 0) {
        const local = existing[0] as Record<string, unknown>
        return { ...row, api_keys: local.api_keys, auth_config: local.auth_config }
      }
    } catch {
      // No existing record, proceed with backup values
    }
    return row
  }
}
