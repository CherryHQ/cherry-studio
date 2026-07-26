import fs from 'node:fs'
import path from 'node:path'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import {
  assertSafeKnowledgeRelativePath,
  buildNoteSnapshotFile,
  buildUrlSnapshotFile,
  collectKnowledgeReservedRelativePaths,
  createKnowledgeIndexStoreAtPath,
  DOCUMENT_SEPARATOR,
  hashEmbeddingText,
  type MaterialFieldSource,
  type RebuildMaterialInput,
  reserveImportedFileRelativePath,
  toMaterialRelativePath
} from '@main/features/knowledge'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import {
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  KNOWLEDGE_BASE_ERROR_MISSING_VECTOR_STORE,
  KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED,
  type KnowledgeItemData,
  type KnowledgeItemType
} from '@shared/data/types/knowledge'
import { eq, inArray } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import type { LegacyKnowledgeVectorLoadResult, LegacyKnowledgeVectorRow } from '../utils/KnowledgeVectorSourceReader'
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
// fs.rm options that survive a transient Windows lock (an open index.sqlite handle / AV / indexer)
// on the index.sqlite family; `recursive` is required for fs.rm to honor the retries.
const REMOVE_RETRY_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const

// writeFile / mkdir face the same transient Windows locks as fs.rm — Defender or the Search Indexer
// briefly opens a just-written file, so open throws EPERM / EACCES / EBUSY — but fs.rm's built-in
// retry does not cover them, and its errno set notably omits EACCES. Wrap these mutations in a retry
// (plus EACCES) so a single momentary lock no longer fails the whole migration. Back off
// exponentially up to FS_RETRY_MAX_DELAY_MS so early retries stay fast (most scans clear in <500ms)
// while the tail stretches to a few seconds for stubborn ones, before surfacing the failure to the
// per-base catch. (The store itself is now built in place — no rename — so the WAL-mode handle that
// close() leaves locked on Windows no longer has to be released for a file move; this retry only
// guards the raw/ snapshot writeFile and the mkdir, which a transient AV scan can still block.)
const TRANSIENT_FS_LOCK_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const FS_RETRY_MAX_ATTEMPTS = 8
const FS_RETRY_BASE_DELAY_MS = 100
const FS_RETRY_MAX_DELAY_MS = 1500

// inArray() binds one SQL variable per id; a single UPDATE over the whole degrade set would
// overflow SQLite's bound-variable cap once a corpus accumulates enough orphaned directory items.
// Chunk well under the cap, matching the repo convention (FileRefService / ChatMigrator use 500).
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
      const delay = Math.min(FS_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), FS_RETRY_MAX_DELAY_MS)
      await new Promise((resolve) => setTimeout(resolve, delay))
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

/**
 * The per-base plan prepare() retains across the whole migration. It deliberately holds NO
 * vectors/chunk text — only counts and the decisions that must stay stable between prepare() and
 * execute() (the legacy base id to re-read, and each url/note item's resolved snapshot path, whose
 * reservation must happen exactly once). execute() re-reads the legacy vectors and rebuilds a
 * base's materials from scratch inside its own loop iteration, so at most one base's vectors are
 * ever resident at a time instead of every base's for the whole migration (the OOM this guards
 * against: a 28-base corpus with high-dimension embeddings held all 28 bases' vectors at once from
 * the end of prepare() until execute() drained them).
 */
interface PreparedBasePlan {
  baseId: string
  legacyBaseId: string
  materialDirPath: string
  targetDbPath: string
  dimensions: number
  // Which migrated items produced a material, in chunk-assignment order. Metadata only (ids), used
  // for progress-unit accounting and test/log observability — never the chunks/vectors themselves.
  materialItemIds: string[]
  expectedUnitCount: number
  // Distinct embedding hashes across the whole base (the embedding table is keyed
  // by hash, so identical chunk bodies — within or across materials — collapse to one row).
  expectedEmbeddingCount: number
  sourceRowCount: number
  // Each url/note item's resolved snapshot relativePath, decided once here (reserveImportedFileRelativePath
  // must not run twice — a second call could mint a different name and desync the store's material
  // row from the raw/ file execute() writes). execute() reuses these verbatim instead of re-reserving.
  snapshotRelativePathByItemId: Map<string, string>
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
    // v1 bases always carried embeddings, so a migrated base is a vector base.
    usesEmbeddings: true,
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
  // Bases whose vector store never finished building at its runtime index.sqlite (the rebuild threw
  // partway). flushBaseFailures() marks each `failed`/missing_vector_store after the loop so the UI
  // surfaces a restore entry instead of leaving a `completed` base with a missing/partial store and
  // forever-empty search.
  private basesToMarkFailed = new Set<string>()
  // Mappings computed once in prepare() and reused by execute() to re-derive each base's
  // loaderTargetMap without re-querying ctx.db or holding any vectors — none of these carry chunk
  // text or embeddings, so caching them costs nothing next to the OOM they help avoid.
  private legacyBasesById = new Map<string, LegacyKnowledgeBaseWithLoaders & { id: string }>()
  private legacyItemIdRemap = new Map<string, string>()
  private directoryChildLoaderRemapByBase = new Map<string, Map<string, string>>()
  private migratedItemsByBaseId = new Map<string, Map<string, MigratedKnowledgeItemForVector>>()
  // One timestamp for every url/note snapshot this run materializes, set once in prepare() and
  // reused by execute() so both phases stamp the same capture time.
  private capturedAt = ''

