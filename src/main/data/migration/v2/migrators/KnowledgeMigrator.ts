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

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { createClient } from '@libsql/client'
import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import { sanitizeFilename } from '@main/utils/file'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import type { FileMetadata } from '@shared/data/types/file'
import type { ItemStatus, KnowledgeItemData, KnowledgeItemType } from '@shared/data/types/knowledge'
import type { ModelMeta } from '@shared/data/types/meta'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('KnowledgeMigrator')

const BASE_INSERT_BATCH_SIZE = 50
const ITEM_INSERT_BATCH_SIZE = 200
const MAX_WARNING_COUNT = 50
const LEGACY_VECTOR_TABLE_NAME = 'vectors'

type NewKnowledgeBase = typeof knowledgeBaseTable.$inferInsert
type NewKnowledgeItem = typeof knowledgeItemTable.$inferInsert
type DimensionResolutionReason =
  | 'ok'
  | 'vector_db_missing'
  | 'vector_db_empty'
  | 'invalid_vector_dimensions'
  | 'vector_db_error'

interface LegacyModel {
  id: string
  name: string
  provider: string
  group?: string
}

interface LegacyPreprocessProvider {
  provider?: {
    id?: string
  }
}

interface LegacyKnowledgeItem {
  id: string
  type: string
  content: unknown
  created_at?: unknown
  updated_at?: unknown
  processingStatus?: string
  processingError?: string
  parentId?: string | null
  sourceUrl?: string
}

interface LegacyKnowledgeBase {
  id: string
  name: string
  description?: string
  dimensions?: number
  model?: LegacyModel | null
  rerankModel?: LegacyModel | null
  preprocessProvider?: LegacyPreprocessProvider
  chunkSize?: number
  chunkOverlap?: number
  threshold?: number
  documentCount?: number
  created_at?: unknown
  updated_at?: unknown
  items?: LegacyKnowledgeItem[]
}

interface LegacyKnowledgeState {
  bases?: LegacyKnowledgeBase[]
}

interface LegacyKnowledgeNote {
  id: string
  content?: string
  sourceUrl?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isLegacyModel = (value: unknown): value is LegacyModel =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.provider === 'string'

const toModelMeta = (model: LegacyModel | null | undefined): ModelMeta | null => {
  if (!model) {
    return null
  }
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    group: model.group
  }
}

const toTimestamp = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return numeric
    }
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

const toItemStatus = (status: string | undefined): ItemStatus => {
  if (status === 'pending') return 'pending'
  if (status === 'processing') return 'pending'
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  return 'idle'
}

const isFileMetadata = (value: unknown): value is FileMetadata =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.origin_name === 'string' &&
  typeof value.path === 'string' &&
  typeof value.size === 'number' &&
  typeof value.ext === 'string' &&
  typeof value.type === 'string' &&
  typeof value.created_at === 'string' &&
  typeof value.count === 'number'

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

