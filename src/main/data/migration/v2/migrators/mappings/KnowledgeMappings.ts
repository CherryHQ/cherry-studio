import type { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { nextFreeKnowledgeRelativePath } from '@main/utils/knowledge'
import { sanitizeFilename } from '@main/utils/legacyFile'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  DEFAULT_KNOWLEDGE_BASE_STATUS,
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED,
  KNOWLEDGE_NOTE_CONTENT_MAX,
  type KnowledgeItemData,
  type KnowledgeItemStatus
} from '@shared/data/types/knowledge'
import type { FileMetadata } from '@shared/data/types/legacyFile'
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid'

import { legacyModelToUniqueId } from '../transformers/ModelTransformers'
import { hasLostOriginalFilename, legacyStorageNames } from './LegacyFileMappings'

export type NewKnowledgeBase = typeof knowledgeBaseTable.$inferInsert
export type NewKnowledgeItem = typeof knowledgeItemTable.$inferInsert

export type LegacyKnowledgeItemType = 'file' | 'url' | 'note' | 'sitemap' | 'directory' | 'memory' | 'video'

export type LegacyProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface LegacyModel {
  id: string
  name: string
  provider: string
  group?: string
}

export interface LegacyPreprocessConfig {
  type: 'preprocess'
  provider: {
    id: string
  }
}

export type LegacyFileReference = Pick<FileMetadata, 'id'> & Partial<FileMetadata>

export interface LegacyKnowledgeItem {
  id?: string
  type?: LegacyKnowledgeItemType
  content?: string | FileMetadata | LegacyFileReference | FileMetadata[]
  created_at?: number
  updated_at?: number
  processingStatus?: LegacyProcessingStatus
  processingError?: string
  uniqueId?: string
  // A v1 `directory` item collects every embedded child file's loader id here
  // (KnowledgeService.directoryTask pushes each addFileLoader result); the v2
  // migration reads these to re-attribute the folder's vectors to per-file items.
  uniqueIds?: string[]
  sourceUrl?: string
}

export interface LegacyKnowledgeBase {
  id?: string
  name?: string
  dimensions?: number
  model?: LegacyModel | null
  rerankModel?: LegacyModel | null
  preprocessProvider?: LegacyPreprocessConfig
  chunkSize?: number
  chunkOverlap?: number
  threshold?: number
  documentCount?: number
  created_at?: number
  updated_at?: number
  items?: LegacyKnowledgeItem[]
}

export type LegacyKnowledgeBaseWithIdentity = LegacyKnowledgeBase & {
  id: string
  name: string
}

export interface LegacyKnowledgeState {
  bases?: LegacyKnowledgeBase[]
}

export interface LegacyKnowledgeNote {
  id: string
  content?: string
  sourceUrl?: string
}

export type KnowledgeBaseTransformResult = { ok: true; value: NewKnowledgeBase }

/**
 * Side-channel emitted for migrated `file` items so the migrator can copy the
 * legacy upload into the v2 knowledge base directory during `execute`. The
 * physical file lives at `<filesDataDir>/<storageName>` (v1 storage name =
 * `{id}{ext}`), never at the stale `path` column (#15733).
 */
export type KnowledgeItemFileCopy = { storageNames: string[] }

export type KnowledgeItemTransformResult =
  | { ok: true; value: NewKnowledgeItem; fileCopy?: KnowledgeItemFileCopy }
  | {
      ok: false
      reason:
        | 'missing_id_or_type'
        | 'unsupported_type'
        | 'invalid_file'
        | 'invalid_url'
        | 'invalid_sitemap'
        | 'invalid_directory'
        | 'invalid_note'
    }

const hasCompleteFileMetadata = (value: LegacyKnowledgeItem['content'] | FileMetadata): value is FileMetadata =>
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

export const toTimestamp = (value: number | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  return Date.now()
}

export const inferKnowledgeItemStatus = (
  item: Pick<LegacyKnowledgeItem, 'processingStatus' | 'uniqueId'>
): KnowledgeItemStatus => {
  if (
    item.processingStatus === 'failed' ||
    item.processingStatus === 'processing' ||
    item.processingStatus === 'pending'
  ) {
    return 'failed'
  }

  return typeof item.uniqueId === 'string' && item.uniqueId.trim() !== '' ? 'completed' : 'idle'
}

