/**
 * Memory Migrator - migrates legacy memory data from memories.db into main SQLite.
 */

import { memoryHistoryTable, memoryTable } from '@data/db/schemas/memory'
import { loggerService } from '@logger'
import { DATA_PATH } from '@main/config'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { and, isNull, sql } from 'drizzle-orm'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('MemoryMigrator')

type LegacyMemoryRow = {
  id: string
  memory: string
  hash: string | null
  embedding: string | null
  metadata: string | null
  user_id: string | null
  agent_id: string | null
  run_id: string | null
  created_at: string | null
  updated_at: string | null
  is_deleted: number | null
}

type LegacyMemoryHistoryRow = {
  id: number
  memory_id: string
  previous_value: string | null
  new_value: string | null
  action: 'ADD' | 'UPDATE' | 'DELETE'
  created_at: string | null
  updated_at: string | null
  is_deleted: number | null
}

export class MemoryMigrator extends BaseMigrator {
  readonly id = 'memory'
  readonly name = 'Memory'
  readonly description = 'Migrate legacy memory data from memories.db'
  readonly order = 6

  private dbPath: string | null = null
  private sourceMemoryCount = 0
  private sourceHistoryCount = 0
  private skippedCount = 0
  private hasMemoriesTable = false
  private hasHistoryTable = false

