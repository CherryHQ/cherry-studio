import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { type Client, createClient, type Value as LibsqlValue } from '@libsql/client'
import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import { sanitizeFilename } from '@main/utils/file'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { v4 as uuidv4 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('KnowledgeVectorMigrator')

const LEGACY_VECTOR_TABLE_NAME = 'vectors'
const VECTORSTORE_TABLE_NAME = 'libsql_vectorstores_embedding'
const INSERT_BATCH_SIZE = 100

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

interface LegacyVectorRow {
  pageContent: string
  uniqueLoaderId: string
  source: string
  vector: number[] | null
}

interface PreparedVectorRow {
  document: string
  externalId: string
  source: string
  embedding: number[]
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
  private preparedBasePlans: PreparedBasePlan[] = []
  private successfulBaseIds = new Set<string>()
  private targetCountByBaseId = new Map<string, number>()

  override reset(): void {
    this.sourceCount = 0
    this.skippedCount = 0
    this.warnings = []
    this.preparedBasePlans = []
    this.successfulBaseIds = new Set<string>()
    this.targetCountByBaseId = new Map<string, number>()
  }

  private getTempVectorStorePath(dbPath: string): string {
    return `${dbPath}.vectorstore.tmp`
  }

  private getLegacyKnowledgeDbPath(baseId: string): string | null {
    const rootPath = path.resolve(getDataPath(), 'KnowledgeBase')
    const sanitizedBaseId = sanitizeFilename(baseId, '_')
    const resolvedDbPath = path.resolve(rootPath, sanitizedBaseId)
    const relativePath = path.relative(rootPath, resolvedDbPath)

    if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      const warningMessage = `Skipped knowledge vector base ${baseId}: invalid legacy vector DB path`
      logger.warn(warningMessage)
      this.warnings.push(warningMessage)
      return null
    }

    return resolvedDbPath
  }

  private async isEmbedjsDatabase(client: Client): Promise<boolean> {
    const result = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      args: [LEGACY_VECTOR_TABLE_NAME]
    })

    return result.rows.length > 0
  }

  private async readLegacyVectorRows(client: Client): Promise<LegacyVectorRow[]> {
    const result = await client.execute({
      sql: `SELECT pageContent, uniqueLoaderId, source, vector FROM ${LEGACY_VECTOR_TABLE_NAME}`,
      args: []
    })

    return result.rows.map((row) => ({
      pageContent: String(row.pageContent ?? ''),
      uniqueLoaderId: String(row.uniqueLoaderId ?? ''),
      source: String(row.source ?? ''),
      vector: this.deserializeLegacyVector(row.vector)
    }))
  }

  // libsql F32_BLOB values are not decoded to one stable JS type across
  // client/runtime combinations. In local verification on macOS this returns
  // ArrayBuffer, but other environments may expose Float32Array or another
  // ArrayBufferView, so keep the decoder intentionally permissive.
  private deserializeLegacyVector(raw: LibsqlValue): number[] | null {
    if (raw === null || raw === undefined) {
      return null
    }

    if (raw instanceof Float32Array) {
      return Array.from(raw)
    }

    if (raw instanceof ArrayBuffer) {
      return Array.from(new Float32Array(raw))
    }

    if (ArrayBuffer.isView(raw)) {
      const view = raw as ArrayBufferView
      return Array.from(
        new Float32Array(view.buffer, view.byteOffset, view.byteLength / Float32Array.BYTES_PER_ELEMENT)
      )
    }

    if (Array.isArray(raw)) {
      return raw.map((value) => Number(value))
    }

    return null
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
      `,
      `
        CREATE INDEX IF NOT EXISTS idx_${VECTORSTORE_TABLE_NAME}_vector
        ON ${VECTORSTORE_TABLE_NAME} (libsql_vector_idx(embeddings, 'metric=cosine'))
      `
    ]

    for (const statement of indexStatements) {
      try {
        await client.execute({ sql: statement, args: [] })
      } catch (error) {
        logger.warn(`Failed to create vector index for table ${VECTORSTORE_TABLE_NAME}`, error as Error)
      }
    }

    const ftsTableName = `${VECTORSTORE_TABLE_NAME}_fts`
    try {
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
    } catch (error) {
      logger.warn(`Failed to create FTS schema for table ${VECTORSTORE_TABLE_NAME}`, error as Error)
    }
  }

  private async insertVectorRows(client: Client, rows: Array<PreparedVectorRow & { id: string }>): Promise<void> {
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
      '',
      row.document,
      JSON.stringify({ source: row.source }),
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

  private buildLoaderKeyMap(
    legacyBase: LegacyKnowledgeBaseWithLoaders | undefined,
    migratedItemIds: Set<string>
  ): Map<string, string> {
    const map = new Map<string, string>()
    if (!legacyBase || !Array.isArray(legacyBase.items)) {
      return map
    }

    for (const item of legacyBase.items) {
      if (!item.id || !migratedItemIds.has(item.id)) {
        continue
      }

      if (Array.isArray(item.uniqueIds) && item.uniqueIds.length > 0) {
        for (const uniqueId of item.uniqueIds) {
          if (typeof uniqueId === 'string' && uniqueId.trim() !== '') {
            map.set(uniqueId, item.id)
          }
        }
        continue
      }

      if (typeof item.uniqueId === 'string' && item.uniqueId.trim() !== '') {
        map.set(item.uniqueId, item.id)
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
        .select({ id: knowledgeItemTable.id, baseId: knowledgeItemTable.baseId })
        .from(knowledgeItemTable)

      const migratedItemIdsByBaseId = new Map<string, Set<string>>()
      for (const item of migratedItems) {
        const bucket = migratedItemIdsByBaseId.get(item.baseId) ?? new Set<string>()
        bucket.add(item.id)
        migratedItemIdsByBaseId.set(item.baseId, bucket)
      }

      const legacyBasesById = new Map(
        knowledgeState.bases
          .filter((base): base is LegacyKnowledgeBaseWithLoaders & { id: string } => typeof base.id === 'string')
          .map((base) => [base.id, base])
      )

      for (const base of migratedBases) {
        const legacyBase = legacyBasesById.get(base.id)
        if (!legacyBase) {
          const warningMessage = `Skipped knowledge vector base ${base.id}: legacy knowledge base not found`
          logger.warn(warningMessage)
          this.warnings.push(warningMessage)
          continue
        }

        const dbPath = this.getLegacyKnowledgeDbPath(base.id)
        if (!dbPath) {
          continue
        }

        if (!fs.existsSync(dbPath)) {
          const warningMessage = `Skipped knowledge vector base ${base.id}: legacy vector DB missing`
          logger.warn(warningMessage)
          this.warnings.push(warningMessage)
          continue
        }

        const stat = fs.statSync(dbPath)
        if (stat.isDirectory()) {
          const warningMessage = `Skipped knowledge vector base ${base.id}: legacy vector DB path is a directory`
          logger.warn(warningMessage)
          this.warnings.push(warningMessage)
          continue
        }

        const client = createClient({ url: pathToFileURL(dbPath).toString() })
        try {
          const isEmbedjs = await this.isEmbedjsDatabase(client)
          if (!isEmbedjs) {
            const warningMessage = `Skipped knowledge vector base ${base.id}: legacy DB is not embedjs format`
            logger.warn(warningMessage)
            this.warnings.push(warningMessage)
            continue
          }

          const vectorRows = await this.readLegacyVectorRows(client)
          this.sourceCount += vectorRows.length

          const loaderKeyMap = this.buildLoaderKeyMap(
            legacyBase,
            migratedItemIdsByBaseId.get(base.id) ?? new Set<string>()
          )
          const rows: PreparedVectorRow[] = []

          for (const row of vectorRows) {
            const externalId = loaderKeyMap.get(row.uniqueLoaderId)
            if (!externalId) {
              this.skippedCount += 1
              const warningMessage = `Skipped knowledge vector row in base ${base.id}: uniqueLoaderId '${row.uniqueLoaderId}' cannot be mapped to item.id`
              logger.warn(warningMessage)
              this.warnings.push(warningMessage)
              continue
            }

            if (!row.vector || row.vector.length === 0) {
              this.skippedCount += 1
              const warningMessage = `Skipped knowledge vector row in base ${base.id}: vector payload missing for uniqueLoaderId '${row.uniqueLoaderId}'`
              logger.warn(warningMessage)
              this.warnings.push(warningMessage)
              continue
            }

            rows.push({
              document: row.pageContent,
              externalId,
              source: row.source,
              embedding: row.vector
            })
          }

          this.preparedBasePlans.push({
            baseId: base.id,
            dbPath,
            dimensions: base.dimensions,
            rows,
            sourceRowCount: vectorRows.length
          })
        } finally {
          client.close()
        }
      }

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

      try {
        const rebuiltRows: Array<PreparedVectorRow & { id: string }> = plan.rows.map((row) => ({
          ...row,
          id: uuidv4()
        }))

        if (fs.existsSync(tempPath)) {
          fs.rmSync(tempPath, { force: true })
        }

        const targetClient = createClient({ url: pathToFileURL(tempPath).toString() })
        try {
          await this.ensureVectorStoreSchema(targetClient, plan.dimensions)

          for (let i = 0; i < rebuiltRows.length; i += INSERT_BATCH_SIZE) {
            await this.insertVectorRows(targetClient, rebuiltRows.slice(i, i + INSERT_BATCH_SIZE))
          }
        } finally {
          targetClient.close()
        }

        if (fs.existsSync(plan.dbPath)) {
          fs.rmSync(plan.dbPath, { force: true })
        }

        fs.renameSync(tempPath, plan.dbPath)

        this.successfulBaseIds.add(plan.baseId)
        this.targetCountByBaseId.set(plan.baseId, rebuiltRows.length)
        processedCount += rebuiltRows.length
      } catch (error) {
        this.skippedCount += plan.rows.length
        const warningMessage = `Skipped knowledge vector base ${plan.baseId}: ${error instanceof Error ? error.message : String(error)}`
        logger.warn(warningMessage)
        this.warnings.push(warningMessage)

        if (fs.existsSync(tempPath)) {
          fs.rmSync(tempPath, { force: true })
        }
      } finally {
        processedWork += Math.max(plan.rows.length, 1)
        this.reportProgress(
          Math.round((processedWork / totalWork) * 100),
          `Migrated ${processedWork}/${totalWork} knowledge vector work units`,
          {
            key: 'migration.progress.migrated_knowledge_vectors',
            params: { processed: processedWork, total: totalWork }
          }
        )
      }
    }

    logger.info('KnowledgeVectorMigrator.execute completed', {
      processedCount,
      successfulBaseCount: this.successfulBaseIds.size,
      warningCount: this.warnings.length
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

          const missingSourceResult = await client.execute({
            sql: `SELECT count(*) AS count FROM ${VECTORSTORE_TABLE_NAME} WHERE json_extract(metadata, '$.source') IS NULL OR json_extract(metadata, '$.source') = ''`,
            args: []
          })
          const missingSourceCount = Number(missingSourceResult.rows[0]?.count ?? 0)
          if (missingSourceCount > 0) {
            errors.push({
              key: `knowledge_vector_missing_source_${plan.baseId}`,
              expected: 0,
              actual: missingSourceCount,
              message: `Found ${missingSourceCount} knowledge vector rows without metadata.source in base ${plan.baseId}`
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
