import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { type Client, createClient } from '@libsql/client'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import {
  KnowledgeChunkMetadataSchema,
  type KnowledgeItemData,
  type KnowledgeItemType
} from '@shared/data/types/knowledge'
import { estimateTokenCount } from 'tokenx'
import { v4 as uuidv4 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('KnowledgeVectorMigrator')

const VECTORSTORE_TABLE_NAME = 'libsql_vectorstores_embedding'
const INSERT_BATCH_SIZE = 100
const LEGACY_VECTOR_BACKUP_SUFFIX = '.embedjs.bak'
const INDEXABLE_KNOWLEDGE_ITEM_TYPES = new Set<KnowledgeItemType>(['file', 'url', 'note'])
const SKIP_WARNING_SAMPLE_LIMIT = 3

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

interface LegacyKnowledgeItemWithLoaders {
  id?: string
  uniqueId?: string
  uniqueIds?: string[]
}

interface LegacyKnowledgeBaseWithLoaders {
  id?: string
  items?: LegacyKnowledgeItemWithLoaders[]
}

interface LegacyKnowledgeStateWithLoaders {
  bases?: LegacyKnowledgeBaseWithLoaders[]
}

interface PreparedVectorRow {
  document: string
  externalId: string
  itemType: KnowledgeItemType
  source: string
  chunkIndex: number
  tokenCount: number
  embedding: number[]
}

interface MigratedKnowledgeItemForVector {
  id: string
  baseId: string
  type: KnowledgeItemType
  data: KnowledgeItemData
}

interface LoaderTarget {
  id: string
  itemType: KnowledgeItemType
  source: string
}

interface PreparedBasePlan {
  baseId: string
  dbPath: string
  dimensions: number
  rows: PreparedVectorRow[]
  sourceRowCount: number
}

export class KnowledgeVectorMigrator extends BaseMigrator {
  readonly id = 'knowledge_vector'
  readonly name = 'KnowledgeVector'
  readonly description = 'Rebuild legacy knowledge vectors into vectorstores libsql'
  readonly order = 3.5

  private sourceCount = 0
  private skippedCount = 0
  private warnings: string[] = []
  private skippedWarnings = new Map<string, { count: number; samples: string[] }>()
  private preparedBasePlans: PreparedBasePlan[] = []
  private successfulBaseIds = new Set<string>()
  private targetCountByBaseId = new Map<string, number>()
  private executionErrors: string[] = []

  override reset(): void {
    this.sourceCount = 0
    this.skippedCount = 0
    this.warnings = []
    this.skippedWarnings = new Map<string, { count: number; samples: string[] }>()
    this.preparedBasePlans = []
    this.successfulBaseIds = new Set<string>()
    this.targetCountByBaseId = new Map<string, number>()
    this.executionErrors = []
  }

  private getTempVectorStorePath(dbPath: string): string {
    return `${dbPath}.vectorstore.tmp`
  }

  private getLegacyBackupPath(dbPath: string): string {
    return `${dbPath}${LEGACY_VECTOR_BACKUP_SUFFIX}`
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
      const summary = `Skipped knowledge vector records (${reason}): count=${bucket.count}; examples: ${bucket.samples.join(' | ')}`
      this.recordWarning(summary)
    }

    this.skippedWarnings.clear()
  }

  private async ensureVectorStoreSchema(client: Client, dimensions: number): Promise<void> {
    await client.execute({
      sql: `
        CREATE TABLE IF NOT EXISTS ${VECTORSTORE_TABLE_NAME} (
          id TEXT PRIMARY KEY,
          external_id TEXT,
          collection TEXT,
          document TEXT,
          metadata JSON DEFAULT '{}',
          embeddings F32_BLOB(${dimensions})
        )
      `,
      args: []
    })

    const indexStatements = [
      `
        CREATE INDEX IF NOT EXISTS idx_${VECTORSTORE_TABLE_NAME}_external_id
        ON ${VECTORSTORE_TABLE_NAME} (external_id)
      `,
      `
        CREATE INDEX IF NOT EXISTS idx_${VECTORSTORE_TABLE_NAME}_collection
        ON ${VECTORSTORE_TABLE_NAME} (collection)
      `
    ]

    for (const statement of indexStatements) {
      await client.execute({ sql: statement, args: [] })
    }

    const ftsTableName = `${VECTORSTORE_TABLE_NAME}_fts`
    await client.execute({
      sql: `
        CREATE VIRTUAL TABLE IF NOT EXISTS ${ftsTableName}
        USING fts5(document, content='${VECTORSTORE_TABLE_NAME}', content_rowid='rowid')
      `,
      args: []
    })

    await client.execute({
      sql: `
        CREATE TRIGGER IF NOT EXISTS ${VECTORSTORE_TABLE_NAME}_ai
        AFTER INSERT ON ${VECTORSTORE_TABLE_NAME}
        BEGIN
          INSERT INTO ${ftsTableName}(rowid, document)
          VALUES (NEW.rowid, NEW.document);
        END
      `,
      args: []
    })

    await client.execute({
      sql: `
        CREATE TRIGGER IF NOT EXISTS ${VECTORSTORE_TABLE_NAME}_au
        AFTER UPDATE OF document ON ${VECTORSTORE_TABLE_NAME}
        BEGIN
          INSERT INTO ${ftsTableName}(${ftsTableName}, rowid, document)
          VALUES ('delete', OLD.rowid, OLD.document);
          INSERT INTO ${ftsTableName}(rowid, document)
          VALUES (NEW.rowid, NEW.document);
        END
      `,
      args: []
    })

    await client.execute({
      sql: `
        CREATE TRIGGER IF NOT EXISTS ${VECTORSTORE_TABLE_NAME}_ad
        AFTER DELETE ON ${VECTORSTORE_TABLE_NAME}
        BEGIN
          INSERT INTO ${ftsTableName}(${ftsTableName}, rowid, document)
          VALUES ('delete', OLD.rowid, OLD.document);
        END
      `,
      args: []
    })
  }

  private async insertVectorRows(
    client: Client,
    rows: Array<PreparedVectorRow & { id: string }>,
    collection: string
  ): Promise<void> {
    if (rows.length === 0) {
      return
    }

    const placeholders = rows
      .map(
        (_, index) =>
          `(?${index * 6 + 1}, ?${index * 6 + 2}, ?${index * 6 + 3}, ?${index * 6 + 4}, ?${index * 6 + 5}, vector32(?${index * 6 + 6}))`
      )
      .join(', ')

    const args = rows.flatMap((row) => [
      row.id,
      row.externalId,
      collection,
      row.document,
      JSON.stringify({
        itemId: row.externalId,
        itemType: row.itemType,
        source: row.source,
        chunkIndex: row.chunkIndex,
        tokenCount: row.tokenCount
      }),
      `[${row.embedding.join(',')}]`
    ])

    await client.execute({
      sql: `
        INSERT INTO ${VECTORSTORE_TABLE_NAME}
          (id, external_id, collection, document, metadata, embeddings)
        VALUES ${placeholders}
      `,
      args
    })
  }

  private getMigratedItemSource(data: KnowledgeItemData): string {
    if (!data || typeof data !== 'object' || !('source' in data) || typeof data.source !== 'string') {
      return ''
    }

    return data.source.trim()
  }

  private buildLoaderTargetMap(
    legacyBase: LegacyKnowledgeBaseWithLoaders | undefined,
    migratedItemsById: Map<string, MigratedKnowledgeItemForVector>
  ): Map<string, LoaderTarget> {
    const map = new Map<string, LoaderTarget>()
    if (!legacyBase || !Array.isArray(legacyBase.items)) {
      return map
    }

    for (const item of legacyBase.items) {
      if (!item.id) {
        continue
      }

      const migratedItem = migratedItemsById.get(item.id)
      if (!migratedItem) {
        continue
      }

      const target: LoaderTarget = {
        id: migratedItem.id,
        itemType: migratedItem.type,
        source: this.getMigratedItemSource(migratedItem.data)
      }

      if (Array.isArray(item.uniqueIds) && item.uniqueIds.length > 0) {
        for (const uniqueId of item.uniqueIds) {
          if (typeof uniqueId === 'string' && uniqueId.trim() !== '') {
            map.set(uniqueId, target)
          }
        }
        continue
      }

      if (typeof item.uniqueId === 'string' && item.uniqueId.trim() !== '') {
        map.set(item.uniqueId, target)
      }
    }

    return map
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const knowledgeState = ctx.sources.reduxState.getCategory<LegacyKnowledgeStateWithLoaders>('knowledge')
      const migratedBases = await ctx.db.select().from(knowledgeBaseTable)

      if (!knowledgeState?.bases || knowledgeState.bases.length === 0 || migratedBases.length === 0) {
        return {
          success: true,
          itemCount: 0
        }
      }

      const migratedItems = await ctx.db
        .select({
          id: knowledgeItemTable.id,
          baseId: knowledgeItemTable.baseId,
          type: knowledgeItemTable.type,
          data: knowledgeItemTable.data
        })
        .from(knowledgeItemTable)

      const migratedItemsByBaseId = new Map<string, Map<string, MigratedKnowledgeItemForVector>>()
      for (const item of migratedItems) {
        const bucket = migratedItemsByBaseId.get(item.baseId) ?? new Map<string, MigratedKnowledgeItemForVector>()
        bucket.set(item.id, item)
        migratedItemsByBaseId.set(item.baseId, bucket)
      }

      const legacyBasesById = new Map(
        knowledgeState.bases
          .filter((base): base is LegacyKnowledgeBaseWithLoaders & { id: string } => typeof base.id === 'string')
          .map((base) => [base.id, base])
      )

      for (const base of migratedBases) {
        if (base.status === 'failed' || base.embeddingModelId === null) {
          const warningMessage = `Skipped knowledge vector base ${base.id}: missing embedding model`
          this.recordSkippedWarning('missing_embedding_model', warningMessage)
          continue
        }

        const legacyBase = legacyBasesById.get(base.id)
        if (!legacyBase) {
          const warningMessage = `Skipped knowledge vector base ${base.id}: legacy knowledge base not found`
          this.recordSkippedWarning('legacy_base_missing', warningMessage)
          continue
        }

        const source = await ctx.sources.knowledgeVectorSource.loadBase(base.id)
        switch (source.status) {
          case 'invalid_path': {
            const warningMessage = `Skipped knowledge vector base ${base.id}: invalid legacy vector DB path`
            this.recordSkippedWarning('invalid_path', warningMessage)
            continue
          }
          case 'missing': {
            const warningMessage = `Skipped knowledge vector base ${base.id}: legacy vector DB missing`
            this.recordSkippedWarning('missing', warningMessage)
            continue
          }
          case 'directory': {
            const warningMessage = `Skipped knowledge vector base ${base.id}: legacy vector DB path is a directory`
            this.recordSkippedWarning('directory', warningMessage)
            continue
          }
          case 'not_embedjs': {
            const warningMessage = `Skipped knowledge vector base ${base.id}: legacy DB is not embedjs format`
            this.recordSkippedWarning('not_embedjs', warningMessage)
            continue
          }
        }

        const vectorRows = source.rows
        this.sourceCount += vectorRows.length

        const loaderTargetMap = this.buildLoaderTargetMap(
          legacyBase,
          migratedItemsByBaseId.get(base.id) ?? new Map<string, MigratedKnowledgeItemForVector>()
        )
        const rows: PreparedVectorRow[] = []
        const chunkIndexByItemId = new Map<string, number>()

        for (const row of vectorRows) {
          // V2 only keeps vectors that can be proven to belong to an existing
          // migrated knowledge_item row. Unmapped legacy vectors are treated
          // as invalid index residue and are intentionally dropped.
          const target = loaderTargetMap.get(row.uniqueLoaderId)
          if (!target) {
            this.skippedCount += 1
            const warningMessage = `Skipped knowledge vector row in base ${base.id}: uniqueLoaderId '${row.uniqueLoaderId}' cannot be mapped to item.id`
            this.recordSkippedWarning('unmapped_loader', warningMessage)
            continue
          }

          if (!INDEXABLE_KNOWLEDGE_ITEM_TYPES.has(target.itemType)) {
            this.skippedCount += 1
            const warningMessage = `Skipped knowledge vector row in base ${base.id}: container item '${target.id}' of type '${target.itemType}' is not indexable`
            this.recordSkippedWarning('non_indexable_container', warningMessage)
            continue
          }

          if (!row.vector || row.vector.length === 0) {
            this.skippedCount += 1
            const warningMessage = `Skipped knowledge vector row in base ${base.id}: vector payload missing for uniqueLoaderId '${row.uniqueLoaderId}'`
            this.recordSkippedWarning('missing_vector_payload', warningMessage)
            continue
          }

          const sourceText = row.source.trim() || target.source
          if (sourceText === '') {
            this.skippedCount += 1
            const warningMessage = `Skipped knowledge vector row in base ${base.id}: source missing for item '${target.id}'`
            this.recordSkippedWarning('missing_source', warningMessage)
            continue
          }

          const chunkIndex = chunkIndexByItemId.get(target.id) ?? 0
          chunkIndexByItemId.set(target.id, chunkIndex + 1)

          rows.push({
            document: row.pageContent,
            externalId: target.id,
            itemType: target.itemType,
            source: sourceText,
            chunkIndex,
            tokenCount: estimateTokenCount(row.pageContent),
            embedding: row.vector
          })
        }

        // A base is still planned even when rows.length === 0. In that case the
        // rebuilt V2 vector store is intentionally empty because none of the
        // legacy vectors can be associated with valid migrated knowledge_item rows.
        this.preparedBasePlans.push({
          baseId: base.id,
          dbPath: source.dbPath,
          dimensions: base.dimensions,
          rows,
          sourceRowCount: vectorRows.length
        })
      }

      this.flushSkippedWarnings()

      return {
        success: true,
        itemCount: this.sourceCount,
        warnings: this.warnings.length > 0 ? this.warnings : undefined
      }
    } catch (error) {
      logger.error('KnowledgeVectorMigrator.prepare failed', error as Error)
      return {
        success: false,
        itemCount: this.sourceCount,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(): Promise<ExecuteResult> {
    if (this.preparedBasePlans.length === 0) {
      return {
        success: true,
        processedCount: 0
      }
    }

    const totalWork = this.preparedBasePlans.reduce((sum, plan) => sum + Math.max(plan.rows.length, 1), 0)
    let processedWork = 0
    let processedCount = 0

    for (const plan of this.preparedBasePlans) {
      const tempPath = this.getTempVectorStorePath(plan.dbPath)
      const backupPath = this.getLegacyBackupPath(plan.dbPath)

      try {
        const rebuiltRows: Array<PreparedVectorRow & { id: string }> = plan.rows.map((row) => ({
          ...row,
          id: uuidv4()
        }))

        await fs.promises.rm(tempPath, { force: true })

        const targetClient = createClient({ url: pathToFileURL(tempPath).toString() })
        try {
          await this.ensureVectorStoreSchema(targetClient, plan.dimensions)

          for (let i = 0; i < rebuiltRows.length; i += INSERT_BATCH_SIZE) {
            const batch = rebuiltRows.slice(i, i + INSERT_BATCH_SIZE)
            await this.insertVectorRows(targetClient, batch, plan.baseId)
            processedWork += batch.length
            this.reportProgress(
              Math.round((processedWork / totalWork) * 100),
              `Migrated ${processedWork}/${totalWork} knowledge vector work units`,
              {
                key: 'migration.progress.migrated_knowledge_vectors',
                params: { processed: processedWork, total: totalWork }
              }
            )
            await yieldToEventLoop()
          }
        } finally {
          targetClient.close()
        }

        if (rebuiltRows.length === 0) {
          processedWork += 1
          this.reportProgress(
            Math.round((processedWork / totalWork) * 100),
            `Migrated ${processedWork}/${totalWork} knowledge vector work units`,
            {
              key: 'migration.progress.migrated_knowledge_vectors',
              params: { processed: processedWork, total: totalWork }
            }
          )
          await yieldToEventLoop()
        }

        // First migration preserves the legacy embedjs DB; retries remove the stale failed target before swapping.
        if (!fs.existsSync(backupPath) && fs.existsSync(plan.dbPath)) {
          await fs.promises.rename(plan.dbPath, backupPath)
        } else {
          await fs.promises.rm(plan.dbPath, { force: true })
        }
        await fs.promises.rename(tempPath, plan.dbPath)

        this.successfulBaseIds.add(plan.baseId)
        this.targetCountByBaseId.set(plan.baseId, rebuiltRows.length)
        processedCount += rebuiltRows.length
      } catch (error) {
        const errorMessage = `Knowledge vector base ${plan.baseId} execution failed: ${error instanceof Error ? error.message : String(error)}`
        logger.error(errorMessage, error instanceof Error ? error : new Error(String(error)))
        this.executionErrors.push(errorMessage)

        await fs.promises.rm(tempPath, { force: true })

        return {
          success: false,
          processedCount,
          error: errorMessage
        }
      }
    }

    logger.info('KnowledgeVectorMigrator.execute completed', {
      processedCount,
      successfulBaseCount: this.successfulBaseIds.size,
      warningCount: this.warnings.length,
      executionErrorCount: this.executionErrors.length
    })

    return {
      success: true,
      processedCount
    }
  }

  async validate(): Promise<ValidateResult> {
    const errors: ValidationError[] = []
    let targetCount = 0

    try {
      for (const plan of this.preparedBasePlans) {
        if (!this.successfulBaseIds.has(plan.baseId)) {
          continue
        }

        const client = createClient({ url: pathToFileURL(plan.dbPath).toString() })
        try {
          const expectedCount = this.targetCountByBaseId.get(plan.baseId) ?? 0
          const countResult = await client.execute({
            sql: `SELECT count(*) AS count FROM ${VECTORSTORE_TABLE_NAME}`,
            args: []
          })
          const actualCount = Number(countResult.rows[0]?.count ?? 0)
          targetCount += actualCount

          if (actualCount !== expectedCount) {
            errors.push({
              key: `knowledge_vector_count_mismatch_${plan.baseId}`,
              expected: expectedCount,
              actual: actualCount,
              message: `Knowledge vector count mismatch for base ${plan.baseId}: expected ${expectedCount}, got ${actualCount}`
            })
          }

          const missingExternalIdResult = await client.execute({
            sql: `SELECT count(*) AS count FROM ${VECTORSTORE_TABLE_NAME} WHERE external_id IS NULL OR external_id = ''`,
            args: []
          })
          const missingExternalIdCount = Number(missingExternalIdResult.rows[0]?.count ?? 0)
          if (missingExternalIdCount > 0) {
            errors.push({
              key: `knowledge_vector_missing_external_id_${plan.baseId}`,
              expected: 0,
              actual: missingExternalIdCount,
              message: `Found ${missingExternalIdCount} knowledge vector rows without external_id in base ${plan.baseId}`
            })
          }

          const metadataResult = await client.execute({
            sql: `SELECT id, external_id, metadata FROM ${VECTORSTORE_TABLE_NAME}`,
            args: []
          })

          let invalidMetadataCount = 0
          let mismatchedItemIdCount = 0

          for (const row of metadataResult.rows) {
            let metadata: unknown

            try {
              metadata = JSON.parse(String(row.metadata ?? '{}'))
            } catch {
              invalidMetadataCount += 1
              continue
            }

            const parsedMetadata = KnowledgeChunkMetadataSchema.safeParse(metadata)
            if (!parsedMetadata.success) {
              invalidMetadataCount += 1
              continue
            }

            const externalId = typeof row.external_id === 'string' ? row.external_id : String(row.external_id ?? '')
            if (parsedMetadata.data.itemId !== externalId) {
              mismatchedItemIdCount += 1
            }
          }

          if (invalidMetadataCount > 0) {
            errors.push({
              key: `knowledge_vector_invalid_metadata_${plan.baseId}`,
              expected: 0,
              actual: invalidMetadataCount,
              message: `Found ${invalidMetadataCount} knowledge vector rows with invalid runtime metadata in base ${plan.baseId}`
            })
          }

          if (mismatchedItemIdCount > 0) {
            errors.push({
              key: `knowledge_vector_mismatched_item_id_${plan.baseId}`,
              expected: 0,
              actual: mismatchedItemIdCount,
              message: `Found ${mismatchedItemIdCount} knowledge vector rows whose metadata.itemId does not match external_id in base ${plan.baseId}`
            })
          }
        } finally {
          client.close()
        }
      }

      logger.info('KnowledgeVectorMigrator.validate completed', {
        sourceCount: this.sourceCount,
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
      logger.error('KnowledgeVectorMigrator.validate failed', error as Error)
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
          targetCount,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}