  override reset(): void {
    this.sourceCount = 0
    this.skippedCount = 0
    this.warnings = []
    this.skippedWarnings = new Map<string, { count: number; samples: string[] }>()
    this.preparedBasePlans = []
    this.successfulBaseIds = new Set<string>()
    this.executionErrors = []
    this.directoryItemsToDegrade = new Set<string>()
    this.basesToMarkFailed = new Set<string>()
    this.legacyBasesById = new Map<string, LegacyKnowledgeBaseWithLoaders & { id: string }>()
    this.legacyItemIdRemap = new Map<string, string>()
    this.directoryChildLoaderRemapByBase = new Map<string, Map<string, string>>()
    this.migratedItemsByBaseId = new Map<string, Map<string, MigratedKnowledgeItemForVector>>()
    this.capturedAt = ''
  }

  /**
   * Group a base's directory-expanded children by their container item id, derived from the migrated
   * rows themselves: every child carries `groupId = containerId`, and migration sets a non-null
   * `groupId` ONLY on directory-expanded children (standalone items and containers are `null`), so
   * grouping the rows by `groupId` captures every child of the base.
   *
   * This must NOT be derived from the per-base loader remap's values: when two overlapping/duplicate
   * v1 folders share a file's loader id, KnowledgeMigrator's last-write-wins remap keeps only the
   * later child, so the earlier child would be absent from the groups and never degraded — left as a
   * silent `completed` row with no vectors and no raw/ file (an unreindexable orphan). Scanning the
   * rows includes both children, so the one that draws no chunks is still degraded.
   */
  private collectDirectoryGroups(
    baseId: string,
    migratedItemsByBaseId: Map<string, Map<string, MigratedKnowledgeItemForVector>>
  ): Map<string, Set<string>> {
    const groups = new Map<string, Set<string>>()
    const items = migratedItemsByBaseId.get(baseId)
    if (!items) {
      return groups
    }
    for (const item of items.values()) {
      const containerId = item.groupId
      if (!containerId) {
        continue
      }
      // Defensive: only group under an actual directory container that lives in this base.
      const container = items.get(containerId)
      if (!container || container.type !== 'directory') {
        continue
      }
      const bucket = groups.get(containerId) ?? new Set<string>()
      bucket.add(item.id)
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

  private getRuntimeVectorStorePath(knowledgeBaseDir: string, baseId: string): string {
    return path.join(knowledgeBaseDir, baseId, KNOWLEDGE_META_DIR, KNOWLEDGE_VECTOR_STORE_FILE)
  }

  private recordWarning(message: string): void {
    logger.warn(message)
    this.warnings.push(message)
  }

  /**
   * Build the execute() result's warnings: the execute-phase slice of this.warnings (prepare()'s
   * warnings were already returned to the engine and would be double-counted by its prepare+execute
   * merge) plus any execution errors. Without this, execute-phase degradations only reach the log,
   * never the migration summary the engine surfaces to the user.
   */
  private buildExecuteWarnings(prepareWarningCount: number): string[] | undefined {
    const merged = [...this.warnings.slice(prepareWarningCount), ...this.executionErrors]
    return merged.length > 0 ? merged : undefined
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

  /**
   * Loader ids owned by a migrated STANDALONE indexable item (a file/url/note the user added on its
   * own — no group owner) → that item, as opposed to a directory container/child. Used to stop a
   * directory re-attribution from stealing a standalone item's vectors when both claim the same v1
   * loader id (md5(path) collides a file added standalone and inside a folder). A directory legacy
   * item maps to its container (type 'directory', excluded); its children are synthesized, not legacy
   * items, so they never appear here.
   */
  private collectStandaloneLoaderOwners(
    legacyBase: LegacyKnowledgeBaseWithLoaders | undefined,
    migratedItemsById: Map<string, MigratedKnowledgeItemForVector>,
    legacyItemIdRemap: Map<string, string>
  ): Map<string, MigratedKnowledgeItemForVector> {
    const owners = new Map<string, MigratedKnowledgeItemForVector>()
    if (!legacyBase || !Array.isArray(legacyBase.items)) {
      return owners
    }
    for (const item of legacyBase.items) {
      if (!item.id) {
        continue
      }
      const migratedId = legacyItemIdRemap.get(item.id)
      const migrated = migratedId ? migratedItemsById.get(migratedId) : undefined
      // A non-null groupId marks a directory-expanded child; standalone items carry none. Truthy
      // check (not `!== null`) so an undefined groupId is treated the same as null.
      if (!migrated || migrated.groupId || !INDEXABLE_KNOWLEDGE_ITEM_TYPES.has(migrated.type)) {
        continue
      }
      const loaderIds =
        Array.isArray(item.uniqueIds) && item.uniqueIds.length > 0
          ? item.uniqueIds
          : typeof item.uniqueId === 'string' && item.uniqueId.trim() !== ''
            ? [item.uniqueId]
            : []
      for (const loaderId of loaderIds) {
        if (typeof loaderId === 'string' && loaderId.trim() !== '' && !owners.has(loaderId)) {
          owners.set(loaderId, migrated)
        }
      }
    }
    return owners
  }

  /**
   * Combine the base loader→migrated-item map with the directory-child re-attribution pass into the
   * final loaderTargetMap, returning conflict messages instead of recording them directly: prepare()
   * (the only caller that logs warnings) records each message once, while execute() re-derives the
   * identical map from the identical inputs — re-reading the legacy vectors per base rather than
   * retaining them — without re-warning about a conflict already reported.
   */
  private resolveLoaderTargetMap(
    baseId: string,
    legacyBase: LegacyKnowledgeBaseWithLoaders | undefined,
    baseMigratedItems: Map<string, MigratedKnowledgeItemForVector>,
    legacyItemIdRemap: Map<string, string>,
    baseDirectoryChildLoaderRemap: Map<string, string> | undefined
  ): { loaderTargetMap: Map<string, MigratedKnowledgeItemForVector>; conflictWarnings: string[] } {
    const loaderTargetMap = this.buildLoaderTargetMap(legacyBase, baseMigratedItems, legacyItemIdRemap)
    const conflictWarnings: string[] = []

    if (baseDirectoryChildLoaderRemap) {
      const standaloneLoaderOwners = this.collectStandaloneLoaderOwners(
        legacyBase,
        baseMigratedItems,
        legacyItemIdRemap
      )
      for (const [loaderId, owner] of standaloneLoaderOwners) {
        loaderTargetMap.set(loaderId, owner)
      }
      for (const [loaderId, childItemId] of baseDirectoryChildLoaderRemap) {
        if (standaloneLoaderOwners.has(loaderId)) {
          conflictWarnings.push(
            `Knowledge base ${baseId}: loader '${loaderId}' is owned by a standalone item; kept its vectors there and left the directory child to degrade`
          )
          continue
        }
        const child = baseMigratedItems.get(childItemId)
        if (child) {
          loaderTargetMap.set(loaderId, child)
        }
      }
    }

    return { loaderTargetMap, conflictWarnings }
  }

  /**
   * Filter and group legacy vector rows by migrated item, in legacy read order. Pure (no `this`
   * side effects) so prepare() and execute() get byte-identical grouping over the same inputs:
   * prepare() records the returned skips as warnings/counts once, execute() only needs the
   * chunksByItem grouping to rebuild materials and discards the skip list (already recorded).
   */
  private assignVectorRowsToItems(
    baseId: string,
    vectorRows: LegacyKnowledgeVectorRow[],
    loaderTargetMap: Map<string, MigratedKnowledgeItemForVector>,
    dimensions: number
  ): {
    chunksByItem: Map<string, { item: MaterialFieldSource; chunks: MigratedChunk[] }>
    skips: Array<{ reason: string; message: string }>
  } {
    const chunksByItem = new Map<string, { item: MaterialFieldSource; chunks: MigratedChunk[] }>()
    const skips: Array<{ reason: string; message: string }> = []

    for (const row of vectorRows) {
      // V2 only keeps vectors that can be proven to belong to an existing
      // migrated knowledge_item row. Unmapped legacy vectors are treated
      // as invalid index residue and are intentionally dropped.
      const target = loaderTargetMap.get(row.uniqueLoaderId)
      if (!target) {
        skips.push({
          reason: 'unmapped_loader',
          message: `Skipped knowledge vector row in base ${baseId}: uniqueLoaderId '${row.uniqueLoaderId}' cannot be mapped to item.id`
        })
        continue
      }

      if (!INDEXABLE_KNOWLEDGE_ITEM_TYPES.has(target.type)) {
        skips.push({
          reason: 'non_indexable_container',
          message: `Skipped knowledge vector row in base ${baseId}: container item '${target.id}' of type '${target.type}' is not indexable`
        })
        continue
      }

      if (row.vector.status === 'unsupported_encoding') {
        skips.push({
          reason: 'unsupported_vector_encoding',
          message: `Skipped knowledge vector row in base ${baseId}: unsupported vector encoding '${row.vector.encoding}' for uniqueLoaderId '${row.uniqueLoaderId}'`
        })
        continue
      }

      if (row.vector.status === 'missing' || row.vector.value.length === 0) {
        skips.push({
          reason: 'missing_vector_payload',
          message: `Skipped knowledge vector row in base ${baseId}: vector payload missing for uniqueLoaderId '${row.uniqueLoaderId}'`
        })
        continue
      }

      // A vector whose length disagrees with the base's recorded dimensions
      // would make the brute-force cosine scan compare mismatched lengths, so
      // drop it rather than corrupt vector search for the whole base.
      if (row.vector.value.length !== dimensions) {
        skips.push({
          reason: 'dimension_mismatch',
          message: `Skipped knowledge vector row in base ${baseId}: vector length ${row.vector.value.length} != base dimensions ${dimensions} for uniqueLoaderId '${row.uniqueLoaderId}'`
        })
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

    return { chunksByItem, skips }
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      // One timestamp for every snapshot this run materializes; it records when
      // the file was written (the migration), not a page fetch — origin says so.
      this.capturedAt = new Date().toISOString()
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

      for (const item of migratedItems) {
        const bucket = this.migratedItemsByBaseId.get(item.baseId) ?? new Map<string, MigratedKnowledgeItemForVector>()
        bucket.set(item.id, item)
        this.migratedItemsByBaseId.set(item.baseId, bucket)
      }

      this.legacyBasesById = new Map(
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
      this.legacyItemIdRemap = isStringMap(sharedItemRemap) ? sharedItemRemap : new Map<string, string>()
      const sharedDirectoryChildLoaderRemap = ctx.sharedData.get(KNOWLEDGE_DIRECTORY_CHILD_LOADER_REMAP_SHARED_DATA_KEY)
      this.directoryChildLoaderRemapByBase = isNestedStringMap(sharedDirectoryChildLoaderRemap)
        ? sharedDirectoryChildLoaderRemap
        : new Map<string, Map<string, string>>()

      for (const base of migratedBases) {
        // Directory-expanded children/containers KnowledgeMigrator created for this base. If this
        // base is skipped below, none of their vectors land here, so they become orphaned
        // virtual-path docs (markDirectoryGroupsFullyOrphaned); if the base loads, children that
        // receive no chunks are degraded individually (markEmptyDirectoryChildren). The map is
        // empty for bases without directory expansion, so the marker calls are no-ops there.
        const directoryGroups = this.collectDirectoryGroups(base.id, this.migratedItemsByBaseId)

        if (base.status === 'failed' || base.embeddingModelId === null) {
          // Two distinct skip reasons collapse into this branch — attribute each to its real cause so
          // the migration summary doesn't misreport a vector-store failure as a missing model (which
          // would misdirect triage). A base with no embedding model is genuinely unindexable; a base
          // KnowledgeMigrator already marked `failed` with the model still resolved was failed for
          // another reason (e.g. `missing_vector_store` when its legacy store was unreadable), so key
          // the warning on its actual `base.error`.
          if (base.embeddingModelId === null) {
            this.recordSkippedWarning(
              KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
              `Skipped knowledge vector base ${base.id}: missing embedding model`
            )
          } else {
            const reason = base.error ?? KNOWLEDGE_BASE_ERROR_MISSING_VECTOR_STORE
            this.recordSkippedWarning(
              reason,
              `Skipped knowledge vector base ${base.id}: already marked failed (${reason})`
            )
          }
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

        const legacyBase = this.legacyBasesById.get(legacyBaseId)
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

        // A v1 folder's per-file vectors were booked under the directory item's loader ids;
        // KnowledgeMigrator split that folder into per-file children and recorded each file's
        // loader id → child item id, scoped to this migrated base. Point those loader ids at the
        // child (not the directory container) so the vectors land on the child material instead
        // of being dropped as a non-indexable container. The per-base scope keeps a loader id
        // shared across bases (v1 ids are path/content hashes) pointing at the right base's child.
        // A loader id can also be claimed by BOTH a directory expansion and a standalone
        // file/url/note item the user added separately — resolveLoaderTargetMap keeps the
        // standalone as the vector owner (see collectStandaloneLoaderOwners) and reports the
        // conflict instead of silently stealing the standalone's vectors.
        const baseMigratedItems =
          this.migratedItemsByBaseId.get(base.id) ?? new Map<string, MigratedKnowledgeItemForVector>()
        const baseDirectoryChildLoaderRemap = this.directoryChildLoaderRemapByBase.get(base.id)
        const { loaderTargetMap, conflictWarnings } = this.resolveLoaderTargetMap(
          base.id,
          legacyBase,
          baseMigratedItems,
          this.legacyItemIdRemap,
          baseDirectoryChildLoaderRemap
        )
        for (const conflictWarning of conflictWarnings) {
          this.recordSkippedWarning('directory_child_loader_conflict', conflictWarning)
        }

        // Group the surviving chunks by migrated item, preserving legacy read order
        // both across items (first appearance) and within an item (chunk order).
        const { chunksByItem, skips } = this.assignVectorRowsToItems(base.id, vectorRows, loaderTargetMap, dimensions)
        for (const skip of skips) {
          this.skippedCount += 1
          this.recordSkippedWarning(skip.reason, skip.message)
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
        const reservedPaths = collectKnowledgeReservedRelativePaths([...baseMigratedItems.values()], {
          fileProcessorId: base.fileProcessorId
        })

        // Count and plan this base's materials WITHOUT retaining them: buildMigratedRebuildInput's
        // result (chunk text + reused vectors) is only read here for its counts, then falls out of
        // scope at the end of each loop iteration — it is never pushed onto `this.preparedBasePlans`,
        // so a 28-base migration never holds more than one base's vectors at a time. execute() rebuilds
        // the real materials per base, from the legacy DB again, right before writing them.
        const materialItemIds: string[] = []
        const snapshotRelativePathByItemId = new Map<string, string>()
        const baseEmbeddingHashes = new Set<string>()
        let expectedUnitCount = 0
        for (const { item, chunks } of chunksByItem.values()) {
          // A file already has a real base path; a url/note materializes a snapshot
          // this run and pins the row to it (so toMaterialRelativePath never falls back).
          // A re-run after a partial migration may find the row already pinned (and that
          // path already reserved above); reuse it instead of minting a `name-1.md` twin.
          // The decision (not the snapshot text itself) is what execute() must reuse verbatim —
          // reserveImportedFileRelativePath must run exactly once per item.
          let relativePath: string
          if (item.type === 'url') {
            const contentText = joinMigratedChunkText(chunks)
            // buildUrlSnapshotFile is the same OKF-frontmatter + slug derivation the runtime's
            // captureUrlSnapshotFile uses, so a migrated url snapshot is byte-identical to a natively
            // captured one (the snapshot reader strips the frontmatter to round-trip the body).
            const snapshot = buildUrlSnapshotFile(item.data.url, contentText, this.capturedAt)
            relativePath =
              item.data.relativePath ?? reserveImportedFileRelativePath(`${snapshot.slug}.md`, false, reservedPaths)
            snapshotRelativePathByItemId.set(item.id, relativePath)
          } else if (item.type === 'note') {
            const contentText = joinMigratedChunkText(chunks)
            const snapshot = buildNoteSnapshotFile(item.data.source, contentText, this.capturedAt)
            relativePath =
              item.data.relativePath ?? reserveImportedFileRelativePath(`${snapshot.slug}.md`, false, reservedPaths)
            snapshotRelativePathByItemId.set(item.id, relativePath)
          } else {
            relativePath = toMaterialRelativePath(item)
          }

          materialItemIds.push(item.id)
          const material = buildMigratedRebuildInput(item, chunks, relativePath)
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
          legacyBaseId,
          materialDirPath: path.join(ctx.paths.knowledgeBaseDir, base.id, KNOWLEDGE_MATERIAL_ROOT_DIR),
          targetDbPath: this.getRuntimeVectorStorePath(ctx.paths.knowledgeBaseDir, base.id),
          dimensions,
          materialItemIds,
          expectedUnitCount,
          expectedEmbeddingCount: baseEmbeddingHashes.size,
          sourceRowCount: vectorRows.length,
          snapshotRelativePathByItemId,
          directoryGroups
        })
      }

      this.flushSkippedWarnings()

      return {
        success: true,
        itemCount: this.sourceCount,
        warnings: this.warnings.length > 0 ? [...this.warnings] : undefined
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

  /**
   * Mark every base whose vector store never finished building (collected in execute()'s per-base
   * catch when the rebuild threw before completion) as a restorable `failed` row, after wiping the
   * partial index it left behind. Without this the base stays `completed` and the runtime mounts an
   * empty/partial store: search and the chunk list return nothing forever, and nothing reindexes on
   * its own (KnowledgeVectorStoreService only logs the empty-store state). `missing_vector_store` is
   * the same restorable error prepare()'s unreadable-store branch sets, so the UI offers a re-index
   * that rebuilds from the migrated raw/ files. Best-effort and chunked like flushDirectoryDegradations:
   * a failed UPDATE is recorded as a warning, never thrown, so it cannot abort the surviving bases.
   */
  private async flushBaseFailures(ctx: MigrationContext): Promise<void> {
    if (this.basesToMarkFailed.size === 0) {
      return
    }
    const ids = [...this.basesToMarkFailed]
    let failedCount = 0
    for (let offset = 0; offset < ids.length; offset += DEGRADE_UPDATE_CHUNK) {
      const batch = ids.slice(offset, offset + DEGRADE_UPDATE_CHUNK)
      try {
        await ctx.db
          .update(knowledgeBaseTable)
          .set({ status: 'failed', error: KNOWLEDGE_BASE_ERROR_MISSING_VECTOR_STORE })
          .where(inArray(knowledgeBaseTable.id, batch))
        failedCount += batch.length
      } catch (error) {
        // Best-effort per batch: one failed batch must not abort the rest of the pass.
        this.recordWarning(
          `Failed to mark ${batch.length} knowledge base(s) failed after vector store promotion failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    logger.info('Marked knowledge bases failed after vector store promotion failed', {
      failedCount,
      totalCount: ids.length
    })
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    // Warnings collected so far are prepare()'s and were already returned to the engine; capture the
    // boundary so execute() surfaces only its own warnings (the engine merges prepare + execute, so
    // re-returning prepare's would double-count them).
    const prepareWarningCount = this.warnings.length
    if (this.preparedBasePlans.length === 0) {
      // No vector plan survived prepare(); still degrade items orphaned there (a base whose only
      // content was a directory expansion) before returning.
      await this.flushDirectoryDegradations(ctx)
      return {
        success: true,
        processedCount: 0,
        warnings: this.buildExecuteWarnings(prepareWarningCount)
      }
    }

    const totalWork = this.preparedBasePlans.reduce((sum, plan) => sum + Math.max(plan.materialItemIds.length, 1), 0)
    let processedWork = 0
    let processedCount = 0

    for (const plan of this.preparedBasePlans) {
      // Did the store finish building at its runtime path? Flipped true once the build + close
      // succeeds. It gates the per-base catch: a failure BEFORE the store is complete (rebuild threw)
      // leaves a partial/empty index that must be wiped and the base marked restorable `failed`; a
      // failure AFTER (the snapshot-pin UPDATE) leaves a complete, searchable store that must be kept
      // and the base left as-is.
      let storePromoted = false

      try {
        // Rebuild THIS base's materials right here, in this iteration's local scope, by re-reading
        // its legacy vectors — prepare() intentionally did not retain them (see PreparedBasePlan).
        // `materials`/`materialSnapshots` fall out of scope at the end of this iteration, so at most
        // one base's vectors are ever resident, instead of every base's for the whole migration.
        const legacyBase = this.legacyBasesById.get(plan.legacyBaseId)
        const baseMigratedItems =
          this.migratedItemsByBaseId.get(plan.baseId) ?? new Map<string, MigratedKnowledgeItemForVector>()
        const baseDirectoryChildLoaderRemap = this.directoryChildLoaderRemapByBase.get(plan.baseId)

        const source = await ctx.sources.knowledgeVectorSource.loadBase(plan.legacyBaseId)
        if (source.status !== 'ok') {
          throw new Error(
            `Knowledge vector base ${plan.baseId}: legacy vector DB unavailable at execute time (status=${source.status})`
          )
        }

        const { loaderTargetMap } = this.resolveLoaderTargetMap(
          plan.baseId,
          legacyBase,
          baseMigratedItems,
          this.legacyItemIdRemap,
          baseDirectoryChildLoaderRemap
        )
        // Conflict/skip classification was already recorded by prepare()'s pass over the same
        // inputs — only the chunksByItem grouping is needed here to rebuild materials.
        const { chunksByItem } = this.assignVectorRowsToItems(
          plan.baseId,
          source.rows,
          loaderTargetMap,
          plan.dimensions
        )

        const materials: PreparedMaterial[] = []
        const materialSnapshots: PlannedMaterialSnapshot[] = []
        for (const { item, chunks } of chunksByItem.values()) {
          let relativePath: string
          if (item.type === 'url' || item.type === 'note') {
            // prepare() decided this exactly once; reusing it here (rather than re-deriving via
            // reserveImportedFileRelativePath) keeps the store's material row in sync with whatever
            // path validate() and any cross-base uniqueness check already accounted for.
            const plannedRelativePath = plan.snapshotRelativePathByItemId.get(item.id)
            if (plannedRelativePath === undefined) {
              throw new Error(
                `Knowledge vector base ${plan.baseId}: missing planned snapshot relative path for item '${item.id}'`
              )
            }
            relativePath = plannedRelativePath
            const contentText = joinMigratedChunkText(chunks)
            const fileText =
              item.type === 'url'
                ? buildUrlSnapshotFile(item.data.url, contentText, this.capturedAt).fileText
                : buildNoteSnapshotFile(item.data.source, contentText, this.capturedAt).fileText
            materialSnapshots.push({ itemId: item.id, relativePath, fileText, data: { ...item.data, relativePath } })
          } else {
            relativePath = toMaterialRelativePath(item)
          }

          materials.push(buildMigratedRebuildInput(item, chunks, relativePath))
        }

        await retryOnTransientFsLock(() => fs.promises.mkdir(path.dirname(plan.targetDbPath), { recursive: true }))
        // Defensive clear before building: the runtime path is normally fresh (KnowledgeMigrator mints
        // a new uuid dir per run), but wipe any stale store + WAL sidecars so a build always starts
        // clean. It lives under the migrated base's new uuid dir (never the legacy flat path), so the
        // v1 embedjs DB is untouched and a failed migration leaves v1 fully usable.
        await this.removeIndexStoreFiles(plan.targetDbPath)

        // Build the store DIRECTLY at its runtime index.sqlite — no temp file, no rename. The store is
        // opened through createKnowledgeIndexStoreAtPath — the exact factory the runtime
        // (KnowledgeVectorStoreService) uses — so the result is byte-for-byte a store the runtime would
        // produce.
        //
        // Why not build a temp store and rename it on? The rename was the migration's single most
        // fragile step on Windows. The index store opens index.sqlite in WAL mode, and WAL mode on Windows
        // is known to keep a lock on the MAIN db file past close() — wal_checkpoint(TRUNCATE), PERSIST_WAL
        // and multi-second waits do NOT release it (oven-sh/bun#25964) — on top of the AV/Search-
        // Indexer scan that opens the just-written file without DELETE share. MoveFileEx needs DELETE
        // access on the source, so the rename threw EBUSY/EPERM and the base lost its store. A retry
        // only helps the transient AV case; it cannot wait out a handle that close() never released.
        // Building in place removes the move entirely: whatever lock lingers after close() is harmless
        // because nothing here moves or reopens the file; the runtime opens it only after bootstrap
        // (well after migration finishes), by which point the lock is gone.
        //
        // This trades the rename's crash-atomicity (an interrupted build leaves a partial index at the
        // runtime path) for that robustness — safe because the migration gate re-runs from scratch on
        // any non-completed run: verifyAndClearNewTables() wipes the rows, KnowledgeMigrator re-mints a
        // fresh uuid dir, the runtime never opens a store mid-migration, and the catch below wipes a
        // partial on a caught failure. A crash-orphaned dir is never referenced by a knowledge_base row
        // so it is never mounted (it is dead disk, the same as the rename path produced).
        const store = createKnowledgeIndexStoreAtPath(plan.targetDbPath, { baseId: plan.baseId })
        try {
          for (const material of materials) {
            await store.rebuildMaterial(material.itemId, material.input)
            processedWork += 1
            this.reportRebuildProgress(processedWork, totalWork)
            await yieldToEventLoop()
          }

          // Fold the WAL back into the main db file so the committed pages are durable in index.sqlite
          // itself (the WAL is not guaranteed to be checkpointed on close); the runtime then opens a
          // self-contained store.
          store.checkpoint()
        } finally {
          // Close so the file handle is released (a leaked handle would block a re-run's
          // removeIndexStoreFiles and the later base-dir deletion on Windows).
          await store.close()
        }
        // Build + close succeeded: the complete store sits at its runtime path. A later failure
        // (snapshot-pin) leaves it present and searchable, so it must NOT be wiped or marked failed.
        storePromoted = true

        if (materials.length === 0) {
          processedWork += 1
          this.reportRebuildProgress(processedWork, totalWork)
          await yieldToEventLoop()
        }

        // Materialize each migrated url/note snapshot file under the base's `raw/`
        // material root (overwriting a previous partial run's copy) and pin the item
        // row to it, so the runtime's ensure-snapshot step reads it offline at
        // {baseDir}/raw/{relativePath} (a url instead of re-fetching the page, a note
        // instead of re-deriving from data). The material root may not exist yet (a
        // url/note-only base copies no files), so ensure it first.
        if (materialSnapshots.length > 0) {
          await retryOnTransientFsLock(() => fs.promises.mkdir(plan.materialDirPath, { recursive: true }))
        }
        for (const snapshot of materialSnapshots) {
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
          materials: materials.length,
          materialSnapshots: materialSnapshots.length,
          units: plan.expectedUnitCount,
          embeddings: plan.expectedEmbeddingCount
        })
      } catch (error) {
        const errorMessage = `Knowledge vector base ${plan.baseId} execution failed: ${error instanceof Error ? error.message : String(error)}`
        logger.error(errorMessage, error instanceof Error ? error : new Error(String(error)))
        this.executionErrors.push(errorMessage)

        // If the store never finished building, wipe the partial/empty index left at the runtime path
        // so the runtime cannot later mount a half-built store (a complete store from a post-build
        // snapshot-pin failure is kept — storePromoted). Cleanup must not throw past the loop: on
        // Windows a locked index.sqlite can make rm reject even after retries, which would mask the
        // real errorMessage and abort the whole migration.
        if (!storePromoted) {
          try {
            await this.removeIndexStoreFiles(plan.targetDbPath)
          } catch (cleanupError) {
            logger.warn('Partial index store cleanup failed after base execution error', {
              baseId: plan.baseId,
              cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
            })
          }
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
        // unreindexable virtual-path orphan).
        //
        // Mark the base itself `failed`/missing_vector_store (flushed after the loop) ONLY when its
        // store never finished building (the rebuild threw; storePromoted still false). Leaving such a
        // base `completed` makes the runtime mount an empty/partial store and return empty search/chunk
        // results forever — there is NO auto-reindex (KnowledgeVectorStoreService only logs the
        // empty-store state, it does not rebuild). A `failed` base is kept out of the runtime's open
        // path and surfaces a restore/re-index entry, matching prepare()'s restorable
        // unreadable-store branch. Regular file/url/note rows stay `completed`; restore re-reads them
        // from their migrated raw/ files regardless of status, so they need no per-item degrade.
        // If the build already completed (storePromoted) and only the snapshot-pin threw, the store
        // is present and searchable — do not mark it failed and force a needless full re-index.
        this.skippedCount += plan.expectedUnitCount
        this.markDirectoryGroupsFullyOrphaned(plan.directoryGroups)
        if (!storePromoted) {
          this.basesToMarkFailed.add(plan.baseId)
        }
        continue
      }
    }

    // Persist all directory degradations now: both those collected in prepare() and those added in
    // the per-base catch above for bases that failed mid-rebuild. Running it after the loop (rather
    // than before) is what lets a failed base's directory items reach `failed` once the per-base
    // skip keeps the overall migration alive.
    await this.flushDirectoryDegradations(ctx)
    // Mark every base whose store could not be promoted as a restorable `failed` row (same deferral
    // rationale as the degrade pass: after the loop, so a per-base promote failure does not abort
    // the surviving bases).
    await this.flushBaseFailures(ctx)

    logger.info('KnowledgeVectorMigrator.execute completed', {
      processedCount,
      successfulBaseCount: this.successfulBaseIds.size,
      warningCount: this.warnings.length,
      executionErrorCount: this.executionErrors.length
    })

    return {
      success: true,
      processedCount,
      warnings: this.buildExecuteWarnings(prepareWarningCount)
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
        const snapshotRelativePaths = [...plan.snapshotRelativePathByItemId.values()]
        const missingSnapshots = snapshotRelativePaths.filter(
          (relativePath) => !fs.existsSync(path.join(plan.materialDirPath, relativePath))
        )
        if (missingSnapshots.length > 0) {
          errors.push({
            key: `knowledge_vector_material_snapshots_${plan.baseId}`,
            expected: snapshotRelativePaths.length,
            actual: snapshotRelativePaths.length - missingSnapshots.length,
            message: `Missing ${missingSnapshots.length} materialized url/note snapshot files in base ${plan.baseId}: ${missingSnapshots
              .slice(0, SKIP_WARNING_SAMPLE_LIMIT)
              .join(', ')}`
          })
        }

        // Reopen through createKnowledgeIndexStoreAtPath — the same factory the runtime and the build
        // phase use — not a bare new Database: its driver sets busy_timeout=5000, so this re-read of the
        // just-built store waits out a transient Windows lock (Defender / indexer scanning the
        // freshly-written file) instead of throwing SQLITE_BUSY / EACCES and failing validation for an
        // already-correct store. The factory's schema/meta steps are idempotent on this just-built store
        // (create is IF NOT EXISTS, ensureIndexMeta is INSERT OR IGNORE at the current version), so the
        // counts read below are unchanged. Only difference from a bare read: a store corrupted between
        // build and this reopen (base_id no longer matches) makes ensureIndexMeta throw and fail
        // validation rather than reading stale counts — a stricter, safe outcome, unreachable in this
        // single-threaded in-process migration with no external writer.
        const store = createKnowledgeIndexStoreAtPath(plan.targetDbPath, { baseId: plan.baseId })
        try {
          const counts = store.describeIndexCounts()
          targetCount += counts.units

          this.pushCountMismatch(errors, plan.baseId, 'material', plan.materialItemIds.length, counts.materials)
          this.pushCountMismatch(errors, plan.baseId, 'search_unit', plan.expectedUnitCount, counts.units)
          this.pushCountMismatch(errors, plan.baseId, 'embedding', plan.expectedEmbeddingCount, counts.embeddings)

          // Every unit's body search_text must resolve to a stored embedding, or that
          // unit is silently absent from vector search. This is the migration-time
          // form of the rebuild self-heal invariant (knowledge-technical-design.md §10).
          if (counts.unitsMissingEmbedding > 0) {
            errors.push({
              key: `knowledge_vector_uncovered_units_${plan.baseId}`,
              expected: 0,
              actual: counts.unitsMissingEmbedding,
              message: `Found ${counts.unitsMissingEmbedding} knowledge search_text rows without a stored embedding in base ${plan.baseId}`
            })
          }
        } finally {
          await store.close()
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
