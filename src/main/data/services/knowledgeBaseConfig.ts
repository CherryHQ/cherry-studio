import type { KnowledgeSearchMode } from '@shared/data/types/knowledge'

export interface KnowledgeBaseConfigInput {
  chunkSize?: number | null
  chunkOverlap?: number | null
  threshold?: number | null
  documentCount?: number | null
  searchMode?: KnowledgeSearchMode | null
  hybridAlpha?: number | null
}

type FieldErrors = Record<string, string[]>

function addFieldError(fieldErrors: FieldErrors, field: keyof KnowledgeBaseConfigInput, message: string): void {
  if (!fieldErrors[field]) {
    fieldErrors[field] = []
  }

  fieldErrors[field].push(message)
}

export function normalizeKnowledgeBaseConfig<T extends KnowledgeBaseConfigInput>(config: T): T {
  const normalized = { ...config }

  if (normalized.chunkSize != null && normalized.chunkSize <= 0) {
    normalized.chunkSize = undefined as T['chunkSize']
  }

  if (normalized.chunkOverlap != null && normalized.chunkOverlap < 0) {
    normalized.chunkOverlap = undefined as T['chunkOverlap']
  }

  if (normalized.threshold != null && (normalized.threshold < 0 || normalized.threshold > 1)) {
    normalized.threshold = undefined as T['threshold']
  }

  if (normalized.documentCount != null && normalized.documentCount <= 0) {
    normalized.documentCount = undefined as T['documentCount']
  }

  if (normalized.hybridAlpha != null && (normalized.hybridAlpha < 0 || normalized.hybridAlpha > 1)) {
    normalized.hybridAlpha = undefined as T['hybridAlpha']
  }

  return normalizeKnowledgeBaseConfigDependencies(normalized)
}

export function normalizeKnowledgeBaseConfigDependencies<T extends KnowledgeBaseConfigInput>(config: T): T {
  const normalized = { ...config }

  if (normalized.chunkOverlap != null) {
    if (normalized.chunkSize == null || normalized.chunkOverlap >= normalized.chunkSize) {
      normalized.chunkOverlap = undefined as T['chunkOverlap']
    }
  }

  if (normalized.hybridAlpha != null && normalized.searchMode !== 'hybrid') {
    normalized.hybridAlpha = undefined as T['hybridAlpha']
  }

  return normalized
}

export function validateKnowledgeBaseConfig(config: KnowledgeBaseConfigInput): FieldErrors {
  const fieldErrors: FieldErrors = {}

  if (config.chunkSize != null && config.chunkSize <= 0) {
    addFieldError(fieldErrors, 'chunkSize', 'Chunk size must be greater than 0')
  }

  if (config.chunkOverlap != null && config.chunkOverlap < 0) {
    addFieldError(fieldErrors, 'chunkOverlap', 'Chunk overlap must be greater than or equal to 0')
  }

  if (config.threshold != null && (config.threshold < 0 || config.threshold > 1)) {
    addFieldError(fieldErrors, 'threshold', 'Threshold must be between 0 and 1')
  }

  if (config.documentCount != null && config.documentCount <= 0) {
    addFieldError(fieldErrors, 'documentCount', 'Document count must be greater than 0')
  }

  const hybridAlphaIsInRange = config.hybridAlpha == null || (config.hybridAlpha >= 0 && config.hybridAlpha <= 1)
  if (!hybridAlphaIsInRange) {
    addFieldError(fieldErrors, 'hybridAlpha', 'Hybrid alpha must be between 0 and 1')
  }

  const chunkOverlap = config.chunkOverlap
  if (chunkOverlap != null && chunkOverlap >= 0) {
    if (config.chunkSize == null) {
      addFieldError(fieldErrors, 'chunkOverlap', 'Chunk overlap requires chunk size')
    } else if (chunkOverlap >= config.chunkSize) {
      addFieldError(fieldErrors, 'chunkOverlap', 'Chunk overlap must be smaller than chunk size')
    }
  }

  if (config.hybridAlpha != null && hybridAlphaIsInRange && config.searchMode !== 'hybrid') {
    addFieldError(fieldErrors, 'hybridAlpha', 'Hybrid alpha requires hybrid search mode')
  }

  return fieldErrors
}
