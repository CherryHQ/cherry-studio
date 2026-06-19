import fs from 'node:fs'
import path from 'node:path'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { DOCUMENT_SEPARATOR } from '@main/features/knowledge/utils/indexing/chunk'
import {
  type MaterialFieldSource,
  toMaterialRelativePath
} from '@main/features/knowledge/utils/indexing/materialFields'
import { deriveNoteSnapshotSlug } from '@main/features/knowledge/utils/sources/noteSnapshot'
import { serializeOkfFrontmatter } from '@main/features/knowledge/utils/sources/okfFrontmatter'
import { deriveUrlSnapshotSlug, deriveUrlSnapshotTitle } from '@main/features/knowledge/utils/sources/urlSnapshot'
import {
  assertSafeKnowledgeRelativePath,
  collectKnowledgeReservedRelativePaths,
  reserveImportedFileRelativePath
} from '@main/features/knowledge/utils/storage/pathStorage'
import { hashEmbeddingText } from '@main/features/knowledge/vectorstore/indexStore/hashing'
import { ensureIndexMeta } from '@main/features/knowledge/vectorstore/indexStore/indexMeta'
import { KnowledgeIndexStore } from '@main/features/knowledge/vectorstore/indexStore/KnowledgeIndexStore'
import { type LibsqlDriver, openLibsqlIndexDriver } from '@main/features/knowledge/vectorstore/indexStore/LibsqlDriver'
import { libsqlVectorIndex } from '@main/features/knowledge/vectorstore/indexStore/LibsqlVectorIndex'
import type { RebuildMaterialInput } from '@main/features/knowledge/vectorstore/indexStore/model'
import { createKnowledgeIndexSchema } from '@main/features/knowledge/vectorstore/indexStore/schema'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import {
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED,
  type KnowledgeItemData,
  type KnowledgeItemType
} from '@shared/data/types/knowledge'
import { eq, inArray } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import type { LegacyKnowledgeVectorLoadResult } from '../utils/KnowledgeVectorSourceReader'
import { BaseMigrator } from './BaseMigrator'
import {
  KNOWLEDGE_BASE_ID_REMAP_SHARED_DATA_KEY,
  KNOWLEDGE_DIRECTORY_CHILD_LOADER_REMAP_SHARED_DATA_KEY,
  KNOWLEDGE_ITEM_ID_REMAP_SHARED_DATA_KEY
} from './KnowledgeMigrator'

const logger = loggerService.withContext('KnowledgeVectorMigrator')

// Runtime vector store + material layout — source of truth:
// src/main/features/knowledge/utils/storage/pathStorage.ts
// (CHERRY_META_DIR / VECTOR_STORE_FILE / MATERIAL_ROOT_DIR). Runtime opens
// {knowledgeBaseDir}/{baseId}/.cherry/index.sqlite by the migrated (new) base id, and resolves
// every material's bytes at {knowledgeBaseDir}/{baseId}/raw/{relativePath}, so the migrator must
// write the rebuilt store and any materialized url/note snapshot to those same nested paths.
const KNOWLEDGE_META_DIR = '.cherry'
const KNOWLEDGE_VECTOR_STORE_FILE = 'index.sqlite'
const KNOWLEDGE_MATERIAL_ROOT_DIR = 'raw'
const INDEXABLE_KNOWLEDGE_ITEM_TYPES = new Set<KnowledgeItemType>(['file', 'url', 'note'])
const SKIP_WARNING_SAMPLE_LIMIT = 3
// fs.rm options that survive a transient Windows lock (libsql handle / AV / indexer)
// on the index.sqlite family; `recursive` is required for fs.rm to honor the retries.
const REMOVE_RETRY_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const

// rename / writeFile / mkdir face the same transient Windows locks as fs.rm — Defender or the
// Search Indexer briefly opens a just-written file, so MoveFileEx / open throws
// EPERM / EACCES / EBUSY — but fs.rm's built-in retry does not cover them, and its errno set
// notably omits EACCES. Wrap these mutations in a retry with the same 5×100ms budget plus EACCES,
// so a single momentary lock no longer fails the whole migration (the user-reported symptom).
const TRANSIENT_FS_LOCK_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const FS_RETRY_MAX_ATTEMPTS = 5
const FS_RETRY_DELAY_MS = 100

// inArray() binds one SQL variable per id; a single UPDATE over the whole degrade set would
// overflow SQLite's bound-variable cap once a corpus accumulates enough orphaned directory items.
// Chunk well under the cap, matching the repo convention (FileRefService / orphanCheckerRegistry /
// ChatMigrator all use 500 on this same knowledge_item id column).
const DEGRADE_UPDATE_CHUNK = 500

async function retryOnTransientFsLock<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code
      if (attempt >= FS_RETRY_MAX_ATTEMPTS || code === undefined || !TRANSIENT_FS_LOCK_CODES.has(code)) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, FS_RETRY_DELAY_MS))
    }
  }
}

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

interface MigratedKnowledgeItemForVector {
  id: string
  baseId: string
  groupId: string | null
  type: KnowledgeItemType
  data: KnowledgeItemData
}

/** One legacy chunk pinned to a migrated item, in legacy read order. */
interface MigratedChunk {
  pageContent: string
  embedding: number[]
}

