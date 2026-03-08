/**
 * MCP Server migrator - migrates MCP servers from Redux to SQLite
 *
 * Data source: Redux mcp slice (state.mcp.servers)
 * Target table: mcp_server
 *
 * Skipped fields (runtime/cache, re-detected at startup):
 * - isUvInstalled
 * - isBunInstalled
 */

import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import { type McpServerRow, transformMcpServer } from './mappings/McpServerMappings'

const logger = loggerService.withContext('McpServerMigrator')

export class McpServerMigrator extends BaseMigrator {
  readonly id = 'mcp_server'
  readonly name = 'MCP Server'
  readonly description = 'Migrate MCP server configurations from Redux to SQLite'
  readonly order = 2

  private preparedRows: McpServerRow[] = []
  private skippedCount = 0

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    this.preparedRows = []
    this.skippedCount = 0
    const warnings: string[] = []

    const servers = ctx.sources.reduxState.get<unknown[]>('mcp', 'servers') ?? []

    if (!Array.isArray(servers)) {
      logger.warn('mcp.servers is not an array, skipping')
      return { success: true, itemCount: 0, warnings: ['mcp.servers is not an array'] }
    }

    const seenIds = new Set<string>()

    for (const server of servers) {
      const s = server as Record<string, unknown>

      if (!s.id || typeof s.id !== 'string') {
        this.skippedCount++
        warnings.push(`Skipped server without valid id: ${s.name ?? 'unknown'}`)
        continue
      }

      if (seenIds.has(s.id)) {
        this.skippedCount++
        warnings.push(`Skipped duplicate server id: ${s.id}`)
        continue
      }
      seenIds.add(s.id)

      try {
        this.preparedRows.push(transformMcpServer(s))
      } catch (err) {
        this.skippedCount++
        warnings.push(`Failed to transform server ${s.id}: ${(err as Error).message}`)
        logger.warn(`Skipping server ${s.id}`, err as Error)
      }
    }

    logger.info('Preparation completed', {
      itemCount: this.preparedRows.length,
      skipped: this.skippedCount
    })

    return {
      success: true,
      itemCount: this.preparedRows.length,
      warnings: warnings.length > 0 ? warnings : undefined
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.preparedRows.length === 0) {
      return { success: true, processedCount: 0 }
    }

    try {
      const BATCH_SIZE = 100
      let processed = 0

      await ctx.db.transaction(async (tx) => {
        for (let i = 0; i < this.preparedRows.length; i += BATCH_SIZE) {
          const batch = this.preparedRows.slice(i, i + BATCH_SIZE)
          await tx.insert(mcpServerTable).values(batch)

          processed += batch.length
          const progress = Math.round((processed / this.preparedRows.length) * 100)
          this.reportProgress(progress, `Migrated ${processed}/${this.preparedRows.length} MCP servers`, {
            key: 'migration.progress.migrated_mcp_servers',
            params: { processed, total: this.preparedRows.length }
          })
        }
      })

      logger.info('Execute completed', { processedCount: processed })

      return { success: true, processedCount: processed }
    } catch (error) {
      logger.error('Execute failed', error as Error)
      return {
        success: false,
        processedCount: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    try {
      const result = await ctx.db.select({ count: sql<number>`count(*)` }).from(mcpServerTable).get()
      const targetCount = result?.count ?? 0

      return {
        success: true,
        errors: [],
        stats: {
          sourceCount: this.preparedRows.length,
          targetCount,
          skippedCount: this.skippedCount
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [{ key: 'validation', message: error instanceof Error ? error.message : String(error) }],
        stats: {
          sourceCount: this.preparedRows.length,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}