const normalizeKnowledgeItemError = (
  status: KnowledgeItemStatus,
  processingStatus: LegacyProcessingStatus | undefined,
  processingError: string | undefined
): string | null => {
  if (status !== 'failed') {
    return null
  }

  const normalizedError = processingError?.trim()
  if (normalizedError) {
    return normalizedError
  }

  if (processingStatus === 'pending' || processingStatus === 'processing') {
    return 'Legacy knowledge item indexing was interrupted and needs to be retried.'
  }

  return 'Legacy knowledge item failed without an error message.'
}

const getDefaultChunkOverlap = (chunkSize: number): number => {
  if (chunkSize <= 1) {
    return 0
  }

  return Math.min(DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP, chunkSize - 1)
}

function normalizeMigratedKnowledgeBaseConfig<T extends Partial<NewKnowledgeBase>>(config: T): T {
  const normalized = { ...config }

  const chunkSizeCandidate = normalized.chunkSize
  const chunkSize =
    typeof chunkSizeCandidate === 'number' && Number.isInteger(chunkSizeCandidate) && chunkSizeCandidate > 0
      ? chunkSizeCandidate
      : DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE
  normalized.chunkSize = chunkSize as T['chunkSize']

  const chunkOverlapCandidate = normalized.chunkOverlap
  if (
    typeof chunkOverlapCandidate !== 'number' ||
    !Number.isInteger(chunkOverlapCandidate) ||
    chunkOverlapCandidate < 0 ||
    chunkOverlapCandidate >= chunkSize
  ) {
    normalized.chunkOverlap = getDefaultChunkOverlap(chunkSize) as T['chunkOverlap']
  }

  if (normalized.documentCount != null && normalized.documentCount <= 0) {
    normalized.documentCount = undefined as T['documentCount']
  }

  if (normalized.threshold != null && (normalized.threshold < 0 || normalized.threshold > 1)) {
    normalized.threshold = undefined as T['threshold']
  }

  return normalized
}

export const resolveLegacyFileMetadata = (
  content: LegacyKnowledgeItem['content'],
  filesById: Map<string, FileMetadata>
): FileMetadata | null => {
  if (hasCompleteFileMetadata(content)) {
    return content
  }

  if (typeof content === 'string') {
    return filesById.get(content) ?? null
  }

  if (typeof content === 'object' && content !== null && !Array.isArray(content) && typeof content.id === 'string') {
    const fallback = filesById.get(content.id)
    if (!fallback) {
      return null
    }

    const merged = { ...fallback, ...content }
    return hasCompleteFileMetadata(merged) ? merged : null
  }

  return null
}

export const transformKnowledgeBase = (
  base: LegacyKnowledgeBaseWithIdentity,
  dimensions: number | null,
  onWarning?: (message: string) => void
): KnowledgeBaseTransformResult => {
  const embeddingModelId = legacyModelToUniqueId(base.model ?? null)
  const rerankModelId = legacyModelToUniqueId(base.rerankModel ?? null)

  // The identity guard only checks `name !== ''`, so an all-whitespace v1
  // name reaches here — but the read path (KnowledgeBaseSchema) requires
  // `trim().min(1)` and one such row poisons the whole list query.
  // Write-side validation must be >= read-side: trim, and fall back to
  // the v1 base id when nothing remains.
  const trimmedName = base.name.trim()
  if (trimmedName === '') {
    onWarning?.(`Knowledge base ${base.id} has a blank v1 name; falling back to the base id`)
  }

  const transformedBase: NewKnowledgeBase = {
    id: uuidv4(),
    name: trimmedName || base.id,
    groupId: null,
    dimensions,
    embeddingModelId,
    status: embeddingModelId ? DEFAULT_KNOWLEDGE_BASE_STATUS : 'failed',
    error: embeddingModelId ? null : KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
    rerankModelId: rerankModelId ?? null,
    fileProcessorId: base.preprocessProvider?.provider?.id,
    chunkSize: base.chunkSize ?? DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
    chunkOverlap: base.chunkOverlap ?? DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
    threshold: base.threshold,
    documentCount: base.documentCount,
    createdAt: toTimestamp(base.created_at),
    updatedAt: toTimestamp(base.updated_at)
  }

  return {
    ok: true,
    value: normalizeMigratedKnowledgeBaseConfig(transformedBase)
  }
}