/** A migrated item's material rebuild input plus the embedding hashes it introduces. */
interface PreparedMaterial {
  itemId: string
  input: RebuildMaterialInput
}

/**
 * A url or note snapshot file to materialize under the base's `raw/` material
 * root, so migrated urls/notes are real base files from day one — reindex then
 * reads them offline (a url reads its snapshot instead of re-fetching, a note
 * reads its captured content) and the material row holds the real snapshot path.
 */
interface PlannedMaterialSnapshot {
  itemId: string
  relativePath: string
  /**
   * The snapshot file's exact bytes: OKF frontmatter + the material's content
   * text, for both url and note. The snapshot reader strips the frontmatter back
   * off to round-trip the body exactly (the hash stays stable, vectors reused).
   */
  fileText: string
  /** The item's data with `relativePath` pinned, written back to the migrated row. */
  data: KnowledgeItemData
}

interface PreparedBasePlan {
  baseId: string
  materialDirPath: string
  targetDbPath: string
  materials: PreparedMaterial[]
  materialSnapshots: PlannedMaterialSnapshot[]
  expectedUnitCount: number
  // Distinct embedding hashes across the whole base (the embedding table is keyed
  // by hash, so identical chunk bodies — within or across materials — collapse to one row).
  expectedEmbeddingCount: number
  sourceRowCount: number
  // Directory-expanded groups (container id → child ids) this base owns. Kept on the plan so a
  // per-base failure in execute() can degrade them (markDirectoryGroupsFullyOrphaned) the same way
  // a prepare-time skip does — otherwise an isolated base's directory children stay `completed`
  // with no vectors and no raw/ file, an unreindexable silent orphan.
  directoryGroups: Map<string, Set<string>>
}

function isStringMap(value: unknown): value is Map<string, string> {
  return value instanceof Map
}

/** Narrow the per-base directory-child loader remap: migrated base id → (loaderId → childId). */
function isNestedStringMap(value: unknown): value is Map<string, Map<string, string>> {
  return value instanceof Map && [...value.values()].every((inner) => inner instanceof Map)
}

/** Narrow a migrated row to the indexable subset the material-field helpers expect. */
function toMaterialFieldSource(item: MigratedKnowledgeItemForVector): MaterialFieldSource | null {
  if (item.type !== 'file' && item.type !== 'url' && item.type !== 'note') {
    return null
  }
  // type/data correlation is guaranteed by the migration that wrote `data` per type;
  // the source struct keeps them as independent fields, so assert the union here.
  return { id: item.id, type: item.type, data: item.data } as MaterialFieldSource
}

/** The canonical content text of a migrated material: legacy chunk bodies joined by {@link DOCUMENT_SEPARATOR}. */
function joinMigratedChunkText(chunks: MigratedChunk[]): string {
  return chunks.map((chunk) => chunk.pageContent).join(DOCUMENT_SEPARATOR)
}

/**
 * Assemble one material rebuild input from a migrated item's preserved legacy
 * chunks (Route A — keep the v1 split). The canonical content text is the chunk
 * bodies joined by {@link DOCUMENT_SEPARATOR}; each unit's offsets span its body
 * exactly, so the store's `content.text.slice(charStart, charEnd) === body`
 * invariant holds by construction. Vectors are reused verbatim (no re-embedding)
 * and deduped by embedding-text hash, matching the index store's hash-keyed
 * embedding table. The material's `relativePath` is resolved by the caller (a file
 * uses its stored path; a url/note uses the snapshot it materializes this run).
 */
function buildMigratedRebuildInput(
  item: MaterialFieldSource,
  chunks: MigratedChunk[],
  relativePath: string
): PreparedMaterial {
  const units: RebuildMaterialInput['units'] = []
  const embeddingByHash = new Map<string, number[]>()
  let cursor = 0

  chunks.forEach((chunk, index) => {
    if (index > 0) {
      cursor += DOCUMENT_SEPARATOR.length
    }
    const charStart = cursor
    const charEnd = cursor + chunk.pageContent.length
    cursor = charEnd
    units.push({ unitType: 'chunk', unitIndex: index, charStart, charEnd })

    const embeddingTextHash = hashEmbeddingText(chunk.pageContent)
    if (!embeddingByHash.has(embeddingTextHash)) {
      embeddingByHash.set(embeddingTextHash, chunk.embedding)
    }
  })

  const input: RebuildMaterialInput = {
    material: {
      relativePath
    },
    content: {
      text: joinMigratedChunkText(chunks)
    },
    units,
    embeddings: [...embeddingByHash.entries()].map(([embeddingTextHash, vector]) => ({ embeddingTextHash, vector }))
  }

  return { itemId: item.id, input }
}

export class KnowledgeVectorMigrator extends BaseMigrator {
  readonly id = 'knowledge_vector'
  readonly name = 'KnowledgeVector'
  readonly description = 'Rebuild legacy knowledge vectors into the per-base index.sqlite store'
  readonly order = 3.5

