import type { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { FileMetadata } from '@shared/data/types/file'
import {
  DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP,
  DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE,
  DEFAULT_KNOWLEDGE_BASE_EMOJI,
  DEFAULT_KNOWLEDGE_SEARCH_MODE,
  type KnowledgeItemData,
  type KnowledgeItemStatus
} from '@shared/data/types/knowledge'

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
  description?: string
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

export type KnowledgeItemTransformResult =
  | { ok: true; value: NewKnowledgeItem }
  | {
      ok: false
      reason:
        | 'missing_id_or_type'
        | 'unsupported_type'
        | 'invalid_file'
        | 'invalid_url'
        | 'invalid_sitemap'
        | 'invalid_directory'
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

export const inferKnowledgeItemStatus = (item: Pick<LegacyKnowledgeItem, 'uniqueId'>): KnowledgeItemStatus =>
  typeof item.uniqueId === 'string' && item.uniqueId.trim() !== '' ? 'completed' : 'idle'

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
  dimensions: number
): KnowledgeBaseTransformResult => {
  const embeddingModelId = legacyModelToUniqueId(base.model ?? null)
  const rerankModelId = legacyModelToUniqueId(base.rerankModel ?? null)

  const transformedBase: NewKnowledgeBase = {
    id: base.id,
    name: base.name,
    description: base.description,
    groupId: null,
    emoji: DEFAULT_KNOWLEDGE_BASE_EMOJI,
    dimensions,
    embeddingModelId: embeddingModelId ?? null,
    rerankModelId: rerankModelId ?? null,
    fileProcessorId: base.preprocessProvider?.provider?.id,
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap,
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
  }
): KnowledgeItemTransformResult => {
  if (!item?.id || !item?.type) {
    return {
      ok: false,
      reason: 'missing_id_or_type'
    }
  }

  let type: NewKnowledgeItem['type']
  let data: KnowledgeItemData

  if (item.type === 'file') {
    const file = resolveLegacyFileMetadata(item.content, deps.filesById)
    if (!file) {
      return {
        ok: false,
        reason: 'invalid_file'
      }
    }

    type = 'file'
    data = { source: file.path, file }
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
    if (typeof item.content !== 'string' || item.content.trim() === '') {
      return {
        ok: false,
        reason: 'invalid_sitemap'
      }
    }

    type = 'sitemap'
    data = {
      source: item.content,
      url: item.content
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

    type = 'note'
    data = {
      source: note?.sourceUrl ?? item.sourceUrl ?? content,
      content,
      sourceUrl: note?.sourceUrl ?? item.sourceUrl
    }
  } else {
    return {
      ok: false,
      reason: 'unsupported_type'
    }
  }

  return {
    ok: true,
    value: {
      // Preserve legacy item IDs during migration for identity stability.
      // UUID v7 ordering benefits apply only to knowledge items created after migration.
      id: item.id,
      baseId,
      // Official v1 exports are flat, so migrated items do not carry grouping
      // metadata by default.
      groupId: null,
      type,
      data,
      status: inferKnowledgeItemStatus(item),
      phase: null,
      error: item.processingError ?? null,
      createdAt: toTimestamp(item.created_at),
      updatedAt: toTimestamp(item.updated_at)
    }
  }
}
