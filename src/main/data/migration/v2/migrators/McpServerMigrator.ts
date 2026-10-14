/**
 * MCP Server migrator - migrates MCP servers from Redux to SQLite
 *
 * Data sources:
 * - Redux mcp slice (state.mcp.servers) -> mcp_server table
 *
 * Skipped fields (runtime/cache, derived again from live binary availability):
 * - isUvInstalled, isBunInstalled
 *
 * Not migrated (regenerable cache, re-fetched from provider API):
 * - Dexie mcp:provider:*:servers (handled in separate PR)
 */

import { sql } from 'drizzle-orm'

import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import { type McpServerTransformResult, transformMcpServer } from './mappings/McpServerMappings'

const logger = loggerService.withContext('McpServerMigrator')

export class McpServerMigrator extends BaseMigrator {
  readonly id = 'mcp_server'
  readonly name = 'MCP Server'
  readonly description = 'Migrate MCP server configurations from Redux to SQLite'
  readonly order = 1.5

  private preparedResults: McpServerTransformResult[] = []
  /** Rows that failed to insert on their own (malformed legacy records); see execute(). */
  private executeSkipped: string[] = []
  private skippedCount = 0

  override reset(): void {
    this.preparedResults = []
    this.executeSkipped = []
    this.skippedCount = 0
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const warnings: string[] = []
      const servers = ctx.sources.reduxState.get<unknown[]>('mcp', 'servers') ?? []

      if (!Array.isArray(servers)) {
        logger.warn('mcp.servers is not an array, skipping')
        warnings.push('mcp.servers is not an array')
      } else {
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
            this.preparedResults.push(transformMcpServer(s, this.preparedResults.length))
          } catch (err) {
            this.skippedCount++
            warnings.push(`Failed to transform server ${s.id}: ${(err as Error).message}`)
            logger.warn(`Skipping server ${s.id}`, err as Error)
          }
        }

        if (this.skippedCount > 0 && this.preparedResults.length === 0 && servers.length > 0) {
          return {
            success: false,
            itemCount: 0,
            warnings
          }
        }
      }

      logger.info('Preparation completed', {
        serverCount: this.preparedResults.length,
        skipped: this.skippedCount
      })

      return {
        success: true,
        itemCount: this.preparedResults.length,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      logger.error('Preparation failed', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.preparedResults.length === 0) {
      // Always publish the (empty) mapping so downstream migrators can distinguish
      // "ran with zero servers" from "never ran". Without this, AssistantMigrator
      // throws a fatal error when assistants still reference now-deleted servers,
      // instead of gracefully dropping those dangling refs.
      ctx.sharedData.set('mcpServerIdMapping', new Map<string, string>())
      return { success: true, processedCount: 0 }
    }

    try {
      let processed = 0
      const skippedIds = new Set<string>()
      const warnings: string[] = []
      const rows = this.preparedResults.map((r) => r.row)

      const BATCH_SIZE = 100
      ctx.db.transaction((tx) => {
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE)
          let batchError: unknown
          try {
            tx.insert(mcpServerTable).values(batch).run()
            processed += batch.length
            continue
          } catch (error) {
            // A single malformed legacy record aborts the whole batched INSERT
            // (#20301). Retry the batch row by row so only the offending rows
            // are skipped and every other server still migrates.
            batchError = error
            logger.warn('Batch insert failed, retrying rows individually', error as Error)
          }
          let recovered = 0
          for (const row of batch) {
            try {
              tx.insert(mcpServerTable).values(row).run()
              processed += 1
              recovered += 1
            } catch (rowError) {
              const message = rowError instanceof Error ? rowError.message : String(rowError)
              skippedIds.add(row.id!)
              warnings.push(`Skipped MCP server "${row.name}" (${row.id}): ${message}`)
              logger.warn('Skipped MCP server that could not be inserted', { id: row.id, name: row.name, message })
            }
          }
          if (recovered === 0) {
            // Not one row of the batch could be written: that is a database-wide
            // failure (locked file, missing table, closed connection), not bad
            // data. Skipping everything would report success with no servers.
            const message = batchError instanceof Error ? batchError.message : String(batchError)
            throw new Error(`MCP server batch insert failed and no row could be recovered individually: ${message}`)
          }
        }
      })

      // Share oldId → newId mapping so downstream migrators (e.g. AssistantMigrator)
      // can remap legacy MCP server references to the new UUIDs. A skipped
      // server has no row, so it stays unmapped and its references are dropped.
      const idMapping = new Map<string, string>()
      for (const result of this.preparedResults) {
        if (!skippedIds.has(result.row.id!)) {
          idMapping.set(result.oldId, result.row.id!)
        }
      }
      ctx.sharedData.set('mcpServerIdMapping', idMapping)
      this.executeSkipped = warnings

      this.reportProgress(100, `Migrated ${processed} items`, {
        key: 'migration.progress.migrated_mcp_servers',
        params: { processed, total: this.preparedResults.length }
      })

      logger.info('Execute completed', { processedCount: processed, skippedCount: skippedIds.size })

      return {
        success: true,
        processedCount: processed,
        ...(warnings.length > 0 ? { warnings } : {})
      }
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
      const serverResult = ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(mcpServerTable)
        .get()
      const serverCount = serverResult?.count ?? 0
      const errors: { key: string; message: string }[] = []

      const expectedCount = this.preparedResults.length - this.executeSkipped.length
      if (serverCount !== expectedCount) {
        errors.push({
          key: 'count_mismatch',
          message: `Expected ${expectedCount} servers but found ${serverCount}`
        })
      }

      const sample = ctx.db.select().from(mcpServerTable).limit(3).all()
      for (const server of sample) {
        if (!server.id || !server.name) {
          errors.push({ key: server.id ?? 'unknown', message: 'Missing required field (id or name)' })
        }
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.preparedResults.length,
          targetCount: serverCount,
          skippedCount: this.skippedCount + this.executeSkipped.length
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [{ key: 'validation', message: error instanceof Error ? error.message : String(error) }],
        stats: {
          sourceCount: this.preparedResults.length,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}
