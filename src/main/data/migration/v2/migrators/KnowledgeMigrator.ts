/** Migrates legacy knowledge bases/items from Redux and Dexie exports into SQLite. */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { assistantKnowledgeBaseTable } from '@data/db/schemas/assistantRelations'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { createClient, type Value as LibsqlValue } from '@libsql/client'
import { loggerService } from '@logger'
import {
  needsProcessedArtifactReservation,
  reserveImportedFileRelativePath
} from '@main/features/knowledge/utils/storage/pathStorage'
import { sanitizeFilename } from '@main/utils/file'
import { copy, ensureDir } from '@main/utils/file/fs'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import {
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  KNOWLEDGE_BASE_ERROR_MISSING_VECTOR_STORE
} from '@shared/data/types/knowledge'
import type { FilePath } from '@shared/types/file'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import type { KnowledgeVectorSourceReader } from '../utils/KnowledgeVectorSourceReader'
import { BaseMigrator } from './BaseMigrator'
import {
  expandLegacyDirectoryItem,
  inferKnowledgeItemStatus,
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
import { legacyModelToUniqueId, resolveModelReference } from './transformers/ModelTransformers'

const logger = loggerService.withContext('KnowledgeMigrator')

const ITEM_INSERT_BATCH_SIZE = 200
const LOOKUP_STREAM_BATCH_SIZE = 200
const LEGACY_VECTOR_TABLE_NAME = 'vectors'
const SKIP_WARNING_SAMPLE_LIMIT = 3
export const KNOWLEDGE_BASE_ID_REMAP_SHARED_DATA_KEY = 'knowledgeBaseIdRemap'
export const KNOWLEDGE_ITEM_ID_REMAP_SHARED_DATA_KEY = 'knowledgeItemIdRemap'
export const KNOWLEDGE_DIRECTORY_CHILD_LOADER_REMAP_SHARED_DATA_KEY = 'knowledgeDirectoryChildLoaderRemap'
export type KnowledgeBaseIdRemap = Map<string, string>
export type KnowledgeItemIdRemap = Map<string, string>

type DimensionResolutionReason =
  | 'ok'
  | 'vector_db_missing'
  | 'legacy_vector_store_directory'
  | 'vector_db_empty'
  | 'invalid_vector_dimensions'
  | 'vector_db_invalid_path'
  | 'vector_db_error'

/**
 * Outcome of reading a base's legacy `uniqueLoaderId → source` map. `kind` lets the caller tell
 * a (recoverable) read failure (`read_error`, which warrants a retry-to-recover hint) from a
 * successful read (`loaded`) — the latter covers both a populated and a genuinely empty/absent
 * vector store, which callers treat the same (an empty `sources` map naturally yields no expansion).
 */
type LoaderSourceMapResult = {
  kind: 'loaded' | 'read_error'
  sources: Map<string, string>
}

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

const resolveLegacyKnowledgeBaseDimensions = (base: LegacyKnowledgeBaseWithIdentity): number | null => {
  return typeof base.dimensions === 'number' && Number.isInteger(base.dimensions) && base.dimensions > 0
    ? base.dimensions
    : null
}

export class KnowledgeMigrator extends BaseMigrator {
  readonly id = 'knowledge'
  readonly name = 'KnowledgeBase'
  readonly description = 'Migrate knowledge base and knowledge item data'
  readonly order = 1.8

  private sourceCount = 0
  private skippedCount = 0
  private preparedBases: NewKnowledgeBase[] = []
  private preparedItems: NewKnowledgeItem[] = []
  private skippedPreparedItemIds = new Set<string>()
  private warnings: string[] = []
  private skippedWarnings = new Map<string, { count: number; samples: string[] }>()
  private seenLegacyBaseIds = new Set<string>()
  private seenLegacyItemIds = new Set<string>()
  private legacyBaseIdRemap = new Map<string, string>()
  private legacyItemIdRemap = new Map<string, string>()
  // New item id → v1 storage filename, so `execute` can copy the upload into the v2 KB dir.
  private fileStorageNameByItemId = new Map<string, string>()
  // migrated base id → (v1 directory child file's loader id → synthesized v2 child item id);
  // handed to the vector migrator via sharedData so it re-attributes the folder's vectors to
  // those children. Scoped per base because v1 loader ids are path/content hashes
  // (`md5(path)` / `md5(text)`) with no base component, so two bases sharing a file path would
  // otherwise clobber each other's mapping and drop the earlier base's vectors.
  private directoryChildLoaderRemap = new Map<string, Map<string, string>>()
  // Synthesized directory-child item ids: `file` items whose source stays at data.source on
  // external disk (never copied into the base), so copyKnowledgeFilesForBase must skip them.
  private migratedDirectoryChildItemIds = new Set<string>()

  override reset(): void {
    this.sourceCount = 0
    this.skippedCount = 0
    this.preparedBases = []
    this.preparedItems = []
    this.skippedPreparedItemIds = new Set<string>()
    this.warnings = []
    this.skippedWarnings = new Map<string, { count: number; samples: string[] }>()
    this.seenLegacyBaseIds = new Set<string>()
    this.seenLegacyItemIds = new Set<string>()
    this.legacyBaseIdRemap = new Map<string, string>()
    this.legacyItemIdRemap = new Map<string, string>()
    this.fileStorageNameByItemId = new Map<string, string>()
    this.directoryChildLoaderRemap = new Map<string, Map<string, string>>()
    this.migratedDirectoryChildItemIds = new Set<string>()
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

  private getEffectiveSkippedCount(): number {
    return this.skippedCount + this.skippedPreparedItemIds.size
  }

  private async dropDanglingAssistantKnowledgeBaseRefs(ctx: MigrationContext): Promise<void> {
    await ctx.db
      .delete(assistantKnowledgeBaseTable)
      .where(
        sql`${assistantKnowledgeBaseTable.knowledgeBaseId} NOT IN (SELECT ${knowledgeBaseTable.id} FROM ${knowledgeBaseTable})`
      )
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

  /**
   * Read the legacy vector DB's `uniqueLoaderId → source` map (via the shared
   * {@link KnowledgeVectorSourceReader}, so directory expansion and vector migration consume
   * the exact same load + path resolution) so a `directory` item can be expanded into per-file
   * children (each file's loader id resolves to its source path). The discriminated `kind`
   * distinguishes a (recoverable) read failure from a successful read — a thrown read is
   * `read_error` (so the caller can warn precisely); a missing DB / directory / non-embedjs /
   * zero rows is a `loaded` read with an empty `sources` map. Both keep the directory tombstone.
   * Best-effort: failures are caught, never thrown.
   */
  private async loadLoaderSourceMap(
    baseId: string,
    vectorSource: KnowledgeVectorSourceReader
  ): Promise<LoaderSourceMapResult> {
    const sources = new Map<string, string>()
    try {
      const result = await vectorSource.loadBase(baseId)
      if (result.status !== 'ok') {
        return { kind: 'loaded', sources }
      }
      for (const row of result.rows) {
        if (row.uniqueLoaderId && row.source && row.source.trim() !== '') {
          sources.set(row.uniqueLoaderId, row.source)
        }
      }
    } catch (error) {
      // Keep the exception detail in the log; the caller emits the user-facing, actionable
      // migration warning based on the `read_error` kind (a transient DB lock is recoverable
      // by re-running, unlike a genuinely empty store).
      logger.warn(
        `Failed to read legacy vector sources for knowledge base ${baseId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      return { kind: 'read_error', sources }
    }

    return { kind: 'loaded', sources }
  }

  /**
   * A v1-indexed folder eligible for re-attribution into per-file children: a not-yet-seen
   * `completed` directory with an id. Shared by the pre-loop "re-run can recover" warning gate
   * and the in-loop expansion branch so a predicate change touches only one place (the two
   * previously mirrored each other and would silently diverge).
   */
  private isExpandableCompletedDirectory(
    item: LegacyKnowledgeItem | undefined
  ): item is LegacyKnowledgeItem & { id: string } {
    return (
      item?.type === 'directory' &&
      !!item.id &&
      !this.seenLegacyItemIds.has(item.id) &&
      inferKnowledgeItemStatus(item) === 'completed'
    )
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

    if (reason === 'invalid_note') {
      return `Skipped note item with neither sourceUrl nor content (itemId=${item.id})`
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

        if (this.seenLegacyBaseIds.has(validBase.id)) {
          this.skippedCount += 1 + items.length
          this.sourceCount += items.length
          const warningMessage = `Skipped duplicate knowledge base ${validBase.id}`
          this.recordSkippedWarning('duplicate_knowledge_base', warningMessage)
          continue
        }

        const embeddingModelId = legacyModelToUniqueId(validBase.model ?? null)
        const embeddingResolution = resolveModelReference(embeddingModelId, validModelIds)
        const resolvedDimensions =
          embeddingResolution.kind === 'resolved'
            ? await this.resolveDimensionsForBase(validBase, ctx.paths.knowledgeBaseDir)
            : { dimensions: resolveLegacyKnowledgeBaseDimensions(validBase), reason: 'legacy_dimensions' as const }

        // A resolved embedding model whose per-base legacy vector store is missing/empty/locked
        // yields dimensions===null. We must NOT drop the base (that loses the library with no
        // recoverable row): keep it as a `failed` row, like the dangling-model branch below, so
        // the name/model/config/idle items survive and the UI offers a restore/re-index entry.
        // `vectorsWillMigrate` also gates directory expansion: a base whose vectors will not
        // migrate must not expand folders into `completed` children that would be empty shells.
        const vectorStoreUnresolved = embeddingResolution.kind === 'resolved' && resolvedDimensions.dimensions === null
        const vectorsWillMigrate = embeddingResolution.kind === 'resolved' && resolvedDimensions.dimensions !== null

        const baseResult = transformKnowledgeBase(validBase, resolvedDimensions.dimensions, (msg) =>
          this.recordWarning(msg)
        )
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

        if (vectorStoreUnresolved) {
          this.recordWarning(
            `Knowledge base ${validBase.id}: legacy vector store unreadable (${resolvedDimensions.reason}); kept as a restorable failed base (re-index to recover) instead of being dropped`
          )
          preparedBase.status = 'failed'
          preparedBase.error = KNOWLEDGE_BASE_ERROR_MISSING_VECTOR_STORE
        }

        const rerankResolution = resolveModelReference(preparedBase.rerankModelId ?? null, validModelIds)
        preparedBase.rerankModelId = rerankResolution.kind === 'resolved' ? rerankResolution.modelId : null
        if (rerankResolution.kind === 'dangling') {
          const warningMessage = `Knowledge base ${validBase.id}: dangling rerank model reference ${rerankResolution.modelId} was cleared`
          this.recordWarning(warningMessage)
        }

        this.seenLegacyBaseIds.add(validBase.id)
        this.legacyBaseIdRemap.set(validBase.id, preparedBase.id!)
        this.preparedBases.push(preparedBase)

        const invalidConfigWarning = getInvalidKnowledgeBaseConfigWarning(validBase, preparedBase)
        if (invalidConfigWarning) {
          this.recordWarning(invalidConfigWarning)
        }

        // Re-attribute a directory's vectors only when this base's vectors will actually
        // migrate (embedding model resolved AND dimensions known); otherwise the children would
        // claim `completed` with nothing behind them — including the dimensions===null /
        // missing-vector-store case above, which must keep its folders as tombstones. An empty
        // source map makes expandLegacyDirectoryItem return null, so the directory keeps its tombstone.
        const directoryLoaderResult: LoaderSourceMapResult =
          vectorsWillMigrate && items.some((candidate) => candidate?.type === 'directory')
            ? await this.loadLoaderSourceMap(validBase.id, ctx.sources.knowledgeVectorSource)
            : { kind: 'loaded', sources: new Map<string, string>() }

        // A read failure (e.g. a transient DB lock) is recoverable, unlike a genuinely empty
        // store: warn that this base's folders fell back to migration-failed tombstones and a re-run
        // may still recover them. Gate on an actually-expandable (`completed`) folder via the same
        // predicate the expansion branch uses (isExpandableCompletedDirectory) — an interrupted/idle
        // or id-less/cross-base-duplicate folder never expands, so the "re-run can recover" message
        // would be inaccurate. A successful read with an empty store is the expected no-op (the
        // per-folder tombstone already explains itself), so it stays quiet.
        const hasCompletedDirectory = items.some((candidate) => this.isExpandableCompletedDirectory(candidate))
        if (directoryLoaderResult.kind === 'read_error' && hasCompletedDirectory) {
          this.recordWarning(
            `Knowledge base ${validBase.id}: legacy vector sources were unreadable, so its v1 folders were kept as migration-failed tombstones; re-running migration once the legacy vector DB is readable can recover them without re-embedding`
          )
        }

        const directoryLoaderSources = directoryLoaderResult.sources

        for (const item of items) {
          this.sourceCount += 1

          // v1-indexed folder: re-attribute its dropped container vectors to synthesized
          // per-file children when the legacy vectors are readable. Only a `completed` folder
          // is expanded — an interrupted (failed/processing/pending) or never-indexed (idle)
          // folder falls through to transformKnowledgeItem so its real status is preserved
          // instead of being silently promoted to a fully `completed` container.
          if (this.isExpandableCompletedDirectory(item)) {
            const expanded = expandLegacyDirectoryItem(preparedBase.id!, item, directoryLoaderSources)
            if (expanded) {
              // Partial re-attribution: some embedded files had no migratable vectors and were
              // dropped. The resolved children are correct and stay `completed`; we surface the
              // loss as a migration warning rather than reflecting it on the container's status,
              // because a container with all-`completed` children reconciles back to `completed`
              // (reconcileContainers) and a per-container marker would not persist.
              const embeddedFileCount = (item.uniqueIds ?? []).filter(
                (loaderId) => typeof loaderId === 'string' && loaderId.trim() !== ''
              ).length
              if (expanded.children.length < embeddedFileCount) {
                this.recordWarning(
                  `Knowledge directory item ${item.id} in base ${validBase.id}: re-attributed vectors for ${expanded.children.length} of ${embeddedFileCount} embedded files; the rest had no migratable vectors and were dropped — re-index the folder to recover them`
                )
              }

              this.seenLegacyItemIds.add(item.id)
              this.legacyItemIdRemap.set(item.id, expanded.container.id!)
              this.preparedItems.push(expanded.container, ...expanded.children)
              for (const child of expanded.children) {
                this.migratedDirectoryChildItemIds.add(child.id!)
              }
              let baseChildLoaderRemap = this.directoryChildLoaderRemap.get(preparedBase.id!)
              if (!baseChildLoaderRemap) {
                baseChildLoaderRemap = new Map<string, string>()
                this.directoryChildLoaderRemap.set(preparedBase.id!, baseChildLoaderRemap)
              }
              for (const [loaderId, childId] of expanded.childLoaderRemap) {
                baseChildLoaderRemap.set(loaderId, childId)
              }
              continue
            }
          }

          const itemResult = transformKnowledgeItem(
            preparedBase.id!,
            item,
            {
              noteById,
              filesById
            },
            (msg) => this.recordWarning(msg)
          )

          if (!itemResult.ok) {
            this.skippedCount += 1
            const warningMessage = this.formatItemWarning(validBase.id, item, itemResult.reason)
            this.recordSkippedWarning(`knowledge_item_${itemResult.reason}`, warningMessage)
            continue
          }

          if (this.seenLegacyItemIds.has(item.id!)) {
            this.skippedCount += 1
            const warningMessage = `Skipped duplicate knowledge item ${item.id!} in base ${validBase.id}`
            this.recordSkippedWarning('duplicate_knowledge_item', warningMessage)
            continue
          }

          this.seenLegacyItemIds.add(item.id!)
          this.legacyItemIdRemap.set(item.id!, itemResult.value.id!)
          this.preparedItems.push(itemResult.value)
          if (itemResult.fileCopy) {
            this.fileStorageNameByItemId.set(itemResult.value.id!, itemResult.fileCopy.storageName)
          }
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
    this.skippedPreparedItemIds = new Set<string>()

    if (this.preparedBases.length === 0 && this.preparedItems.length === 0) {
      await this.dropDanglingAssistantKnowledgeBaseRefs(ctx)
      // No bases/items to migrate, but dropDangling may have pruned assistant_knowledge_base —
      // verify the domain is referentially clean (see the main-path note below).
      await this.assertOwnedForeignKeys(ctx.db, [knowledgeBaseTable, knowledgeItemTable, assistantKnowledgeBaseTable])
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

      // Cross-run idempotency lives at the engine level (verifyAndClearNewTables) — no onConflict guard needed here.
      const legacyBaseIdByMigratedId = new Map(
        [...this.legacyBaseIdRemap.entries()].map(([legacyBaseId, migratedBaseId]) => [migratedBaseId, legacyBaseId])
      )

      for (const base of this.preparedBases) {
        if (!base.id) {
          throw new Error('Prepared knowledge base is missing id')
        }

        const baseItems = itemsByBaseId.get(base.id) ?? []
        // Finalize relativePath + copy uploads before opening the write tx so no
        // file I/O happens while the transaction is held.
        await this.copyKnowledgeFilesForBase(ctx, base.id, base.fileProcessorId, baseItems)
        let transactionProcessed = 0

        const legacyKnowledgeBaseId = legacyBaseIdByMigratedId.get(base.id)

        await ctx.db.transaction(async (tx) => {
          await tx.insert(knowledgeBaseTable).values(base)
          transactionProcessed += 1

          for (let i = 0; i < baseItems.length; i += ITEM_INSERT_BATCH_SIZE) {
            const batch = baseItems.slice(i, i + ITEM_INSERT_BATCH_SIZE)
            await tx.insert(knowledgeItemTable).values(batch)
            transactionProcessed += batch.length
          }

          if (legacyKnowledgeBaseId !== undefined) {
            await tx
              .update(assistantKnowledgeBaseTable)
              .set({ knowledgeBaseId: base.id })
              .where(sql`${assistantKnowledgeBaseTable.knowledgeBaseId} = ${legacyKnowledgeBaseId}`)
          }
        })

        processed += transactionProcessed
        const progress = Math.round((processed / total) * 100)
        this.reportProgress(progress, `Migrated ${processed}/${total} knowledge records`, {
          key: 'migration.progress.migrated_knowledge',
          params: { processed, total }
        })
      }

      await this.dropDanglingAssistantKnowledgeBaseRefs(ctx)

      // Self-check the knowledge domain. In production AssistantMigrator (order 2) writes
      // assistant_knowledge_base AFTER this migrator (order 1.8) — translating each ref to the new
      // base id itself — so the junction is empty here and the engine's final verifyForeignKeys()
      // is its real gate. The remap UPDATE above + this assertion only bite when junction rows with
      // legacy ids already exist at this point (a re-run, or the white-box test that seeds them).
      await this.assertOwnedForeignKeys(ctx.db, [knowledgeBaseTable, knowledgeItemTable, assistantKnowledgeBaseTable])

      this.flushSkippedWarnings()
      ctx.sharedData.set(KNOWLEDGE_BASE_ID_REMAP_SHARED_DATA_KEY, new Map(this.legacyBaseIdRemap))
      ctx.sharedData.set(KNOWLEDGE_ITEM_ID_REMAP_SHARED_DATA_KEY, new Map(this.legacyItemIdRemap))
      ctx.sharedData.set(
        KNOWLEDGE_DIRECTORY_CHILD_LOADER_REMAP_SHARED_DATA_KEY,
        new Map([...this.directoryChildLoaderRemap].map(([baseId, remap]) => [baseId, new Map(remap)]))
      )

      logger.info('KnowledgeMigrator.execute completed', {
        processed,
        baseCount: this.preparedBases.length,
        itemCount: this.preparedItems.length
      })

      return {
        success: true,
        processedCount: processed,
        warnings: this.warnings.length > 0 ? this.warnings : undefined
      }
    } catch (error) {
      logger.error('KnowledgeMigrator.execute failed', error as Error)
      return {
        success: false,
        processedCount: processed,
        error: error instanceof Error ? error.message : String(error),
        warnings: this.warnings.length > 0 ? this.warnings : undefined
      }
    }
  }

  /**
   * Copy each migrated `file` item's upload into the v2 knowledge base material
   * root and finalize its `relativePath` (deduped within the base) so the item
   * behaves like a native v2 item — reindex/restore re-read the file from
   * `<knowledgeBaseDir>/<baseId>/raw/<relativePath>` (§2). Mutates `items` in place
   * before insertion so the persisted row matches what is on disk.
   *
   * The physical source is located by v1 storage name (`<filesDataDir>/<name>`),
   * never the stale `path` column (#15733). A missing or unreadable source
   * degrades gracefully: the item is kept (still searchable via migrated vectors)
   * but not copied, so it just cannot be reindexed until re-added.
   *
   * Dedup goes through `reserveImportedFileRelativePath` (the same primitive the native add
   * path uses), so when this base runs a file processor a processable file also reserves its
   * prospective processed-markdown (`.md`) sibling slot. Without this, a base holding both
   * `report.pdf` and a real `report.md` would later hard-fail reindex when the processor tries
   * to write `report.md` onto the existing sibling.
   */
  private async copyKnowledgeFilesForBase(
    ctx: MigrationContext,
    baseId: string,
    fileProcessorId: string | null | undefined,
    items: NewKnowledgeItem[]
  ): Promise<void> {
    const reservedPaths = new Set<string>()

    for (const item of items) {
      if (item.type !== 'file' || !item.id) {
        continue
      }

      // Synthesized directory-child files live at their external data.source and are never
      // copied into the base — skip dedup/copy (search uses the migrated vectors instead).
      if (this.migratedDirectoryChildItemIds.has(item.id)) {
        continue
      }

      const data = item.data as { relativePath: string }
      const reserveArtifact = needsProcessedArtifactReservation(fileProcessorId, data.relativePath)
      const relativePath = reserveImportedFileRelativePath(data.relativePath, reserveArtifact, reservedPaths)
      data.relativePath = relativePath

      const storageName = this.fileStorageNameByItemId.get(item.id)
      if (!storageName) {
        this.recordWarning(`Knowledge file item ${item.id} is missing a storage name; skipping file copy`)
        continue
      }

      const sourcePath = path.join(ctx.paths.filesDataDir, storageName)
      if (!fs.existsSync(sourcePath)) {
        this.recordWarning(
          `Knowledge file source missing for item ${item.id}; item kept but not reindexable: ${sourcePath}`
        )
        continue
      }

      const destPath = path.join(ctx.paths.knowledgeBaseDir, baseId, 'raw', relativePath)
      try {
        await ensureDir(path.dirname(destPath) as FilePath)
        await copy(sourcePath as FilePath, destPath as FilePath)
      } catch (error) {
        this.recordWarning(
          `Failed to copy knowledge file for item ${item.id} (${sourcePath} → ${destPath}): ${
            error instanceof Error ? error.message : String(error)
          }`
        )
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
      const expectedItemCount = this.preparedItems.length - this.skippedPreparedItemIds.size

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
        skippedCount: this.getEffectiveSkippedCount(),
        errors: errors.length
      })

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.sourceCount,
          targetCount,
          skippedCount: this.getEffectiveSkippedCount()
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
          skippedCount: this.getEffectiveSkippedCount()
        }
      }
    }
  }
}
