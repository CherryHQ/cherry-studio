// Memory Service Types

import { ApiClient, Model } from './ai'

// ========================================================================
export interface MemoryConfig {
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

export interface MemoryItem {
  id: string
  memory: string
  hash?: string
  createdAt?: string
  updatedAt?: string
  score?: number
  metadata?: Record<string, any>
}

export interface MemorySearchResult {
  results: MemoryItem[]
  relations?: any[]
}

export interface MemoryEntity {
  userId?: string
  agentId?: string
  runId?: string
}

export interface MemorySearchFilters {
  userId?: string
  agentId?: string
  runId?: string
  [key: string]: any
}

export interface AddMemoryOptions extends MemoryEntity {
  metadata?: Record<string, any>
  filters?: MemorySearchFilters
  infer?: boolean
}

export interface MemorySearchOptions extends MemoryEntity {
  limit?: number
  filters?: MemorySearchFilters
}

export interface MemoryHistoryItem {
  id: number
  memoryId: string
  previousValue?: string
  newValue: string
  action: 'ADD' | 'UPDATE' | 'DELETE'
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

export interface MemoryListOptions extends MemoryEntity {
  limit?: number
  offset?: number
}

export interface MemoryDeleteAllOptions extends MemoryEntity {}
