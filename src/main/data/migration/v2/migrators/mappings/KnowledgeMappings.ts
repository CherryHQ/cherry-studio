import type { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { FileMetadata } from '@shared/data/types/file'
import type { ItemStatus, KnowledgeItemData } from '@shared/data/types/knowledge'

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
  parentId?: string | null
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

export type KnowledgeBaseTransformResult =
  | { ok: true; value: NewKnowledgeBase }
  | { ok: false; reason: 'embedding_model_missing' }

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

export const toTimestamp = (value: number | undefined): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  return undefined
}

export const toCompositeModelId = (model: LegacyModel | null | undefined): string | null => {
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

export const inferKnowledgeItemStatus = (item: Pick<LegacyKnowledgeItem, 'uniqueId'>): ItemStatus =>
  typeof item.uniqueId === 'string' && item.uniqueId.trim() !== '' ? 'completed' : 'idle'

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
  const embeddingModelId = toCompositeModelId(base.model ?? null)
  if (!embeddingModelId) {
    return {
      ok: false,
      reason: 'embedding_model_missing'
    }
  }

  return {
    ok: true,
    value: {
      id: base.id,
      name: base.name,
      description: base.description,
      dimensions,
      embeddingModelId,
      rerankModelId: toCompositeModelId(base.rerankModel ?? null),
      fileProcessorId: base.preprocessProvider?.provider?.id,
      chunkSize: base.chunkSize,
      chunkOverlap: base.chunkOverlap,
      threshold: base.threshold,
      documentCount: base.documentCount,
      searchMode: 'default',
      createdAt: toTimestamp(base.created_at),
      updatedAt: toTimestamp(base.updated_at)
    }
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
    data = { file }
  } else if (item.type === 'url') {
    if (typeof item.content !== 'string' || item.content.trim() === '') {
      return {
        ok: false,
        reason: 'invalid_url'
      }
    }

    type = 'url'
    data = {
      url: item.content,
      name: item.content
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
      url: item.content,
      name: item.content
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
      path: item.content,
      recursive: true
    }
  } else if (item.type === 'note') {
    const note = deps.noteById.get(item.id)
    const content = note?.content ?? (typeof item.content === 'string' ? item.content : '')

    type = 'note'
    data = {
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
      id: item.id,
      baseId,
      parentId: null,
      type,
      data,
      status: inferKnowledgeItemStatus(item),
      error: item.processingError ?? null,
      createdAt: toTimestamp(item.created_at),
      updatedAt: toTimestamp(item.updated_at)
    }
  }
}