export const transformKnowledgeItem = (
  baseId: string,
  item: LegacyKnowledgeItem,
  deps: {
    noteById: Map<string, LegacyKnowledgeNote>
    filesById: Map<string, FileMetadata>
  },
  onWarning?: (message: string) => void
): KnowledgeItemTransformResult => {
  if (!item?.id || !item?.type) {
    return {
      ok: false,
      reason: 'missing_id_or_type'
    }
  }

  let type: NewKnowledgeItem['type']
  let data: KnowledgeItemData
  let fileCopy: KnowledgeItemFileCopy | undefined

  if (item.type === 'file') {
    const file = resolveLegacyFileMetadata(item.content, deps.filesById)
    if (!file) {
      return {
        ok: false,
        reason: 'invalid_file'
      }
    }

    type = 'file'
    // `origin_name` is the user-facing filename, but a blank one short-circuits
    // sanitizeFilename to '' (before its 'untitled' guard) and a blank
    // relativePath fails the read path (FileItemDataSchema `.min(1)`), poisoning
    // the whole base's item-list query — and resolves the copy destination to
    // the base dir itself. Degrade like FileMigrator.deriveSafeName: storage
    // name (keeps the extension) then the item id. The stale `path` column may
    // carry foreign separators after a cross-platform restore, so the migrator
    // dedupes and copies the file (located via `storageName`) in `execute`.
    const sanitizedName = sanitizeFilename(file.origin_name)
    const relativePath = sanitizedName || sanitizeFilename(file.name) || item.id
    if (!sanitizedName) {
      onWarning?.(
        `Knowledge file item ${item.id} has a blank v1 filename; falling back to ${JSON.stringify(relativePath)}`
      )
    } else if (hasLostOriginalFilename(file)) {
      // Mutually exclusive with the blank case above (this one requires a non-empty origin_name),
      // and both say "the name is not what the user chose" — one notice is enough.
      onWarning?.(
        `Knowledge file item ${item.id}: the original filename was lost by a legacy v1 duplicate-upload bug and ` +
          `cannot be recovered. The file is migrated intact as ${JSON.stringify(relativePath)}.`
      )
    }
    data = { source: file.path, relativePath }
    // Locate the physical upload through the same candidate list `FileMigrator` uses, so one
    // migration run cannot resolve the same row two ways. Never `file.name`: v1
    // FileStorage.findDuplicateFile returns a malformed `name` on a second upload (double
    // extension `a1b2.pdf.pdf` + origin_name set to the storage name), which resolves to a path
    // that does not exist, so the bytes would never reach raw/.
    fileCopy = { storageNames: legacyStorageNames(file) }
  } else if (item.type === 'url') {
    if (typeof item.content !== 'string' || item.content.trim() === '') {
      return {
        ok: false,
        reason: 'invalid_url'
      }
    }

    type = 'url'
    data = {
      source: item.content,
      url: item.content
    }
  } else if (item.type === 'sitemap') {
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (content === '') {
      return {
        ok: false,
        reason: 'invalid_sitemap'
      }
    }

    type = 'url'
    data = {
      source: content,
      url: content
    }
  } else if (item.type === 'directory') {
    if (typeof item.content !== 'string' || item.content.trim() === '') {
      return {
        ok: false,
        reason: 'invalid_directory'
      }
    }

    type = 'directory'
    data = {
      source: item.content
    }
  } else if (item.type === 'note') {
    const note = deps.noteById.get(item.id)
    const rawContent = note?.content ?? (typeof item.content === 'string' ? item.content : '')
    // v1's note editor had no length cap, but the read path (NoteItemDataSchema.content)
    // enforces `.max(KNOWLEDGE_NOTE_CONTENT_MAX)`; a longer note would parse-fail on read
    // and poison the WHOLE base's item-list query. Clamp to the read-side max here, like
    // PromptMigrator filters over-long quick phrases. Truncate (not skip) because the note's
    // content also backstops its `source`, so dropping it would lose recoverable data.
    const content =
      rawContent.length > KNOWLEDGE_NOTE_CONTENT_MAX ? rawContent.slice(0, KNOWLEDGE_NOTE_CONTENT_MAX) : rawContent
    if (content.length !== rawContent.length) {
      onWarning?.(
        `Knowledge note item ${item.id} content exceeded ${KNOWLEDGE_NOTE_CONTENT_MAX} characters; truncated during migration`
      )
    }
    // `||`, not `??`: an empty-string sourceUrl must fall through to a
    // recoverable non-empty content instead of short-circuiting the chain
    // and getting the note dropped as invalid below. The fallback uses the
    // already-clamped `content` so `source` can never exceed it either.
    const source = note?.sourceUrl || item.sourceUrl || content

    // Sibling branches all guard their source against blank values because
    // the read path requires `source: trim().min(1)`; a note with neither
    // sourceUrl nor content has nothing to recover — skip it.
    if (source.trim() === '') {
      return {
        ok: false,
        reason: 'invalid_note'
      }
    }

    type = 'note'
    data = {
      source,
      content
    }
  } else {
    return {
      ok: false,
      reason: 'unsupported_type'
    }
  }

  const inferredStatus = inferKnowledgeItemStatus(item)
  // A v1-indexed folder is one container item whose files were embedded under its
  // loader ids; the vector migrator drops those container-level vectors (no v2
  // home), so letting the directory claim `completed` would leave an empty shell
  // that never re-indexes. Mark it `failed` with a code the UI renders as a
  // delete-and-re-upload prompt (it migrated as a record but its vectors were dropped).
  // Interrupted (failed) and never-indexed (idle) directories keep their inferred status
  // (only a `completed` directory is overridden to `failed`).
  const directoryIndexDropped = type === 'directory' && inferredStatus === 'completed'
  const status = directoryIndexDropped ? 'failed' : inferredStatus

  return {
    ok: true,
    value: {
      id: uuidv7(),
      baseId,
      // Official v1 exports are flat, so migrated items do not carry grouping
      // metadata by default.
      groupId: null,
      type,
      data,
      status,
      error: directoryIndexDropped
        ? KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED
        : normalizeKnowledgeItemError(status, item.processingStatus, item.processingError),
      createdAt: toTimestamp(item.created_at),
      updatedAt: toTimestamp(item.updated_at)
    },
    ...(fileCopy ? { fileCopy } : {})
  }
}