  private sourceCount = 0
  private skippedCount = 0
  private warnings: string[] = []
  private skippedWarnings = new Map<string, { count: number; samples: string[] }>()
  private preparedBasePlans: PreparedBasePlan[] = []
  private successfulBaseIds = new Set<string>()
  private executionErrors: string[] = []
  // Directory-expanded items (KnowledgeMigrator split a v1 folder into a `completed` container
  // plus `completed` per-file children) whose vectors never landed here — either the whole base
  // was skipped (a TOCTOU: KnowledgeMigrator read the legacy store at order 1.8, but it became
  // unreadable by order 3.5) or a child received 0 migratable vectors. Their `data.source` is a
  // virtual path with no raw/ file, so reindex is rejected and they would be invisible empty
  // docs; execute() degrades them to `failed`/directory_not_migrated so the UI prompts a re-add.
  private directoryItemsToDegrade = new Set<string>()

  override reset(): void {
    this.sourceCount = 0
    this.skippedCount = 0
    this.warnings = []
    this.skippedWarnings = new Map<string, { count: number; samples: string[] }>()
    this.preparedBasePlans = []
    this.successfulBaseIds = new Set<string>()
    this.executionErrors = []
    this.directoryItemsToDegrade = new Set<string>()
  }

  /**
   * Group a base's directory-expanded children by their container item id (children carry
   * `groupId = containerId`). Built from the per-base loader remap KnowledgeMigrator published.
   */
  private collectDirectoryGroups(
    baseId: string,
    migratedItemsByBaseId: Map<string, Map<string, MigratedKnowledgeItemForVector>>,
    directoryChildLoaderRemapByBase: Map<string, Map<string, string>>
  ): Map<string, Set<string>> {
    const groups = new Map<string, Set<string>>()
    const childRemap = directoryChildLoaderRemapByBase.get(baseId)
    const items = migratedItemsByBaseId.get(baseId)
    if (!childRemap || !items) {
      return groups
    }
    for (const childId of new Set(childRemap.values())) {
      const child = items.get(childId)
      if (!child || !child.groupId) {
        continue
      }
      const containerId = child.groupId
      const bucket = groups.get(containerId) ?? new Set<string>()
      bucket.add(childId)
      groups.set(containerId, bucket)
    }
    return groups
  }

  /** A skipped base writes no vectors, so every directory group it owns (container + children) is orphaned. */
  private markDirectoryGroupsFullyOrphaned(groups: Map<string, Set<string>>): void {
    for (const [containerId, childIds] of groups) {
      this.directoryItemsToDegrade.add(containerId)
      for (const childId of childIds) {
        this.directoryItemsToDegrade.add(childId)
      }
    }
  }

  /**
   * For a base that loaded: a directory child that received no chunks is an empty doc — degrade it.
   * If every child in a group is empty, the container is degraded too; a group with at least one
   * surviving child keeps its container `completed`.
   */
  private markEmptyDirectoryChildren(groups: Map<string, Set<string>>, chunksByItem: Map<string, unknown>): void {
    for (const [containerId, childIds] of groups) {
      let survivors = 0
      for (const childId of childIds) {
        if (chunksByItem.has(childId)) {
          survivors += 1
        } else {
          this.directoryItemsToDegrade.add(childId)
        }
      }
      if (survivors === 0 && childIds.size > 0) {
        this.directoryItemsToDegrade.add(containerId)
      }
    }
  }

  private getTempVectorStorePath(dbPath: string): string {
    return `${dbPath}.vectorstore.tmp`
  }

