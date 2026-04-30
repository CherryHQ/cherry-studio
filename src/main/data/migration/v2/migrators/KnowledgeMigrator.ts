/** Migrates legacy knowledge bases/items from Redux and Dexie exports into SQLite. */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { createClient, type Value as LibsqlValue } from '@libsql/client'
import { loggerService } from '@logger'
import { sanitizeFilename } from '@main/utils/file'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import type { FileMetadata } from '@shared/data/types/file'
import { KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL } from '@shared/data/types/knowledge'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import {
  type LegacyKnowledgeBase,
  type LegacyKnowledgeBaseWithIdentity,
  type LegacyKnowledgeItem,
  type LegacyKnowledgeNote,
  type LegacyKnowledgeState,
  type NewKnowledgeBase,
  type NewKnowledgeItem,
  transformKnowledgeBase,
  transformKnowledgeItem
} from './mappings/KnowledgeMappings'
import { resolveModelReference } from './transformers/ModelTransformers'

const logger = loggerService.withContext('KnowledgeMigrator')

const ITEM_INSERT_BATCH_SIZE = 200
const LOOKUP_STREAM_BATCH_SIZE = 200
const LEGACY_VECTOR_TABLE_NAME = 'vectors'
const SKIP_WARNING_SAMPLE_LIMIT = 3

type DimensionResolutionReason =
  | 'ok'
  | 'vector_db_missing'
  | 'legacy_vector_store_directory'
  | 'vector_db_empty'
  | 'invalid_vector_dimensions'
  | 'vector_db_invalid_path'
  | 'vector_db_error'

const hasKnowledgeBaseIdentity = (base: LegacyKnowledgeBase): base is LegacyKnowledgeBaseWithIdentity =>
  typeof base.id === 'string' && base.id !== '' && typeof base.name === 'string' && base.name !== ''

const hasCompleteInlineFileMetadata = (value: LegacyKnowledgeItem['content']): value is FileMetadata =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.origin_name === 'string' &&
  typeof value.path === 'string' &&
  typeof value.size === 'number' &&
  typeof value.ext === 'string' &&
  typeof value.type === 'string' &&
  typeof value.created_at === 'string' &&
  typeof value.count === 'number'

const getRequiredFileLookupId = (content: LegacyKnowledgeItem['content']): string | null => {
  if (typeof content === 'string' && content.trim() !== '') {
    return content
  }

  if (
    typeof content === 'object' &&
    content !== null &&
    !Array.isArray(content) &&
    typeof content.id === 'string' &&
    content.id.trim() !== '' &&
    !hasCompleteInlineFileMetadata(content)
  ) {
    return content.id
  }

  return null
}

const getInvalidKnowledgeBaseConfigWarning = (
  base: LegacyKnowledgeBaseWithIdentity,
  normalizedBase: NewKnowledgeBase
): string | null => {
  const clearedFields = [
    ['chunkSize', base.chunkSize, normalizedBase.chunkSize],
    ['chunkOverlap', base.chunkOverlap, normalizedBase.chunkOverlap],
    ['threshold', base.threshold, normalizedBase.threshold],
    ['documentCount', base.documentCount, normalizedBase.documentCount]
  ].flatMap(([field, previousValue, nextValue]) => ((previousValue ?? null) !== (nextValue ?? null) ? [field] : []))

  if (clearedFields.length === 0) {
    return null
  }

  return `Knowledge base ${base.id}: cleared invalid config fields: ${clearedFields.join(', ')}`
}

