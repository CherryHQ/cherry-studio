import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { LegacyAgentsDbReader } from '../utils/LegacyAgentsDbReader'
import { BaseMigrator } from './BaseMigrator'
import {
  AGENTS_TABLE_MIGRATION_SPECS,
  type AgentsTableRowCounts,
  buildAgentsImportStatements,
  getTotalAgentsRowCount
} from './mappings/AgentsDbMappings'

const logger = loggerService.withContext('AgentsMigrator')

export class AgentsMigrator extends BaseMigrator {
  readonly id = 'agents'
  readonly name = 'Agents'
  readonly description = 'Migrate legacy agents.db data into the main SQLite database'
  readonly order = 2.5

  private sourceCounts: AgentsTableRowCounts = this.createEmptyCounts()
  private sourceDbPath: string | null | undefined = undefined

  override reset(): void {
    this.sourceCounts = this.createEmptyCounts()
    this.sourceDbPath = undefined
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    const reader = this.createReader(ctx)
    const dbPath = this.resolveSourceDbPath(reader)

    if (!dbPath) {
      return {
        success: true,
        itemCount: 0,
        warnings: ['agents.db not found - no agents data to migrate']
      }
    }

    this.sourceCounts = await reader.countRows()

    return {
      success: true,
      itemCount: getTotalAgentsRowCount(this.sourceCounts)
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    const reader = this.createReader(ctx)
    const dbPath = this.resolveSourceDbPath(reader)

    if (!dbPath) {
      logger.info('No legacy agents.db found, skipping agents migration')
      return { success: true, processedCount: 0 }
    }

    if (getTotalAgentsRowCount(this.sourceCounts) === 0) {
      this.sourceCounts = await reader.countRows()
    }

    const statements = buildAgentsImportStatements(dbPath)
    const [attachStatement, ...remainingStatements] = statements
    let isAttached = false

    try {
      await ctx.db.run(sql.raw(attachStatement))
      isAttached = true

      for (const statement of remainingStatements.filter(
        (statement) => statement !== 'DETACH DATABASE agents_legacy'
      )) {
        await ctx.db.run(sql.raw(statement))
      }
    } finally {
      if (isAttached) {
        await ctx.db.run(sql.raw('DETACH DATABASE agents_legacy'))
      }
    }

    return {
      success: true,
      processedCount: getTotalAgentsRowCount(this.sourceCounts)
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const reader = this.createReader(ctx)
    const dbPath = this.resolveSourceDbPath(reader)

    if (!dbPath) {
      return {
        success: true,
        errors: [],
        stats: {
          sourceCount: 0,
          targetCount: 0,
          skippedCount: 0
        }
      }
    }

    if (getTotalAgentsRowCount(this.sourceCounts) === 0) {
      this.sourceCounts = await reader.countRows()
    }

    const errors: ValidationError[] = []
    let targetCount = 0

    for (const spec of AGENTS_TABLE_MIGRATION_SPECS) {
      const result = await ctx.db.get<{ count: number }>(sql.raw(`SELECT COUNT(*) AS count FROM ${spec.targetTable}`))
      const tableTargetCount = Number(result?.count ?? 0)
      const tableSourceCount = this.sourceCounts[spec.sourceTable]
      targetCount += tableTargetCount

      if (tableTargetCount < tableSourceCount) {
        errors.push({
          key: `${spec.targetTable}_count_mismatch`,
          expected: tableSourceCount,
          actual: tableTargetCount,
          message: `${spec.targetTable} count too low: expected ${tableSourceCount}, got ${tableTargetCount}`
        })
      }
    }

    return {
      success: errors.length === 0,
      errors,
      stats: {
        sourceCount: getTotalAgentsRowCount(this.sourceCounts),
        targetCount,
        skippedCount: 0,
        mismatchReason: errors.length > 0 ? 'One or more agents_* tables were not fully imported' : undefined
      }
    }
  }

  private createReader(ctx: MigrationContext): LegacyAgentsDbReader {
    return new LegacyAgentsDbReader(ctx.paths)
  }

  private resolveSourceDbPath(reader: LegacyAgentsDbReader): string | null {
    if (this.sourceDbPath !== undefined) {
      return this.sourceDbPath
    }

    this.sourceDbPath = reader.resolvePath()
    return this.sourceDbPath
  }

  private createEmptyCounts(): AgentsTableRowCounts {
    return {
      agents: 0,
      sessions: 0,
      skills: 0,
      scheduled_tasks: 0,
      task_run_logs: 0,
      channels: 0,
      channel_task_subscriptions: 0,
      session_messages: 0
    }
  }
}
