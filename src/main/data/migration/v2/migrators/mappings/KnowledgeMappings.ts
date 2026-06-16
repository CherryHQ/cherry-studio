import type { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { sanitizeFilename } from '@main/utils/file'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  DEFAULT_KNOWLEDGE_BASE_STATUS,
  DEFAULT_KNOWLEDGE_SEARCH_MODE,
  KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL,
  type KnowledgeItemData,
  type KnowledgeItemStatus
} from '@shared/data/types/knowledge'
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid'

import { legacyModelToUniqueId } from '../transformers/ModelTransformers'

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
export type KnowledgeItemFileCopy = { storageName: string }

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

  if (normalized.threshold != null && (normalized.threshold < 0 || normalized.threshold > 1)) {
    normalized.threshold = undefined as T['threshold']
  }

  if (normalized.documentCount != null && normalized.documentCount <= 0) {
    normalized.documentCount = undefined as T['documentCount']
  }

  if (normalized.hybridAlpha != null) {
    if (normalized.hybridAlpha < 0 || normalized.hybridAlpha > 1 || normalized.searchMode !== 'hybrid') {
      normalized.hybridAlpha = undefined as T['hybridAlpha']
    }
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
    searchMode: DEFAULT_KNOWLEDGE_SEARCH_MODE,
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
    }
    data = { source: file.path, relativePath }
    fileCopy = { storageName: file.name }
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
      source: item.content,
      path: item.content
    }
  } else if (item.type === 'note') {
    const note = deps.noteById.get(item.id)
    const content = note?.content ?? (typeof item.content === 'string' ? item.content : '')
    // `||`, not `??`: an empty-string sourceUrl must fall through to a
    // recoverable non-empty content instead of short-circuiting the chain
    // and getting the note dropped as invalid below.
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

  const status = inferKnowledgeItemStatus(item)

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
      error: normalizeKnowledgeItemError(status, item.processingStatus, item.processingError),
      createdAt: toTimestamp(item.created_at),
      updatedAt: toTimestamp(item.updated_at)
    },
    ...(fileCopy ? { fileCopy } : {})
  }
}