const resolveMigratedFailedBaseDimensions = (base: LegacyKnowledgeBaseWithIdentity): number => {
  return typeof base.dimensions === 'number' && Number.isInteger(base.dimensions) && base.dimensions > 0
    ? base.dimensions
    : 1
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
  private skippedWarnings = new Map<string, { count: number; samples: string[] }>()
  private seenBaseIds = new Set<string>()
  private seenItemIds = new Set<string>()

  override reset(): void {
    this.sourceCount = 0
    this.skippedCount = 0
    this.preparedBases = []
    this.preparedItems = []
    this.warnings = []
    this.skippedWarnings = new Map<string, { count: number; samples: string[] }>()
    this.seenBaseIds = new Set<string>()
    this.seenItemIds = new Set<string>()
  }

  private recordWarning(message: string): void {
    logger.warn(message)
    this.warnings.push(message)
  }

  private recordSkippedWarning(reason: string, message: string): void {
    const bucket = this.skippedWarnings.get(reason) ?? { count: 0, samples: [] }
    bucket.count += 1
    if (bucket.samples.length < SKIP_WARNING_SAMPLE_LIMIT) {
      bucket.samples.push(message)
    }
    this.skippedWarnings.set(reason, bucket)
  }

  private flushSkippedWarnings(): void {
    for (const [reason, bucket] of this.skippedWarnings) {
      const summary = `Skipped knowledge records (${reason}): count=${bucket.count}; examples: ${bucket.samples.join(' | ')}`
      this.recordWarning(summary)
    }

    this.skippedWarnings.clear()
  }

  private getLegacyKnowledgeDbPath(baseId: string, knowledgeBaseDir: string): string | null {
    // MigrationPaths already accounts for legacy custom userData before the v2 path registry is available.
    const rootPath = knowledgeBaseDir
    const sanitizedBaseId = sanitizeFilename(baseId, '_')
    const resolvedDbPath = path.resolve(rootPath, sanitizedBaseId)
    const relativePath = path.relative(rootPath, resolvedDbPath)

    if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      const warningMessage = `Skipped knowledge base ${baseId}: invalid legacy vector DB path`
      this.recordWarning(warningMessage)
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
      const warningMessage = `Invalid vector blob length for knowledge base ${baseId}: ${blobLength} is not divisible by ${Float32Array.BYTES_PER_ELEMENT}`
      this.recordWarning(warningMessage)
      return null
    }

    const dimensions = blobLength / Float32Array.BYTES_PER_ELEMENT
    return Number.isInteger(dimensions) && dimensions > 0 ? dimensions : null
  }

  private async resolveDimensionsForBase(
    base: LegacyKnowledgeBaseWithIdentity,
    knowledgeBaseDir: string
  ): Promise<{ dimensions: number | null; reason: DimensionResolutionReason }> {
    const dbPath = this.getLegacyKnowledgeDbPath(base.id, knowledgeBaseDir)
    if (!dbPath) {
      return { dimensions: null, reason: 'vector_db_invalid_path' }
    }

    if (!fs.existsSync(dbPath)) {
      return { dimensions: null, reason: 'vector_db_missing' }
    }

    let client: ReturnType<typeof createClient> | null = null

    try {
      const dbStat = fs.statSync(dbPath)
      if (dbStat.isDirectory()) {
        return { dimensions: null, reason: 'legacy_vector_store_directory' }
      }

      client = createClient({ url: pathToFileURL(dbPath).toString() })

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
      const warningMessage = `Failed to inspect legacy vector DB for knowledge base ${base.id}: ${
        error instanceof Error ? error.message : String(error)
      }`
      this.recordWarning(warningMessage)
      return { dimensions: null, reason: 'vector_db_error' }
    } finally {
      if (client) {
        try {
          client.close()
        } catch (error) {
          const warningMessage = `Failed to close legacy vector DB client for knowledge base ${base.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
          this.recordWarning(warningMessage)
        }
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

  private collectLookupIds(bases: LegacyKnowledgeBase[]): {
    noteIds: Set<string>
    fileIds: Set<string>
  } {
    const noteIds = new Set<string>()
    const fileIds = new Set<string>()

    for (const base of bases) {
      const items = Array.isArray(base.items) ? base.items : []

      for (const item of items) {
        if (item?.type === 'note' && typeof item.id === 'string' && item.id.trim() !== '') {
          noteIds.add(item.id)
        }

        if (item?.type === 'file') {
          const fileId = getRequiredFileLookupId(item.content)
          if (fileId) {
            fileIds.add(fileId)
          }
        }
      }
    }

    return { noteIds, fileIds }
  }

  private async loadNoteLookup(ctx: MigrationContext, noteIds: Set<string>): Promise<Map<string, LegacyKnowledgeNote>> {
    const noteById = new Map<string, LegacyKnowledgeNote>()

    if (noteIds.size === 0) {
      return noteById
    }

    if (!(await ctx.sources.dexieExport.tableExists('knowledge_notes'))) {
      const warningMessage = 'knowledge_notes export file not found - note content fallback to Redux item content'
      this.recordWarning(warningMessage)
      return noteById
    }

    const reader = ctx.sources.dexieExport.createStreamReader('knowledge_notes')
    await reader.readInBatches<LegacyKnowledgeNote>(LOOKUP_STREAM_BATCH_SIZE, async (notes) => {
      for (const note of notes) {
        if (note?.id && noteIds.has(note.id)) {
          noteById.set(note.id, note)
        }
      }
    })

    logger.info('Knowledge note lookup prepared via streaming', {
      requested: noteIds.size,
      matched: noteById.size
    })

    return noteById
  }

  private async loadFileLookup(ctx: MigrationContext, fileIds: Set<string>): Promise<Map<string, FileMetadata>> {
    const filesById = new Map<string, FileMetadata>()

    if (fileIds.size === 0) {
      return filesById
    }

    if (!(await ctx.sources.dexieExport.tableExists('files'))) {
      const warningMessage = 'files export file not found - file item fallback by id disabled'
      this.recordWarning(warningMessage)
      return filesById
    }

    const reader = ctx.sources.dexieExport.createStreamReader('files')
    await reader.readInBatches<FileMetadata>(LOOKUP_STREAM_BATCH_SIZE, async (files) => {
      for (const file of files) {
        if (file?.id && fileIds.has(file.id)) {
          filesById.set(file.id, file)
        }
      }
    })

    logger.info('Knowledge file lookup prepared via streaming', {
      requested: fileIds.size,
      matched: filesById.size
    })

    return filesById
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const knowledgeState = ctx.sources.reduxState.getCategory<LegacyKnowledgeState>('knowledge')

      if (!knowledgeState) {
        const warningMessage = 'knowledge Redux category not found - no knowledge data to migrate'
        logger.warn(warningMessage)
        return {
          success: true,
          itemCount: 0,
          warnings: [warningMessage]
        }
      }

      if (!Array.isArray(knowledgeState.bases)) {
        const warningMessage = 'knowledge.bases is not an array - no knowledge data to migrate'
        logger.warn(warningMessage)
        return {
          success: true,
          itemCount: 0,
          warnings: [warningMessage]
        }
      }

      const bases = knowledgeState.bases

      if (bases.length === 0) {
        logger.info('No knowledge bases found in Redux state')
        return {
          success: true,
          itemCount: 0
        }
      }

      const { noteIds, fileIds } = this.collectLookupIds(bases)
      const noteById = await this.loadNoteLookup(ctx, noteIds)
      const filesById = await this.loadFileLookup(ctx, fileIds)
      const validModelIds = ctx.db?.select
        ? new Set((await ctx.db.select({ id: userModelTable.id }).from(userModelTable)).map((row) => row.id))
        : null

      for (const base of bases) {
        this.sourceCount += 1

        if (!hasKnowledgeBaseIdentity(base)) {
          this.skippedCount += 1
          const warningMessage = 'Skipped invalid knowledge base: missing id or name'
          this.recordSkippedWarning('invalid_knowledge_base_identity', warningMessage)
          continue
        }

        const validBase = base

        const items = Array.isArray(validBase.items) ? validBase.items : []

        if (this.seenBaseIds.has(validBase.id)) {
          this.skippedCount += 1 + items.length
          this.sourceCount += items.length
          const warningMessage = `Skipped duplicate knowledge base ${validBase.id}`
          this.recordSkippedWarning('duplicate_knowledge_base', warningMessage)
          continue
        }

        const initialBaseResult = transformKnowledgeBase(validBase, resolveMigratedFailedBaseDimensions(validBase))
        const embeddingResolution = resolveModelReference(
          initialBaseResult.value.embeddingModelId ?? null,
          validModelIds
        )
        const resolvedDimensions =
          embeddingResolution.kind === 'resolved'
            ? await this.resolveDimensionsForBase(validBase, ctx.paths.knowledgeBaseDir)
            : { dimensions: initialBaseResult.value.dimensions, reason: 'ok' as const }

        if (resolvedDimensions.dimensions === null) {
          this.skippedCount += 1 + items.length
          this.sourceCount += items.length
          const warningMessage = `Skipped knowledge base ${validBase.id}: ${resolvedDimensions.reason}`
          this.recordSkippedWarning(`knowledge_base_${resolvedDimensions.reason}`, warningMessage)
          continue
        }

        const baseResult =
          resolvedDimensions.dimensions === initialBaseResult.value.dimensions
            ? initialBaseResult
            : transformKnowledgeBase(validBase, resolvedDimensions.dimensions)
        const preparedBase = { ...baseResult.value }

        if (embeddingResolution.kind === 'resolved') {
          preparedBase.embeddingModelId = embeddingResolution.modelId
        } else {
          const warningMessage =
            embeddingResolution.kind === 'dangling'
              ? `Knowledge base ${validBase.id}: dangling embedding model reference ${embeddingResolution.modelId} requires restore with a new embedding model`
              : `Knowledge base ${validBase.id}: missing embedding model reference requires restore with a new embedding model`
          this.recordWarning(warningMessage)
          preparedBase.embeddingModelId = null
          preparedBase.status = 'failed'
          preparedBase.error = KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL
        }

        const rerankResolution = resolveModelReference(preparedBase.rerankModelId ?? null, validModelIds)
        preparedBase.rerankModelId = rerankResolution.kind === 'resolved' ? rerankResolution.modelId : null
        if (rerankResolution.kind === 'dangling') {
          const warningMessage = `Knowledge base ${validBase.id}: dangling rerank model reference ${rerankResolution.modelId} was cleared`
          this.recordWarning(warningMessage)
        }

        this.seenBaseIds.add(preparedBase.id!)
        this.preparedBases.push(preparedBase)

        const invalidConfigWarning = getInvalidKnowledgeBaseConfigWarning(validBase, preparedBase)
        if (invalidConfigWarning) {
          this.recordWarning(invalidConfigWarning)
        }

        for (const item of items) {
          this.sourceCount += 1

          const itemResult = transformKnowledgeItem(validBase.id, item, {
            noteById,
            filesById
          })

          if (!itemResult.ok) {
            this.skippedCount += 1
            const warningMessage = this.formatItemWarning(validBase.id, item, itemResult.reason)
            this.recordSkippedWarning(`knowledge_item_${itemResult.reason}`, warningMessage)
            continue
          }

          if (this.seenItemIds.has(itemResult.value.id!)) {
            this.skippedCount += 1
            const warningMessage = `Skipped duplicate knowledge item ${itemResult.value.id!} in base ${validBase.id}`
            this.recordSkippedWarning('duplicate_knowledge_item', warningMessage)
            continue
          }

          this.seenItemIds.add(itemResult.value.id!)
          this.preparedItems.push(itemResult.value)
        }
      }

      this.flushSkippedWarnings()

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
      const expectedBaseCount = this.preparedBases.length
      const expectedItemCount = this.preparedItems.length

      if (targetBaseCount < expectedBaseCount) {
        errors.push({
          key: 'knowledge_base_count_mismatch',
          expected: expectedBaseCount,
          actual: targetBaseCount,
          message: `Expected ${expectedBaseCount} knowledge bases, got ${targetBaseCount}`
        })
      }

      if (targetItemCount < expectedItemCount) {
        errors.push({
          key: 'knowledge_item_count_mismatch',
          expected: expectedItemCount,
          actual: targetItemCount,
          message: `Expected ${expectedItemCount} knowledge items, got ${targetItemCount}`
        })
      }

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