/**
 * Segments of a v1-persisted path, treating both `/` and `\` as separators: a v1 row can carry
 * foreign-platform paths (#15733), and `node:path` is platform-dependent, so the same v1 export
 * migrated on macOS and on Windows would otherwise yield two different `relativePath`s — hence
 * two different display names and two different Concept IDs. Same reasoning as
 * `FileMigrator.basenameAnySep`. `+` folds repeated separators; the filter drops the empty
 * segments a leading/trailing separator produces, plus no-op `.` segments.
 */
const splitLegacyPathSegments = (value: string): string[] =>
  value.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.')

/**
 * Comparison key for "is this the same directory segment?". A cross-platform restore can leave the
 * folder path and its files' paths differing in case or Unicode composition, so containment is
 * tested on the folded key while the emitted path always keeps the original casing. `toLowerCase`
 * (not `toLocaleLowerCase`) to keep this free of locale surprises such as tr-TR's I→ı.
 */
const foldPathSegment = (segment: string): string => segment.normalize('NFC').toLowerCase()

/**
 * Sanitize one path segment. `sanitizeFilename` strips separators, control characters, Windows
 * reserved names and trailing dots/space (so `..` collapses to `untitled`), and only returns ''
 * for an empty input — which the `||` covers. The result is therefore always non-empty and never
 * `.`/`..`/a separator, which is what makes the joined path satisfy
 * `assertSafeKnowledgeRelativePath` by construction (see `expandLegacyDirectoryItem`).
 *
 * The native expansion deliberately does not do this: `chooseDirectoryPathPrefix` takes
 * `path.basename` of a folder that exists on *this* machine and `expandDirectoryNode` reuses the
 * `treePath` it just walked, so their segments are legal here by construction and sanitizing would
 * only misname real files. Migration has no such guarantee — a v1 row can
 * carry a path recorded on another OS (#15733) and there is no local file to check it against — so
 * it must sanitize, and it is the only guarantor that the emitted path is readable at all. The
 * asymmetry is visible exactly once: reindexing the container of a folder named `a<b` on POSIX
 * moves it from the migrated `a_b` to the native `a<b`. Both are valid; see
 * `README-KnowledgeMigrator.md` → "Directory and Legacy Sitemap Semantics".
 */
