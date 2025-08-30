import type { ApiClient } from './api'
import type { Model } from './model'

export type MemoryConfig = {
  /**
   * @deprecated use embedderApiClient instead
   */
  embedderModel?: Model
  embedderDimensions?: number
  /**
   * @deprecated use llmApiClient instead
   */
  llmModel?: Model
  embedderApiClient?: ApiClient
  llmApiClient?: ApiClient
  customFactExtractionPrompt?: string
  customUpdateMemoryPrompt?: string
  /** Indicates whether embedding dimensions are automatically detected */
  isAutoDimensions?: boolean
}
export type MemoryItem = {
  id: string
  memory: string
  hash?: string
  createdAt?: string
  updatedAt?: string
  score?: number
  metadata?: Record<string, any>
}
export type MemorySearchResult = {
  results: MemoryItem[]
  relations?: any[]
}
export type MemoryEntity = {
  userId?: string
  agentId?: string
  runId?: string
}
export type MemorySearchFilters = {
  userId?: string
  agentId?: string
  runId?: string
  [key: string]: any
}
export type AddMemoryOptions = MemoryEntity & {
  metadata?: Record<string, any>
  filters?: MemorySearchFilters
  infer?: boolean
}
export type MemorySearchOptions = MemoryEntity & {
  limit?: number
  filters?: MemorySearchFilters
}
export type MemoryHistoryItem = {
  id: number
  memoryId: string
  previousValue?: string
  newValue: string
  action: 'ADD' | 'UPDATE' | 'DELETE'
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}
export type MemoryListOptions = MemoryEntity & {
  limit?: number
  offset?: number
}
export type MemoryDeleteAllOptions = MemoryEntity
