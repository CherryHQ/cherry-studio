/**
 * Knowledge migrator - migrates knowledge bases and items from Redux/Dexie to SQLite
 *
 * Data sources:
 *   - Redux knowledge slice (`knowledge.bases`)
 *   - Dexie `knowledge_notes` table (full note content)
 *   - Dexie `files` table (file metadata fallback)
 *
 * Target tables:
 *   - `knowledge_base`
 *   - `knowledge_item`
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { createClient, type Value as LibsqlValue } from '@libsql/client'
import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import { sanitizeFilename } from '@main/utils/file'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import type { FileMetadata } from '@shared/data/types/file'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import {
  type LegacyKnowledgeBase,
  type LegacyKnowledgeBaseWithIdentity,
  type LegacyKnowledgeNote,
  type LegacyKnowledgeState,
  type NewKnowledgeBase,
  type NewKnowledgeItem,
  transformKnowledgeBase,
  transformKnowledgeItem
} from './mappings/KnowledgeMappings'

const logger = loggerService.withContext('KnowledgeMigrator')

const ITEM_INSERT_BATCH_SIZE = 200
const MAX_WARNING_COUNT = 50
const LEGACY_VECTOR_TABLE_NAME = 'vectors'

type DimensionResolutionReason =
  | 'ok'
  | 'vector_db_missing'
  | 'vector_db_empty'
  | 'invalid_vector_dimensions'
  | 'vector_db_invalid_path'
  | 'vector_db_error'

const hasKnowledgeBaseIdentity = (base: LegacyKnowledgeBase): base is LegacyKnowledgeBaseWithIdentity =>
  typeof base.id === 'string' && base.id !== '' && typeof base.name === 'string' && base.name !== ''

export class KnowledgeMigrator extends BaseMigrator {
  readonly id = 'knowledge'
  readonly name = 'KnowledgeBase'
  readonly description = 'Migrate knowledge base and knowledge item data'
  readonly order = 3

  private sourceCount = 0
  private skippedCount = 0
  private preparedBases: NewKnowledgeBase[] = []
  private preparedItems: NewKnowledgeItem[] = []
  private warnings: string[] = []
  private warningOverflowCount = 0

  private pushWarning(message: string): void {
    if (this.warnings.length < MAX_WARNING_COUNT) {
      this.warnings.push(message)
      return
    }

    this.warningOverflowCount += 1
  }

  private getLegacyKnowledgeDbPath(baseId: string): string | null {
    const rootPath = path.resolve(getDataPath(), 'KnowledgeBase')
    const sanitizedBaseId = sanitizeFilename(baseId, '_')
    const resolvedDbPath = path.resolve(rootPath, sanitizedBaseId)
    const relativePath = path.relative(rootPath, resolvedDbPath)

    if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      this.pushWarning(`Skipped knowledge base ${baseId}: invalid legacy vector DB path`)
      return null
    }

    return resolvedDbPath
  }

  private toFiniteNumber(value: LibsqlValue): number | null {
    if (value === null || value === undefined) {
      return null
    }

    if (typeof value === 'bigint') {
      const numeric = Number(value)
      return Number.isFinite(numeric) ? numeric : null
    }

    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }

  private parseDimensionsFromBlobLength(blobLengthValue: LibsqlValue, baseId: string): number | null {
    const blobLength = this.toFiniteNumber(blobLengthValue)
    if (blobLength === null || !Number.isInteger(blobLength) || blobLength <= 0) {
      return null
    }

    if (blobLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      this.pushWarning(
        `Invalid vector blob length for knowledge base ${baseId}: ${blobLength} is not divisible by ${Float32Array.BYTES_PER_ELEMENT}`
      )
      return null
    }

    const dimensions = blobLength / Float32Array.BYTES_PER_ELEMENT
    return Number.isInteger(dimensions) && dimensions > 0 ? dimensions : null
  }

  private async resolveDimensionsForBase(
    base: LegacyKnowledgeBaseWithIdentity
  ): Promise<{ dimensions: number | null; reason: DimensionResolutionReason }> {
    const dbPath = this.getLegacyKnowledgeDbPath(base.id)
    if (!dbPath) {
      return { dimensions: null, reason: 'vector_db_invalid_path' }
    }

    if (!fs.existsSync(dbPath)) {
      return { dimensions: null, reason: 'vector_db_missing' }
    }

    const client = createClient({ url: pathToFileURL(dbPath).toString() })

    try {
      const countResult = await client.execute(
        `SELECT count(*) AS total, sum(CASE WHEN vector IS NOT NULL THEN 1 ELSE 0 END) AS with_vector FROM ${LEGACY_VECTOR_TABLE_NAME}`
      )
      const totalRows = this.toFiniteNumber(countResult.rows?.[0]?.total) ?? 0
      const vectorRows = this.toFiniteNumber(countResult.rows?.[0]?.with_vector) ?? 0

      if (totalRows <= 0 || vectorRows <= 0) {
        return { dimensions: null, reason: 'vector_db_empty' }
      }

      const vectorLengthResult = await client.execute(
        `SELECT length(vector) AS bytes FROM ${LEGACY_VECTOR_TABLE_NAME} WHERE vector IS NOT NULL LIMIT 1`
      )
      const dimensions = this.parseDimensionsFromBlobLength(vectorLengthResult.rows?.[0]?.bytes, base.id)
      if (dimensions !== null) {
        return { dimensions, reason: 'ok' }
      }

      return { dimensions: null, reason: 'invalid_vector_dimensions' }
    } catch (error) {
      this.pushWarning(
        `Failed to inspect legacy vector DB for knowledge base ${base.id}: ${error instanceof Error ? error.message : String(error)}`
      )
      return { dimensions: null, reason: 'vector_db_error' }
    } finally {
      try {
        client.close()
      } catch {
        // Ignore close errors from libsql client during best-effort inspection.
      }
    }
  }

  private formatItemWarning(baseId: string, item: { id?: string; type?: string }, reason: string): string {
    if (reason === 'missing_id_or_type') {
      return `Skipped invalid knowledge item in base ${baseId}: missing id or type`
    }

    if (reason === 'unsupported_type') {
      return `Skipped unsupported knowledge item type '${item.type}' (itemId=${item.id})`
    }

    if (reason === 'invalid_file') {
      return `Skipped file item with invalid metadata (itemId=${item.id})`
    }

    if (reason === 'invalid_url') {
      return `Skipped url item with invalid content (itemId=${item.id})`
    }

    if (reason === 'invalid_sitemap') {
      return `Skipped sitemap item with invalid content (itemId=${item.id})`
    }

    if (reason === 'invalid_directory') {
      return `Skipped directory item with invalid content (itemId=${item.id})`
    }

    return `Skipped invalid knowledge item in base ${baseId} (itemId=${item.id})`
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    this.sourceCount = 0
    this.skippedCount = 0
    this.preparedBases = []
    this.preparedItems = []
    this.warnings = []
    this.warningOverflowCount = 0

    try {
      const knowledgeState = ctx.sources.reduxState.getCategory<LegacyKnowledgeState>('knowledge')
      const bases = Array.isArray(knowledgeState?.bases) ? knowledgeState.bases : []

      if (bases.length === 0) {
        logger.info('No knowledge bases found in Redux state')
        return {
          success: true,
          itemCount: 0
        }
      }

      const noteById = new Map<string, LegacyKnowledgeNote>()
      if (await ctx.sources.dexieExport.tableExists('knowledge_notes')) {
        const notes = await ctx.sources.dexieExport.readTable<LegacyKnowledgeNote>('knowledge_notes')
        for (const note of notes) {
          if (note?.id) {
            noteById.set(note.id, note)
          }
        }
      } else {
        this.pushWarning('knowledge_notes export file not found - note content fallback to Redux item content')
      }

      const filesById = new Map<string, FileMetadata>()
      if (await ctx.sources.dexieExport.tableExists('files')) {
        const files = await ctx.sources.dexieExport.readTable<FileMetadata>('files')
        for (const file of files) {
          if (file?.id) {
            filesById.set(file.id, file)
          }
        }
      } else {
        this.pushWarning('files export file not found - file item fallback by id disabled')
      }

      for (const base of bases) {
        this.sourceCount += 1

        if (!hasKnowledgeBaseIdentity(base)) {
          this.skippedCount += 1
          this.pushWarning('Skipped invalid knowledge base: missing id or name')
          continue
        }

        const validBase = base

        const items = Array.isArray(validBase.items) ? validBase.items : []
        const resolvedDimensions = await this.resolveDimensionsForBase(validBase)

        if (resolvedDimensions.dimensions === null) {
          this.skippedCount += 1 + items.length
          this.sourceCount += items.length
          this.pushWarning(`Skipped knowledge base ${validBase.id}: ${resolvedDimensions.reason}`)
          continue
        }

        const baseResult = transformKnowledgeBase(validBase, resolvedDimensions.dimensions)
        if (!baseResult.ok) {
          this.skippedCount += 1 + items.length
          this.sourceCount += items.length
          this.pushWarning(`Skipped knowledge base ${validBase.id}: ${baseResult.reason}`)
          continue
        }

        this.preparedBases.push(baseResult.value)

        for (const item of items) {
          this.sourceCount += 1

          const itemResult = transformKnowledgeItem(validBase.id, item, {
            noteById,
            filesById
          })

          if (!itemResult.ok) {
            this.skippedCount += 1
            this.pushWarning(this.formatItemWarning(validBase.id, item, itemResult.reason))
            continue
          }

          this.preparedItems.push(itemResult.value)
        }
      }

      if (this.warningOverflowCount > 0) {
        this.warnings.push(`... and ${this.warningOverflowCount} more warnings`)
      }

      logger.info('KnowledgeMigrator.prepare completed', {
        sourceCount: this.sourceCount,
        preparedBases: this.preparedBases.length,
        preparedItems: this.preparedItems.length,
        skippedCount: this.skippedCount,
        warningCount: this.warnings.length
      })

      return {
        success: true,
        itemCount: this.sourceCount,
        warnings: this.warnings.length > 0 ? this.warnings : undefined
      }
    } catch (error) {
      logger.error('KnowledgeMigrator.prepare failed', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.preparedBases.length === 0 && this.preparedItems.length === 0) {
      logger.info('No knowledge data to migrate')
      return {
        success: true,
        processedCount: 0
      }
    }

    const total = this.preparedBases.length + this.preparedItems.length
    let processed = 0

    try {
      const baseIdSet = new Set<string>()
      for (const base of this.preparedBases) {
        if (!base.id) {
          throw new Error('Prepared knowledge base is missing id')
        }
        baseIdSet.add(base.id)
      }

      const itemsByBaseId = new Map<string, NewKnowledgeItem[]>()
      for (const item of this.preparedItems) {
        if (!item.baseId) {
          throw new Error(`Prepared knowledge item '${item.id ?? 'missing-id'}' is missing baseId`)
        }
        if (!item.id) {
          throw new Error(`Prepared knowledge item for base '${item.baseId}' is missing id`)
        }
        if (!baseIdSet.has(item.baseId)) {
          throw new Error(`Prepared knowledge item '${item.id}' references missing base '${item.baseId}'`)
        }

        const items = itemsByBaseId.get(item.baseId)
        if (items) {
          items.push(item)
        } else {
          itemsByBaseId.set(item.baseId, [item])
        }
      }

      for (const base of this.preparedBases) {
        if (!base.id) {
          throw new Error('Prepared knowledge base is missing id')
        }

        const baseItems = itemsByBaseId.get(base.id) ?? []
        let transactionProcessed = 0

        await ctx.db.transaction(async (tx) => {
          await tx.insert(knowledgeBaseTable).values(base)
          transactionProcessed += 1

          for (let i = 0; i < baseItems.length; i += ITEM_INSERT_BATCH_SIZE) {
            const batch = baseItems.slice(i, i + ITEM_INSERT_BATCH_SIZE)
            await tx.insert(knowledgeItemTable).values(batch)
            transactionProcessed += batch.length
          }
        })

        processed += transactionProcessed
        const progress = Math.round((processed / total) * 100)
        this.reportProgress(progress, `Migrated ${processed}/${total} knowledge records`, {
          key: 'migration.progress.migrated_knowledge',
          params: { processed, total }
        })
      }

      logger.info('KnowledgeMigrator.execute completed', {
        processed,
        baseCount: this.preparedBases.length,
        itemCount: this.preparedItems.length
      })

      return {
        success: true,
        processedCount: processed
      }
    } catch (error) {
      logger.error('KnowledgeMigrator.execute failed', error as Error)
      return {
        success: false,
        processedCount: processed,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const errors: ValidationError[] = []

    try {
      const baseResult = await ctx.db.select({ count: sql<number>`count(*)` }).from(knowledgeBaseTable).get()
      const itemResult = await ctx.db.select({ count: sql<number>`count(*)` }).from(knowledgeItemTable).get()

      const targetBaseCount = baseResult?.count ?? 0
      const targetItemCount = itemResult?.count ?? 0
      const targetCount = targetBaseCount + targetItemCount

      const orphanItems = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(knowledgeItemTable)
        .where(sql`${knowledgeItemTable.baseId} NOT IN (SELECT id FROM ${knowledgeBaseTable})`)
        .get()

      if ((orphanItems?.count ?? 0) > 0) {
        errors.push({
          key: 'knowledge_orphan_items',
          expected: 0,
          actual: orphanItems?.count ?? 0,
          message: `Found ${orphanItems?.count ?? 0} orphan knowledge items without valid base`
        })
      }

      logger.info('KnowledgeMigrator.validate completed', {
        sourceCount: this.sourceCount,
        targetBaseCount,
        targetItemCount,
        targetCount,
        skippedCount: this.skippedCount,
        errors: errors.length
      })

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.sourceCount,
          targetCount,
          skippedCount: this.skippedCount
        }
      }
    } catch (error) {
      logger.error('KnowledgeMigrator.validate failed', error as Error)
      return {
        success: false,
        errors: [
          {
            key: 'validation',
            message: error instanceof Error ? error.message : String(error)
          }
        ],
        stats: {
          sourceCount: this.sourceCount,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}