const toSafePathSegment = (segment: string): string => sanitizeFilename(segment) || 'untitled'

/** A v1 `directory` item expanded into a v2 container plus one `file` child per embedded file. */
export interface ExpandedDirectoryItem {
  container: NewKnowledgeItem
  children: NewKnowledgeItem[]
  /**
   * Each embedded file's v1 loader id → the synthesized v2 child item id, so the
   * vector migrator can re-attribute the folder's vectors to the right child.
   */
  childLoaderRemap: Map<string, string>
  /**
   * The top-level `raw/` name this expansion claimed. The caller must add it to its per-base
   * set of taken top-level names — but only for a non-null result, since a null expansion
   * claims nothing.
   */
  pathPrefix: string
  /**
   * How many children recorded a v1 source outside the folder path (inconsistent v1 data) and
   * were therefore named by filename alone. Returned as a count rather than per-child warnings
   * because migration warnings are an unbounded array rendered in full to the user — one folder
   * with 5000 files must not emit 5000 notices. The caller emits one aggregate warning.
   */
  unrelatedSourceChildCount: number
}

/**
 * Expand a v1-indexed `directory` item into a `completed` container `directory`
 * item plus one `completed` `file` child per embedded file, so the folder's v1
 * vectors can be re-attributed instead of dropped (v1 booked every file under the
 * directory item's loader ids, with no per-file item — see KnowledgeService.
 * directoryTask). `loaderSourceMap` maps each loader id to its source file path
 * (the legacy vector DB's `source` column).
 *
 * Paths mirror a native v2 directory expansion exactly: the container claims a deduped top-level
 * `raw/` prefix (`docs`, `docs_1`, … — the same scheme as `chooseDirectoryPathPrefix`) and each
 * child gets `<prefix>/<path relative to the folder>`, derived purely from the v1 `source` strings.
 * That keeps the display name, the Concept ID and `material.relative_path` readable instead of
 * opaque ids.
 *
 * **No byte is ever copied**: `raw/<prefix>` does not exist, so a child is still not readable from
 * disk and `assertSubtreesCanReindex` still rejects re-indexing it on the missing-source check
 * (path-shaped is not the same as path-backed). Search reads the migrated vectors instead;
 * rebuilding the folder means re-indexing the container (which then fills `raw/<prefix>` for real)
 * or deleting and re-adding it.
 *
 * Two questions this shape invites:
 * - Children deliberately do NOT reserve a processed-artifact (`.md`) slot: they are never handed
 *   to the file processor, so reserving would only push a real sibling `docs/report.md` to
 *   `docs/report_1.md` for nothing — and would drag base-level `fileProcessorId` into this mapping.
 * - A child's `relativePath` now carries a real extension, so `needsFileProcessing` would return
 *   true for it — but no processing job can ever be scheduled: `planKnowledgeItemSource` is only
 *   reached from `scheduleItem`, whose three entry points (`addItems` for newly created items,
 *   `prepareRootJobHandler` for leaves it just created, `reindexSubtreeJobHandler` for the roots it
 *   reset) cannot reach a migrated child.
 *
 * Invariant, relied on by every read path: because each segment goes through `toSafePathSegment`
 * and the prefix is deduped against a set seeded with `CHERRY_META_DIR`, the emitted paths always
 * satisfy `assertSafeKnowledgeRelativePath`. Violating it would turn the graceful "source missing"
 * of reindex admission / restore filtering / preview into a bare `Error`, since
 * `getKnowledgeBaseFilePath` asserts on every one of those paths.
 *
 * `reservedTopLevelNames` is read-only: a null result claims no prefix, so committing the claim is
 * the caller's job (see `pathPrefix`).
 *
 * Returns `null` when the directory's `content` (folder path) is blank, or when no child
 * file can be resolved (vector DB unreadable/empty, or the directory carries no loader ids)
 * — the caller then keeps the tombstone.
 */