const toCompositeModelId = (model: LegacyModel | null | undefined): string | null => {
  if (!model) {
    return null
  }

  const providerId = model.provider?.trim()
  const modelId = model.id?.trim()
  if (!providerId || !modelId) {
    return null
  }

  if (modelId.includes('::')) {
    return modelId
  }

  return `${providerId}::${modelId}`
}

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

  private resolveFileMetadata(content: unknown, filesById: Map<string, FileMetadata>): FileMetadata | null {
    if (isFileMetadata(content)) {
      return content
    }

    if (typeof content === 'string') {
      return filesById.get(content) ?? null
    }

    if (isRecord(content) && typeof content.id === 'string') {
      const fallback = filesById.get(content.id)
      if (!fallback) {
        return null
      }
      const merged = { ...fallback, ...content }
      return isFileMetadata(merged) ? merged : null
    }

    return null
  }

  private getLegacyKnowledgeDbPath(baseId: string): string {
    return path.join(getDataPath(), 'KnowledgeBase', sanitizeFilename(baseId, '_'))
  }

  private toFiniteNumber(value: unknown): number | null {
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

  private parseDimensionsFromBlobLength(blobLengthValue: unknown, baseId: string): number | null {
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
    return isPositiveInteger(dimensions) ? dimensions : null
  }

  private async resolveDimensionsForBase(
    base: LegacyKnowledgeBase
  ): Promise<{ dimensions: number | null; reason: DimensionResolutionReason }> {
    const dbPath = this.getLegacyKnowledgeDbPath(base.id)
    if (!fs.existsSync(dbPath)) {
      return { dimensions: null, reason: 'vector_db_missing' }
    }

    const client = createClient({ url: `file:${dbPath}` })
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
      const blobDimensions = this.parseDimensionsFromBlobLength(vectorLengthResult.rows?.[0]?.bytes, base.id)
      if (blobDimensions !== null) {
        return { dimensions: blobDimensions, reason: 'ok' }
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
        // libsql client close errors should not block migration fallback
      }
    }
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

        if (!base?.id || !base?.name) {
          this.skippedCount += 1
          this.pushWarning(`Skipped invalid knowledge base: missing id or name`)
          continue
        }

        const items = Array.isArray(base.items) ? base.items : []
        const model = isLegacyModel(base.model) ? base.model : null
        const rerankModel = isLegacyModel(base.rerankModel) ? base.rerankModel : null
        const resolvedDimensions = await this.resolveDimensionsForBase(base)

        if (resolvedDimensions.dimensions === null) {
          this.skippedCount += 1 + items.length
          this.sourceCount += items.length
          this.pushWarning(`Skipped knowledge base ${base.id}: ${resolvedDimensions.reason}`)
          continue
        }

        const embeddingModelId = toCompositeModelId(model)
        if (!embeddingModelId) {
          this.skippedCount += 1 + items.length
          this.sourceCount += items.length
          this.pushWarning(`Skipped knowledge base ${base.id}: embedding_model_missing`)
          continue
        }

        this.preparedBases.push({
          id: base.id,
          name: base.name,
          description: base.description,
          dimensions: resolvedDimensions.dimensions,
          embeddingModelId,
          embeddingModelMeta: toModelMeta(model),
          rerankModelId: toCompositeModelId(rerankModel),
          rerankModelMeta: toModelMeta(rerankModel),
          fileProcessorId: base.preprocessProvider?.provider?.id,
          chunkSize: base.chunkSize,
          chunkOverlap: base.chunkOverlap,
          threshold: base.threshold,
          documentCount: base.documentCount,
          createdAt: toTimestamp(base.created_at),
          updatedAt: toTimestamp(base.updated_at)
        })

        for (const item of items) {
          this.sourceCount += 1

          if (!item?.id || !item?.type) {
            this.skippedCount += 1
            this.pushWarning(`Skipped invalid knowledge item in base ${base.id}: missing id or type`)
            continue
          }

          if (item.type === 'video' || item.type === 'memory') {
            this.skippedCount += 1
            this.pushWarning(`Skipped unsupported knowledge item type '${item.type}' (itemId=${item.id})`)
            continue
          }

          let type: KnowledgeItemType
          let data: KnowledgeItemData

          if (item.type === 'file') {
            const file = this.resolveFileMetadata(item.content, filesById)
            if (!file) {
              this.skippedCount += 1
              this.pushWarning(`Skipped file item with invalid metadata (itemId=${item.id})`)
              continue
            }

            type = 'file'
            data = { file }
          } else if (item.type === 'url') {
            if (typeof item.content !== 'string' || item.content.trim() === '') {
              this.skippedCount += 1
              this.pushWarning(`Skipped url item with invalid content (itemId=${item.id})`)
              continue
            }

            type = 'url'
            data = {
              url: item.content,
              name: item.content
            }
          } else if (item.type === 'sitemap') {
            if (typeof item.content !== 'string' || item.content.trim() === '') {
              this.skippedCount += 1
              this.pushWarning(`Skipped sitemap item with invalid content (itemId=${item.id})`)
              continue
            }

            type = 'sitemap'
            data = {
              url: item.content,
              name: item.content
            }
          } else if (item.type === 'directory') {
            if (typeof item.content !== 'string' || item.content.trim() === '') {
              this.skippedCount += 1
              this.pushWarning(`Skipped directory item with invalid content (itemId=${item.id})`)
              continue
            }

            type = 'directory'
            data = {
              path: item.content,
              recursive: true
            }
          } else if (item.type === 'note') {
            const note = noteById.get(item.id)
            const noteContent = note?.content ?? (typeof item.content === 'string' ? item.content : '')

            type = 'note'
            data = {
              content: noteContent,
              sourceUrl: note?.sourceUrl ?? item.sourceUrl
            }
          } else {
            this.skippedCount += 1
            this.pushWarning(`Skipped unsupported knowledge item type '${item.type}' (itemId=${item.id})`)
            continue
          }

          this.preparedItems.push({
            id: item.id,
            baseId: base.id,
            // v1 knowledge items do not have stable tree semantics for v2 directory hierarchy.
            // Keep all migrated items at root level; v2 directory processing builds its own structure.
            parentId: null,
            type,
            data,
            status: toItemStatus(item.processingStatus),
            error: item.processingError ?? null,
            createdAt: toTimestamp(item.created_at),
            updatedAt: toTimestamp(item.updated_at)
          })
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
      const db = ctx.db
      await db.transaction(async (tx) => {
        for (let i = 0; i < this.preparedBases.length; i += BASE_INSERT_BATCH_SIZE) {
          const batch = this.preparedBases.slice(i, i + BASE_INSERT_BATCH_SIZE)
          await tx.insert(knowledgeBaseTable).values(batch)
          processed += batch.length

          const progress = Math.round((processed / total) * 100)
          this.reportProgress(progress, `Migrated ${processed}/${total} knowledge records`, {
            key: 'migration.progress.migrated_knowledge',
            params: { processed, total }
          })
        }

        for (let i = 0; i < this.preparedItems.length; i += ITEM_INSERT_BATCH_SIZE) {
          const batch = this.preparedItems.slice(i, i + ITEM_INSERT_BATCH_SIZE)
          await tx.insert(knowledgeItemTable).values(batch)
          processed += batch.length

          const progress = Math.round((processed / total) * 100)
          this.reportProgress(progress, `Migrated ${processed}/${total} knowledge records`, {
            key: 'migration.progress.migrated_knowledge',
            params: { processed, total }
          })
        }
      })

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
      const db = ctx.db

      const baseResult = await db.select({ count: sql<number>`count(*)` }).from(knowledgeBaseTable).get()
      const itemResult = await db.select({ count: sql<number>`count(*)` }).from(knowledgeItemTable).get()

      const targetBaseCount = baseResult?.count ?? 0
      const targetItemCount = itemResult?.count ?? 0
      const targetCount = targetBaseCount + targetItemCount

      const orphanItems = await db
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