  private getRuntimeVectorStorePath(knowledgeBaseDir: string, baseId: string): string {
    return path.join(knowledgeBaseDir, baseId, KNOWLEDGE_META_DIR, KNOWLEDGE_VECTOR_STORE_FILE)
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

  /** Remove an index.sqlite and its WAL sidecars, surviving a transient Windows lock. */
  private async removeIndexStoreFiles(dbPath: string): Promise<void> {
    await fs.promises.rm(dbPath, REMOVE_RETRY_OPTIONS)
    await fs.promises.rm(`${dbPath}-wal`, REMOVE_RETRY_OPTIONS)
    await fs.promises.rm(`${dbPath}-shm`, REMOVE_RETRY_OPTIONS)
  }

  private buildLoaderTargetMap(
    legacyBase: LegacyKnowledgeBaseWithLoaders | undefined,
    migratedItemsById: Map<string, MigratedKnowledgeItemForVector>,
    legacyItemIdRemap: Map<string, string>
  ): Map<string, MigratedKnowledgeItemForVector> {
    const map = new Map<string, MigratedKnowledgeItemForVector>()
    if (!legacyBase || !Array.isArray(legacyBase.items)) {
      return map
    }

    for (const item of legacyBase.items) {
      if (!item.id) {
        continue
      }

      const migratedItemId = legacyItemIdRemap.get(item.id)
      if (!migratedItemId) {
        continue
      }

      const migratedItem = migratedItemsById.get(migratedItemId)
      if (!migratedItem) {
        continue
      }

      if (Array.isArray(item.uniqueIds) && item.uniqueIds.length > 0) {
        for (const uniqueId of item.uniqueIds) {
          if (typeof uniqueId === 'string' && uniqueId.trim() !== '') {
            map.set(uniqueId, migratedItem)
          }
        }
        continue
      }

      if (typeof item.uniqueId === 'string' && item.uniqueId.trim() !== '') {
        map.set(item.uniqueId, migratedItem)
      }
    }

    return map
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      // One timestamp for every snapshot this run materializes; it records when
      // the file was written (the migration), not a page fetch — origin says so.
      const capturedAt = new Date().toISOString()
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
          groupId: knowledgeItemTable.groupId,
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
      const sharedBaseRemap = ctx.sharedData.get(KNOWLEDGE_BASE_ID_REMAP_SHARED_DATA_KEY)
      const legacyBaseIdRemap = isStringMap(sharedBaseRemap) ? sharedBaseRemap : new Map<string, string>()
      const legacyBaseIdByMigratedId = new Map(
        [...legacyBaseIdRemap.entries()].map(([legacyBaseId, migratedBaseId]) => [migratedBaseId, legacyBaseId])
      )
      const sharedItemRemap = ctx.sharedData.get(KNOWLEDGE_ITEM_ID_REMAP_SHARED_DATA_KEY)
      const legacyItemIdRemap = isStringMap(sharedItemRemap) ? sharedItemRemap : new Map<string, string>()
      const sharedDirectoryChildLoaderRemap = ctx.sharedData.get(KNOWLEDGE_DIRECTORY_CHILD_LOADER_REMAP_SHARED_DATA_KEY)
      const directoryChildLoaderRemapByBase = isNestedStringMap(sharedDirectoryChildLoaderRemap)
        ? sharedDirectoryChildLoaderRemap
        : new Map<string, Map<string, string>>()

      for (const base of migratedBases) {
        // Directory-expanded children/containers KnowledgeMigrator created for this base. If this
        // base is skipped below, none of their vectors land here, so they become orphaned
        // virtual-path docs (markDirectoryGroupsFullyOrphaned); if the base loads, children that
        // receive no chunks are degraded individually (markEmptyDirectoryChildren). The map is
        // empty for bases without directory expansion, so the marker calls are no-ops there.
        const directoryGroups = this.collectDirectoryGroups(
          base.id,
          migratedItemsByBaseId,
          directoryChildLoaderRemapByBase
        )

        if (base.status === 'failed' || base.embeddingModelId === null) {
          const warningMessage = `Skipped knowledge vector base ${base.id}: missing embedding model`
          this.recordSkippedWarning(KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL, warningMessage)
          this.markDirectoryGroupsFullyOrphaned(directoryGroups)
          continue
        }

        // Capture before the awaits below: TS resets property narrowing across await.
        const dimensions = base.dimensions
        if (typeof dimensions !== 'number' || !Number.isInteger(dimensions) || dimensions <= 0) {
          const warningMessage = `Skipped knowledge vector base ${base.id}: invalid dimensions`
          this.recordSkippedWarning('invalid_dimensions', warningMessage)
          this.markDirectoryGroupsFullyOrphaned(directoryGroups)
          continue
        }

        const legacyBaseId = legacyBaseIdByMigratedId.get(base.id)
        if (!legacyBaseId) {
          const warningMessage = `Skipped knowledge vector base ${base.id}: migrated base id cannot be mapped to legacy knowledge base id`
          this.recordSkippedWarning('unmapped_base', warningMessage)
          this.markDirectoryGroupsFullyOrphaned(directoryGroups)
          continue
        }

        const legacyBase = legacyBasesById.get(legacyBaseId)
        if (!legacyBase) {
          const warningMessage = `Skipped knowledge vector base ${base.id}: legacy knowledge base ${legacyBaseId} not found`
          this.recordSkippedWarning('legacy_base_missing', warningMessage)
          this.markDirectoryGroupsFullyOrphaned(directoryGroups)
          continue
        }

        // A legacy DB that exists but cannot be read (locked / corrupt) makes `loadBase` reject. That
        // is a recoverable per-base failure, mirroring KnowledgeMigrator: its v1 folders are kept as
        // failed tombstones and re-running migration once the DB is readable recovers them without
        // re-embedding. Skip this base instead of letting the reject abort the whole migration.
        let source: LegacyKnowledgeVectorLoadResult
        try {
          source = await ctx.sources.knowledgeVectorSource.loadBase(legacyBaseId)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.recordSkippedWarning(
            'read_error',
            `Skipped knowledge vector base ${base.id}: legacy vector DB unreadable (${message})`
          )
          this.markDirectoryGroupsFullyOrphaned(directoryGroups)
          continue
        }
        switch (source.status) {
          case 'invalid_path': {
            const warningMessage = `Skipped knowledge vector base ${base.id}: invalid legacy vector DB path`
            this.recordSkippedWarning('invalid_path', warningMessage)
            this.markDirectoryGroupsFullyOrphaned(directoryGroups)
            continue
          }
          case 'missing': {
            const warningMessage = `Skipped knowledge vector base ${base.id}: legacy vector DB missing`
            this.recordSkippedWarning('missing', warningMessage)
            this.markDirectoryGroupsFullyOrphaned(directoryGroups)
            continue
          }
          case 'directory': {
            const warningMessage = `Skipped knowledge vector base ${base.id}: legacy vector DB path is a directory`
            this.recordSkippedWarning('directory', warningMessage)
            this.markDirectoryGroupsFullyOrphaned(directoryGroups)
            continue
          }
          case 'not_embedjs': {
            const warningMessage = `Skipped knowledge vector base ${base.id}: legacy DB is not embedjs format`
            this.recordSkippedWarning('not_embedjs', warningMessage)
            this.markDirectoryGroupsFullyOrphaned(directoryGroups)
            continue
          }
        }

        const vectorRows = source.rows
        this.sourceCount += vectorRows.length

        const loaderTargetMap = this.buildLoaderTargetMap(
          legacyBase,
          migratedItemsByBaseId.get(base.id) ?? new Map<string, MigratedKnowledgeItemForVector>(),
          legacyItemIdRemap
        )

        // A v1 folder's per-file vectors were booked under the directory item's loader ids;
        // KnowledgeMigrator split that folder into per-file children and recorded each file's
        // loader id → child item id, scoped to this migrated base. Point those loader ids at the
        // child (not the directory container) so the vectors land on the child material instead
        // of being dropped as a non-indexable container. The per-base scope keeps a loader id
        // shared across bases (v1 ids are path/content hashes) pointing at the right base's child.
        const baseMigratedItems = migratedItemsByBaseId.get(base.id)
        const baseDirectoryChildLoaderRemap = directoryChildLoaderRemapByBase.get(base.id)
        if (baseMigratedItems && baseDirectoryChildLoaderRemap) {
          for (const [loaderId, childItemId] of baseDirectoryChildLoaderRemap) {
            const child = baseMigratedItems.get(childItemId)
            if (child) {
              loaderTargetMap.set(loaderId, child)
            }
          }
        }

        // Group the surviving chunks by migrated item, preserving legacy read order
        // both across items (first appearance) and within an item (chunk order).
        const chunksByItem = new Map<string, { item: MaterialFieldSource; chunks: MigratedChunk[] }>()

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

          if (!INDEXABLE_KNOWLEDGE_ITEM_TYPES.has(target.type)) {
            this.skippedCount += 1
            const warningMessage = `Skipped knowledge vector row in base ${base.id}: container item '${target.id}' of type '${target.type}' is not indexable`
            this.recordSkippedWarning('non_indexable_container', warningMessage)
            continue
          }

          if (row.vector.status === 'unsupported_encoding') {
            this.skippedCount += 1
            const warningMessage = `Skipped knowledge vector row in base ${base.id}: unsupported vector encoding '${row.vector.encoding}' for uniqueLoaderId '${row.uniqueLoaderId}'`
            this.recordSkippedWarning('unsupported_vector_encoding', warningMessage)
            continue
          }

          if (row.vector.status === 'missing' || row.vector.value.length === 0) {
            this.skippedCount += 1
            const warningMessage = `Skipped knowledge vector row in base ${base.id}: vector payload missing for uniqueLoaderId '${row.uniqueLoaderId}'`
            this.recordSkippedWarning('missing_vector_payload', warningMessage)
            continue
          }

          // A vector whose length disagrees with the base's recorded dimensions
          // would make the brute-force cosine scan compare mismatched lengths, so
          // drop it rather than corrupt vector search for the whole base.
          if (row.vector.value.length !== dimensions) {
            this.skippedCount += 1
            const warningMessage = `Skipped knowledge vector row in base ${base.id}: vector length ${row.vector.value.length} != base dimensions ${dimensions} for uniqueLoaderId '${row.uniqueLoaderId}'`
            this.recordSkippedWarning('dimension_mismatch', warningMessage)
            continue
          }

          const materialItem = toMaterialFieldSource(target)
          if (!materialItem) {
            // INDEXABLE_KNOWLEDGE_ITEM_TYPES already excluded container types; this is
            // unreachable, but keep it explicit so a future type addition fails closed.
            continue
          }

          const entry = chunksByItem.get(target.id) ?? { item: materialItem, chunks: [] }
          entry.chunks.push({ pageContent: row.pageContent, embedding: row.vector.value })
          chunksByItem.set(target.id, entry)
        }

        // A directory child that drew no chunks (its v1 file's vectors were absent/unmappable) is an
        // empty virtual-path doc that cannot reindex — degrade it; a fully-empty group degrades its
        // container too. Children that did receive chunks stay completed and flow through below.
        this.markEmptyDirectoryChildren(directoryGroups, chunksByItem)

        // Snapshot names must dodge every path the base already occupies (copied
        // files, their processed artifacts, other snapshots planned this run). Pass
        // fileProcessorId so an unprocessed file's prospective `.md` artifact slot is
        // reserved too — same invariant the runtime add path uses, so a snapshot can't
        // later be overwritten by a reindex-produced artifact (or vice versa).
        const reservedPaths = collectKnowledgeReservedRelativePaths(
          [...(migratedItemsByBaseId.get(base.id)?.values() ?? [])],
          {
            fileProcessorId: base.fileProcessorId
          }
        )

        const materials: PreparedMaterial[] = []
        const materialSnapshots: PlannedMaterialSnapshot[] = []
        const baseEmbeddingHashes = new Set<string>()
        let expectedUnitCount = 0
        for (const { item, chunks } of chunksByItem.values()) {
          // A file already has a real base path; a url/note materializes a snapshot
          // this run and pins the row to it (so toMaterialRelativePath never falls back).
          // A re-run after a partial migration may find the row already pinned (and that
          // path already reserved above); reuse it instead of minting a `name-1.md` twin.
          let relativePath: string
          if (item.type === 'url') {
            const contentText = joinMigratedChunkText(chunks)
            relativePath =
              item.data.relativePath ??
              reserveImportedFileRelativePath(
                `${deriveUrlSnapshotSlug(contentText, item.data.url)}.md`,
                false,
                reservedPaths
              )
            materialSnapshots.push({
              itemId: item.id,
              relativePath,
              fileText:
                serializeOkfFrontmatter({
                  type: 'URL',
                  title: deriveUrlSnapshotTitle(contentText, item.data.url),
                  resource: item.data.url,
                  timestamp: capturedAt
                }) + contentText,
              data: { ...item.data, relativePath }
            })
          } else if (item.type === 'note') {
            const contentText = joinMigratedChunkText(chunks)
            relativePath =
              item.data.relativePath ??
              reserveImportedFileRelativePath(`${deriveNoteSnapshotSlug(item.data.source)}.md`, false, reservedPaths)
            materialSnapshots.push({
              itemId: item.id,
              relativePath,
              // OKF frontmatter + content; the note reader strips it to round-trip the body.
              fileText:
                serializeOkfFrontmatter({
                  type: 'Note',
                  title: item.data.source,
                  timestamp: capturedAt
                }) + contentText,
              data: { ...item.data, relativePath }
            })
          } else {
            relativePath = toMaterialRelativePath(item)
          }

          const material = buildMigratedRebuildInput(item, chunks, relativePath)
          materials.push(material)
          expectedUnitCount += material.input.units.length
          for (const embedding of material.input.embeddings) {
            baseEmbeddingHashes.add(embedding.embeddingTextHash)
          }
        }

        // A base is still planned even when it has no materials. In that case the
        // rebuilt V2 store is intentionally empty because none of the legacy vectors
        // could be associated with valid, indexable migrated knowledge_item rows.
        this.preparedBasePlans.push({
          baseId: base.id,
          materialDirPath: path.join(ctx.paths.knowledgeBaseDir, base.id, KNOWLEDGE_MATERIAL_ROOT_DIR),
          targetDbPath: this.getRuntimeVectorStorePath(ctx.paths.knowledgeBaseDir, base.id),
          materials,
          materialSnapshots,
          expectedUnitCount,
          expectedEmbeddingCount: baseEmbeddingHashes.size,
          sourceRowCount: vectorRows.length,
          directoryGroups
        })
      }

      this.flushSkippedWarnings()

      return {
        success: true,
        itemCount: this.sourceCount,
        warnings: this.warnings.length > 0 ? this.warnings : undefined
      }
    } catch (error) {
      this.flushSkippedWarnings()
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('KnowledgeVectorMigrator.prepare failed', error as Error)
      return {
        success: false,
        itemCount: this.sourceCount,
        warnings: [...this.warnings, errorMessage]
      }
    }
  }

  /**
   * Persist the directory degrade set (collected in prepare() for skipped/empty bases and in
   * execute()'s per-base catch for bases that failed mid-rebuild): orphaned directory-expanded
   * items become `failed`/directory_not_migrated so the UI prompts a re-add (their virtual-path
   * source cannot reindex). A failure here is non-fatal — the worst case is a stale `completed`
   * row that the next migration run re-degrades — so it is recorded as a warning, never thrown.
   * Chunked under SQLite's bound-variable cap so a large degrade set cannot overflow the UPDATE.
   */
  private async flushDirectoryDegradations(ctx: MigrationContext): Promise<void> {
    if (this.directoryItemsToDegrade.size === 0) {
      return
    }
    const ids = [...this.directoryItemsToDegrade]
    let degradedCount = 0
    for (let offset = 0; offset < ids.length; offset += DEGRADE_UPDATE_CHUNK) {
      const batch = ids.slice(offset, offset + DEGRADE_UPDATE_CHUNK)
      try {
        await ctx.db
          .update(knowledgeItemTable)
          .set({ status: 'failed', error: KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED })
          .where(inArray(knowledgeItemTable.id, batch))
        degradedCount += batch.length
      } catch (error) {
        // Best-effort per batch: one failed batch must not abort the rest of the degrade pass.
        this.recordWarning(
          `Failed to degrade ${batch.length} orphaned directory-expanded knowledge items: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    logger.info('Degraded orphaned directory-expanded knowledge items', {
      degradedCount,
      totalCount: ids.length
    })
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.preparedBasePlans.length === 0) {
      // No vector plan survived prepare(); still degrade items orphaned there (a base whose only
      // content was a directory expansion) before returning.
      await this.flushDirectoryDegradations(ctx)
      return {
        success: true,
        processedCount: 0
      }
    }

    const totalWork = this.preparedBasePlans.reduce((sum, plan) => sum + Math.max(plan.materials.length, 1), 0)
    let processedWork = 0
    let processedCount = 0

    for (const plan of this.preparedBasePlans) {
      const tempPath = this.getTempVectorStorePath(plan.targetDbPath)

      try {
        await retryOnTransientFsLock(() => fs.promises.mkdir(path.dirname(plan.targetDbPath), { recursive: true }))
        await this.removeIndexStoreFiles(tempPath)

        // Rebuild into a temp store through the exact runtime open sequence
        // (driver → schema → ensureIndexMeta → KnowledgeIndexStore.rebuildMaterial), so the
        // migrated store is byte-for-byte a store the runtime would produce.
        //
        // serializedSingleConnection: the per-material rebuild loop runs one transaction per
        // material. With libsql's client.transaction('write') each would orphan a still-open
        // handle on this temp store (released only by GC), and on Windows those leaked handles
        // block the rename below — the intermittent "file lock". Manual BEGIN keeps every write on
        // the single connection, so driver.close() releases all of it before the rename. Safe here
        // because migration is the sole writer and nothing reads this temp store concurrently.
        const driver = await openLibsqlIndexDriver(tempPath, { serializedSingleConnection: true })
        try {
          await createKnowledgeIndexSchema(driver)
          await ensureIndexMeta(driver, { baseId: plan.baseId })
          const store = new KnowledgeIndexStore(driver, libsqlVectorIndex)

          for (const material of plan.materials) {
            await store.rebuildMaterial(material.itemId, material.input)
            processedWork += 1
            this.reportRebuildProgress(processedWork, totalWork)
            await yieldToEventLoop()
          }

          // Fold the WAL back into the main db file: only the main file is renamed
          // onto the target, and libsql does not reliably checkpoint on close — without
          // this the renamed store reads short (SQLITE_IOERR_SHORT_READ) because its
          // committed pages still live in the now-orphaned `${tempPath}-wal` sidecar.
          await driver.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        } finally {
          // Close before the rename so the file handle is released (a leaked handle
          // would block the rename and the later base-dir deletion on Windows).
          await driver.close()
        }

        if (plan.materials.length === 0) {
          processedWork += 1
          this.reportRebuildProgress(processedWork, totalWork)
          await yieldToEventLoop()
        }

        // Leave the v1 legacy embedjs DB untouched in place: a user who rolls back to v1 after a
        // failed or abandoned migration must keep a working knowledge base. The rebuilt V2 store
        // lives under the migrated base's new uuid directory, so it never collides with the legacy
        // flat path and the v1 source needs no relocation. Runtime may have auto-created an empty
        // store at the target; remove it (and its WAL sidecars) first so the rename succeeds on
        // Windows (POSIX rename overwrites, Windows throws on an existing target).
        await this.removeIndexStoreFiles(plan.targetDbPath)
        await retryOnTransientFsLock(() => fs.promises.rename(tempPath, plan.targetDbPath))

        // Materialize each migrated url/note snapshot file under the base's `raw/`
        // material root (overwriting a previous partial run's copy) and pin the item
        // row to it, so the runtime's ensure-snapshot step reads it offline at
        // {baseDir}/raw/{relativePath} (a url instead of re-fetching the page, a note
        // instead of re-deriving from data). The material root may not exist yet (a
        // url/note-only base copies no files), so ensure it first.
        if (plan.materialSnapshots.length > 0) {
          await retryOnTransientFsLock(() => fs.promises.mkdir(plan.materialDirPath, { recursive: true }))
        }
        for (const snapshot of plan.materialSnapshots) {
          // A reused item.data.relativePath could in principle carry a traversal;
          // guard it before writing — the same invariant every other base write
          // enforces (getKnowledgeBaseFilePath) but which this direct join bypasses.
          assertSafeKnowledgeRelativePath(snapshot.relativePath)
          await retryOnTransientFsLock(() =>
            fs.promises.writeFile(path.join(plan.materialDirPath, snapshot.relativePath), snapshot.fileText, 'utf-8')
          )
          await ctx.db
            .update(knowledgeItemTable)
            .set({ data: snapshot.data })
            .where(eq(knowledgeItemTable.id, snapshot.itemId))
        }

        this.successfulBaseIds.add(plan.baseId)
        processedCount += plan.expectedUnitCount
        logger.info('Migrated knowledge vector base as preserved-chunk concatenation', {
          baseId: plan.baseId,
          materials: plan.materials.length,
          materialSnapshots: plan.materialSnapshots.length,
          units: plan.expectedUnitCount,
          embeddings: plan.expectedEmbeddingCount
        })
      } catch (error) {
        const errorMessage = `Knowledge vector base ${plan.baseId} execution failed: ${error instanceof Error ? error.message : String(error)}`
        logger.error(errorMessage, error instanceof Error ? error : new Error(String(error)))
        this.executionErrors.push(errorMessage)

        // Cleanup must not throw past the loop: on Windows a locked index.sqlite can make rm reject
        // even after retries, which would mask the real errorMessage and abort the whole migration.
        try {
          await this.removeIndexStoreFiles(tempPath)
        } catch (cleanupError) {
          logger.warn('Temp index store cleanup failed after base execution error', {
            baseId: plan.baseId,
            cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          })
        }

        // A per-base failure is non-fatal: skip this base (it stays out of successfulBaseIds, so
        // validate() never checks it) and keep migrating the rest, mirroring prepare()'s skip +
        // continue. One locked/corrupt base no longer drags the entire migration — and every other
        // migrator after it — into markFailed; the failure is surfaced as a warning instead.
        //
        // But isolation alone is incomplete: prepare() already counted this base's surviving rows
        // into sourceCount, and validate() now omits them from targetCount, so the engine's
        // `targetCount < sourceCount - skippedCount` reconciliation would still abort the whole
        // migration. Credit the base's expected units to skippedCount so expectedCount drops in
        // lockstep — the genuine per-base skip the engine then accepts. And degrade this base's
        // directory-expanded items the same way a prepare-time skip does, so once the migration is
        // allowed to succeed its children are not left `completed` with no vectors (an
        // unreindexable virtual-path orphan); regular file items keep their real raw/ file and
        // self-heal via runtime reindex, so they need no degrade here.
        this.skippedCount += plan.expectedUnitCount
        this.markDirectoryGroupsFullyOrphaned(plan.directoryGroups)
        continue
      }
    }

    // Persist all directory degradations now: both those collected in prepare() and those added in
    // the per-base catch above for bases that failed mid-rebuild. Running it after the loop (rather
    // than before) is what lets a failed base's directory items reach `failed` once the per-base
    // skip keeps the overall migration alive.
    await this.flushDirectoryDegradations(ctx)

    logger.info('KnowledgeVectorMigrator.execute completed', {
      processedCount,
      successfulBaseCount: this.successfulBaseIds.size,
      warningCount: this.warnings.length,
      executionErrorCount: this.executionErrors.length
    })

    return {
      success: true,
      processedCount,
      warnings: this.executionErrors.length > 0 ? [...this.executionErrors] : undefined
    }
  }

  private reportRebuildProgress(processedWork: number, totalWork: number): void {
    this.reportProgress(
      Math.round((processedWork / totalWork) * 100),
      `Migrated ${processedWork}/${totalWork} knowledge vector work units`,
      {
        key: 'migration.progress.migrated_knowledge_vectors',
        params: { processed: processedWork, total: totalWork }
      }
    )
  }

  async validate(): Promise<ValidateResult> {
    const errors: ValidationError[] = []
    let targetCount = 0

    try {
      for (const plan of this.preparedBasePlans) {
        if (!this.successfulBaseIds.has(plan.baseId)) {
          continue
        }

        // The rebuilt store's url/note material rows reference these snapshot paths,
        // so a missing file would surface later as an unreadable material.
        const missingSnapshots = plan.materialSnapshots.filter(
          (snapshot) => !fs.existsSync(path.join(plan.materialDirPath, snapshot.relativePath))
        )
        if (missingSnapshots.length > 0) {
          errors.push({
            key: `knowledge_vector_material_snapshots_${plan.baseId}`,
            expected: plan.materialSnapshots.length,
            actual: plan.materialSnapshots.length - missingSnapshots.length,
            message: `Missing ${missingSnapshots.length} materialized url/note snapshot files in base ${plan.baseId}: ${missingSnapshots
              .slice(0, SKIP_WARNING_SAMPLE_LIMIT)
              .map((snapshot) => snapshot.relativePath)
              .join(', ')}`
          })
        }

        // Reopen through openLibsqlIndexDriver, not a bare createClient: the driver sets
        // busy_timeout=5000, so this post-rename re-read waits out a transient Windows lock
        // (Defender / indexer scanning the just-renamed store) instead of throwing SQLITE_BUSY /
        // EACCES and failing validation for an already-correct store.
        const driver = await openLibsqlIndexDriver(plan.targetDbPath)
        try {
          const materialCount = await this.tableCount(driver, 'material')
          const unitCount = await this.tableCount(driver, 'search_unit')
          const embeddingCount = await this.tableCount(driver, 'embedding')
          targetCount += unitCount

          this.pushCountMismatch(errors, plan.baseId, 'material', plan.materials.length, materialCount)
          this.pushCountMismatch(errors, plan.baseId, 'search_unit', plan.expectedUnitCount, unitCount)
          this.pushCountMismatch(errors, plan.baseId, 'embedding', plan.expectedEmbeddingCount, embeddingCount)

          // Every unit's body search_text must resolve to a stored embedding, or that
          // unit is silently absent from vector search. This is the migration-time
          // form of the rebuild self-heal invariant (knowledge-technical-design.md §10).
          const uncovered = await driver.execute(
            `SELECT count(*) AS count FROM search_text st
                  LEFT JOIN embedding e ON e.embedding_text_hash = st.embedding_text_hash
                  WHERE e.embedding_text_hash IS NULL`
          )
          const uncoveredCount = Number(uncovered.rows[0]?.count ?? 0)
          if (uncoveredCount > 0) {
            errors.push({
              key: `knowledge_vector_uncovered_units_${plan.baseId}`,
              expected: 0,
              actual: uncoveredCount,
              message: `Found ${uncoveredCount} knowledge search_text rows without a stored embedding in base ${plan.baseId}`
            })
          }
        } finally {
          await driver.close()
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

  private async tableCount(driver: LibsqlDriver, table: string): Promise<number> {
    const result = await driver.execute(`SELECT count(*) AS count FROM ${table}`)
    return Number(result.rows[0]?.count ?? 0)
  }

  private pushCountMismatch(
    errors: ValidationError[],
    baseId: string,
    table: string,
    expected: number,
    actual: number
  ): void {
    if (actual === expected) {
      return
    }
    errors.push({
      key: `knowledge_vector_${table}_count_mismatch_${baseId}`,
      expected,
      actual,
      message: `Knowledge vector ${table} count mismatch for base ${baseId}: expected ${expected}, got ${actual}`
    })
  }
}