export const expandLegacyDirectoryItem = (
  baseId: string,
  item: LegacyKnowledgeItem,
  loaderSourceMap: Map<string, string>,
  reservedTopLevelNames: ReadonlySet<string>
): ExpandedDirectoryItem | null => {
  if (typeof item.content !== 'string' || item.content.trim() === '') {
    return null
  }

  const containerSegments = splitLegacyPathSegments(item.content)
  const containerFold = containerSegments.map(foldPathSegment)
  // A folder name is not a filename: `report.v2` must dedupe to `report.v2_1`, not `report_1.v2`
  // — hence splitExtension=false, matching chooseDirectoryPathPrefix. A path of only separators
  // leaves no segment, so fall back to `root` the way the native chooser does.
  const pathPrefix = nextFreeKnowledgeRelativePath(
    toSafePathSegment(containerSegments.at(-1) ?? 'root'),
    (candidate) => !reservedTopLevelNames.has(candidate),
    false
  )

  const createdAt = toTimestamp(item.created_at)
  const updatedAt = toTimestamp(item.updated_at)
  const containerId = uuidv7()
  const children: NewKnowledgeItem[] = []
  const childLoaderRemap = new Map<string, string>()
  const usedChildPaths = new Set<string>()
  let unrelatedSourceChildCount = 0

  for (const loaderId of item.uniqueIds ?? []) {
    if (typeof loaderId !== 'string' || loaderId.trim() === '') {
      continue
    }
    // One child per distinct loader id. A repeated id would otherwise mint a second child and
    // overwrite the remap, leaving the first one `completed` with zero vectors — an empty shell
    // that looks healthy and is not counted by the re-attribution warning.
    if (childLoaderRemap.has(loaderId)) {
      continue
    }
    const source = loaderSourceMap.get(loaderId)
    if (typeof source !== 'string' || source.trim() === '') {
      continue
    }

    const sourceSegments = splitLegacyPathSegments(source)
    let subSegments: string[]
    if (
      sourceSegments.length > containerSegments.length &&
      containerFold.every((segment, index) => segment === foldPathSegment(sourceSegments[index]))
    ) {
      subSegments = sourceSegments.slice(containerSegments.length)
    } else {
      // v1 booked a file that is not under this folder against this directory item (inconsistent
      // data, or a restore that rewrote paths). Fall back to the filename alone: still readable,
      // and still inside this container's prefix namespace.
      subSegments = sourceSegments.slice(-1)
      unrelatedSourceChildCount += 1
    }
    if (subSegments.length === 0) {
      subSegments = ['untitled']
    }

    // Two distinct v1 sources can collapse onto one path (`a<b.md` / `a>b.md` both sanitize to
    // `a_b.md`, or two fallbacks share a filename). The later one takes `_N`: `material.relative_path`
    // is UNIQUE, and a duplicate makes KnowledgeVectorMigrator's per-base catch wipe the whole
    // base's index.
    const desiredPath = [pathPrefix, ...subSegments.map(toSafePathSegment)].join('/')
    const relativePath = nextFreeKnowledgeRelativePath(desiredPath, (candidate) => !usedChildPaths.has(candidate))
    usedChildPaths.add(relativePath)

    const childId = uuidv7()
    children.push({
      id: childId,
      baseId,
      groupId: containerId,
      type: 'file',
      data: { source, relativePath },
      status: 'completed',
      error: null,
      createdAt,
      updatedAt
    })
    childLoaderRemap.set(loaderId, childId)
  }

  if (children.length === 0) {
    return null
  }

  const container: NewKnowledgeItem = {
    id: containerId,
    baseId,
    groupId: null,
    type: 'directory',
    data: { source: item.content, relativePath: pathPrefix },
    status: 'completed',
    error: null,
    createdAt,
    updatedAt
  }

  return { container, children, childLoaderRemap, pathPrefix, unrelatedSourceChildCount }
}