  async prepare(_ctx: MigrationContext): Promise<PrepareResult> {
    this.dbPath = this.resolveLegacyMemoryDbPath()
    this.sourceMemoryCount = 0
    this.sourceHistoryCount = 0
    this.skippedCount = 0
    this.hasMemoriesTable = false
    this.hasHistoryTable = false

    if (!this.dbPath) {
      return {
        success: true,
        itemCount: 0,
        warnings: ['Legacy memories.db not found - skipping memory migration']
      }
    }

    try {
      this.hasMemoriesTable = await this.legacyTableExists(this.dbPath, 'memories')
      this.hasHistoryTable = await this.legacyTableExists(this.dbPath, 'memory_history')

      const memoryCountRows = this.hasMemoriesTable
        ? await this.readLegacyDb<{ count: number }>(this.dbPath, `SELECT COUNT(*) as count FROM memories`)
        : [{ count: 0 }]
      const historyCountRows = this.hasHistoryTable
        ? await this.readLegacyDb<{ count: number }>(this.dbPath, `SELECT COUNT(*) as count FROM memory_history`)
        : [{ count: 0 }]

      this.sourceMemoryCount = Number(memoryCountRows[0]?.count ?? 0)
      this.sourceHistoryCount = Number(historyCountRows[0]?.count ?? 0)

      logger.info('Memory migration source prepared', {
        dbPath: this.dbPath,
        memories: this.sourceMemoryCount,
        history: this.sourceHistoryCount
      })

      return {
        success: true,
        itemCount: this.sourceMemoryCount + this.sourceHistoryCount,
        warnings:
          !this.hasMemoriesTable || !this.hasHistoryTable
            ? [
                ...(!this.hasMemoriesTable ? ['Legacy memories table not found, skipping memory rows'] : []),
                ...(!this.hasHistoryTable ? ['Legacy memory_history table not found, skipping history rows'] : [])
              ]
            : undefined
      }
    } catch (error) {
      logger.error('Failed to prepare memory migration', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (!this.dbPath || this.sourceMemoryCount + this.sourceHistoryCount === 0) {
      return { success: true, processedCount: 0 }
    }

    try {
      const [legacyMemories, legacyHistory] = await Promise.all([
        this.hasMemoriesTable ? this.readLegacyDb<LegacyMemoryRow>(this.dbPath, `SELECT * FROM memories`) : [],
        this.hasHistoryTable
          ? this.readLegacyDb<LegacyMemoryHistoryRow>(this.dbPath, `SELECT * FROM memory_history`)
          : []
      ])

      const now = new Date().toISOString()

      const memoryRows = legacyMemories
        .filter((row) => !!row.id && !!row.memory)
        .map((row) => ({
          id: row.id,
          memory: row.memory,
          hash: row.hash || row.id,
          embedding: row.embedding,
          metadata: this.parseMetadata(row.metadata),
          userId: row.user_id,
          agentId: row.agent_id,
          runId: row.run_id,
          createdAt: row.created_at || now,
          updatedAt: row.updated_at || row.created_at || now,
          deletedAt: row.is_deleted === 1 ? row.updated_at || row.created_at || now : null
        }))

      const historyRows = legacyHistory
        .filter((row) => !!row.memory_id && !!row.action)
        .map((row) => ({
          id: row.id,
          memoryId: row.memory_id,
          previousValue: row.previous_value,
          newValue: row.new_value,
          action: row.action,
          createdAt: row.created_at || now,
          updatedAt: row.updated_at || row.created_at || now,
          deletedAt: row.is_deleted === 1 ? row.updated_at || row.created_at || now : null
        }))

      const memoryIds = new Set(memoryRows.map((row) => row.id))
      const validHistoryRows = historyRows.filter((row) => memoryIds.has(row.memoryId))
      this.skippedCount = historyRows.length - validHistoryRows.length

      const BATCH_SIZE = 200
      let processed = 0
      const total = memoryRows.length + validHistoryRows.length

      await ctx.db.transaction(async (tx) => {
        for (let i = 0; i < memoryRows.length; i += BATCH_SIZE) {
          const batch = memoryRows.slice(i, i + BATCH_SIZE)
          if (batch.length === 0) continue
          await tx.insert(memoryTable).values(batch).onConflictDoNothing({ target: memoryTable.id })
          processed += batch.length
          this.reportProgress(
            total > 0 ? Math.round((processed / total) * 100) : 100,
            `Migrated ${processed}/${total} memory rows`
          )
        }

        for (let i = 0; i < validHistoryRows.length; i += BATCH_SIZE) {
          const batch = validHistoryRows.slice(i, i + BATCH_SIZE)
          if (batch.length === 0) continue
          await tx.insert(memoryHistoryTable).values(batch).onConflictDoNothing({ target: memoryHistoryTable.id })
          processed += batch.length
          this.reportProgress(
            total > 0 ? Math.round((processed / total) * 100) : 100,
            `Migrated ${processed}/${total} memory rows`
          )
        }
      })

      return {
        success: true,
        processedCount: processed
      }
    } catch (error) {
      logger.error('Memory migration execute failed', error as Error)
      return {
        success: false,
        processedCount: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const errors: ValidationError[] = []

    try {
      const [targetMemoryCount, targetHistoryCount] = await Promise.all([
        ctx.db.select({ count: sql<number>`count(*)` }).from(memoryTable).get(),
        ctx.db.select({ count: sql<number>`count(*)` }).from(memoryHistoryTable).get()
      ])

      const sourceCount = this.sourceMemoryCount + this.sourceHistoryCount
      const targetCount = Number(targetMemoryCount?.count ?? 0) + Number(targetHistoryCount?.count ?? 0)

      if (targetCount < sourceCount - this.skippedCount) {
        errors.push({
          key: 'memory_count_mismatch',
          message: `Memory migration count mismatch: source=${sourceCount}, target=${targetCount}, skipped=${this.skippedCount}`
        })
      }

      // Sample integrity: active history rows must reference existing memory rows.
      const orphanHistory = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(memoryHistoryTable)
        .where(
          and(
            isNull(memoryHistoryTable.deletedAt),
            sql`${memoryHistoryTable.memoryId} NOT IN (SELECT id FROM ${memoryTable})`
          )
        )
        .get()

      if ((orphanHistory?.count ?? 0) > 0) {
        errors.push({
          key: 'memory_orphan_history',
          message: `Found ${orphanHistory?.count ?? 0} orphan memory_history rows`
        })
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount,
          targetCount,
          skippedCount: this.skippedCount,
          mismatchReason:
            errors.length > 0
              ? 'Some rows were skipped due to missing references or invalid source records.'
              : undefined
        }
      }
    } catch (error) {
      logger.error('Memory migration validate failed', error as Error)
      return {
        success: false,
        errors: [
          {
            key: 'memory_validate_failed',
            message: error instanceof Error ? error.message : String(error)
          }
        ],
        stats: {
          sourceCount: this.sourceMemoryCount + this.sourceHistoryCount,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }

  private resolveLegacyMemoryDbPath(): string | null {
    const candidatePaths = [
      path.join(DATA_PATH, 'Memory', 'memories.db'),
      path.join(app.getPath('userData'), 'memories.db')
    ]

    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    return null
  }

  private parseMetadata(raw: string | null): Record<string, any> | null {
    if (!raw) return null
    try {
      return JSON.parse(raw) as Record<string, any>
    } catch {
      return null
    }
  }

  private async readLegacyDb<T>(dbPath: string, sqlQuery: string): Promise<T[]> {
    const { createClient } = await import('@libsql/client')
    const legacyDb = createClient({
      url: `file:${dbPath}`,
      intMode: 'number'
    })

    try {
      const result = await legacyDb.execute(sqlQuery)
      return result.rows as T[]
    } finally {
      legacyDb.close()
    }
  }

  private async legacyTableExists(dbPath: string, tableName: string): Promise<boolean> {
    const rows = await this.readLegacyDb<{ count: number }>(
      dbPath,
      `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='${tableName}'`
    )
    return Number(rows[0]?.count ?? 0) > 0
  }
}
